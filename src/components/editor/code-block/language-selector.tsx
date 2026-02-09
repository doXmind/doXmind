"use client";

import { useState, useMemo } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  getLanguageDisplayName,
  getPopularLanguages,
  getOtherLanguages,
  searchLanguages,
  type Language,
} from "@/extensions/code-block/code-block-types";
import { cn } from "@/lib/utils";

interface LanguageSelectorProps {
  value: string | null;
  onChange: (language: string) => void;
}

export function LanguageSelector({ value, onChange }: LanguageSelectorProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const filteredLanguages = useMemo(() => {
    return searchLanguages(search);
  }, [search]);

  const popularLanguages = getPopularLanguages();
  const otherLanguages = getOtherLanguages();

  const handleSelect = (language: Language) => {
    onChange(language.id);
    setOpen(false);
    setSearch("");
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setSearch("");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleOpenChange(!open)}
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {getLanguageDisplayName(value)}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {/* Search Input */}
        <div className="px-2 py-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search language..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
        </div>

        <DropdownMenuSeparator />

        <div className="max-h-60 overflow-y-auto">
          {search.trim() ? (
            // Filtered results
            filteredLanguages.length > 0 ? (
              filteredLanguages.map((lang) => (
                <DropdownMenuItem
                  key={lang.id}
                  onClick={() => handleSelect(lang)}
                  className={cn("text-xs", value === lang.id && "bg-accent")}
                >
                  {lang.name}
                </DropdownMenuItem>
              ))
            ) : (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                No languages found
              </div>
            )
          ) : (
            // Grouped view
            <>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Popular
              </DropdownMenuLabel>
              {popularLanguages.map((lang) => (
                <DropdownMenuItem
                  key={lang.id}
                  onClick={() => handleSelect(lang)}
                  className={cn("text-xs", value === lang.id && "bg-accent")}
                >
                  {lang.name}
                </DropdownMenuItem>
              ))}

              <DropdownMenuSeparator />

              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                All Languages
              </DropdownMenuLabel>
              {otherLanguages.map((lang) => (
                <DropdownMenuItem
                  key={lang.id}
                  onClick={() => handleSelect(lang)}
                  className={cn("text-xs", value === lang.id && "bg-accent")}
                >
                  {lang.name}
                </DropdownMenuItem>
              ))}
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
