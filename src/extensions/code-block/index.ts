import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { common, createLowlight } from "lowlight";
import { CodeBlockNodeView } from "@/components/editor/code-block/code-block-node-view";

// Initialize lowlight with common languages
export const lowlight = createLowlight(common);

export interface CustomCodeBlockOptions {
  HTMLAttributes: Record<string, unknown>;
  lowlight: ReturnType<typeof createLowlight>;
  defaultLanguage: string | null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    customCodeBlock: {
      setCodeBlockLanguage: (language: string) => ReturnType;
    };
  }
}

export const CustomCodeBlock = CodeBlockLowlight.extend<CustomCodeBlockOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      lowlight,
      defaultLanguage: null,
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockNodeView);
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setCodeBlockLanguage:
        (language: string) =>
        ({ commands }) => {
          return commands.updateAttributes("codeBlock", { language });
        },
    };
  },
});
