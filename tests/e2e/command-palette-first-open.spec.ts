import { test, expect, type Page } from "@playwright/test";

import { openPage } from "./block-ux/harness";

/**
 * The first Cmd+P must not wait on React's Suspense fallback throttle.
 *
 * The three overlays used to mount through `next/dynamic`, which wraps its lazy
 * component in `<Suspense fallback={null}>`. The first open suspended, committed
 * that invisible fallback, and React then held the real content back until
 * `FALLBACK_THROTTLE_MS` (300ms) had passed since the fallback commit, so that a
 * loading state could not flash past the user. Measured on the packaged app
 * (n=6): the 17kB palette chunk finished downloading at +2.0ms from the keydown
 * and the dialog did not enter the DOM until +304.4ms. Every open after the
 * first was 1.6-5.8ms.
 *
 * The assertion is on the *gap* between the chunk landing and the dialog
 * appearing rather than on total latency, because that gap is the defect and it
 * is build-independent: dev and production measured within 5ms of each other,
 * since 300ms of waiting costs the same everywhere. Holding the chunk back to
 * +446ms moved the dialog to +454ms — an 8ms gap — which is what proved the
 * 296ms was a timer floor and not work.
 *
 * This cannot be a unit test. React skips the throttle entirely when
 * `ReactSharedInternals.actQueue` is non-null, and every Testing Library render
 * runs inside `act()`, so the defect is invisible in jsdom by construction.
 */

interface FirstOpenProbe {
  keydown: number | null;
  dialog: number | null;
  chunks: number[];
}

type ProbeWindow = Window & { __firstOpenProbe?: FirstOpenProbe };

async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe: FirstOpenProbe = { keydown: null, dialog: null, chunks: [] };
    (window as ProbeWindow).__firstOpenProbe = probe;
    document.addEventListener(
      "keydown",
      (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "p" && probe.keydown === null) {
          probe.keydown = performance.now();
        }
      },
      true
    );
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (
          probe.keydown !== null &&
          entry.startTime >= probe.keydown &&
          entry.name.endsWith(".js")
        ) {
          probe.chunks.push((entry as PerformanceResourceTiming).responseEnd);
        }
      }
    }).observe({ type: "resource" });
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('[role="dialog"]') || node.querySelector('[role="dialog"]')) {
            probe.dialog = performance.now();
            observer.disconnect();
            return;
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

async function readProbe(page: Page): Promise<FirstOpenProbe | undefined> {
  return page.evaluate(() => (window as ProbeWindow).__firstOpenProbe);
}

test("the first command palette open commits as soon as its chunk lands", async ({ page }) => {
  await openPage(page, "First Open", "# First Open\n\nOne paragraph.\n");
  await installProbe(page);

  await page.keyboard.press("Meta+p");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();

  const probe = await readProbe(page);
  if (!probe?.keydown || !probe.dialog) throw new Error("probe did not observe the first open");

  // The palette is still code-split: its chunk is requested by the keystroke,
  // not prefetched at boot. Without this the gap below could be satisfied by
  // paying for the chunk during editor startup instead, which is a different
  // trade and not the one measured here.
  expect(probe.chunks.length).toBeGreaterThan(0);

  const chunkLanded = Math.max(...probe.chunks) - probe.keydown;
  const dialogAppeared = probe.dialog - probe.keydown;
  const gap = dialogAppeared - chunkLanded;

  // Measured against the dev server, which inflates absolute latency 2.7-6.1x:
  // 296ms of gap before this fix, 13ms after. 100ms sits an order of magnitude
  // below the throttle it guards against and ~7x above the honest cost.
  // The bound is looser on CI, where four shards of two workers share a runner: main and this
  // branch both measured 107ms and 112.3ms against the 100ms below, which is runner contention
  // rather than a throttle creeping back. 250 still catches what this test was written for — the
  // regression it pins measured 296ms — while 100 keeps its edge where the machine is quiet.
  const gapBudget = process.env.CI ? 250 : 100;
  expect(gap, `dialog appeared ${gap.toFixed(1)}ms after its chunk landed`).toBeLessThan(gapBudget);

  // What the user feels. Dev measured 331.8ms before and 32.5ms after; the
  // sanctioned menu-entry animation is "only around 150ms"
  // (docs/BLOCK_UX_REFERENCE.md), so a first open may not cost more than the
  // whole animation again on top of it.
  expect(dialogAppeared).toBeLessThan(process.env.CI ? 500 : 200);
});
