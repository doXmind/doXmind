"use client";

import { Editor } from "@tiptap/react";
import { Eye, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DiffReviewToolbarProps {
  editor: Editor | null;
  isActive: boolean;
  pendingCount: number;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

export function DiffReviewToolbar({
  editor,
  isActive,
  pendingCount,
  onAcceptAll,
  onRejectAll,
}: DiffReviewToolbarProps) {
  if (!isActive || !editor) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2",
        "bg-amber-50 dark:bg-amber-950/30",
        "border-b border-amber-200 dark:border-amber-800"
      )}
    >
      {/* Status indicator */}
      <div className="flex items-center gap-2 text-sm">
        <Eye className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="font-medium text-amber-800 dark:text-amber-200">
          Review Mode
        </span>
        <span className="text-amber-600 dark:text-amber-400">
          {pendingCount} change{pendingCount !== 1 ? "s" : ""} pending
        </span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Action buttons */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onRejectAll}
        className={cn(
          "text-red-600 dark:text-red-400",
          "hover:text-red-700 dark:hover:text-red-300",
          "hover:bg-red-100 dark:hover:bg-red-900/30"
        )}
      >
        <X className="h-4 w-4 mr-1" />
        Reject All
      </Button>

      <Button
        variant="default"
        size="sm"
        onClick={onAcceptAll}
        className={cn(
          "bg-green-600 hover:bg-green-700",
          "dark:bg-green-700 dark:hover:bg-green-600"
        )}
      >
        <Check className="h-4 w-4 mr-1" />
        Accept All
      </Button>
    </div>
  );
}
