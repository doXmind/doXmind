import { Node, mergeAttributes } from "@tiptap/core";
import type { Extension, Mark } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { MermaidChart } from "@/extensions/mermaid";
import { Callout } from "@/extensions/callout";
import { InlineMath, BlockMath } from "@/extensions/math";
import { Toggle, ToggleSummary, ToggleBody } from "@/extensions/toggle";
import { PageLink } from "@/extensions/page-link";

type CustomBlockNode = Pick<ProseMirrorNode, "attrs"> | { attrs?: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTipTapExtension = Node<any> | Mark<any> | Extension<any>;
type ExternalReferenceBlockType = "pdf-block" | "excel-block";
type SelfContainedBlockType = "mermaid" | "callout" | "math" | "toggle" | "page-link";

export type CustomBlockCategory = "self-contained" | "external-reference";

interface BaseCustomBlockExtension {
  blockType: string;
  category: CustomBlockCategory;
  extensions: readonly AnyTipTapExtension[];
}

export interface ExternalReferenceCustomBlockExtension extends BaseCustomBlockExtension {
  category: "external-reference";
  extractIdFromNode(node: CustomBlockNode): string;
  extractSrcFromNode(node: CustomBlockNode): string;
  placeholderTemplate(id: string, src: string): string;
}

export interface SelfContainedCustomBlockExtension extends BaseCustomBlockExtension {
  category: "self-contained";
}

export type CustomBlockExtension =
  | ExternalReferenceCustomBlockExtension
  | SelfContainedCustomBlockExtension;

export interface ExternalReferencePlaceholder {
  blockType: ExternalReferenceBlockType;
  id: string;
  src: string;
  attrs: string;
}

export interface ExternalReferenceBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const CUSTOM_BLOCK_PLACEHOLDER_REGEX =
  /^<!--\s*(pdf-block|excel-block)\s+id="([^"]+)"\s+src="([^"]+)"(.*?)\s*-->(?:\n|$)/;

export const PdfBlock = createExternalReferenceBlockExtension({
  name: "pdfBlock",
  blockType: "pdf-block",
  label: "PDF",
});

export const ExcelBlock = createExternalReferenceBlockExtension({
  name: "excelBlock",
  blockType: "excel-block",
  label: "Excel",
});

type CustomBlockExtensionsMap = {
  [K in ExternalReferenceBlockType]: ExternalReferenceCustomBlockExtension;
} & {
  [K in SelfContainedBlockType]: SelfContainedCustomBlockExtension;
};

export const CustomBlockExtensions: CustomBlockExtensionsMap = {
  "pdf-block": createExternalReferenceRegistryEntry("pdf-block", PdfBlock),
  "excel-block": createExternalReferenceRegistryEntry("excel-block", ExcelBlock),
  mermaid: { blockType: "mermaid", category: "self-contained", extensions: [MermaidChart] },
  callout: { blockType: "callout", category: "self-contained", extensions: [Callout] },
  math: { blockType: "math", category: "self-contained", extensions: [InlineMath, BlockMath] },
  toggle: {
    blockType: "toggle",
    category: "self-contained",
    extensions: [Toggle, ToggleSummary, ToggleBody],
  },
  "page-link": { blockType: "page-link", category: "self-contained", extensions: [PageLink] },
};

export const customBlockExtensionsByType: Record<string, CustomBlockExtension> =
  CustomBlockExtensions;

export const customBlockTipTapExtensions: AnyTipTapExtension[] = Object.values(
  CustomBlockExtensions
).flatMap((entry) => [...entry.extensions]);

export function parseCustomBlockPlaceholder(
  source: string
): ExternalReferencePlaceholder | null {
  const trimmed = source.trim();
  const match = CUSTOM_BLOCK_PLACEHOLDER_REGEX.exec(trimmed);
  if (!match || match[0].trim() !== trimmed) return null;
  return placeholderFromMatch(match);
}

export function parseCustomBlockPlaceholderComment(
  node: Comment | string
): ExternalReferencePlaceholder | null {
  if (typeof node === "string") return parseCustomBlockPlaceholder(node);
  return parseCustomBlockPlaceholder(`<!--${node.data}-->`);
}

function createExternalReferenceRegistryEntry(
  blockType: ExternalReferenceBlockType,
  extension: Node<ExternalReferenceBlockOptions>
): ExternalReferenceCustomBlockExtension {
  return {
    blockType,
    category: "external-reference",
    extensions: [extension],
    extractIdFromNode: (node) => readStringAttr(node, "id"),
    extractSrcFromNode: (node) => readStringAttr(node, "src"),
    placeholderTemplate: (id, src) => placeholderTemplateFor(blockType, id, src),
  };
}

function createExternalReferenceBlockExtension({
  name,
  blockType,
  label,
}: {
  name: string;
  blockType: ExternalReferenceBlockType;
  label: string;
}): Node<ExternalReferenceBlockOptions> {
  return Node.create<ExternalReferenceBlockOptions>({
    name,

    group: "block",

    atom: true,

    draggable: true,

    markdownTokenName: name,

    markdownTokenizer: {
      name,
      level: "block" as const,
      start: "<!--",
      tokenize(src: string) {
        const match = CUSTOM_BLOCK_PLACEHOLDER_REGEX.exec(src);
        if (!match) return undefined;
        const placeholder = placeholderFromMatch(match);
        if (placeholder.blockType !== blockType) return undefined;

        return {
          type: name,
          raw: match[0],
          id: placeholder.id,
          src: placeholder.src,
          attrs: placeholder.attrs,
        };
      },
    },

    addOptions() {
      return {
        HTMLAttributes: {},
      };
    },

    addAttributes() {
      return {
        id: {
          default: "",
          parseHTML: (element) => element.getAttribute("data-id") || "",
          renderHTML: (attributes) => ({ "data-id": attributes.id }),
        },
        src: {
          default: "",
          parseHTML: (element) => element.getAttribute("data-src") || "",
          renderHTML: (attributes) => ({ "data-src": attributes.src }),
        },
      };
    },

    parseMarkdown(token, helpers) {
      return helpers.createNode(name, {
        id: token.id || "",
        src: token.src || "",
      });
    },

    renderMarkdown(node): string {
      const id = readStringAttr(node, "id");
      const src = readStringAttr(node, "src");
      if (!id || !src) return "";
      return placeholderTemplateFor(blockType, id, src);
    },

    parseHTML() {
      return [
        {
          tag: `div[data-type="${blockType}"]`,
        },
      ];
    },

    renderHTML({ HTMLAttributes }) {
      return [
        "div",
        mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
          "data-type": blockType,
          class: "custom-block-external-reference",
        }),
        `${label}: ${HTMLAttributes["data-src"] || ""}`,
      ];
    },
  });
}

function placeholderFromMatch(match: RegExpExecArray): ExternalReferencePlaceholder {
  return {
    blockType: match[1] as ExternalReferenceBlockType,
    id: match[2] ?? "",
    src: match[3] ?? "",
    attrs: match[4] ?? "",
  };
}

function placeholderTemplateFor(blockType: ExternalReferenceBlockType, id: string, src: string) {
  return `<!-- ${blockType} id="${id}" src="${src}" -->`;
}

function readStringAttr(node: CustomBlockNode, attr: "id" | "src"): string {
  const value = node.attrs?.[attr];
  return typeof value === "string" ? value : "";
}
