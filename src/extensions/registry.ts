import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

type CustomBlockNode = Pick<ProseMirrorNode, "attrs"> | { attrs?: Record<string, unknown> };
type TipTapExtensionDefinition = Node<ExternalReferenceBlockOptions>;
type ExternalReferenceBlockType = "pdf-block" | "excel-block";

export type CustomBlockCategory = "self-contained" | "external-reference";

interface BaseCustomBlockExtension {
  blockType: string;
  category: CustomBlockCategory;
  extension: TipTapExtensionDefinition;
}

export interface ExternalReferenceCustomBlockExtension extends BaseCustomBlockExtension {
  category: "external-reference";
  extractIdFromNode(node: CustomBlockNode): string;
  extractSrcFromNode(node: CustomBlockNode): string;
  placeholderTemplate(id: string, src: string): string;
}

export interface SelfContainedCustomBlockExtension extends BaseCustomBlockExtension {
  // Self-contained blocks are migrated in slice #34.
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

export const PdfBlock: TipTapExtensionDefinition = createExternalReferenceBlockExtension({
  name: "pdfBlock",
  blockType: "pdf-block",
  label: "PDF",
});

export const ExcelBlock: TipTapExtensionDefinition = createExternalReferenceBlockExtension({
  name: "excelBlock",
  blockType: "excel-block",
  label: "Excel",
});

export const CustomBlockExtensions: Record<
  ExternalReferenceBlockType,
  ExternalReferenceCustomBlockExtension
> = {
  "pdf-block": createExternalReferenceRegistryEntry("pdf-block", PdfBlock),
  "excel-block": createExternalReferenceRegistryEntry("excel-block", ExcelBlock),
};

export const customBlockExtensionsByType: Record<string, CustomBlockExtension> =
  CustomBlockExtensions;

export const customBlockTipTapExtensions = Object.values(CustomBlockExtensions).map(
  (entry) => entry.extension
);

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
  extension: TipTapExtensionDefinition
): ExternalReferenceCustomBlockExtension {
  return {
    blockType,
    category: "external-reference",
    extension,
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
}): TipTapExtensionDefinition {
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
