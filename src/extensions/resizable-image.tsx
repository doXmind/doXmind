import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ImageNodeView } from "@/components/editor/image-node-view";
import { notify } from "@/lib/notifications";
import { api } from "@/lib/api";
import { parseUploadError } from "@/lib/utils/image-upload-errors";

export interface ResizableImageOptions {
  HTMLAttributes: Record<string, unknown>;
  allowBase64: boolean;
}

/**
 * Plugin that manages upload placeholder decorations.
 * Uses Decoration.widget so the placeholder exists only in the view layer,
 * never mutating the document. DecorationSet.map() automatically tracks
 * positions through document changes, fixing the position drift bug.
 */
const ImageUploadPlaceholderKey = new PluginKey<DecorationSet>("imageUploadPlaceholder");

function createImageUploadPlaceholderPlugin() {
  return new Plugin({
    key: ImageUploadPlaceholderKey,
    state: {
      init() {
        return DecorationSet.empty;
      },
      apply(tr, set) {
        // Map existing decorations through document changes
        set = set.map(tr.mapping, tr.doc);

        const action = tr.getMeta(ImageUploadPlaceholderKey);
        if (action?.type === "add") {
          const deco = Decoration.widget(
            action.pos,
            () => {
              const el = document.createElement("div");
              el.className =
                "image-upload-placeholder flex items-center gap-2 py-3 px-4 my-1 " +
                "rounded-lg bg-muted/50 text-muted-foreground text-sm";
              el.innerHTML =
                '<div class="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>' +
                "Uploading image\u2026";
              return el;
            },
            { id: action.id, side: 0 }
          );
          set = set.add(tr.doc, [deco]);
        } else if (action?.type === "remove") {
          const toRemove = set.find(undefined, undefined, (spec) => spec.id === action.id);
          if (toRemove.length > 0) {
            set = set.remove(toRemove);
          }
        }
        return set;
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function uploadAndInsertImage(file: File, view: any, pos?: number) {
  if (!file.type.startsWith("image/")) return false;

  const altText = file.name.replace(/\.[^.]+$/, "");
  const { state } = view;
  const insertPos = pos !== undefined ? pos : state.selection.from;
  const uploadId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Add placeholder decoration (no document mutation — position tracks automatically)
  const tr = state.tr.setMeta(ImageUploadPlaceholderKey, {
    type: "add",
    pos: insertPos,
    id: uploadId,
  });
  view.dispatch(tr);

  try {
    const result = await api.uploadImage(file);

    // Read the decoration's current tracked position
    const currentState = view.state;
    const decoSet = ImageUploadPlaceholderKey.getState(currentState);
    const placeholders = decoSet?.find(undefined, undefined, (spec) => spec.id === uploadId) || [];
    const trackedPos = placeholders.length > 0 ? placeholders[0].from : insertPos;

    // Insert image at tracked position and remove placeholder decoration
    const imageNode = currentState.schema.nodes.image.create({
      src: result.url,
      alt: altText,
    });

    const insertTr = currentState.tr
      .insert(trackedPos, imageNode)
      .setMeta(ImageUploadPlaceholderKey, { type: "remove", id: uploadId });
    view.dispatch(insertTr);

    return true;
  } catch (error) {
    // Remove placeholder decoration only — nothing to clean up in the document
    try {
      const currentState = view.state;
      const removeTr = currentState.tr.setMeta(ImageUploadPlaceholderKey, {
        type: "remove",
        id: uploadId,
      });
      view.dispatch(removeTr);
    } catch {
      // View may have been destroyed during upload
    }

    const errorMessage = parseUploadError(error);
    notify.error(errorMessage);

    return false;
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

  // Markdown: ![alt](src "title")
  markdownTokenName: "image",

  parseMarkdown(token, helpers) {
    return helpers.createNode("image", {
      src: token.href,
      title: token.title,
      alt: token.text,
    });
  },

  renderMarkdown(node) {
    const src = (node.attrs?.src as string) ?? "";
    const alt = (node.attrs?.alt as string) ?? "";
    const title = (node.attrs?.title as string) ?? "";
    // Empty placeholder (no src) has no portable markdown form — skip it.
    // The node lives in the sidecar HTML and is restored from there on reopen.
    if (!src) return "";
    if (title) return `![${alt}](${src} "${title}")`;
    return `![${alt}](${src})`;
  },

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
        tag: "img",
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
      new InputRule({
        find: /!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\)/,
        handler: ({ state, range, match }) => {
          const [, alt, src, title] = match;
          const { tr } = state;

          if (src) {
            const node = this.type.create({ src, alt, title });
            tr.replaceWith(range.from, range.to, node);
          }
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      createImageUploadPlaceholderPlugin(),
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
