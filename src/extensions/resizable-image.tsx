import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ImageNodeView } from "@/components/editor/image-node-view";
import { toast } from "sonner";
import { api } from "@/lib/api";

export interface ResizableImageOptions {
  HTMLAttributes: Record<string, unknown>;
  allowBase64: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function uploadAndInsertImage(file: File, view: any, pos?: number) {
  if (!file.type.startsWith("image/")) return false;

  const altText = file.name.replace(/\.[^.]+$/, "");

  const insertImageNode = (src: string) => {
    const node = view.state.schema.nodes.image.create({ src, alt: altText });
    const tr = view.state.tr;
    if (pos !== undefined) {
      tr.insert(pos, node);
    } else {
      tr.replaceSelectionWith(node);
    }
    view.dispatch(tr);
  };

  try {
    const result = await api.uploadImage(file);
    insertImageNode(result.url);
    return true;
  } catch {
    // Fallback to data URL if upload fails
    toast.error("Server upload failed, using embedded image instead");
    const reader = new FileReader();
    reader.onload = () => insertImageNode(reader.result as string);
    reader.readAsDataURL(file);
    return true;
  }
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    resizableImage: {
      setImage: (options: {
        src: string;
        alt?: string;
        title?: string;
        width?: number | string;
        height?: number | string;
        align?: "left" | "center" | "right";
      }) => ReturnType;
      setImageAlign: (align: "left" | "center" | "right") => ReturnType;
      setImageSize: (options: { width: number; height: number }) => ReturnType;
    };
  }
}

export const ResizableImage = Node.create<ResizableImageOptions>({
  name: "image",

  addOptions() {
    return {
      HTMLAttributes: {},
      allowBase64: false,
    };
  },

  group: "block",

  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const width = element.getAttribute("width") || element.style.width;
          return width ? parseInt(width, 10) : null;
        },
        renderHTML: (attributes) => {
          if (!attributes.width) {
            return {};
          }
          return {
            width: attributes.width,
          };
        },
      },
      height: {
        default: null,
        parseHTML: (element) => {
          const height = element.getAttribute("height") || element.style.height;
          return height ? parseInt(height, 10) : null;
        },
        renderHTML: (attributes) => {
          if (!attributes.height) {
            return {};
          }
          return {
            height: attributes.height,
          };
        },
      },
      align: {
        default: "center",
        parseHTML: (element) => {
          return element.getAttribute("data-align") || "center";
        },
        renderHTML: (attributes) => {
          return {
            "data-align": attributes.align,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "img[src]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },

  addCommands() {
    return {
      setImage:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
      setImageAlign:
        (align) =>
        ({ commands }) => {
          return commands.updateAttributes(this.name, { align });
        },
      setImageSize:
        (options) =>
        ({ commands }) => {
          return commands.updateAttributes(this.name, {
            width: options.width,
            height: options.height,
          });
        },
    };
  },

  addInputRules() {
    return [
      {
        find: /!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\)/,
        handler: ({ state, range, match }) => {
          const [, alt, src, title] = match;
          const { tr } = state;

          if (src) {
            const node = this.type.create({ src, alt, title });
            tr.replaceWith(range.from, range.to, node);
          }
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("imageUpload"),
        props: {
          handlePaste: (_view, event) => {
            const items = event.clipboardData?.items;
            if (!items) return false;

            for (const item of Array.from(items)) {
              if (item.type.startsWith("image/")) {
                const file = item.getAsFile();
                if (file) {
                  event.preventDefault();
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  uploadAndInsertImage(file, _view as any);
                  return true;
                }
              }
            }
            return false;
          },
          handleDrop: (_view, event) => {
            const files = event.dataTransfer?.files;
            if (!files || files.length === 0) return false;

            const imageFile = Array.from(files).find((f) => f.type.startsWith("image/"));
            if (!imageFile) return false;

            event.preventDefault();
            const coordinates = _view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            uploadAndInsertImage(imageFile, _view as any, coordinates?.pos);
            return true;
          },
        },
      }),
    ];
  },
});
