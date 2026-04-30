"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { textColorOptions, bgColorOptions, type BlockColorOption } from "@/lib/block-actions";

interface ColorPickerProps {
  activeTextColor: string | null;
  activeBackgroundColor: string | null;
  onTextColorChange: (color: string) => void;
  onBackgroundColorChange: (color: string) => void;
}

/**
 * Notion-style color picker with text and background color grids.
 * Reusable across bubble menu and block action menu.
 */
export const ColorPicker = memo(function ColorPicker({
  activeTextColor,
  activeBackgroundColor,
  onTextColorChange,
  onBackgroundColorChange,
}: ColorPickerProps) {
  return (
    <div className="p-2.5">
      {/* Text color section */}
      <p className="text-ui-xs mb-1.5 font-medium uppercase tracking-wider text-muted-foreground">
        Text color
      </p>
      <div className="mb-3 grid grid-cols-6 gap-1">
        {textColorOptions.map((color) => (
          <TextColorSwatch
            key={color.label}
            color={color}
            isActive={color.value === "" ? !activeTextColor : activeTextColor === color.value}
            onClick={() => onTextColorChange(color.value)}
          />
        ))}
      </div>

      {/* Background color section */}
      <p className="text-ui-xs mb-1.5 font-medium uppercase tracking-wider text-muted-foreground">
        Background
      </p>
      <div className="grid grid-cols-6 gap-1">
        {bgColorOptions.map((color) => (
          <BgColorSwatch
            key={color.label}
            color={color}
            isActive={
              color.value === "" ? !activeBackgroundColor : activeBackgroundColor === color.value
            }
            onClick={() => onBackgroundColorChange(color.value)}
          />
        ))}
      </div>
    </div>
  );
});

/** Text color swatch — shows an "A" in the given color */
function TextColorSwatch({
  color,
  isActive,
  onClick,
}: {
  color: BlockColorOption;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={color.label}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md text-sm font-bold transition-all",
        "hover:bg-accent",
        isActive && "ring-2 ring-primary ring-offset-1 ring-offset-popover"
      )}
      style={color.value ? { color: color.value } : undefined}
    >
      A
    </button>
  );
}

/** Background color swatch — shows a filled square */
function BgColorSwatch({
  color,
  isActive,
  onClick,
}: {
  color: BlockColorOption;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={color.label}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md transition-all",
        "hover:ring-2 hover:ring-accent",
        isActive && "ring-2 ring-primary ring-offset-1 ring-offset-popover"
      )}
    >
      <span
        className={cn(
          "h-5.5 w-5.5 h-[22px] w-[22px] rounded-[5px] border border-border/40",
          !color.value && "bg-popover"
        )}
        style={color.value ? { backgroundColor: color.value } : undefined}
      />
    </button>
  );
}
