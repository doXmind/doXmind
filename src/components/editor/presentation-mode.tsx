"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { useLayoutStore } from "@/stores/layout-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useFileStore } from "@/stores/file-store";
import { useAuthStore } from "@/stores/auth-store";
import { Z_INDEX } from "@/lib/constants";
import { cn } from "@/lib/utils";

function isEmptySlide(html: string): boolean {
  const stripped = html
    .replace(/<p>\s*<\/p>/g, "")
    .replace(/<[^>]*>/g, "")
    .trim();
  return stripped.length === 0;
}

function splitHtmlIntoSlides(html: string): string[] {
  // Primary: split by <hr> dividers
  const hasHr = /<hr\s*\/?>/i.test(html);
  if (hasHr) {
    return html.split(/<hr\s*\/?>/i).filter((s) => !isEmptySlide(s));
  }

  // Fallback: split by H1/H2 headings
  // Split before each <h1> or <h2> tag, keeping the tag with its content
  const headingSlides = html.split(/(?=<h[12]\b)/i).filter((s) => !isEmptySlide(s));
  if (headingSlides.length > 1) {
    return headingSlides;
  }

  // No dividers, no headings — entire document as one slide
  return isEmptySlide(html) ? [] : [html];
}

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

interface Slide {
  type: "title" | "content";
  html: string;
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

interface PresentationModeProps {
  /** Override title (default: current file name from store) */
  title?: string;
  /** Override author (default: current user from store) */
  author?: string;
  /** Override date string (default: file updatedAt from store) */
  date?: string;
}

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

  const currentFile = files.find((f) => f.id === currentFileId);

  // Portal needs to wait for client mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Build slides: title slide + content slides
  const slides = useMemo<Slide[]>(() => {
    if (!editor || !isPresentationMode) return [];

    const contentSlides = splitHtmlIntoSlides(editor.getHTML());
    if (contentSlides.length === 0) return [];

    // Build title slide — props override store values
    const title = titleProp || currentFile?.name?.replace(/\.md$/i, "") || "Untitled";
    const author = authorProp ?? (user?.username || user?.email || "");
    const date =
      dateProp ?? (currentFile?.updatedAt ? formatPresentationDate(currentFile.updatedAt) : "");

    const metaParts: string[] = [];
    if (author) metaParts.push(author);
    if (date) metaParts.push(date);
    const metaHtml =
      metaParts.length > 0
        ? `<p class="presentation-title-meta">${metaParts.join(" &middot; ")}</p>`
        : "";

    const titleSlide: Slide = {
      type: "title",
      html: `<h1 class="presentation-title-heading">${title}</h1>${metaHtml}`,
    };

    return [titleSlide, ...contentSlides.map((html) => ({ type: "content" as const, html }))];
  }, [editor, isPresentationMode, currentFile, user, titleProp, authorProp, dateProp]);

  // Reset state when entering presentation
  useEffect(() => {
    if (isPresentationMode) {
      setCurrentSlide(0);
      setDirection(0);
      setIsIdle(false);
      setIsDark(resolvedTheme !== "light");
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

  const exit = useCallback(() => {
    setPresentationMode(false);
  }, [setPresentationMode]);

  // Keyboard navigation
  useEffect(() => {
    if (!isPresentationMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
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
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPresentationMode, goNext, goPrev, exit, slides.length]);

  // Auto-hide controls after 3s of inactivity
  useEffect(() => {
    if (!isPresentationMode) return;
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
  }, [isPresentationMode]);

  if (!mounted || !isPresentationMode || slides.length === 0) return null;

  const progress = ((currentSlide + 1) / slides.length) * 100;

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
            <div
              className={cn(
                "presentation-content",
                slides[currentSlide].type === "title" && "presentation-title-slide",
                fontFamily === "serif" && "pres-font-serif",
                fontFamily === "mono" && "pres-font-mono",
                fontSize === "small" && "pres-size-small",
                fontSize === "large" && "pres-size-large",
                lineHeight === "compact" && "pres-leading-compact",
                lineHeight === "relaxed" && "pres-leading-relaxed"
              )}
              dangerouslySetInnerHTML={{ __html: slides[currentSlide].html }}
            />
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

      {/* Bottom bar: slide counter */}
      <div className={cn("presentation-bottom-bar", isIdle && "presentation-idle")}>
        <span className="presentation-counter">
          {currentSlide + 1} / {slides.length}
        </span>
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
