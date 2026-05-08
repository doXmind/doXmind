"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, FileText } from "lucide-react";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  CollisionItem,
  CollisionResolution,
} from "@/lib/external-import-resolver";

/**
 * Conflict-resolution modal surfaced when a sidebar external DnD batch
 * (#67/#69) lands in `plan.collisions`. Multi-file drops evaluate each item
 * independently against the whitelist; everything in `collisions` is
 * surfaced HERE in one place, and everything in `rejected` shows the
 * bad-extension toast(s) (already wired in #67).
 *
 * The user picks Replace / Keep both / Skip per row, then presses Apply
 * (commits the batch) or Cancel all (drops the entire batch — accepted
 * items dropped earlier in the same drop are unaffected; this dialog only
 * controls the collision sub-batch).
 *
 * Replace is load-bearing: at the FS level it overwrites the user file but
 * leaves the hidden `.doxmind` sidecar intact (CONTEXT.md "Stale sidecar"
 * + ADR 0002). The next open trips the Salvage path. The Replace hint
 * copy alludes to that contract without dragging the user into the weeds.
 */
export interface ImportConflictModalProps {
  open: boolean;
  collisions: CollisionItem[];
  /** Apply with the per-collision decisions. Keyed by `existingName`. */
  onApply: (decisions: Record<string, CollisionResolution>) => void;
  /** Drop the entire collision sub-batch — equivalent to "skip" for every row. */
  onCancelAll: () => void;
}

const RESOLUTIONS: CollisionResolution[] = ["replace", "keep-both", "skip"];

export function ImportConflictModal({
  open,
  collisions,
  onApply,
  onCancelAll,
}: ImportConflictModalProps) {
  const t = useTranslations("sidebar");
  const [decisions, setDecisions] = useState<Record<string, CollisionResolution>>({});

  // Reset decisions whenever the dialog reopens with a fresh batch. The
  // collision list is the identity of the dialog: a new batch arriving
  // (different list, possibly with overlapping names) wipes the prior
  // selections so the user doesn't accidentally apply a stale decision.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, CollisionResolution> = {};
    for (const collision of collisions) {
      // Pre-select "keep-both" — it's the safest default (no data loss,
      // no skipped imports). The user can still flip every row before Apply.
      next[collision.existingName] = "keep-both";
    }
    setDecisions(next);
  }, [open, collisions]);

  const allDecided = useMemo(
    () => collisions.every((c) => decisions[c.existingName] !== undefined),
    [collisions, decisions]
  );

  const handleApply = () => {
    if (!allDecided) return;
    onApply(decisions);
  };

  return (
    <Modal open={open} onClose={onCancelAll} className="max-w-xl">
      <ModalHeader onClose={onCancelAll}>
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          {t("importConflictTitle", { count: collisions.length })}
        </span>
      </ModalHeader>
      <p className="text-sm text-muted-foreground">{t("importConflictDescription")}</p>

      <div className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto pr-1">
        {collisions.map((collision) => {
          const current = decisions[collision.existingName];
          return (
            <div
              key={collision.existingName}
              className="rounded-lg border border-border bg-background/40 p-3"
            >
              <div className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{collision.existingName}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {t("importConflictExisting")}
                </span>
              </div>

              <div
                role="radiogroup"
                aria-label={collision.existingName}
                className="mt-2 grid grid-cols-3 gap-1.5"
              >
                {RESOLUTIONS.map((resolution) => (
                  <ResolutionButton
                    key={resolution}
                    resolution={resolution}
                    selected={current === resolution}
                    onSelect={() =>
                      setDecisions((prev) => ({
                        ...prev,
                        [collision.existingName]: resolution,
                      }))
                    }
                    label={labelFor(t, resolution)}
                  />
                ))}
              </div>

              {current && (
                <p className="mt-2 text-xs text-muted-foreground">{hintFor(t, current)}</p>
              )}
            </div>
          );
        })}
      </div>

      <ModalFooter>
        <Button variant="outline" onClick={onCancelAll}>
          {t("importConflictCancelAll")}
        </Button>
        <Button onClick={handleApply} disabled={!allDecided}>
          {t("importConflictApply")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function ResolutionButton({
  resolution,
  selected,
  onSelect,
  label,
}: {
  resolution: CollisionResolution;
  selected: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        selected
          ? resolution === "replace"
            ? "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-primary/60 bg-primary/10 text-primary"
          : "border-border bg-background hover:bg-accent hover:text-accent-foreground"
      )}
    >
      {label}
    </button>
  );
}

function labelFor(
  t: ReturnType<typeof useTranslations<"sidebar">>,
  resolution: CollisionResolution
): string {
  switch (resolution) {
    case "replace":
      return t("importConflictReplace");
    case "keep-both":
      return t("importConflictKeepBoth");
    case "skip":
      return t("importConflictSkip");
  }
}

function hintFor(
  t: ReturnType<typeof useTranslations<"sidebar">>,
  resolution: CollisionResolution
): string {
  switch (resolution) {
    case "replace":
      return t("importConflictReplaceHint");
    case "keep-both":
      return t("importConflictKeepBothHint");
    case "skip":
      return t("importConflictSkipHint");
  }
}
