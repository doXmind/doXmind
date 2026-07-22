import type { DocumentMeta } from "@/lib/storage";
import { TRANSIENT_ID_PREFIX, useFileStore } from "@/stores/file-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";

export interface PageProperties {
  tags: string[];
  aliases: string[];
  custom: Record<string, PagePropertyValue>;
}

export type PagePropertyValue = string | number | boolean | string[];
export type PagePropertiesPatch = Record<string, PagePropertyValue | null>;

export const PAGE_PROPERTY_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

const READ_ONLY_PAGE_PROPERTY_KEYS = new Set([
  "id",
  "title",
  "icon",
  "favorite",
  "cover",
  "cover_position",
  "created",
  "updated",
  "tags",
  "aliases",
]);

export function pagePropertiesFromMeta(meta: DocumentMeta | undefined): PageProperties {
  return {
    tags: normalizePagePropertyList(meta?.tags),
    aliases: normalizePagePropertyList(meta?.aliases),
    custom: projectCustomPageProperties(meta),
  };
}

export function parsePagePropertyInput(value: string): string[] {
  return normalizePagePropertyList(value.split(/[\n,]/));
}

export function diffPageProperties(
  previous: PageProperties,
  next: PageProperties
): PagePropertiesPatch {
  const patch: PagePropertiesPatch = {};
  if (!sameList(previous.tags, next.tags)) patch.tags = next.tags.length ? next.tags : null;
  if (!sameList(previous.aliases, next.aliases)) {
    patch.aliases = next.aliases.length ? next.aliases : null;
  }
  const customKeys = new Set([...Object.keys(previous.custom), ...Object.keys(next.custom)]);
  for (const key of [...customKeys].sort(compareText)) {
    const previousValue = previous.custom[key];
    const nextValue = next.custom[key];
    if (nextValue === undefined) patch[key] = null;
    else if (previousValue === undefined || !samePropertyValue(previousValue, nextValue)) {
      patch[key] = clonePagePropertyValue(nextValue);
    }
  }
  return patch;
}

export function hasPagePropertiesPatch(patch: PagePropertiesPatch): boolean {
  return Object.keys(patch).length > 0;
}

export function isEditablePagePropertyKey(value: string): boolean {
  return PAGE_PROPERTY_KEY_PATTERN.test(value) && !READ_ONLY_PAGE_PROPERTY_KEYS.has(value);
}

export function isPagePropertyValue(value: unknown): value is PagePropertyValue {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

/** Save the active Page first, then apply an optimistic-concurrency metadata patch. */
export async function savePageProperties(
  pageId: string,
  patch: PagePropertiesPatch
): Promise<boolean> {
  if (!hasPagePropertiesPatch(patch)) return true;

  const before = useFileStore.getState();
  const activePage = before.currentFileId === pageId;
  const requestSave = useEditorRefStore.getState().requestSave;
  const editor = useEditorStore.getState();
  const needsBodySave =
    activePage && (editor.isDirty || editor.isSaving || pageId.startsWith(TRANSIENT_ID_PREFIX));
  if (needsBodySave && requestSave) {
    if (!(await requestSave())) return false;
  } else if (needsBodySave) {
    throw new Error("Save the Page to disk before editing its properties");
  }

  const state = useFileStore.getState();
  const resolvedId = state.files.some((file) => file.id === pageId)
    ? pageId
    : activePage
      ? state.currentFileId
      : null;
  if (!resolvedId) throw new Error("Page is no longer available");
  await state.updatePageProperties(resolvedId, patch);
  return true;
}

function normalizePagePropertyList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    const candidate = item.trim();
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    normalized.push(candidate);
  }
  return normalized;
}

function projectCustomPageProperties(
  meta: DocumentMeta | undefined
): Record<string, PagePropertyValue> {
  if (!meta) return {};
  const custom: Record<string, PagePropertyValue> = {};
  for (const key of Object.keys(meta).sort(compareText)) {
    if (!isEditablePagePropertyKey(key)) continue;
    const value = meta[key];
    if (isPagePropertyValue(value)) custom[key] = clonePagePropertyValue(value);
  }
  return custom;
}

function clonePagePropertyValue(value: PagePropertyValue): PagePropertyValue {
  return Array.isArray(value) ? [...value] : value;
}

function samePropertyValue(left: PagePropertyValue, right: PagePropertyValue): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && sameList(left, right);
  }
  return left === right;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
