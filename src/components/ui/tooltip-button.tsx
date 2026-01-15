"use client";

import * as React from "react";
import { Tooltip } from "./tooltip";
import { Button, type ButtonProps } from "./button";
import type { LucideIcon } from "lucide-react";

export interface TooltipButtonProps extends ButtonProps {
  /** Tooltip content to display on hover */
  tooltip: React.ReactNode;
  /** Side of the button to show the tooltip */
  tooltipSide?: "top" | "right" | "bottom" | "left";
  /** Delay before showing tooltip (ms) */
  tooltipDelay?: number;
  /** Icon component to render inside the button */
  icon?: LucideIcon;
  /** Icon size class (default: "h-4 w-4") */
  iconClassName?: string;
}

/**
 * A button wrapped with a tooltip for consistent icon button patterns.
 * Combines the most common Tooltip + Button usage pattern into a single component.
 *
 * @example
 * // Basic usage
 * <TooltipButton
 *   tooltip="Save document"
 *   icon={Save}
 *   onClick={handleSave}
 * />
 *
 * @example
 * // With custom variant and side
 * <TooltipButton
 *   tooltip="Delete item"
 *   tooltipSide="left"
 *   variant="destructive"
 *   icon={Trash}
 *   onClick={handleDelete}
 * />
 *
 * @example
 * // With children instead of icon
 * <TooltipButton tooltip="Custom content" variant="ghost" size="icon">
 *   <CustomIcon />
 * </TooltipButton>
 */
export const TooltipButton = React.forwardRef<HTMLButtonElement, TooltipButtonProps>(
  (
    {
      tooltip,
      tooltipSide = "top",
      tooltipDelay,
      icon: Icon,
      iconClassName = "h-4 w-4",
      variant = "ghost",
      size = "icon",
      children,
      ...buttonProps
    },
    ref
  ) => {
    return (
      <Tooltip content={tooltip} side={tooltipSide} delayDuration={tooltipDelay}>
        <Button ref={ref} variant={variant} size={size} {...buttonProps}>
          {Icon ? <Icon className={iconClassName} /> : children}
        </Button>
      </Tooltip>
    );
  }
);

TooltipButton.displayName = "TooltipButton";
