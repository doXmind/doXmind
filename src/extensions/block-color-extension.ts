/**
 * Block Color Extension for TipTap
 *
 * Adds textColor and backgroundColor global attributes to block-level nodes.
 * Used by the Block Action Menu to apply Notion-style block colors.
 */

import { Extension } from "@tiptap/core";

const COLORED_TYPES = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
  "callout",
  "toggle",
];

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NAMED_COLOR = /^[a-z]+$/i;
const FUNCTIONAL_COLOR = /^(?:rgb|rgba|hsl|hsla)\([0-9a-z.,%\s/+-]*\)$/i;

/**
 * Colours come out of the document, which is untrusted input (docs/adr/0011),
 * and land in a `style` attribute. Anything that is not a plain CSS colour
 * could smuggle in a second declaration, so it is dropped on parse.
 */
function readColor(value: string | null): string | null {
  if (!value) return null;
  const color = value.trim();
  if (HEX_COLOR.test(color) || NAMED_COLOR.test(color) || FUNCTIONAL_COLOR.test(color)) {
    return color;
  }
  return null;
}

export const BlockColorExtension = Extension.create({
  name: "blockColor",

  addGlobalAttributes() {
    return [
      {
        types: COLORED_TYPES,
        attributes: {
          textColor: {
            default: null,
            parseHTML: (element) => readColor(element.getAttribute("data-text-color")),
            renderHTML: (attributes) => {
              if (!attributes.textColor) return {};
              return {
                "data-text-color": attributes.textColor,
                style: `color: ${attributes.textColor}`,
              };
            },
          },
          backgroundColor: {
            default: null,
            parseHTML: (element) => readColor(element.getAttribute("data-bg-color")),
            renderHTML: (attributes) => {
              if (!attributes.backgroundColor) return {};
              return {
                "data-bg-color": attributes.backgroundColor,
                style: `background-color: ${attributes.backgroundColor}; padding: 2px 4px; border-radius: 4px`,
              };
            },
          },
        },
      },
    ];
  },
});
