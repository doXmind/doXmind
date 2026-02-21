/**
 * Global serialized mermaid renderer.
 *
 * Mermaid's render() function uses global DOM state internally and is NOT
 * safe to call concurrently. This module provides a promise queue that
 * serializes all render calls, initializes mermaid once, and retries once
 * on failure.
 */

let mermaidInstance: typeof import("mermaid").default | null = null;
let lastTheme: string | null = null;
let renderCounter = 0;

// Promise queue: each render waits for the previous one to finish
let renderQueue: Promise<void> = Promise.resolve();

/**
 * Ensure mermaid is imported and initialized.
 * Re-initializes only if the theme has changed.
 */
async function ensureInitialized(): Promise<typeof import("mermaid").default> {
  const isDark = document.documentElement.classList.contains("dark");
  const currentTheme = isDark ? "dark" : "default";

  if (!mermaidInstance) {
    const { default: mermaid } = await import("mermaid");
    mermaidInstance = mermaid;
  }

  if (lastTheme !== currentTheme) {
    mermaidInstance.initialize({
      startOnLoad: false,
      theme: currentTheme,
      securityLevel: "loose",
    });
    lastTheme = currentTheme;
  }

  return mermaidInstance;
}

/**
 * Internal: perform a single render attempt.
 */
async function doRender(code: string): Promise<string> {
  const mermaid = await ensureInitialized();
  const id = `mermaid-${Date.now()}-${renderCounter++}`;
  const { svg } = await mermaid.render(id, code);

  // Clean up only the specific temporary element mermaid may have left
  const tempEl = document.getElementById(id);
  if (tempEl && !tempEl.closest(".mermaid-rendered")) {
    tempEl.remove();
  }

  return svg;
}

/**
 * Render mermaid code to SVG string.
 *
 * - Serialized: only one render runs at a time via a promise queue.
 * - Retries once on failure with a short delay.
 */
export function renderMermaidSvg(code: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    renderQueue = renderQueue.then(async () => {
      try {
        const svg = await doRender(code);
        resolve(svg);
      } catch {
        // Retry once after a short delay — the first failure may be due to
        // mermaid's global state being dirty from a prior failed render.
        try {
          await new Promise((r) => setTimeout(r, 100));
          const svg = await doRender(code);
          resolve(svg);
        } catch (secondError) {
          reject(secondError);
        }
      }
    });
  });
}
