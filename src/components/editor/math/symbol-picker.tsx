"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import katex from "katex";
import { cn } from "@/lib/utils";
import { MATH_SYMBOLS, SYMBOL_CATEGORIES } from "@/extensions/math/math-types";

interface SymbolPickerProps {
  onSelect: (latex: string) => void;
  onClose: () => void;
}

/**
 * Symbol Picker Component
 *
 * Provides a searchable grid of common LaTeX symbols
 */
export function SymbolPicker({ onSelect, onClose }: SymbolPickerProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("common");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search on mount (desktop only to avoid mobile keyboard popup)
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth >= 768) {
      searchInputRef.current?.focus();
    }
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Filter symbols
  const filteredSymbols = useMemo(() => {
    let symbols = MATH_SYMBOLS;

    if (search.trim()) {
      const q = search.toLowerCase();
      symbols = symbols.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.latex.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q)
      );
    } else {
      symbols = symbols.filter((s) => s.category === category);
    }

    return symbols;
  }, [search, category]);

  // Render symbol preview
  const renderSymbol = (latex: string) => {
    try {
      return katex.renderToString(latex, {
        throwOnError: false,
        displayMode: false,
      });
    } catch {
      return latex;
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "symbol-picker absolute z-50",
        "top-full left-0 mt-2",
        "w-80 max-h-96",
        "border border-border rounded-lg bg-popover shadow-xl",
        "animate-in fade-in-0 slide-in-from-top-2 duration-150"
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-sm font-medium">Insert Symbol</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Search */}
      <div className="p-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search symbols..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(
              "w-full pl-9 pr-3 py-1.5 text-base md:text-sm",
              "bg-background border border-input rounded-md",
              "focus:outline-none focus:ring-2 focus:ring-ring",
              "placeholder:text-muted-foreground"
            )}
          />
        </div>
      </div>

      {/* Category tabs */}
      {!search.trim() && (
        <div className="flex gap-1 p-2 border-b border-border overflow-x-auto scrollbar-thin">
          {SYMBOL_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={cn(
                "px-2 py-1 text-xs rounded whitespace-nowrap transition-colors",
                category === cat.id
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent text-muted-foreground hover:text-foreground"
              )}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Symbol grid */}
      <div className="p-2 max-h-48 overflow-y-auto">
        {filteredSymbols.length === 0 ? (
          <div className="text-center py-4 text-sm text-muted-foreground">
            No symbols found
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-1">
            {filteredSymbols.map((symbol) => (
              <button
                key={symbol.id}
                onClick={() => onSelect(symbol.latex)}
                title={`${symbol.name}\n${symbol.latex}`}
                className={cn(
                  "p-2 rounded text-center transition-colors",
                  "hover:bg-accent focus:bg-accent focus:outline-none",
                  "text-lg"
                )}
              >
                <span
                  dangerouslySetInnerHTML={{
                    __html: renderSymbol(symbol.latex),
                  }}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-border text-xs text-muted-foreground">
        Click a symbol to insert • Hover for LaTeX code
      </div>
    </div>
  );
}
