"use client";

import { useCallback, useState, useEffect } from "react";
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { LanguageSelector } from "./language-selector";
import { LineNumbers } from "./line-numbers";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

export function CodeBlockNodeView({
  node,
  updateAttributes,
}: NodeViewProps) {
  const { language } = node.attrs;
  const [copied, setCopied] = useState(false);
  const [lineCount, setLineCount] = useState(1);

  // Calculate line count from content
  useEffect(() => {
    const text = node.textContent || "";
    const lines = text.split("\n").length;
    setLineCount(Math.max(1, lines));
  }, [node.textContent]);

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
      {/* Code Block Container - Notion Style */}
      <div className="code-block-container relative overflow-hidden rounded-lg border border-border/60 bg-muted/30 hover:border-border transition-colors">
        {/* Header with Language Selector and Copy Button */}
        <div className="code-block-header flex items-center justify-between px-2 py-1.5 border-b border-border/40 bg-muted/40">
          {/* Language Selector */}
          <LanguageSelector value={language} onChange={handleLanguageChange} />

          {/* Copy Button */}
          <Tooltip content={copied ? "Copied!" : "Copy code"} side="top">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 mr-1 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5 mr-1" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </Tooltip>
        </div>

        {/* Code Area with Line Numbers */}
        <div className="code-block-body flex overflow-x-auto">
          {/* Line Numbers */}
          <LineNumbers count={lineCount} />

          {/* Code Content */}
          <div className="flex-1 min-w-0">
            <NodeViewContent
              as="pre"
              className={cn(
                "code-block-content",
                "p-4 pl-4 font-mono text-sm leading-relaxed",
                "focus:outline-none",
                "bg-transparent",
                language && `language-${language}`
              )}
            />
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  );
}
