import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

type HighlightRange = { from: number; to: number };

export const InlineAISelectionHighlightPluginKey = new PluginKey<HighlightRange[] | null>(
  "inlineAISelectionHighlight"
);

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    inlineAISelectionHighlight: {
      setInlineAISelectionHighlight: (from: number, to: number) => ReturnType;
      setInlineAISelectionHighlights: (ranges: HighlightRange[]) => ReturnType;
      clearInlineAISelectionHighlight: () => ReturnType;
    };
  }
}

export const InlineAISelectionHighlightExtension = Extension.create({
  name: "inlineAISelectionHighlight",

  addCommands() {
    return {
      setInlineAISelectionHighlight:
        (from: number, to: number) =>
        ({ tr, dispatch }) => {
          if (!dispatch) return true;
          dispatch(tr.setMeta(InlineAISelectionHighlightPluginKey, [{ from, to }]));
          return true;
        },
      setInlineAISelectionHighlights:
        (ranges: HighlightRange[]) =>
        ({ tr, dispatch }) => {
          if (!dispatch) return true;
          dispatch(tr.setMeta(InlineAISelectionHighlightPluginKey, ranges));
          return true;
        },
      clearInlineAISelectionHighlight:
        () =>
        ({ tr, dispatch }) => {
          if (!dispatch) return true;
          dispatch(tr.setMeta(InlineAISelectionHighlightPluginKey, null));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<HighlightRange[] | null>({
        key: InlineAISelectionHighlightPluginKey,
        state: {
          init: (): HighlightRange[] | null => null,
          apply: (tr, value) => {
            const meta = tr.getMeta(InlineAISelectionHighlightPluginKey);
            if (meta !== undefined) {
              const ranges = (meta as HighlightRange[] | null) || null;
              if (!ranges || ranges.length === 0) return null;
              const normalized = ranges
                .filter((r) => typeof r.from === "number" && typeof r.to === "number")
                .map((r) => ({ from: Math.min(r.from, r.to), to: Math.max(r.from, r.to) }))
                .filter((r) => r.to > r.from);
              return normalized.length > 0 ? normalized : null;
            }
            if (!value) return null;
            const mapped = value
              .map((r) => ({
                from: tr.mapping.map(r.from),
                to: tr.mapping.map(r.to),
              }))
              .map((r) => ({ from: Math.min(r.from, r.to), to: Math.max(r.from, r.to) }))
              .filter((r) => r.to > r.from);
            return mapped.length > 0 ? mapped : null;
          },
        },
        props: {
          decorations: (state) => {
            const ranges = InlineAISelectionHighlightPluginKey.getState(state);
            if (!ranges || ranges.length === 0) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              ranges.map((range) =>
                Decoration.inline(range.from, range.to, {
                  class: "inline-ai-selection-highlight",
                })
              )
            );
          },
        },
      }),
    ];
  },
});
