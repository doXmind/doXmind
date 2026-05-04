"use client";

import { useState, useRef } from "react";
import { NodeViewWrapper, NodeViewContent, NodeViewProps } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { EmojiPicker, type EmojiCategory } from "@/components/ui/emoji-picker";
import type { CalloutType } from "@/extensions/callout";

const DEFAULT_EMOJI: Record<CalloutType, string> = {
  info: "💡",
  warning: "⚠️",
  error: "⛔",
  tip: "💡",
};

const CALLOUT_CATEGORIES: EmojiCategory[] = [
  {
    label: "Callout",
    emojis: [
      "💡",
      "👉",
      "☝️",
      "👌",
      "🔑",
      "🚧",
      "⚠️",
      "🔥",
      "📌",
      "✂️",
      "❓",
      "🚫",
      "⛔",
      "⏰",
      "📞",
      "🚨",
      "♻️",
      "✅",
      "🔒",
      "📎",
      "📖",
      "🗣️",
      "➡️",
      "📢",
      "🛠️",
      "⚙️",
      "📝",
      "📋",
      "🎯",
      "⭐",
    ],
  },
  {
    label: "People",
    emojis: [
      "😀",
      "😃",
      "😄",
      "😁",
      "😆",
      "😅",
      "🤣",
      "😂",
      "🙂",
      "🙃",
      "😉",
      "😊",
      "😇",
      "🥰",
      "😍",
      "🤩",
      "😘",
      "😗",
      "☺️",
      "😚",
      "😋",
      "😛",
      "😜",
      "🤪",
      "😝",
      "🤑",
      "🤗",
      "🤭",
      "🤫",
      "🤔",
      "🤐",
      "🤨",
      "😐",
      "😑",
      "😶",
      "😏",
      "😒",
      "🙄",
      "😬",
      "😮",
    ],
  },
  {
    label: "Nature",
    emojis: ["🌱", "🌿", "🍀", "🌸", "🌺", "🌻", "🌲", "🍂", "🌊", "☀️", "🌙", "⛅", "❄️", "🌍"],
  },
  {
    label: "Symbols",
    emojis: ["⭐", "🌟", "✨", "💫", "🔥", "❤️", "💎", "🏆", "🎨", "🎵", "🚀", "⚡", "🌈", "🎉"],
  },
];

export function CalloutNodeView({ node, updateAttributes }: NodeViewProps) {
  const type = (node.attrs.type as CalloutType) || "info";
  const customEmoji = (node.attrs.emoji as string | null) || null;
  const displayEmoji = customEmoji || DEFAULT_EMOJI[type];
  const t = useTranslations("editor");
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleSelect = (emoji: string | null) => {
    updateAttributes({ emoji });
    setIsOpen(false);
  };

  return (
    <NodeViewWrapper className="doxmind-callout-wrapper">
      <div className="doxmind-callout-card">
        <div className="doxmind-callout-icon-slot relative" contentEditable={false}>
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="doxmind-callout-icon-button"
            title={t("callout.changeType")}
          >
            <span aria-hidden="true">{displayEmoji}</span>
          </button>

          {isOpen && buttonRef.current && (
            <EmojiPicker
              anchorRect={buttonRef.current.getBoundingClientRect()}
              onSelect={handleSelect}
              onClose={() => setIsOpen(false)}
              categories={CALLOUT_CATEGORIES}
              removeLabel={t("callout.resetIcon")}
            />
          )}
        </div>

        <NodeViewContent className="doxmind-callout-content" />
      </div>
    </NodeViewWrapper>
  );
}
