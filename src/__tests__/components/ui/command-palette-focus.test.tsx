import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandPalette } from "@/components/ui/command-palette";
import { useFileStore } from "@/stores/file-store";
import en from "@/messages/en.json";

/**
 * The palette must take focus on the commit that renders it.
 *
 * It used to render `null` on its first commit — a `mounted` state flag flipped
 * in an effect, the usual client-only guard for `createPortal` — and schedule
 * its auto-focus in a `requestAnimationFrame`. So the focus callback and the
 * re-render that actually put the input in the DOM were two independent pieces
 * of work racing each other, and the callback ran once with no retry: lose the
 * race and focus was dropped for good. The dialog then sat open with the caret
 * still in the Page behind it and the user's typing went into their Markdown.
 *
 * Nothing caught it because the palette used to mount through `next/dynamic`,
 * whose Suspense fallback made React hold the first open for 300ms
 * (FALLBACK_THROTTLE_MS); a commit landing after 300ms of an idle main thread
 * always won. Opening promptly dropped it to 3 first-opens in 10 that focused.
 *
 * Asserting on focus straight after `render` is what makes this a real guard:
 * `act` flushes effects but not animation frames, so the deferred version fails
 * here and only the version that focuses during its own effect passes.
 */

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const withIntl = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
    {node}
  </NextIntlClientProvider>
);

describe("Command palette focus", () => {
  beforeEach(() => {
    useFileStore.setState({ files: [], rootPath: null, currentFileId: null });
  });

  it("focuses its search input on the commit that renders it", () => {
    render(withIntl(<CommandPalette open onClose={vi.fn()} />));

    expect(screen.getByLabelText("Search commands")).toHaveFocus();
  });
});
