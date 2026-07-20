import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { useLayoutStore } from "@/stores/layout-store";

/**
 * Presentation mode shipped as an overlay with no entry point anywhere in the
 * UI and an extension list that built an invalid ProseMirror schema. It was
 * removed rather than repaired; these assertions keep the store state, the
 * stylesheet and the translations from drifting back in without a real
 * surface behind them.
 */
describe("presentation mode surface", () => {
  it("leaves no state on the layout store", () => {
    const leftovers = Object.keys(useLayoutStore.getState()).filter((key) =>
      /presentation/i.test(key)
    );
    expect(leftovers).toEqual([]);
  });

  it("leaves no translations behind", () => {
    expect("presentation" in en.editor).toBe(false);
    expect("presentation" in zh.editor).toBe(false);
  });

  it("ships no component or stylesheet", () => {
    const src = join(process.cwd(), "src");
    expect(existsSync(join(src, "components/editor/presentation-mode.tsx"))).toBe(false);
    expect(existsSync(join(src, "app/styles/presentation.css"))).toBe(false);
  });
});
