"use client";

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { OutlineCollapsed } from "@/components/editor/mindlines/outline-collapsed";
import type { Heading } from "@/components/editor/mindlines/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLayoutStore } from "@/stores/layout-store";
import { cn } from "@/lib/utils";
import { perfMark, perfMeasure } from "@/lib/perf";
import type { FileItem } from "@/stores/file-store";

const SCROLLSPY_THRESHOLD = 0.2;
const MIN_OUTLINE_HEADINGS = 2;

interface BrowsingRuntimeProps {
  file: FileItem;
  reservedRightInset?: number;
  onActivateEdit?: (context: { scrollTop: number }) => void;
}

interface SearchRender {
  html: string;
  count: number;
}

export function BrowsingRuntime({
  file,
  reservedRightInset = 0,
  onActivateEdit,
}: BrowsingRuntimeProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const activatedRef = useRef(false);
  const lineHeight = useLayoutStore((s) => s.lineHeight);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);

  const headings = useMemo<Heading[]>(
    () =>
      (file.outline ?? []).map((item, index) => ({
        id: item.id,
        level: item.depth,
        text: item.text || "Untitled",
        pos: index,
      })),
    [file.outline]
  );
  const outlineHeadings = useMemo(
    () => (headings.length >= MIN_OUTLINE_HEADINGS ? headings : []),
    [headings]
  );

  const sourceHtml = file.browsingHtml ?? file.editorHtml ?? file.content ?? "";
  const preparedHtml = useMemo(
    () => prepareBrowsingHtml(sourceHtml, headings),
    [headings, sourceHtml]
  );
  const searchRender = useMemo(
    () => renderSearchHighlights(preparedHtml, searchTerm, currentSearchIndex),
    [currentSearchIndex, preparedHtml, searchTerm]
  );

  useEffect(() => {
    const startMark = `doxmind.browsing.open.start:${file.id}:${performance.now()}`;
    perfMark(startMark);
    const frame = requestAnimationFrame(() => {
      const detail = {
        fileId: file.id,
        documentType: "markdown",
        runtime: "browsing",
        sourceState: file.sourceState,
        rendererVersion: file.browsingRendererVersion,
      };
      perfMeasure("doxmind.browsing.firstPaint", startMark, undefined, detail);

      const switchStartMark = window.__doxmindSwitchStartMark;
      const fileIdAtStart = window.__doxmindSwitchFileId;
      if (switchStartMark && fileIdAtStart === file.id) {
        perfMeasure("doxmind.switch.firstPaint", switchStartMark, undefined, detail);
        window.__doxmindSwitchStartMark = undefined;
        window.__doxmindSwitchFileId = undefined;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [file.browsingRendererVersion, file.id, file.sourceState]);

  useEffect(() => {
    setCurrentSearchIndex(0);
  }, [preparedHtml, searchTerm]);

  useEffect(() => {
    if (!searchTerm || searchRender.count === 0) return;
    const active = contentRef.current?.querySelector<HTMLElement>(
      '[data-browsing-search-current="true"]'
    );
    active?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentSearchIndex, searchRender.count, searchTerm]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const placeholders = Array.from(
      content.querySelectorAll<HTMLElement>(
        '[data-browsing-heavy-block][data-browsing-block-state="placeholder"]'
      )
    );
    if (placeholders.length === 0) return;

    if (typeof IntersectionObserver === "undefined") {
      placeholders.forEach((el) => el.setAttribute("data-browsing-block-state", "hydrated"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries, self) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = entry.target as HTMLElement;
          target.setAttribute("data-browsing-block-state", "hydrated");
          self.unobserve(target);
        }
      },
      {
        root: scrollAreaRef.current ?? null,
        rootMargin: "200px 0px",
        threshold: 0.01,
      }
    );

    placeholders.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [searchRender.html]);

  useEffect(() => {
    const scrollParent = scrollAreaRef.current;
    const content = contentRef.current;
    if (!scrollParent || !content || outlineHeadings.length === 0) {
      setActiveId(null);
      return;
    }

    let rafId: number | null = null;
    const findTopHeading = () => {
      rafId = null;
      const containerRect = scrollParent.getBoundingClientRect();
      const threshold = containerRect.top + containerRect.height * SCROLLSPY_THRESHOLD;

      let best: Heading | null = null;
      for (const heading of outlineHeadings) {
        const element = content.querySelector<HTMLElement>(`#${escapeCssId(heading.id)}`);
        if (!element) continue;
        if (element.getBoundingClientRect().top <= threshold) {
          best = heading;
        } else {
          break;
        }
      }
      setActiveId((prev) => {
        const next = best?.id ?? outlineHeadings[0]?.id ?? null;
        return prev === next ? prev : next;
      });
    };

    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(findTopHeading);
    };

    scrollParent.addEventListener("scroll", handleScroll, { passive: true });
    findTopHeading();
    return () => {
      scrollParent.removeEventListener("scroll", handleScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [outlineHeadings, searchRender.html]);

  const navigateTo = useCallback((heading: Heading) => {
    const scrollParent = scrollAreaRef.current;
    const content = contentRef.current;
    const element = content?.querySelector<HTMLElement>(`#${escapeCssId(heading.id)}`);
    if (!scrollParent || !element) return;

    const elementRect = element.getBoundingClientRect();
    const containerRect = scrollParent.getBoundingClientRect();
    const relativeTop = elementRect.top - containerRect.top;
    const targetScrollTop = scrollParent.scrollTop + relativeTop - 80;

    scrollParent.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: "smooth",
    });
  }, []);

  const activateEdit = useCallback(() => {
    if (!onActivateEdit || activatedRef.current) return;
    activatedRef.current = true;
    const startMark = `doxmind.editor.activation.start:${file.id}:${performance.now()}`;
    perfMark(startMark);
    if (typeof window !== "undefined") {
      window.__doxmindEditorActivationStartMark = startMark;
      window.__doxmindEditorActivationFileId = file.id;
    }
    onActivateEdit({ scrollTop: scrollAreaRef.current?.scrollTop ?? 0 });
  }, [file.id, onActivateEdit]);

  useEffect(() => {
    activatedRef.current = false;
  }, [file.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEventFromEditableElement(event.target) || !isKeyboardEditIntent(event)) return;
      activateEdit();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activateEdit]);

  const pageFrameStyle = useMemo(
    () =>
      ({
        "--editor-outline-gutter": `${reservedRightInset}px`,
      }) as CSSProperties,
    [reservedRightInset]
  );

  return (
    <div
      className="flex h-full flex-col"
      data-testid="browsing-runtime"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (isKeyboardEditIntent(event.nativeEvent)) {
          activateEdit();
        }
      }}
    >
      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {outlineHeadings.length > 0 && (
            <div
              className="pointer-events-none absolute bottom-[14vh] right-2 top-[18vh] z-30 overflow-visible transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] md:right-2"
              style={{ width: 40 }}
            >
              <div className="pointer-events-auto relative h-full w-full">
                <OutlineCollapsed
                  headings={outlineHeadings}
                  activeId={activeId}
                  onNavigate={navigateTo}
                />
              </div>
            </div>
          )}
          <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1" data-browsing-scroll>
            <StaticCover file={file} />
            <div
              className={cn(
                "editor-page-frame relative",
                lineHeight === "compact" && "editor-leading-compact",
                lineHeight === "relaxed" && "editor-leading-relaxed"
              )}
              style={pageFrameStyle}
            >
              <StaticIcon icon={file.icon} />
              <div
                ref={contentRef}
                className="ProseMirror doxmind-browsing-prose"
                data-testid="browsing-document"
                onMouseDown={(event) => {
                  if (isEventFromInteractiveElement(event.target)) return;
                  hydrateClickedHeavyBlock(event.target);
                  activateEdit();
                }}
                dangerouslySetInnerHTML={{ __html: searchRender.html }}
              />
            </div>
          </ScrollArea>
          <BrowsingSearchBar
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            resultCount={searchRender.count}
            currentIndex={currentSearchIndex}
            onPrevious={() =>
              setCurrentSearchIndex((index) =>
                searchRender.count === 0 ? 0 : (index - 1 + searchRender.count) % searchRender.count
              )
            }
            onNext={() =>
              setCurrentSearchIndex((index) =>
                searchRender.count === 0 ? 0 : (index + 1) % searchRender.count
              )
            }
          />
        </div>
      </div>
    </div>
  );
}

function StaticCover({ file }: { file: FileItem }) {
  if (!file.coverImageUrl) return null;
  const isCssBackground = file.coverImageUrl.startsWith("linear-gradient(");
  return (
    <div className="mb-4 h-[200px] overflow-hidden md:h-[280px]" aria-hidden="true">
      {isCssBackground ? (
        <div className="h-full w-full" style={{ background: file.coverImageUrl }} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.coverImageUrl}
          alt=""
          className="h-full w-full object-cover"
          style={{ objectPosition: `center ${(file.coverPosition ?? 0.5) * 100}%` }}
          draggable={false}
        />
      )}
    </div>
  );
}

function StaticIcon({ icon }: { icon: string | null }) {
  if (!icon) return <div className="h-7" aria-hidden="true" />;
  return (
    <div className="flex h-[68px] items-end pb-4" aria-hidden="true">
      <span className="text-2xl leading-none">{icon}</span>
    </div>
  );
}

interface BrowsingSearchBarProps {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  resultCount: number;
  currentIndex: number;
  onPrevious: () => void;
  onNext: () => void;
}

function BrowsingSearchBar({
  searchTerm,
  onSearchTermChange,
  resultCount,
  currentIndex,
  onPrevious,
  onNext,
}: BrowsingSearchBarProps) {
  const isSearchBarOpen = useLayoutStore((s) => s.isSearchBarOpen);
  const setSearchBarOpen = useLayoutStore((s) => s.setSearchBarOpen);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isSearchBarOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      onSearchTermChange("");
    }
  }, [isSearchBarOpen, onSearchTermChange]);

  const close = () => setSearchBarOpen(false);

  return (
    <AnimatePresence>
      {isSearchBarOpen && (
        <motion.div
          role="search"
          aria-label="Find in document"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className={cn(
            "absolute top-2 z-[45]",
            "left-2 right-2 md:left-auto md:right-4 md:w-[420px]",
            "rounded-lg border border-border bg-popover",
            "shadow-lg shadow-black/10 dark:shadow-black/30"
          )}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            } else if (event.key === "Enter" && event.shiftKey) {
              event.preventDefault();
              onPrevious();
            } else if (event.key === "Enter") {
              event.preventDefault();
              onNext();
            }
          }}
        >
          <div className="flex items-center gap-2 px-3 py-2.5">
            <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(event) => onSearchTermChange(event.target.value)}
              placeholder="Search"
              className="min-w-[80px] flex-1 bg-transparent text-base placeholder:text-muted-foreground focus:outline-none md:text-sm"
              aria-label="Search text"
            />
            <span className="min-w-[60px] whitespace-nowrap text-center text-xs text-muted-foreground">
              {searchTerm ? (
                resultCount > 0 ? (
                  `${currentIndex + 1} of ${resultCount}`
                ) : (
                  <span className="text-amber-500">No matches</span>
                )
              ) : null}
            </span>
            <button
              type="button"
              onClick={onPrevious}
              disabled={resultCount === 0}
              className="rounded-md p-1.5 transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous result"
              title="Previous result"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={resultCount === 0}
              className="rounded-md p-1.5 transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next result"
              title="Next result"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={close}
              className="rounded-md p-1.5 transition-colors hover:bg-accent"
              aria-label="Close search"
              title="Close search"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function renderSearchHighlights(html: string, rawTerm: string, activeIndex: number): SearchRender {
  const term = rawTerm.trim();
  if (!term || typeof window === "undefined" || typeof DOMParser === "undefined") {
    return { html, count: 0 };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div data-root>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return { html, count: 0 };

  const textNodes: Text[] = [];
  const filter = doc.defaultView?.NodeFilter ?? window.NodeFilter;
  const nodeFilter = filter.SHOW_TEXT;
  const walker = doc.createTreeWalker(root, nodeFilter, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!node.nodeValue || !parent) return filter.FILTER_REJECT;
      if (parent.closest("script,style,mark")) return filter.FILTER_REJECT;
      return filter.FILTER_ACCEPT;
    },
  });

  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === 3) textNodes.push(current as Text);
    current = walker.nextNode();
  }

  let matchIndex = 0;
  const needle = term.toLocaleLowerCase();
  for (const node of textNodes) {
    const text = node.nodeValue ?? "";
    const haystack = text.toLocaleLowerCase();
    let cursor = 0;
    let index = haystack.indexOf(needle, cursor);
    if (index === -1) continue;

    const fragment = doc.createDocumentFragment();
    while (index !== -1) {
      if (index > cursor) {
        fragment.append(doc.createTextNode(text.slice(cursor, index)));
      }
      const mark = doc.createElement("mark");
      mark.setAttribute("data-browsing-search-result", "true");
      if (matchIndex === activeIndex) {
        mark.setAttribute("data-browsing-search-current", "true");
      }
      mark.textContent = text.slice(index, index + term.length);
      fragment.append(mark);
      matchIndex += 1;
      cursor = index + term.length;
      index = haystack.indexOf(needle, cursor);
    }
    if (cursor < text.length) {
      fragment.append(doc.createTextNode(text.slice(cursor)));
    }
    node.replaceWith(fragment);
  }

  return { html: root.innerHTML, count: matchIndex };
}

function prepareBrowsingHtml(html: string, headings: Heading[] = []) {
  if (!html || typeof window === "undefined" || typeof DOMParser === "undefined") return html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div data-root>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return html;

  applyOutlineHeadingIds(root, headings);

  for (const image of Array.from(root.querySelectorAll("img"))) {
    if (!image.hasAttribute("loading")) image.setAttribute("loading", "lazy");
    if (!image.hasAttribute("decoding")) image.setAttribute("decoding", "async");
  }

  for (const code of Array.from(root.querySelectorAll("pre > code"))) {
    const language = Array.from(code.classList)
      .find((className) => className.startsWith("language-"))
      ?.slice("language-".length);
    if (language === "mermaid" || language === "math") {
      const pre = code.closest("pre");
      if (pre) annotateHeavyBlock(pre, language);
    }
  }

  for (const node of Array.from(
    root.querySelectorAll<HTMLElement>('[data-type="mermaid-chart"]')
  )) {
    annotateHeavyBlock(node, "mermaid");
    if (!node.textContent?.trim()) {
      const code = (node.getAttribute("data-code") || "").trim();
      const preview = code.split("\n").slice(0, 3).join(" ").slice(0, 120);
      node.textContent = preview || "Mermaid diagram";
    }
  }

  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-type="block-math"]'))) {
    annotateHeavyBlock(node, "math");
    if (!node.textContent?.trim()) {
      const latex = (node.getAttribute("data-latex") || "").trim();
      node.textContent = latex || "Equation";
    }
  }

  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-type="inline-math"]'))) {
    if (!node.textContent?.trim()) {
      const latex = (node.getAttribute("data-latex") || "").trim();
      if (latex) node.textContent = latex;
    }
  }

  for (const node of Array.from(
    root.querySelectorAll<HTMLElement>('[data-type="pdf-block"], [data-type="excel-block"]')
  )) {
    const blockType = node.getAttribute("data-type") || "external-reference";
    annotateHeavyBlock(node, blockType);
  }

  return root.innerHTML;
}

function applyOutlineHeadingIds(root: Element, headings: Heading[]) {
  if (headings.length === 0) return;
  const renderedHeadings = Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));
  for (let index = 0; index < headings.length && index < renderedHeadings.length; index += 1) {
    const element = renderedHeadings[index];
    if (!element.id) element.id = headings[index].id;
  }
}

function annotateHeavyBlock(el: Element, blockType: string) {
  el.setAttribute("data-browsing-heavy-block", blockType);
  if (!el.hasAttribute("data-browsing-block-state")) {
    el.setAttribute("data-browsing-block-state", "placeholder");
  }
}

function escapeCssId(id: string) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(id);
  return id.replace(/["\\#.;?+*~':!^$[\]()=>|/@]/g, "\\$&");
}

function isKeyboardEditIntent(event: KeyboardEvent) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key === "Enter" || event.key === "Backspace" || event.key === "Delete") return true;
  if (event.key === "/" || event.key === " ") return true;
  return event.key.length === 1;
}

function isEventFromEditableElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return !!target.closest('input,textarea,select,[contenteditable="true"]');
}

function isEventFromInteractiveElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    'a,button,input,textarea,select,[role="button"],[contenteditable="true"]'
  );
}

function hydrateClickedHeavyBlock(target: EventTarget | null) {
  if (!(target instanceof Element)) return;
  const heavy = target.closest<HTMLElement>(
    '[data-browsing-heavy-block][data-browsing-block-state="placeholder"]'
  );
  if (heavy) heavy.setAttribute("data-browsing-block-state", "hydrated");
}
