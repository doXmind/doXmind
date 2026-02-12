/**
 * Block Color Extension for TipTap
 *
 * Adds textColor and backgroundColor global attributes to block-level nodes.
 * Used by the Block Action Menu to apply Notion-style block colors.
 */

import { Extension } from "@tiptap/core";

export const BlockColorExtension = Extension.create({
  name: "blockColor",

  addGlobalAttributes() {
    return [
      {
        types: [
          "paragraph",
          "heading",
          "blockquote",
          "bulletList",
          "orderedList",
          "taskList",
          "callout",
          "toggle",
        ],
        attributes: {
          textColor: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-text-color") || null,
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
            parseHTML: (element) => element.getAttribute("data-bg-color") || null,
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
