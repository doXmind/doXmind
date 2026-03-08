"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { JSONContent } from "@tiptap/core";
import { api } from "@/lib/api";
import { useFileStore } from "@/stores/file-store";

// Model is now determined by backend (uses fast_model)
// No need to hardcode here - backend will use the configured fast_model

const SYSTEM_PROMPT = `You are a presentation assistant. Given a full document, produce a simplified, concise version suitable for presentation slides.

Rules:
1. Keep the document structure — use headings (# for H1, ## for H2) for each section.
2. Separate each section with "---" (horizontal rule) on its own line.
3. Simplify content into short, clear bullet points or concise paragraphs. Remove unnecessary detail.
4. Preserve key information, data, and conclusions.
5. Keep each section to 3-6 bullet points maximum.
6. Use markdown formatting (bold, lists, etc.) as needed.
7. Do NOT add any preamble or explanation — output ONLY the simplified document.
8. Respond in the same language as the input document.
9. Preserve tables that contain important data (numbers, statistics, comparisons). Keep table structure using markdown table format (| Header | Header |).`;

/** Convert a simple markdown string into TipTap JSONContent */
function markdownToJson(md: string): JSONContent {
  const lines = md.split("\n");
  const nodes: JSONContent[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      nodes.push({ type: "horizontalRule" });
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      nodes.push({
        type: "heading",
        attrs: { level },
        content: parseInline(headingMatch[2].trim()),
      });
      i++;
      continue;
    }

    // Bullet list — collect consecutive lines starting with - or *
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      nodes.push({
        type: "bulletList",
        content: items.map((text) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInline(text) }],
        })),
      });
      continue;
    }

    // Numbered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      nodes.push({
        type: "orderedList",
        content: items.map((text) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInline(text) }],
        })),
      });
      continue;
    }

    // Empty line — skip
    if (!line.trim()) {
      i++;
      continue;
    }

    // Regular paragraph
    nodes.push({
      type: "paragraph",
      content: parseInline(line),
    });
    i++;
  }

  return { type: "doc", content: nodes.length > 0 ? nodes : [{ type: "paragraph" }] };
}

/** Parse inline markdown (bold, italic) into TipTap inline nodes */
function parseInline(text: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  // Match **bold** and *italic* patterns
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|([^*]+))/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      // **bold**
      nodes.push({ type: "text", text: match[2], marks: [{ type: "bold" }] });
    } else if (match[3]) {
      // *italic*
      nodes.push({ type: "text", text: match[3], marks: [{ type: "italic" }] });
    } else if (match[4]) {
      nodes.push({ type: "text", text: match[4] });
    }
  }

  return nodes.length > 0 ? nodes : [{ type: "text", text: text || " " }];
}

/** Recursively extract plain text from TipTap JSON */
function extractText(node: JSONContent): string {
  if (node.text) return node.text;
  if (!node.content) return "";
  return node.content.map(extractText).join("");
}

/** Convert TipTap JSON to readable text, preserving structure */
function jsonToReadableText(doc: JSONContent): string {
  if (!doc.content) return "";

  const parts: string[] = [];

  for (const node of doc.content) {
    switch (node.type) {
      case "heading": {
        const level = node.attrs?.level || 1;
        const prefix = "#".repeat(level);
        parts.push(`${prefix} ${extractText(node)}`);
        break;
      }
      case "horizontalRule":
        parts.push("---");
        break;
      case "bulletList":
      case "orderedList": {
        const items = node.content || [];
        items.forEach((item, idx) => {
          const prefix = node.type === "orderedList" ? `${idx + 1}. ` : "- ";
          parts.push(`${prefix}${extractText(item)}`);
        });
        break;
      }
      case "blockquote":
        parts.push(`> ${extractText(node)}`);
        break;
      case "codeBlock":
        parts.push(`\`\`\`\n${extractText(node)}\n\`\`\``);
        break;
      default:
        parts.push(extractText(node));
    }
  }

  return parts.join("\n");
}

/** Load simplified doc from file store */
function loadFromStore(fileId: string): JSONContent | null {
  const file = useFileStore.getState().getFile(fileId);
  if (!file?.presentationSimplified) return null;
  try {
    return JSON.parse(file.presentationSimplified);
  } catch {
    return null;
  }
}

/** Save simplified doc to file store (persists to DB) */
function saveToStore(fileId: string, doc: JSONContent) {
  useFileStore.getState().updateFile(fileId, {
    presentationSimplified: JSON.stringify(doc),
  });
}

export function useSlideSummary(fileId: string | null) {
  const [simplifiedDoc, setSimplifiedDoc] = useState<JSONContent | null>(() =>
    fileId ? loadFromStore(fileId) : null
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Restore from file store when fileId changes
  useEffect(() => {
    setSimplifiedDoc(fileId ? loadFromStore(fileId) : null);
  }, [fileId]);

  const generate = useCallback(
    async (doc: JSONContent) => {
      // Pre-check: block if AI is locked (credits exhausted)
      const { useBillingStore } = await import("@/stores/billing-store");
      if (useBillingStore.getState().isAILocked()) {
        useBillingStore.getState().openUpgradeModal("Upgrade to generate slide summaries");
        return;
      }

      // Cancel any in-flight request
      abortRef.current?.abort();

      const controller = new AbortController();
      abortRef.current = controller;
      setIsGenerating(true);

      try {
        const docText = jsonToReadableText(doc);
        if (!docText.trim() || docText.trim().length < 30) {
          setIsGenerating(false);
          return;
        }

        const { response } = await api.simpleChat(
          `Simplify this document for a presentation:\n\n${docText}`,
          SYSTEM_PROMPT
          // No model parameter - backend will use fast_model
        );

        if (controller.signal.aborted) return;

        const json = markdownToJson(response);
        // Persist to database via file store
        if (fileId) saveToStore(fileId, json);
        setSimplifiedDoc(json);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("Failed to generate simplified presentation:", err);
      } finally {
        if (!controller.signal.aborted) {
          setIsGenerating(false);
        }
      }
    },
    [fileId]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
  }, []);

  return {
    simplifiedDoc,
    isGenerating,
    generate,
    cancel,
  };
}
