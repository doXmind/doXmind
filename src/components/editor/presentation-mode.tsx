"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent, Extensions } from "@tiptap/core";

// Content-rendering extensions (no editing features)
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Underline from "@tiptap/extension-underline";
import Typography from "@tiptap/extension-typography";
import Link from "@tiptap/extension-link";
import { ResizableImage } from "@/extensions/resizable-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { CustomCodeBlock } from "@/extensions/code-block";
import { InlineMath, BlockMath } from "@/extensions/math";
import { Callout } from "@/extensions/callout";
import { Toggle } from "@/extensions/toggle";
import { BlockColorExtension } from "@/extensions/block-color-extension";

import { useLayoutStore } from "@/stores/layout-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useFileStore } from "@/stores/file-store";
import { useAuthStore } from "@/stores/auth-store";
import { Z_INDEX } from "@/lib/constants";
import { cn } from "@/lib/utils";

/* ─── Presentation-only extensions (content rendering, no editing) ── */

const presentationExtensions: Extensions = [
  StarterKit.configure({
    codeBlock: false,
    heading: { levels: [1, 2, 3, 4] },
  }),
  Underline,
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  Typography,
  Link.configure({
    openOnClick: false,
    HTMLAttributes: {
      class: "text-primary underline underline-offset-2 cursor-pointer",
    },
  }),
  ResizableImage.configure({
    HTMLAttributes: { class: "rounded-lg max-w-full" },
    allowBase64: true,
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
  CustomCodeBlock,
  InlineMath,
  BlockMath,
  Callout,
  Toggle,
  BlockColorExtension,
];

/* ─── Utility helpers ─────────────────────────────────── */

function getTextContent(node: JSONContent): string {
  if (node.text) return node.text;
  if (!node.content) return "";
  return node.content.map(getTextContent).join("");
}

function isEmptySlideJson(nodes: JSONContent[]): boolean {
  if (nodes.length === 0) return true;
  return nodes.every((node) => {
    if (node.type !== "paragraph") return false;
    if (!node.content) return true;
    return node.content.every((child) => !child.text?.trim());
  });
}

interface SlideSlice {
  json: JSONContent;
  startNodeIndex: number;
  nodeCount: number;
}

function splitJsonIntoSlides(doc: JSONContent): SlideSlice[] {
  const content = doc.content || [];

  // Primary: split by horizontal rules
  const hasHr = content.some((node) => node.type === "horizontalRule");
  if (hasHr) {
    const groups: { nodes: JSONContent[]; startIndex: number }[] = [{ nodes: [], startIndex: 0 }];
    for (let i = 0; i < content.length; i++) {
      if (content[i].type === "horizontalRule") {
        groups.push({ nodes: [], startIndex: i + 1 });
      } else {
        groups[groups.length - 1].nodes.push(content[i]);
      }
    }
    const slides = groups
      .filter((g) => !isEmptySlideJson(g.nodes))
      .map((g) => ({
        json: { type: "doc" as const, content: g.nodes },
        startNodeIndex: g.startIndex,
        nodeCount: g.nodes.length,
      }));
    if (slides.length > 0) return slides;
  }

  // Fallback: split before H1/H2 headings
  const groups: { nodes: JSONContent[]; startIndex: number }[] = [{ nodes: [], startIndex: 0 }];
  for (let i = 0; i < content.length; i++) {
    const node = content[i];
    if (
      node.type === "heading" &&
      (node.attrs?.level === 1 || node.attrs?.level === 2) &&
      groups[groups.length - 1].nodes.length > 0
    ) {
      groups.push({ nodes: [], startIndex: i });
    }
    groups[groups.length - 1].nodes.push(node);
  }

  if (groups.length > 1) {
    return groups
      .filter((g) => !isEmptySlideJson(g.nodes))
      .map((g) => ({
        json: { type: "doc" as const, content: g.nodes },
        startNodeIndex: g.startIndex,
        nodeCount: g.nodes.length,
      }));
  }

  // Single slide: entire document
  if (isEmptySlideJson(content)) return [];
  return [
    { json: { type: "doc" as const, content }, startNodeIndex: 0, nodeCount: content.length },
  ];
}

function formatPresentationDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function extractSlideTitleFromJson(doc: JSONContent): string {
  const firstNode = doc.content?.[0];
  if (!firstNode) return "Untitled slide";

  if (firstNode.type === "heading") {
    return getTextContent(firstNode).slice(0, 60) || "Untitled slide";
  }

  const text = getTextContent(firstNode);
  if (text) {
    return text.slice(0, 60) + (text.length > 60 ? "\u2026" : "");
  }
  return "Untitled slide";
}

/* ─── Slide renderer (optionally editable) ───────────── */

function SlideContent({
  json,
  className,
  editable = false,
  onContentChange,
}: {
  json: JSONContent;
  className?: string;
  editable?: boolean;
  onContentChange?: (json: JSONContent) => void;
}) {
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  const editor = useEditor({
    extensions: presentationExtensions,
    content: json,
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => {
      onContentChangeRef.current?.(e.getJSON());
    },
  });

  return (
    <div className={className}>
      <EditorContent editor={editor} />
    </div>
  );
}

/* ─── Animation variants ──────────────────────────────── */

const slideVariants = {
  enter: (dir: number) => ({
    x: dir > 0 ? "50%" : "-50%",
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (dir: number) => ({
    x: dir > 0 ? "-50%" : "50%",
    opacity: 0,
  }),
};

/* ─── Types ───────────────────────────────────────────── */

interface Slide {
  type: "title" | "content";
  json?: JSONContent;
  title?: string;
  meta?: string;
  sourceNodeIndex?: number;
  nodeCount?: number;
}

interface PresentationModeProps {
  title?: string;
  author?: string;
  date?: string;
}

/* ─── Component ───────────────────────────────────────── */

export function PresentationMode({
  title: titleProp,
  author: authorProp,
  date: dateProp,
}: PresentationModeProps = {}) {
  const { isPresentationMode, setPresentationMode, fontFamily, fontSize, lineHeight } =
    useLayoutStore();
  const editor = useEditorRefStore((s) => s.editor);
  const { currentFileId, files } = useFileStore();
  const user = useAuthStore((s) => s.user);
  const { resolvedTheme } = useTheme();

  const [currentSlide, setCurrentSlide] = useState(0);
  const [direction, setDirection] = useState(0);
  const [isIdle, setIsIdle] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [showNavigator, setShowNavigator] = useState(false);
  const [jumpInput, setJumpInput] = useState("");

  const currentFile = files.find((f) => f.id === currentFileId);

  // Portal needs to wait for client mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Build slides: title slide + content slides
  const slides = useMemo<Slide[]>(() => {
    if (!editor || !isPresentationMode) return [];

    const contentSlides = splitJsonIntoSlides(editor.getJSON());
    if (contentSlides.length === 0) return [];

    const title = titleProp || currentFile?.name?.replace(/\.md$/i, "") || "Untitled";
    const author = authorProp ?? (user?.username || user?.email || "");
    const date =
      dateProp ?? (currentFile?.updatedAt ? formatPresentationDate(currentFile.updatedAt) : "");

    const metaParts: string[] = [];
    if (author) metaParts.push(author);
    if (date) metaParts.push(date);

    const titleSlide: Slide = {
      type: "title",
      title,
      meta: metaParts.length > 0 ? metaParts.join(" \u00B7 ") : undefined,
    };

    return [
      titleSlide,
      ...contentSlides.map((s) => ({
        type: "content" as const,
        json: s.json,
        sourceNodeIndex: s.startNodeIndex,
        nodeCount: s.nodeCount,
      })),
    ];
  }, [editor, isPresentationMode, currentFile, user, titleProp, authorProp, dateProp]);

  // Reset state when entering presentation
  useEffect(() => {
    if (isPresentationMode) {
      setCurrentSlide(0);
      setDirection(0);
      setIsIdle(false);
      setIsDark(resolvedTheme !== "light");
      setShowNavigator(false);
      setJumpInput("");
    }
  }, [isPresentationMode, resolvedTheme]);

  // Lock body scroll
  useEffect(() => {
    if (!isPresentationMode) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isPresentationMode]);

  const goNext = useCallback(() => {
    setDirection(1);
    setCurrentSlide((prev) => Math.min(prev + 1, slides.length - 1));
  }, [slides.length]);

  const goPrev = useCallback(() => {
    setDirection(-1);
    setCurrentSlide((prev) => Math.max(prev - 1, 0));
  }, []);

  const canEdit = editor?.isEditable ?? false;

  // Track edits made inside presentation slides (keyed by slide index)
  const editedContentsRef = useRef<Record<number, JSONContent>>({});

  // Reset edited contents when entering presentation
  useEffect(() => {
    if (isPresentationMode) {
      editedContentsRef.current = {};
    }
  }, [isPresentationMode]);

  const syncEditsToEditor = useCallback(() => {
    if (!editor) return;
    const edited = editedContentsRef.current;
    if (Object.keys(edited).length === 0) return;

    const originalDoc = editor.getJSON();
    const content = [...(originalDoc.content || [])];

    // Process edited slides in reverse order so earlier splices don't shift later indices
    const sortedEntries = Object.entries(edited)
      .map(([idx, json]) => [parseInt(idx, 10), json] as [number, JSONContent])
      .sort(([a], [b]) => b - a);

    for (const [slideIdx, newJson] of sortedEntries) {
      const slide = slides[slideIdx];
      if (slide?.type !== "content" || slide.sourceNodeIndex == null || slide.nodeCount == null)
        continue;
      const newNodes = newJson.content || [];
      content.splice(slide.sourceNodeIndex, slide.nodeCount, ...newNodes);
    }

    editor.commands.setContent({ type: "doc", content });
  }, [editor, slides]);

  const exit = useCallback(() => {
    syncEditsToEditor();
    setPresentationMode(false);
  }, [syncEditsToEditor, setPresentationMode]);

  const goToSlide = useCallback(
    (index: number) => {
      if (index < 0 || index >= slides.length) return;
      setDirection(index > currentSlide ? 1 : -1);
      setCurrentSlide(index);
      setShowNavigator(false);
      setJumpInput("");
    },
    [slides.length, currentSlide]
  );

  // Keyboard navigation
  useEffect(() => {
    if (!isPresentationMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // When typing inside the slide editor, let the editor handle all keys except Escape
      const target = e.target as HTMLElement;
      const isInEditor =
        target.closest?.(".ProseMirror") && target.closest?.(".presentation-slide");
      if (isInEditor) {
        if (e.key === "Escape") {
          e.preventDefault();
          (document.activeElement as HTMLElement)?.blur();
        }
        return;
      }

      // When navigator is open, intercept keys for jump input
      if (showNavigator) {
        if (e.key >= "0" && e.key <= "9") {
          e.preventDefault();
          setJumpInput((prev) => prev + e.key);
          return;
        }
        if (e.key === "Enter" && jumpInput) {
          e.preventDefault();
          const target = parseInt(jumpInput, 10) - 1;
          goToSlide(target);
          return;
        }
        if (e.key === "Backspace") {
          e.preventDefault();
          setJumpInput((prev) => prev.slice(0, -1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowNavigator(false);
          setJumpInput("");
          return;
        }
      }

      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case " ":
        case "PageDown":
          e.preventDefault();
          goNext();
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
          e.preventDefault();
          goPrev();
          break;
        case "Escape":
          e.preventDefault();
          exit();
          break;
        case "Home":
          e.preventDefault();
          setDirection(-1);
          setCurrentSlide(0);
          break;
        case "End":
          e.preventDefault();
          setDirection(1);
          setCurrentSlide(slides.length - 1);
          break;
        case "g":
        case "G":
          e.preventDefault();
          setShowNavigator((v) => !v);
          setJumpInput("");
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isPresentationMode,
    goNext,
    goPrev,
    exit,
    goToSlide,
    slides.length,
    showNavigator,
    jumpInput,
  ]);

  // Auto-hide controls after 3s of inactivity
  useEffect(() => {
    if (!isPresentationMode) return;
    if (showNavigator) {
      setIsIdle(false);
      return;
    }

    let timer: ReturnType<typeof setTimeout>;

    const resetIdle = () => {
      setIsIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIsIdle(true), 3000);
    };

    resetIdle();
    window.addEventListener("mousemove", resetIdle);
    window.addEventListener("keydown", resetIdle);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", resetIdle);
      window.removeEventListener("keydown", resetIdle);
    };
  }, [isPresentationMode, showNavigator]);

  if (!mounted || !isPresentationMode || slides.length === 0) return null;

  const progress = ((currentSlide + 1) / slides.length) * 100;
  const slide = slides[currentSlide];

  const contentClassName = cn(
    "presentation-content",
    fontFamily === "serif" && "pres-font-serif",
    fontFamily === "mono" && "pres-font-mono",
    fontSize === "small" && "pres-size-small",
    fontSize === "large" && "pres-size-large",
    lineHeight === "compact" && "pres-leading-compact",
    lineHeight === "relaxed" && "pres-leading-relaxed"
  );

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className={cn("presentation-overlay", !isDark && "presentation-light")}
      style={{ zIndex: Z_INDEX.MODAL + 10 }}
    >
      {/* Background */}
      <div className="presentation-bg" />

      {/* Top-right controls */}
      <div className={cn("presentation-top-controls", isIdle && "presentation-idle")}>
        <button
          onClick={() => setIsDark((d) => !d)}
          className="presentation-control-btn"
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button onClick={exit} className="presentation-control-btn" aria-label="Exit presentation">
          <X className="h-4 w-4" />
          <span className="presentation-close-label">ESC</span>
        </button>
      </div>

      {/* Slide content */}
      <div className="presentation-stage">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentSlide}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 30,
              mass: 0.8,
            }}
            className="presentation-slide"
          >
            {slide.type === "title" ? (
              <div className={cn(contentClassName, "presentation-title-slide")}>
                <h1 className="presentation-title-heading">{slide.title}</h1>
                {slide.meta && <p className="presentation-title-meta">{slide.meta}</p>}
              </div>
            ) : (
              <SlideContent
                json={editedContentsRef.current[currentSlide] ?? slide.json!}
                className={contentClassName}
                editable={canEdit}
                onContentChange={(json) => {
                  editedContentsRef.current[currentSlide] = json;
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation arrows */}
      {currentSlide > 0 && (
        <button
          onClick={goPrev}
          className={cn(
            "presentation-nav-btn presentation-nav-prev",
            isIdle && "presentation-idle"
          )}
          aria-label="Previous slide"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}
      {currentSlide < slides.length - 1 && (
        <button
          onClick={goNext}
          className={cn(
            "presentation-nav-btn presentation-nav-next",
            isIdle && "presentation-idle"
          )}
          aria-label="Next slide"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}

      {/* Invisible click zones for navigation */}
      <div className="presentation-click-zone-left" onClick={goPrev} />
      <div className="presentation-click-zone-right" onClick={goNext} />

      {/* Slide Navigator Panel */}
      <AnimatePresence>
        {showNavigator && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
            className="presentation-navigator"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="presentation-navigator-header">
              <span className="presentation-navigator-title">Go to slide</span>
              {jumpInput && <span className="presentation-navigator-jump">#{jumpInput}_</span>}
              <button
                onClick={() => {
                  setShowNavigator(false);
                  setJumpInput("");
                }}
                className="presentation-control-btn"
                aria-label="Close navigator"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="presentation-navigator-grid">
              {slides.map((s, i) => (
                <button
                  key={i}
                  onClick={() => goToSlide(i)}
                  className={cn(
                    "presentation-navigator-item",
                    i === currentSlide && "presentation-navigator-item-active"
                  )}
                >
                  <span className="presentation-navigator-number">{i + 1}</span>
                  <span className="presentation-navigator-label">
                    {s.type === "title" ? "Title Slide" : extractSlideTitleFromJson(s.json!)}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom bar: slide counter */}
      <div className={cn("presentation-bottom-bar", isIdle && "presentation-idle")}>
        <button
          onClick={() => {
            setShowNavigator((v) => !v);
            setJumpInput("");
          }}
          className="presentation-counter presentation-counter-btn"
          title="Press G to open slide navigator"
        >
          {currentSlide + 1} / {slides.length}
        </button>
      </div>

      {/* Progress bar */}
      <div className="presentation-progress-track">
        <motion.div
          className="presentation-progress-fill"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
        />
      </div>
    </motion.div>,
    document.body
  );
}
