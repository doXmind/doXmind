"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { LanguageSelector } from "./language-selector";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

export function CodeBlockNodeView({ node, updateAttributes }: NodeViewProps) {
  const t = useTranslations("editor");
  const { language } = node.attrs;
  const [copied, setCopied] = useState(false);

  // Copy code to clipboard
  const handleCopy = useCallback(async () => {
    const text = node.textContent || "";
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [node.textContent]);

  // Update language
  const handleLanguageChange = useCallback(
    (newLanguage: string) => {
      updateAttributes({ language: newLanguage || null });
    },
    [updateAttributes]
  );

  return (
    <NodeViewWrapper className="code-block-wrapper group relative my-4">
      {/* Notion-style: a single flat surface, no header bar, no line-number
          gutter. The code sits directly on a solid light-gray panel. */}
      <div className="code-block-container relative overflow-hidden rounded-lg">
        {/* Floating controls — language + copy — fade in on hover/focus in
            the top-right corner so the resting block is just code. */}
        <div
          className={cn(
            "code-block-controls absolute right-2 top-2 z-10 flex items-center gap-0.5",
            "opacity-0 transition-opacity duration-150",
            "focus-within:opacity-100 group-hover:opacity-100"
          )}
          contentEditable={false}
        >
          <LanguageSelector value={language} onChange={handleLanguageChange} />
          <Tooltip content={copied ? t("codeCopied") : t("copyCode")} side="top">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </Tooltip>
        </div>

        {/* Code content */}
        <NodeViewContent<"pre">
          as="pre"
          className={cn(
            "code-block-content",
            "p-4 font-mono",
            "focus:outline-none",
            "max-[767px]:p-3",
            language && `language-${language}`
          )}
        />
      </div>
    </NodeViewWrapper>
  );
}
