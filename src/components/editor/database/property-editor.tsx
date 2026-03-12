"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import type {
  PropertyType,
  PropertyDef,
  PropertyOptions,
} from "@/extensions/database/database-types";
import {
  DEFAULT_STATUS_CATEGORIES,
  READONLY_PROPERTY_TYPES,
} from "@/extensions/database/database-types";
import { useDatabaseStore } from "@/stores/database-store";
import { PropertyTypePicker } from "./property-type-picker";
import { SelectOptionsEditor } from "./select-options-editor";

interface PropertyEditorProps {
  databaseId: string;
  existingProperty?: PropertyDef;
  insertPosition?: number;
  onClose: () => void;
}

export function PropertyEditor({ databaseId, existingProperty, onClose }: PropertyEditorProps) {
  const t = useTranslations("database.propertyEditor");
  const tDb = useTranslations("database");
  const isEditMode = !!existingProperty;
  const [name, setName] = useState(existingProperty?.name ?? tDb("propertyTypes.text"));
  const [type, setType] = useState<PropertyType>(existingProperty?.type ?? "text");
  const [choices, setChoices] = useState(existingProperty?.options?.choices ?? []);
  const [showTypeChange, setShowTypeChange] = useState(false);

  const { addProperty, updateProperty, deleteProperty } = useDatabaseStore();

  const needsChoices = type === "select" || type === "multi_select" || type === "status";

  const buildOptions = useCallback((): PropertyOptions | undefined => {
    if (type === "select" || type === "multi_select") {
      return { choices };
    }
    if (type === "status") {
      return {
        choices,
        statusCategories: existingProperty?.options?.statusCategories ?? DEFAULT_STATUS_CATEGORIES,
      };
    }
    return undefined;
  }, [type, choices, existingProperty]);

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);

    try {
      if (isEditMode && existingProperty) {
        await updateProperty(databaseId, existingProperty.id, {
          name: name.trim(),
          type,
          options: buildOptions(),
        });
      } else {
        const options = buildOptions();
        await addProperty(databaseId, {
          name: name.trim(),
          type,
          options,
        });
      }
      onClose();
    } catch (err) {
      console.error("Failed to save property:", err);
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existingProperty) return;
    await deleteProperty(databaseId, existingProperty.id);
    onClose();
  };

  const handleTypeChange = (newType: PropertyType) => {
    // Auto-fill name with default type name when empty or still matches previous default
    const prevDefault = tDb(`propertyTypes.${type}`);
    if (!name.trim() || name === prevDefault) {
      setName(tDb(`propertyTypes.${newType}`));
    }
    if (isEditMode && newType !== existingProperty?.type) {
      const newNeedsChoices =
        newType === "select" || newType === "multi_select" || newType === "status";
      if (!newNeedsChoices) {
        setChoices([]);
      }
    }
    setType(newType);
    setShowTypeChange(false);
  };

  const isReadonly = READONLY_PROPERTY_TYPES.includes(type);

  return (
    <div className="w-72 space-y-3 p-3">
      <div className="text-xs font-medium text-muted-foreground">
        {isEditMode ? t("editProperty") : t("newProperty")}
      </div>

      {/* Property name */}
      <input
        type="text"
        placeholder={t("propertyName")}
        className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSave()}
        autoFocus
        disabled={isReadonly}
      />

      {/* Type selector / picker */}
      {isEditMode && !showTypeChange ? (
        <button
          className="w-full rounded-md border border-border px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
          onClick={() => !isReadonly && setShowTypeChange(true)}
          disabled={isReadonly}
        >
          {t("changeType")}
        </button>
      ) : (
        <PropertyTypePicker value={type} onChange={handleTypeChange} showReadonly={!isEditMode} />
      )}

      {/* Choice editor for select-like types */}
      {needsChoices && <SelectOptionsEditor choices={choices} onChange={setChoices} />}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={handleSave}
          disabled={!name.trim() || saving}
        >
          {isEditMode ? t("save") : t("add")}
        </button>
        <button
          className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
          onClick={onClose}
        >
          {t("cancel")}
        </button>
      </div>

      {/* Delete button for edit mode */}
      {isEditMode && !isReadonly && (
        <>
          <div className="border-b border-border" />
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
            onClick={handleDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("deleteProperty")}
          </button>
        </>
      )}
    </div>
  );
}
