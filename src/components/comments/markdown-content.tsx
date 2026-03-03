"use client";

import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

interface MarkdownContentProps {
  content: string;
  className?: string;
  baseClassName?: string;
}

// Configure a minimal marked instance for comments
const commentMarked = new marked.Renderer();

// Make links open in new tab
commentMarked.link = ({ href, text }: { href: string; text: string }) => {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
};

export function MarkdownContent({ content, className, baseClassName }: MarkdownContentProps) {
  const html = useMemo(() => {
    if (!content) return "";

    try {
      const raw = marked.parse(content, {
        async: false,
        renderer: commentMarked,
        breaks: true, // Treat single newlines as <br>
      }) as string;

      // Sanitize — only allow safe tags for comments
      return DOMPurify.sanitize(raw, {
        ALLOWED_TAGS: [
          "p",
          "br",
          "strong",
          "b",
          "em",
          "i",
          "del",
          "s",
          "code",
          "pre",
          "blockquote",
          "ul",
          "ol",
          "li",
          "a",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "hr",
        ],
        ALLOWED_ATTR: ["href", "target", "rel"],
      });
    } catch {
      return content;
    }
  }, [content]);

  return (
    <div
      className={`${baseClassName ?? "comment-prose text-[14px] leading-relaxed text-foreground/90"} ${className || ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
