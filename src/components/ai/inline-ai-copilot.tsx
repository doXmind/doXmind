"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FileText,
  Lightbulb,
  ListChecks,
  MessageSquare,
  Square,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AiLogoIcon } from "@/components/ui/ai-logo-icon";
import { MarkdownContent } from "@/components/comments/markdown-content";
import { QUICK_EDIT_OPTIONS } from "@/components/ai/quick-edit-options";
import { useInlineAI } from "@/hooks/use-inline-ai";
import { useEditorStore } from "@/stores/editor-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useChatContextStore } from "@/stores/chat-context-store";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import type { DiffSession } from "@/types/diff";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";

interface InlineAICopilotProps {
  fileId: string;
  isDemoMode?: boolean;
}

type ActionDef = {
  id: string;
  label: string;
  kind: "prompt" | "quick_edit";
  prompt?: string;
  quickAction?: string;
};

function getActionIcon(actionId: string) {
  if (actionId === "explain")
    return <FileText className="mr-2 h-3.5 w-3.5 text-muted-foreground" />;
  if (actionId === "check")
    return <ListChecks className="mr-2 h-3.5 w-3.5 text-muted-foreground" />;
  if (actionId === "evaluate")
    return <Lightbulb className="mr-2 h-3.5 w-3.5 text-muted-foreground" />;
  if (actionId.includes("summary"))
    return <FileText className="mr-2 h-3.5 w-3.5 text-muted-foreground" />;
  if (actionId.includes("action"))
    return <ListChecks className="mr-2 h-3.5 w-3.5 text-muted-foreground" />;
  if (actionId.includes("brainstorm"))
    return <Lightbulb className="mr-2 h-3.5 w-3.5 text-muted-foreground" />;
  return <Sparkles className="mr-2 h-3.5 w-3.5 text-muted-foreground" />;
}

export function InlineAICopilot({ fileId, isDemoMode = false }: InlineAICopilotProps) {
  const tQuickEdit = useTranslations("quickEdit");
  const tInline = useTranslations("editor.versionPanel");
  const tInlineSafe = useCallback(
    (key: string, fallback: string) => {
      try {
        return tInline(key);
      } catch {
        return fallback;
      }
    },
    [tInline]
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const didNormalizeNativeSelectionRef = useRef(false);
  const [input, setInput] = useState("");
  const [lastInlineRequest, setLastInlineRequest] = useState<
    { type: "prompt"; value: string } | { type: "quick_edit"; value: string } | null
  >(null);
  const [expandedEditOption, setExpandedEditOption] = useState<string | null>(null);
  const [focusedEditIndex, setFocusedEditIndex] = useState(-1);
  const [measuredListHeight, setMeasuredListHeight] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [persistentInlineRange, setPersistentInlineRange] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [layout, setLayout] = useState<{
    barLeft: number;
    barTop: number;
    barWidth: number;
    listLeft: number;
    listTop: number;
    listWidth: number;
    listMaxHeight: number;
  } | null>(null);

  const { sendInlineRequest, runInlineQuickEdit, isStreaming, stopStreaming } = useInlineAI();
  const editor = useEditorRefStore((s) => s.editor);
  const setChatOpen = useLayoutStore((s) => s.setChatOpen);
  const addChatContext = useChatContextStore((s) => s.addChatContext);
  const chatContexts = useChatContextStore((s) => s.chatContexts);
  const removeChatContext = useChatContextStore((s) => s.removeChatContext);
  const effectiveFileId = isDemoMode ? "demo-file" : fileId;

  const inlineAIOpen = useEditorStore((s) => s.inlineAIOpen);
  const inlineAIPosition = useEditorStore((s) => s.inlineAIPosition);
  const inlineAIMode = useEditorStore((s) => s.inlineAIMode);
  const inlineAIReference = useEditorStore((s) => s.inlineAIReference);
  const inlineAIAnchorRect = useEditorStore((s) => s.inlineAIAnchorRect);
  const inlineAIResponse = useEditorStore((s) => s.inlineAIResponse);
  const selection = useEditorStore((s) => s.selection);
  const closeInlineAI = useEditorStore((s) => s.closeInlineAI);
  const setInlineAIMode = useEditorStore((s) => s.setInlineAIMode);
  const clearInlineAIResponse = useEditorStore((s) => s.clearInlineAIResponse);
  const setSelection = useEditorStore((s) => s.setSelection);
  const diffSession = useDiffReviewStore((s) => s.diffSession);
  const isDiffReviewMode = useDiffReviewStore((s) => s.isReviewMode);
  const acceptAllHunks = useDiffReviewStore((s) => s.acceptAllHunks);
  const rejectAllHunks = useDiffReviewStore((s) => s.rejectAllHunks);
  const endDiffReview = useDiffReviewStore((s) => s.endDiffReview);

  const handleDismissInline = useCallback(
    (options?: { preserveSelection?: boolean }) => {
      const preserveSelection = !!options?.preserveSelection;

      if (!preserveSelection) {
        // Clear selection contexts added for inline ask flow to avoid stale side-panel pills
        for (const ctx of chatContexts) {
          if (ctx.type === "selection") {
            removeChatContext(ctx.id);
          }
        }

        // Collapse editor selection so text is no longer highlighted after closing
        if (editor) {
          const { to } = editor.state.selection;
          editor.commands.setTextSelection(to);
          editor.commands.focus();
        }
        setSelection(null);
      }

      clearInlineAIResponse();
      closeInlineAI();
    },
    [chatContexts, removeChatContext, editor, setSelection, clearInlineAIResponse, closeInlineAI]
  );

  const firstSelectionContext = useMemo(
    () => chatContexts.find((ctx) => ctx.type === "selection") || null,
    [chatContexts]
  );

  const selectedTextForEdit = useMemo(() => {
    const fromStore = selection?.text?.trim();
    if (fromStore) return fromStore;

    const fromContext = firstSelectionContext?.text?.trim();
    if (fromContext) return fromContext;

    const fromReference = inlineAIReference?.selectedText?.trim();
    if (fromReference) return fromReference;

    if (inlineAIReference && editor) {
      try {
        return editor.state.doc
          .textBetween(inlineAIReference.from, inlineAIReference.to, "\n", "\n")
          .trim();
      } catch {
        return "";
      }
    }

    return "";
  }, [selection, firstSelectionContext, inlineAIReference, editor]);

  const hasEditSelectionContext = selectedTextForEdit.length > 0;
  const hasInlineSelection = useMemo(() => {
    const fromStore = selection?.text?.trim();
    if (fromStore) return true;
    if (inlineAIReference && inlineAIReference.to > inlineAIReference.from) return true;
    return false;
  }, [selection, inlineAIReference]);

  useEffect(() => {
    if (!inlineAIOpen) {
      setInput("");
      setLastInlineRequest(null);
      setIsRetrying(false);
      setPersistentInlineRange(null);
      didNormalizeNativeSelectionRef.current = false;
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [inlineAIOpen]);

  useEffect(() => {
    if (!inlineAIOpen) return;

    const from = inlineAIReference?.from ?? selection?.from;
    const to = inlineAIReference?.to ?? selection?.to;
    if (typeof from === "number" && typeof to === "number" && to > from) {
      setPersistentInlineRange({ from, to });
    }
  }, [inlineAIOpen, inlineAIReference, selection]);

  useEffect(() => {
    if (!inlineAIOpen || !editor) return;
    if (inlineAIMode !== "ask" && inlineAIMode !== "edit") return;
    if (didNormalizeNativeSelectionRef.current) return;

    const collapseTo = inlineAIReference?.to ?? selection?.to;
    if (typeof collapseTo !== "number") return;

    // Avoid double-layer highlight: collapse native DOM selection
    // and keep only our persistent decoration highlight.
    editor.commands.setTextSelection(collapseTo);
    didNormalizeNativeSelectionRef.current = true;
  }, [inlineAIOpen, inlineAIMode, editor, selection, inlineAIReference]);

  useEffect(() => {
    if (!editor) return;

    const hasSelectionContext = chatContexts.some((ctx) => ctx.type === "selection");

    const ranges = new Map<string, { from: number; to: number }>();
    const addRange = (from?: number, to?: number) => {
      if (typeof from !== "number" || typeof to !== "number") return;
      const safeFrom = Math.min(from, to);
      const safeTo = Math.max(from, to);
      if (safeTo <= safeFrom) return;
      ranges.set(`${safeFrom}:${safeTo}`, { from: safeFrom, to: safeTo });
    };

    // Keep inline-local selection highlighted while inline panel is open.
    if (inlineAIOpen) {
      addRange(selection?.from, selection?.to);
      addRange(inlineAIReference?.from, inlineAIReference?.to);
      addRange(persistentInlineRange?.from, persistentInlineRange?.to);
    }

    // Keep all side-chat selection contexts highlighted, not only the first one.
    for (const ctx of chatContexts) {
      if (ctx.type === "selection") {
        addRange(ctx.from, ctx.to);
      }
    }

    const highlightRanges = Array.from(ranges.values());
    const shouldShowPersistentSelection =
      highlightRanges.length > 0 && (inlineAIOpen || hasSelectionContext);

    if (shouldShowPersistentSelection) {
      // Backward-compatible guard for hot-reload/editor instances that were
      // created before the multi-range command was registered.
      const commands = editor.commands as typeof editor.commands & {
        setInlineAISelectionHighlights?: (ranges: { from: number; to: number }[]) => boolean;
      };
      if (typeof commands.setInlineAISelectionHighlights === "function") {
        commands.setInlineAISelectionHighlights(highlightRanges);
      } else {
        const first = highlightRanges[0];
        if (first) {
          editor.commands.setInlineAISelectionHighlight(first.from, first.to);
        }
      }
    } else {
      editor.commands.clearInlineAISelectionHighlight();
    }

    return () => {
      editor.commands.clearInlineAISelectionHighlight();
    };
  }, [
    editor,
    selection,
    inlineAIReference,
    persistentInlineRange,
    inlineAIOpen,
    inlineAIMode,
    chatContexts,
  ]);

  const updateLayout = useCallback(() => {
    if (!inlineAIOpen || !inlineAIPosition || typeof window === "undefined") return;
    const boundaryEl = document.querySelector<HTMLElement>(
      ".ProseMirror[data-inline-ai-boundary='true']"
    );
    const boundaryRect = boundaryEl?.getBoundingClientRect();
    const boundaryLeft = boundaryRect ? Math.max(16, boundaryRect.left) : 36;
    const boundaryRight = boundaryRect
      ? Math.min(window.innerWidth - 16, boundaryRect.right)
      : window.innerWidth - 36;
    const boundaryWidth = Math.max(360, boundaryRight - boundaryLeft);

    const innerPadding = 8;
    const barWidth = Math.max(360, boundaryWidth - innerPadding * 2);
    const minLeft = boundaryLeft + innerPadding;
    const maxLeft = Math.max(minLeft, boundaryRight - innerPadding - barWidth);
    const barLeft = Math.min(minLeft, maxLeft);
    const barHeight = 56;
    const viewportPadding = 16;

    const estimatedListHeight = inlineAIResponse
      ? 260
      : !isStreaming && !inlineAIResponse
        ? 360
        : 0;
    const listHeight = Math.min(measuredListHeight || estimatedListHeight, 420);

    // For rich atom blocks (math/image/mermaid), prefer the captured node rect.
    // ProseMirror position coords on atom ranges can collapse to text-like points
    // and cause overlay placement that appears to cover the edited block.
    let computedAnchorRect = inlineAIAnchorRect;
    const selectedText = inlineAIReference?.selectedText?.trim() || "";
    const isStructuredBlockSelection =
      selectedText.startsWith("```mermaid") ||
      selectedText.startsWith("![") ||
      selectedText.startsWith("$$") ||
      (selectedText.startsWith("$") && selectedText.endsWith("$"));

    if (inlineAIReference && editor && (!inlineAIAnchorRect || !isStructuredBlockSelection)) {
      try {
        const fromCoords = editor.view.coordsAtPos(inlineAIReference.from);
        const toCoords = editor.view.coordsAtPos(inlineAIReference.to);
        computedAnchorRect = {
          top: Math.min(fromCoords.top, toCoords.top),
          bottom: Math.max(fromCoords.bottom, toCoords.bottom),
          left: Math.min(fromCoords.left, toCoords.left),
          right: Math.max(fromCoords.right, toCoords.right),
        };
      } catch {
        // Fall back to initial captured rect if positions are temporarily invalid.
        computedAnchorRect = inlineAIAnchorRect;
      }
    }

    const anchorTop = computedAnchorRect?.top ?? inlineAIPosition.y;
    const anchorBottom = computedAnchorRect?.bottom ?? inlineAIPosition.y;
    const listGap = 12;
    const isEditFlow = inlineAIMode === "edit" || inlineAIResponse?.intent === "edit";
    const protectedTop = anchorTop - 120;
    const protectedBottom = anchorBottom + 120;
    const overlapPx = (top: number, bottom: number, zoneTop: number, zoneBottom: number) =>
      Math.max(0, Math.min(bottom, zoneBottom) - Math.max(top, zoneTop));

    const belowTop = anchorBottom + 10;
    const aboveTop = anchorTop - 10 - barHeight;
    const canPlaceBarBelow = belowTop + barHeight <= window.innerHeight - viewportPadding;
    const canPlaceBarAbove = aboveTop >= viewportPadding;

    // Keep input below selection by default, but account for response list space
    // so the panel does not heavily cover nearby content.
    let placeBarAbove = !canPlaceBarBelow && canPlaceBarAbove;
    if (!placeBarAbove && canPlaceBarBelow && canPlaceBarAbove && listHeight > 0) {
      const belowListRoom = window.innerHeight - viewportPadding - (belowTop + barHeight + listGap);
      const aboveListRoom = aboveTop - viewportPadding - listGap;
      if (belowListRoom < 160 && aboveListRoom > belowListRoom) {
        placeBarAbove = true;
      }
    }

    if (isEditFlow && canPlaceBarAbove && canPlaceBarBelow) {
      const belowOverlap = overlapPx(belowTop, belowTop + barHeight, protectedTop, protectedBottom);
      const aboveOverlap = overlapPx(aboveTop, aboveTop + barHeight, protectedTop, protectedBottom);
      if (aboveOverlap < belowOverlap) placeBarAbove = true;
      if (belowOverlap < aboveOverlap) placeBarAbove = false;
    }

    let barTop = belowTop;
    if (placeBarAbove) {
      barTop = aboveTop;
    }
    barTop = Math.min(
      Math.max(barTop, viewportPadding),
      window.innerHeight - viewportPadding - barHeight
    );

    const listWidth = Math.min(420, barWidth);
    const listLeft = Math.min(
      Math.max(barLeft, boundaryLeft + innerPadding),
      boundaryRight - innerPadding - listWidth
    );
    const defaultListTop = barTop + 58;
    const listAvailableBelow = Math.max(
      0,
      window.innerHeight - viewportPadding - (barTop + barHeight + listGap)
    );
    const listAvailableAbove = Math.max(0, barTop - viewportPadding - listGap);

    let listOnTop = placeBarAbove;
    if (listHeight > 0) {
      const preferredSpace = placeBarAbove ? listAvailableAbove : listAvailableBelow;
      const oppositeSpace = placeBarAbove ? listAvailableBelow : listAvailableAbove;
      if (preferredSpace < 140 && oppositeSpace > preferredSpace) {
        listOnTop = !placeBarAbove;
      }
    }

    const topMaxHeight = Math.max(0, Math.min(420, Math.floor(listAvailableAbove)));
    const topRenderedHeight = Math.min(listHeight, topMaxHeight);
    const topListTop = barTop - listGap - topRenderedHeight;
    const topOverlap = overlapPx(
      topListTop,
      topListTop + topRenderedHeight,
      protectedTop,
      protectedBottom
    );

    const bottomMaxHeight = Math.max(0, Math.min(420, Math.floor(listAvailableBelow)));
    const bottomRenderedHeight = Math.min(listHeight, bottomMaxHeight);
    const bottomListTop = defaultListTop;
    const bottomOverlap = overlapPx(
      bottomListTop,
      bottomListTop + bottomRenderedHeight,
      protectedTop,
      protectedBottom
    );

    if (isEditFlow && listHeight > 0) {
      if (topOverlap < bottomOverlap) listOnTop = true;
      if (bottomOverlap < topOverlap) listOnTop = false;
    }

    const listMaxHeight = listOnTop ? topMaxHeight : bottomMaxHeight;
    const listTop = listOnTop ? topListTop : bottomListTop;

    setLayout({ barLeft, barTop, barWidth, listLeft, listTop, listWidth, listMaxHeight });
  }, [
    inlineAIOpen,
    inlineAIPosition,
    inlineAIAnchorRect,
    inlineAIReference,
    inlineAIMode,
    inlineAIResponse,
    isStreaming,
    measuredListHeight,
    editor,
  ]);

  useEffect(() => {
    if (!inlineAIOpen) {
      setMeasuredListHeight(0);
      return;
    }
    const raf = requestAnimationFrame(() => {
      const h = listRef.current?.offsetHeight || 0;
      setMeasuredListHeight(h);
    });
    return () => cancelAnimationFrame(raf);
  }, [inlineAIOpen, inlineAIMode, inlineAIResponse, isStreaming, expandedEditOption]);

  useEffect(() => {
    if (!inlineAIOpen) return;
    updateLayout();
    const onResize = () => updateLayout();
    const onScroll = () => updateLayout();
    const onEditorUpdate = () => {
      requestAnimationFrame(() => updateLayout());
    };

    const editorDom = editor?.view.dom as HTMLElement | undefined;
    const boundaryEl = document.querySelector<HTMLElement>(
      ".ProseMirror[data-inline-ai-boundary='true']"
    );
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => requestAnimationFrame(() => updateLayout()))
        : null;

    if (resizeObserver) {
      if (boundaryEl) resizeObserver.observe(boundaryEl);
      if (editorDom && editorDom !== boundaryEl) resizeObserver.observe(editorDom);
    }

    editor?.on("transaction", onEditorUpdate);
    editor?.on("selectionUpdate", onEditorUpdate);

    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      editor?.off("transaction", onEditorUpdate);
      editor?.off("selectionUpdate", onEditorUpdate);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [inlineAIOpen, updateLayout, editor]);

  useEffect(() => {
    if (!inlineAIOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target)) {
        handleDismissInline({
          preserveSelection: inlineAIMode === "ask" || inlineAIMode === "edit",
        });
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [inlineAIOpen, handleDismissInline, inlineAIMode]);

  useEffect(() => {
    if (inlineAIMode === "edit" && !hasEditSelectionContext) {
      setInlineAIMode("write");
    }
  }, [inlineAIMode, hasEditSelectionContext, setInlineAIMode]);

  useEffect(() => {
    if (inlineAIMode === "ask" && !hasInlineSelection) {
      setInlineAIMode("write");
    }
  }, [inlineAIMode, hasInlineSelection, setInlineAIMode]);

  useEffect(() => {
    // Only auto-switch to edit when there is actual editable text context.
    // Some selections (e.g. non-text nodes) have a range but no text payload,
    // which would otherwise cause write <-> edit oscillation.
    if (inlineAIMode === "write" && hasEditSelectionContext) {
      setInlineAIMode("edit");
    }
  }, [inlineAIMode, hasEditSelectionContext, setInlineAIMode]);

  useEffect(() => {
    if (inlineAIMode !== "edit") setExpandedEditOption(null);
  }, [inlineAIMode]);

  const actions = useMemo<ActionDef[]>(() => {
    if (inlineAIMode === "edit") {
      return [
        {
          id: "improve",
          label: tInline("inlineAI.actions.edit.improve.label"),
          kind: "quick_edit",
          quickAction: "improve",
        },
        {
          id: "proofread",
          label: tInline("inlineAI.actions.edit.proofread.label"),
          kind: "quick_edit",
          quickAction: "fix-grammar",
        },
        {
          id: "simplify",
          label: tInline("inlineAI.actions.edit.simplify.label"),
          kind: "quick_edit",
          quickAction: "simplify",
        },
        {
          id: "longer",
          label: tInline("inlineAI.actions.edit.longer.label"),
          kind: "quick_edit",
          quickAction: "expand",
        },
        {
          id: "shorter",
          label: tInline("inlineAI.actions.edit.shorter.label"),
          kind: "quick_edit",
          quickAction: "shorten",
        },
      ];
    }

    if (inlineAIMode === "ask") {
      return [
        {
          id: "explain",
          label: tInlineSafe("inlineAI.actions.ask.explain.label", "解释这段"),
          kind: "prompt",
          prompt: tInlineSafe("inlineAI.actions.ask.explain.prompt", "清晰简洁地解释选中内容。"),
        },
        {
          id: "check",
          label: tInlineSafe("inlineAI.actions.ask.check.label", "检查问题"),
          kind: "prompt",
          prompt: tInlineSafe(
            "inlineAI.actions.ask.check.prompt",
            "检查这段内容的逻辑、表达和潜在问题，并列出要点。"
          ),
        },
        {
          id: "evaluate",
          label: tInlineSafe("inlineAI.actions.ask.evaluate.label", "评价这段"),
          kind: "prompt",
          prompt: tInlineSafe(
            "inlineAI.actions.ask.evaluate.prompt",
            "从清晰度、说服力和完整性评价这段内容，并给出简短结论。"
          ),
        },
      ];
    }

    return [
      {
        id: "continue",
        label: tInline("inlineAI.actions.write.continue.label"),
        kind: "prompt",
        prompt: tInline("inlineAI.actions.write.continue.prompt"),
      },
      {
        id: "summary",
        label: tInline("inlineAI.actions.write.summary.label"),
        kind: "prompt",
        prompt: tInline("inlineAI.actions.write.summary.prompt"),
      },
      {
        id: "actions",
        label: tInline("inlineAI.actions.write.actions.label"),
        kind: "prompt",
        prompt: tInline("inlineAI.actions.write.actions.prompt"),
      },
      {
        id: "brainstorm",
        label: tInline("inlineAI.actions.write.brainstorm.label"),
        kind: "prompt",
        prompt: tInline("inlineAI.actions.write.brainstorm.prompt"),
      },
    ];
  }, [inlineAIMode, tInline, tInlineSafe]);
  const baseEditOptions = useMemo(
    () => QUICK_EDIT_OPTIONS.filter((option) => !option.submenu?.length),
    []
  );
  const toneOption = useMemo(
    () => QUICK_EDIT_OPTIONS.find((option) => option.id === "tone") || null,
    []
  );
  const translateOption = useMemo(
    () => QUICK_EDIT_OPTIONS.find((option) => option.id === "translate") || null,
    []
  );
  const editCommandItems = useMemo(() => {
    const items: Array<{ key: string; action?: string; isToggle?: boolean }> = [];
    for (const option of baseEditOptions) {
      items.push({ key: `action:${option.id}`, action: option.id });
    }
    if (toneOption) {
      items.push({ key: `toggle:${toneOption.id}`, isToggle: true });
      if (expandedEditOption === toneOption.id) {
        for (const sub of toneOption.submenu || []) {
          items.push({ key: `action:${sub.id}`, action: sub.id });
        }
      }
    }
    if (translateOption) {
      items.push({ key: `toggle:${translateOption.id}`, isToggle: true });
      if (expandedEditOption === translateOption.id) {
        for (const sub of translateOption.submenu || []) {
          items.push({ key: `action:${sub.id}`, action: sub.id });
        }
      }
    }
    return items;
  }, [baseEditOptions, toneOption, translateOption, expandedEditOption]);

  useEffect(() => {
    if (inlineAIMode !== "edit") {
      setFocusedEditIndex(-1);
      return;
    }
    setFocusedEditIndex((prev) => (editCommandItems.length === 0 ? -1 : Math.max(0, prev)));
  }, [inlineAIMode, editCommandItems.length]);

  const submitPrompt = useCallback(
    async (prompt: string, forceOpenStudio = false, intentOverride?: "ask" | "edit" | "insert") => {
      const requestIntent =
        intentOverride ??
        (inlineAIMode === "edit" ? "edit" : inlineAIMode === "write" ? "insert" : "ask");

      const selectedText = selectedTextForEdit.trim();
      const selectionFrom =
        selection?.from ?? inlineAIReference?.from ?? firstSelectionContext?.from;
      const selectionTo = selection?.to ?? inlineAIReference?.to ?? firstSelectionContext?.to;
      const selectionPayload =
        selectedText &&
        typeof selectionFrom === "number" &&
        typeof selectionTo === "number" &&
        selectionTo > selectionFrom
          ? {
              text: selectedText,
              from: selectionFrom,
              to: selectionTo,
            }
          : null;

      await sendInlineRequest({
        intent: requestIntent,
        instruction: prompt,
        fileId: effectiveFileId,
        requestId: crypto.randomUUID(),
        selection: selectionPayload,
        anchor: inlineAIReference
          ? {
              beforeText: inlineAIReference.beforeText,
              afterText: inlineAIReference.afterText,
            }
          : null,
      });

      if (forceOpenStudio) {
        setChatOpen(true);
      }

      if (forceOpenStudio) {
        closeInlineAI();
      }
    },
    [
      selection,
      sendInlineRequest,
      effectiveFileId,
      inlineAIReference,
      setChatOpen,
      closeInlineAI,
      inlineAIMode,
      selectedTextForEdit,
      firstSelectionContext,
    ]
  );

  const pushInlineSelectionToChat = useCallback(() => {
    const text = selectedTextForEdit.trim();
    const from = selection?.from ?? inlineAIReference?.from ?? firstSelectionContext?.from;
    const to = selection?.to ?? inlineAIReference?.to ?? firstSelectionContext?.to;

    if (!text || typeof from !== "number" || typeof to !== "number" || to <= from) {
      return false;
    }

    for (const ctx of chatContexts) {
      if (ctx.type === "selection") {
        removeChatContext(ctx.id);
      }
    }

    addChatContext({
      type: "selection",
      text,
      from,
      to,
    });

    return true;
  }, [
    selectedTextForEdit,
    selection,
    inlineAIReference,
    firstSelectionContext,
    chatContexts,
    removeChatContext,
    addChatContext,
  ]);

  const pushInlineResponseToChatReference = useCallback(() => {
    const responseText = inlineAIResponse?.content?.trim();
    if (!responseText) return false;

    addChatContext({
      type: "inline_result",
      text: responseText,
    });

    return true;
  }, [inlineAIResponse, addChatContext]);

  const handleOpenStudio = useCallback(() => {
    pushInlineSelectionToChat();
    pushInlineResponseToChatReference();
    setChatOpen(true);
    closeInlineAI();
  }, [pushInlineSelectionToChat, pushInlineResponseToChatReference, setChatOpen, closeInlineAI]);

  const pendingDiffCount = useMemo(
    () => diffSession?.hunks.filter((h) => h.status === "pending").length || 0,
    [diffSession]
  );

  const showInlineDiffActions =
    inlineAIResponse?.intent !== "ask" && isDiffReviewMode && pendingDiffCount > 0;

  const inputPlaceholder =
    inlineAIResponse?.status === "ready"
      ? tInline("inlineAI.followupHint")
      : inlineAIMode === "edit"
        ? tInline("inlineAI.editPlaceholder")
        : hasInlineSelection
          ? tInline("inlineAI.placeholder")
          : tInline("inlineAI.writePlaceholder");

  const createInlineDiffSnapshot = useCallback(
    (session: DiffSession | null) => {
      if (!editor || !session) return;
      const accepted = session.hunks.filter((h) => h.status === "accepted");
      if (accepted.length === 0) return;

      const total = session.hunks.length;
      const summary =
        accepted.length === 1
          ? "AI edit: accepted 1 change"
          : `AI edit: accepted ${accepted.length} of ${total} changes`;

      api.createVersion(session.fileId, editor.getHTML(), "ai_edit", summary).catch(() => {});
    },
    [editor]
  );

  const handleAcceptInlineDiff = useCallback(() => {
    if (!editor || !diffSession) return;
    const pending = diffSession.hunks.filter((h) => h.status === "pending");
    if (pending.length === 0) return;

    for (const hunk of pending) {
      editor.commands.acceptDiffHunk(hunk.id);
    }
    acceptAllHunks();
    createInlineDiffSnapshot(useDiffReviewStore.getState().diffSession);
    endDiffReview();
    clearInlineAIResponse();
    closeInlineAI();
  }, [
    editor,
    diffSession,
    acceptAllHunks,
    createInlineDiffSnapshot,
    endDiffReview,
    clearInlineAIResponse,
    closeInlineAI,
  ]);

  const handleDiscardInlineDiff = useCallback(() => {
    if (!editor || !diffSession) return;
    editor.commands.clearDiffReview();
    rejectAllHunks();
    endDiffReview();
    clearInlineAIResponse();
  }, [editor, diffSession, rejectAllHunks, endDiffReview, clearInlineAIResponse]);

  const handleSubmit = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || isStreaming) return;

    // Freeform input is treated as an edit/insert instruction.
    // Ask-mode remains available via predefined ask actions.
    const inferredIntent: "ask" | "edit" | "insert" = hasEditSelectionContext ? "edit" : "insert";
    const nextMode = inferredIntent === "insert" ? "write" : inferredIntent;
    if (inlineAIMode !== nextMode) {
      setInlineAIMode(nextMode);
    }

    setLastInlineRequest({ type: "prompt", value: prompt });
    await submitPrompt(prompt, false, inferredIntent);
    setInput("");
  }, [input, isStreaming, hasEditSelectionContext, inlineAIMode, setInlineAIMode, submitPrompt]);

  const handleInsertInlineResponse = useCallback(() => {
    const content = inlineAIResponse?.content.trim();
    if (!editor || !content || !editor.markdown) return;

    const fallbackPos = editor.state.selection.to;
    const to = inlineAIReference?.to ?? selection?.to ?? fallbackPos;

    let insertPos = to;
    try {
      const resolved = editor.state.doc.resolve(to);
      for (let depth = resolved.depth; depth >= 1; depth -= 1) {
        const node = resolved.node(depth);
        if (node.isBlock) {
          insertPos = resolved.after(depth);
          break;
        }
      }
    } catch {
      insertPos = to;
    }

    const json = editor.markdown.parse(content);
    const parsed = editor.state.schema.nodeFromJSON(json);
    if (parsed.content.size === 0) return;

    editor.chain().focus().insertContentAt(insertPos, parsed.content.toJSON()).run();
    clearInlineAIResponse();
    closeInlineAI();
  }, [
    editor,
    inlineAIResponse,
    inlineAIReference,
    selection,
    clearInlineAIResponse,
    closeInlineAI,
  ]);

  const handleInlineQuickEdit = useCallback(
    async (action: string) => {
      if (!selectedTextForEdit || isStreaming) return;
      setLastInlineRequest({ type: "quick_edit", value: action });
      await runInlineQuickEdit({
        action,
        fileId: effectiveFileId,
        requestId: crypto.randomUUID(),
        selection: {
          text: selectedTextForEdit,
          from:
            selection?.from ??
            inlineAIReference?.from ??
            firstSelectionContext?.from ??
            editor?.state.selection.from ??
            0,
          to:
            selection?.to ??
            inlineAIReference?.to ??
            firstSelectionContext?.to ??
            editor?.state.selection.to ??
            0,
        },
        anchor: inlineAIReference
          ? {
              beforeText: inlineAIReference.beforeText,
              afterText: inlineAIReference.afterText,
            }
          : null,
      });
    },
    [
      selectedTextForEdit,
      isStreaming,
      runInlineQuickEdit,
      effectiveFileId,
      selection,
      inlineAIReference,
      firstSelectionContext,
      editor,
      setLastInlineRequest,
    ]
  );

  const handleRetryInlineRequest = useCallback(async () => {
    if (!lastInlineRequest || isStreaming || isRetrying) return;

    setIsRetrying(true);

    try {
      // Retry for inline edits must start from the original text snapshot.
      // Clear current pending diff session first so old/new hunks don't stack.
      if (lastInlineRequest.type === "quick_edit" && isDiffReviewMode && pendingDiffCount > 0) {
        handleDiscardInlineDiff();
        clearInlineAIResponse();
      }

      if (lastInlineRequest.type === "prompt") {
        await submitPrompt(lastInlineRequest.value, false);
        return;
      }

      await handleInlineQuickEdit(lastInlineRequest.value);
    } finally {
      setIsRetrying(false);
    }
  }, [
    lastInlineRequest,
    isStreaming,
    isRetrying,
    isDiffReviewMode,
    pendingDiffCount,
    handleDiscardInlineDiff,
    clearInlineAIResponse,
    submitPrompt,
    handleInlineQuickEdit,
  ]);

  const runAction = useCallback(
    async (action: ActionDef) => {
      if (isStreaming) return;

      if (action.kind === "quick_edit" && action.quickAction && selection?.text) {
        await handleInlineQuickEdit(action.quickAction);
        return;
      }

      if (action.kind === "prompt" && action.prompt) {
        setLastInlineRequest({ type: "prompt", value: action.prompt });
        await submitPrompt(action.prompt, false);
      }
    },
    [isStreaming, selection, handleInlineQuickEdit, submitPrompt]
  );

  const executeEditCommandKey = useCallback(
    (key: string) => {
      if (key.startsWith("action:")) {
        void handleInlineQuickEdit(key.replace("action:", ""));
        return;
      }
      if (key.startsWith("toggle:")) {
        const toggleId = key.replace("toggle:", "");
        setExpandedEditOption((prev) => (prev === toggleId ? null : toggleId));
      }
    },
    [handleInlineQuickEdit]
  );

  if (!inlineAIOpen || !layout) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="pointer-events-none fixed inset-0 z-[140]"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          handleDismissInline();
          return;
        }

        const canNavigateEditList =
          inlineAIMode === "edit" &&
          !isStreaming &&
          !inlineAIResponse &&
          editCommandItems.length > 0 &&
          event.target !== inputRef.current;

        if (!canNavigateEditList) return;

        if (event.key === "ArrowDown") {
          event.preventDefault();
          setFocusedEditIndex((prev) => (prev + 1) % editCommandItems.length);
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          setFocusedEditIndex((prev) => (prev <= 0 ? editCommandItems.length - 1 : prev - 1));
          return;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          const index = focusedEditIndex >= 0 ? focusedEditIndex : 0;
          const item = editCommandItems[index];
          if (item) executeEditCommandKey(item.key);
        }
      }}
    >
      <div
        className="pointer-events-none absolute"
        style={{ left: layout.barLeft - 56, top: layout.barTop + 4 }}
        aria-hidden="true"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-popover/95 shadow-lg backdrop-blur">
          <AiLogoIcon className="text-foreground/85" size={16} />
        </div>
      </div>

      <div
        className="pointer-events-auto absolute rounded-2xl border border-border/60 bg-popover/95 shadow-2xl backdrop-blur"
        style={{ left: layout.barLeft, top: layout.barTop, width: layout.barWidth }}
      >
        <div className="flex h-12 items-center gap-2 px-3">
          {isStreaming ? (
            <div className="flex h-8 flex-1 items-center gap-2 px-1 text-sm font-medium text-muted-foreground">
              <span>{tInline("inlineAI.thinking")}</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-orange-400 [animation-delay:-240ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-rose-400 [animation-delay:-120ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400" />
              </span>
            </div>
          ) : (
            <>
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder={inputPlaceholder}
                className="h-8 flex-1 bg-transparent px-1 text-[28px] text-sm outline-none placeholder:text-muted-foreground/65"
              />
            </>
          )}

          {isStreaming && (
            <button
              type="button"
              onClick={stopStreaming}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/90"
              aria-label={tInline("inlineAI.stop")}
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          )}

          {!isStreaming && (
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={tInline("inlineAI.close")}
              onClick={() => handleDismissInline()}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {!isStreaming && !inlineAIResponse && (
        <div
          ref={listRef}
          className="pointer-events-auto absolute max-h-[420px] overflow-auto rounded-2xl border border-border/60 bg-popover/95 p-3 shadow-2xl backdrop-blur"
          style={{
            left: layout.listLeft,
            top: layout.listTop,
            width: layout.listWidth,
            maxHeight: layout.listMaxHeight || 420,
          }}
        >
          <div className="mb-3 rounded-xl border border-border/60 bg-background/40 p-1.5">
            <div className="flex items-center gap-1">
              <ModeTab
                active={inlineAIMode === "write"}
                icon={<Sparkles className="h-3.5 w-3.5" />}
                label={tInline("inlineAI.tabs.write")}
                onClick={() => setInlineAIMode("write")}
                hidden={hasInlineSelection}
              />
              <ModeTab
                active={inlineAIMode === "edit"}
                icon={<Wand2 className="h-3.5 w-3.5" />}
                label={tInline("inlineAI.tabs.edit")}
                onClick={() => setInlineAIMode("edit")}
                hidden={!hasInlineSelection}
              />
              <ModeTab
                active={inlineAIMode === "ask"}
                icon={<MessageSquare className="h-3.5 w-3.5" />}
                label={tInline("inlineAI.tabs.ask")}
                onClick={() => setInlineAIMode("ask")}
                hidden={!hasInlineSelection}
              />
              <div className="flex-1" />
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-border/70 hover:bg-accent/70 hover:text-foreground"
                onClick={handleOpenStudio}
              >
                <Bot className="h-3.5 w-3.5" />
                {tInline("inlineAI.openStudio")}
              </button>
            </div>
          </div>

          {inlineAIMode === "edit" ? (
            <>
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/90">
                {tInline("inlineAI.rewrite")}
              </div>
              <div className="space-y-0.5">
                {baseEditOptions.map((option) => {
                  const commandKey = `action:${option.id}`;
                  const isFocused = editCommandItems[focusedEditIndex]?.key === commandKey;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => void handleInlineQuickEdit(option.id)}
                      className={cn(
                        "flex w-full items-center rounded-lg border border-transparent px-2.5 py-2 text-left text-sm transition-all",
                        "hover:border-border/70 hover:bg-accent/70",
                        isFocused && "border-border/70 bg-accent/70",
                        isStreaming && "pointer-events-none opacity-60"
                      )}
                    >
                      <span className="mr-2 text-muted-foreground">{option.icon}</span>
                      <span className="flex-1">{tQuickEdit(option.labelKey)}</span>
                    </button>
                  );
                })}
              </div>

              <div className="my-2 h-px bg-border/60" />

              <div className="space-y-1">
                {toneOption && (
                  <div>
                    {(() => {
                      const toggleKey = `toggle:${toneOption.id}`;
                      const isToggleFocused = editCommandItems[focusedEditIndex]?.key === toggleKey;
                      return (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedEditOption((prev) =>
                              prev === toneOption.id ? null : toneOption.id
                            )
                          }
                          className={cn(
                            "flex w-full items-center rounded-lg px-2 py-2 text-left text-sm hover:bg-accent/70",
                            (expandedEditOption === toneOption.id || isToggleFocused) &&
                              "bg-accent/50"
                          )}
                        >
                          <span className="mr-2 text-muted-foreground">{toneOption.icon}</span>
                          <span className="flex-1">{tQuickEdit(toneOption.labelKey)}</span>
                          {expandedEditOption === toneOption.id ? (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </button>
                      );
                    })()}

                    {expandedEditOption === toneOption.id && (
                      <div className="ml-8 mt-1 flex flex-wrap gap-1.5">
                        {toneOption.submenu?.map((sub) => {
                          const commandKey = `action:${sub.id}`;
                          const isFocused = editCommandItems[focusedEditIndex]?.key === commandKey;
                          return (
                            <button
                              key={sub.id}
                              type="button"
                              onClick={() => void handleInlineQuickEdit(sub.id)}
                              className={cn(
                                "rounded-md border border-border/70 px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
                                isFocused && "bg-accent text-foreground"
                              )}
                            >
                              {tQuickEdit(sub.labelKey)}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {translateOption && (
                  <div>
                    {(() => {
                      const toggleKey = `toggle:${translateOption.id}`;
                      const isToggleFocused = editCommandItems[focusedEditIndex]?.key === toggleKey;
                      return (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedEditOption((prev) =>
                              prev === translateOption.id ? null : translateOption.id
                            )
                          }
                          className={cn(
                            "flex w-full items-center rounded-lg px-2 py-2 text-left text-sm hover:bg-accent/70",
                            (expandedEditOption === translateOption.id || isToggleFocused) &&
                              "bg-accent/50"
                          )}
                        >
                          <span className="mr-2 text-muted-foreground">{translateOption.icon}</span>
                          <span className="flex-1">{tQuickEdit(translateOption.labelKey)}</span>
                          {expandedEditOption === translateOption.id ? (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </button>
                      );
                    })()}

                    {expandedEditOption === translateOption.id && (
                      <div className="ml-8 mt-1 flex flex-wrap gap-1.5">
                        {translateOption.submenu?.map((sub) => {
                          const commandKey = `action:${sub.id}`;
                          const isFocused = editCommandItems[focusedEditIndex]?.key === commandKey;
                          return (
                            <button
                              key={sub.id}
                              type="button"
                              onClick={() => void handleInlineQuickEdit(sub.id)}
                              className={cn(
                                "rounded-md border border-border/70 px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
                                isFocused && "bg-accent text-foreground"
                              )}
                            >
                              {tQuickEdit(sub.labelKey)}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/90">
                {tInline("inlineAI.suggested")}
              </div>
              <div className="space-y-0.5">
                {actions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => void runAction(action)}
                    className={cn(
                      "flex w-full items-center rounded-lg border border-transparent px-2.5 py-2 text-left text-sm transition-all",
                      "hover:border-border/70 hover:bg-accent/70",
                      isStreaming && "pointer-events-none opacity-60"
                    )}
                  >
                    {getActionIcon(action.id)}
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {inlineAIResponse &&
        (inlineAIResponse.status === "ready" || inlineAIResponse.status === "error") && (
          <div
            ref={listRef}
            className="pointer-events-auto absolute overflow-auto rounded-2xl border border-border/60 bg-popover/95 p-3 shadow-2xl backdrop-blur"
            style={{
              left: layout.listLeft,
              top: layout.listTop,
              width: layout.listWidth,
              maxHeight: layout.listMaxHeight || 420,
            }}
          >
            {inlineAIResponse.status === "ready" && (
              <div className="space-y-3">
                <div className="max-h-56 overflow-auto rounded-md">
                  <MarkdownContent
                    content={inlineAIResponse.content || tInline("inlineAI.done")}
                    baseClassName="prose prose-sm max-w-none text-foreground/95 dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                  />
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {showInlineDiffActions ? (
                    <>
                      <span className="mr-1 text-muted-foreground">
                        {tInline("inlineAI.diffReview.count", { count: pendingDiffCount })}
                      </span>
                      <button
                        type="button"
                        className="rounded-md bg-foreground px-2 py-1 text-background hover:bg-foreground/90"
                        onClick={handleAcceptInlineDiff}
                      >
                        {tInline("inlineAI.diffReview.accept")}
                      </button>
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 hover:bg-accent"
                        onClick={handleDiscardInlineDiff}
                      >
                        {tInline("inlineAI.diffReview.discard")}
                      </button>
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 hover:bg-accent"
                        onClick={() => void handleRetryInlineRequest()}
                        disabled={!lastInlineRequest || isStreaming || isRetrying}
                      >
                        {tInline("inlineAI.diffReview.tryAgain")}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="rounded-md bg-accent px-2 py-1 hover:bg-accent/80"
                        onClick={handleInsertInlineResponse}
                      >
                        {tInline("inlineAI.insertAsBlock")}
                      </button>
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 hover:bg-accent"
                        onClick={() => {
                          void navigator.clipboard.writeText(inlineAIResponse.content || "");
                        }}
                      >
                        {tInline("inlineAI.copy")}
                      </button>
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 hover:bg-accent"
                        onClick={handleOpenStudio}
                      >
                        {tInline("inlineAI.openStudio")}
                      </button>
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 hover:bg-accent"
                        onClick={() => {
                          clearInlineAIResponse();
                          requestAnimationFrame(() => inputRef.current?.focus());
                        }}
                      >
                        {tInline("inlineAI.close")}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {inlineAIResponse.status === "error" && (
              <div className="space-y-2">
                <p className="text-sm text-destructive">
                  {inlineAIResponse.error || tInline("inlineAI.error")}
                </p>
                <button
                  type="button"
                  className="rounded-md bg-accent px-2 py-1 text-xs"
                  onClick={() => handleDismissInline()}
                >
                  {tInline("inlineAI.dismiss")}
                </button>
              </div>
            )}
          </div>
        )}
    </div>,
    document.body
  );
}

function ModeTab({
  active,
  icon,
  label,
  onClick,
  disabled,
  hidden,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  hidden?: boolean;
}) {
  if (hidden) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all",
        active
          ? "bg-foreground text-background shadow-sm"
          : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
        disabled && "cursor-not-allowed opacity-35"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
