"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Tags, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  diffPageProperties,
  hasPagePropertiesPatch,
  isEditablePagePropertyKey,
  pagePropertiesFromMeta,
  parsePagePropertyInput,
  savePageProperties,
  type PageProperties,
  type PagePropertiesPatch,
  type PagePropertyValue,
} from "@/lib/page-properties";
import type { FileItem } from "@/types";
import { getDisplayName, isMarkdownFile } from "@/lib/document-types";
import { useFileStore } from "@/stores/file-store";

export interface PagePropertiesPanelProps {
  file: FileItem;
  saveProperties?: (pageId: string, patch: PagePropertiesPatch) => Promise<boolean>;
}

type PropertyDraftKind = "text" | "number" | "checkbox" | "list" | "relation";

interface CustomPropertyDraft {
  id: string;
  key: string;
  kind: PropertyDraftKind;
  value: string;
  checked: boolean;
  relationValues: string[];
}

let propertyDraftSequence = 0;

export function PagePropertiesPanel({
  file,
  saveProperties = savePageProperties,
}: PagePropertiesPanelProps) {
  const t = useTranslations("pageProperties");
  const projected = useMemo(() => pagePropertiesFromMeta(file.meta), [file.meta]);
  const [open, setOpen] = useState(false);
  const [baseline, setBaseline] = useState<PageProperties>(projected);
  const [tagsInput, setTagsInput] = useState(projected.tags.join(", "));
  const [aliasesInput, setAliasesInput] = useState(projected.aliases.join(", "));
  const [customDrafts, setCustomDrafts] = useState(() => customDraftsFrom(projected.custom));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaceFiles = useFileStore((state) => state.files);
  const relationPages = useMemo(
    () =>
      workspaceFiles.filter(
        (candidate) => candidate.id !== file.id && !candidate.isFolder && isMarkdownFile(candidate)
      ),
    [file.id, workspaceFiles]
  );

  useEffect(() => {
    setBaseline(projected);
    setTagsInput(projected.tags.join(", "));
    setAliasesInput(projected.aliases.join(", "));
    setCustomDrafts(customDraftsFrom(projected.custom));
    setError(null);
  }, [file.id, projected]);

  const customProjection = useMemo(() => projectCustomDrafts(customDrafts), [customDrafts]);
  const current = useMemo<PageProperties>(
    () => ({
      tags: parsePagePropertyInput(tagsInput),
      aliases: parsePagePropertyInput(aliasesInput),
      custom: customProjection.properties ?? baseline.custom,
    }),
    [aliasesInput, baseline.custom, customProjection.properties, tagsInput]
  );
  const patch = useMemo(() => diffPageProperties(baseline, current), [baseline, current]);

  const resetDraft = () => {
    setTagsInput(baseline.tags.join(", "));
    setAliasesInput(baseline.aliases.join(", "));
    setCustomDrafts(customDraftsFrom(baseline.custom));
    setError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !isSaving) resetDraft();
    setOpen(nextOpen);
  };

  const handleSave = async () => {
    if (customProjection.error || !hasPagePropertiesPatch(patch)) return;
    setError(null);
    setIsSaving(true);
    try {
      const saved = await saveProperties(file.id, patch);
      if (!saved) return;
      setBaseline(current);
      setOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const propertyCount =
    baseline.tags.length + baseline.aliases.length + Object.keys(baseline.custom).length;
  const customError = customProjection.error
    ? t(customProjection.error.message, customProjection.error.values)
    : null;

  const updateCustomDraft = (id: string, update: Partial<CustomPropertyDraft>) => {
    setCustomDrafts((drafts) =>
      drafts.map((draft) => (draft.id === id ? { ...draft, ...update } : draft))
    );
  };

  return (
    <div>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t("title")}
            className="h-8 gap-2 rounded-lg bg-background/90 px-2.5 text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
          >
            <Tags className="h-3.5 w-3.5" />
            <span>{t("title")}</span>
            {propertyCount > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                {propertyCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-4">
          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">{t("title")}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("description")}</p>
            </div>
            <label className="block space-y-1.5 text-xs font-medium">
              <span>{t("tags")}</span>
              <Input
                value={tagsInput}
                onChange={(event) => setTagsInput(event.target.value)}
                placeholder={t("tagsPlaceholder")}
                aria-label={t("tags")}
                disabled={isSaving}
              />
            </label>
            <label className="block space-y-1.5 text-xs font-medium">
              <span>{t("aliases")}</span>
              <Input
                value={aliasesInput}
                onChange={(event) => setAliasesInput(event.target.value)}
                placeholder={t("aliasesPlaceholder")}
                aria-label={t("aliases")}
                disabled={isSaving}
              />
            </label>
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{t("customTitle")}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  disabled={isSaving}
                  onClick={() =>
                    setCustomDrafts((drafts) => [...drafts, emptyCustomPropertyDraft()])
                  }
                >
                  <Plus className="h-3 w-3" />
                  {t("addProperty")}
                </Button>
              </div>
              {customDrafts.map((draft, index) => (
                <div key={draft.id} className="grid grid-cols-[1fr_7rem_auto] gap-1.5">
                  <Input
                    value={draft.key}
                    onChange={(event) => updateCustomDraft(draft.id, { key: event.target.value })}
                    placeholder={t("propertyNamePlaceholder")}
                    aria-label={t("propertyName", { index: index + 1 })}
                    disabled={isSaving}
                    className="h-8 text-xs"
                  />
                  <select
                    value={draft.kind}
                    onChange={(event) =>
                      updateCustomDraft(draft.id, {
                        kind: event.target.value as PropertyDraftKind,
                      })
                    }
                    aria-label={t("propertyType", { index: index + 1 })}
                    disabled={isSaving}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="text">{t("typeText")}</option>
                    <option value="number">{t("typeNumber")}</option>
                    <option value="checkbox">{t("typeCheckbox")}</option>
                    <option value="list">{t("typeList")}</option>
                    <option value="relation">{t("typeRelation")}</option>
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={t("removeProperty", { index: index + 1 })}
                    disabled={isSaving}
                    onClick={() =>
                      setCustomDrafts((drafts) => drafts.filter((item) => item.id !== draft.id))
                    }
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                  <div className="col-span-3">
                    {draft.kind === "relation" ? (
                      <div
                        role="group"
                        aria-label={t("propertyValue", { index: index + 1 })}
                        className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-2"
                      >
                        {relationPages.length ? (
                          relationPages.map((candidate) => {
                            const relation = pageRelationLink(candidate);
                            const label = getDisplayName(candidate.name);
                            return (
                              <label key={candidate.id} className="flex items-center gap-2 text-xs">
                                <input
                                  type="checkbox"
                                  checked={draft.relationValues.includes(relation)}
                                  onChange={(event) =>
                                    updateCustomDraft(draft.id, {
                                      relationValues: event.target.checked
                                        ? [...draft.relationValues, relation]
                                        : draft.relationValues.filter(
                                            (value) => value !== relation
                                          ),
                                    })
                                  }
                                  aria-label={t("relationTarget", {
                                    index: index + 1,
                                    title: label,
                                  })}
                                  disabled={isSaving}
                                />
                                <span className="min-w-0 truncate">{label}</span>
                                <span className="min-w-0 truncate text-muted-foreground">
                                  {relation.slice(2, -2)}
                                </span>
                              </label>
                            );
                          })
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            {t("noRelationPages")}
                          </span>
                        )}
                      </div>
                    ) : draft.kind === "checkbox" ? (
                      <label className="flex h-8 items-center gap-2 rounded-md border px-2 text-xs">
                        <input
                          type="checkbox"
                          checked={draft.checked}
                          onChange={(event) =>
                            updateCustomDraft(draft.id, { checked: event.target.checked })
                          }
                          aria-label={t("propertyValue", { index: index + 1 })}
                          disabled={isSaving}
                        />
                        {draft.checked ? t("checked") : t("unchecked")}
                      </label>
                    ) : (
                      <Input
                        value={draft.value}
                        onChange={(event) =>
                          updateCustomDraft(draft.id, { value: event.target.value })
                        }
                        aria-label={t("propertyValue", { index: index + 1 })}
                        placeholder={
                          draft.kind === "list" ? t("listPlaceholder") : t("valuePlaceholder")
                        }
                        disabled={isSaving}
                        inputMode={draft.kind === "number" ? "decimal" : undefined}
                        className="h-8 text-xs"
                      />
                    )}
                  </div>
                </div>
              ))}
              {customDrafts.length === 0 && (
                <p className="text-[11px] text-muted-foreground">{t("noCustomProperties")}</p>
              )}
            </div>
            <p className="text-[11px] leading-4 text-muted-foreground">{t("inputHint")}</p>
            {customError && (
              <p role="alert" className="text-xs text-destructive">
                {customError}
              </p>
            )}
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleOpenChange(false)}
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={
                  isSaving || Boolean(customProjection.error) || !hasPagePropertiesPatch(patch)
                }
                onClick={() => void handleSave()}
              >
                {isSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {t("save")}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function customDraftsFrom(properties: Record<string, PagePropertyValue>): CustomPropertyDraft[] {
  return Object.entries(properties).map(([key, value]) => {
    const relations = exactPageRelations(value);
    if (relations) {
      return createCustomPropertyDraft(key, "relation", "", false, relations);
    }
    if (typeof value === "boolean") {
      return createCustomPropertyDraft(key, "checkbox", "", value);
    }
    if (typeof value === "number") {
      return createCustomPropertyDraft(key, "number", String(value), false);
    }
    if (Array.isArray(value)) {
      return createCustomPropertyDraft(key, "list", value.join(", "), false);
    }
    return createCustomPropertyDraft(key, "text", value, false);
  });
}

function emptyCustomPropertyDraft(): CustomPropertyDraft {
  return createCustomPropertyDraft("", "text", "", false);
}

function createCustomPropertyDraft(
  key: string,
  kind: PropertyDraftKind,
  value: string,
  checked: boolean,
  relationValues: string[] = []
): CustomPropertyDraft {
  propertyDraftSequence += 1;
  return {
    id: `page-property-${propertyDraftSequence}`,
    key,
    kind,
    value,
    checked,
    relationValues,
  };
}

function projectCustomDrafts(drafts: CustomPropertyDraft[]): {
  properties: Record<string, PagePropertyValue> | null;
  error: {
    message: "invalidKey" | "duplicateKey" | "invalidNumber";
    values: { key: string };
  } | null;
} {
  const properties: Record<string, PagePropertyValue> = {};
  for (const draft of drafts) {
    const key = draft.key.trim();
    if (!isEditablePagePropertyKey(key)) {
      return { properties: null, error: { message: "invalidKey", values: { key } } };
    }
    if (Object.hasOwn(properties, key)) {
      return { properties: null, error: { message: "duplicateKey", values: { key } } };
    }
    if (draft.kind === "relation") properties[key] = [...draft.relationValues];
    else if (draft.kind === "checkbox") properties[key] = draft.checked;
    else if (draft.kind === "list") properties[key] = parsePagePropertyInput(draft.value);
    else if (draft.kind === "number") {
      const value = Number(draft.value.trim());
      if (!draft.value.trim() || !Number.isFinite(value)) {
        return { properties: null, error: { message: "invalidNumber", values: { key } } };
      }
      properties[key] = value;
    } else properties[key] = draft.value;
  }
  return { properties, error: null };
}

function exactPageRelations(value: PagePropertyValue): string[] | null {
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
  if (!values?.length) return null;
  return values.every((item) => /^\[\[[^\[\]|#^\r\n]+\]\]$/.test(item)) ? [...values] : null;
}

function pageRelationLink(file: FileItem): string {
  const raw = file.storageHandle?.relPath ?? file.storageHandle?.path ?? file.name;
  const target = raw
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\.(?:md|markdown)$/i, "");
  return `[[${target}]]`;
}
