"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Plus,
  Upload,
  CheckCircle2,
  FolderKanban,
  BookOpen,
  Users,
  Calendar,
  Loader2,
  ChevronDown,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDatabaseStore } from "@/stores/database-store";
import {
  DATABASE_TEMPLATES,
  buildTemplatePayload,
  type DatabaseTemplate,
} from "@/extensions/database/database-templates";
import { parseCSVFile, csvToPayload, type ParsedCSV } from "@/extensions/database/csv-utils";
import type { PropertyType } from "@/extensions/database/database-types";

// ---------------------------------------------------------------------------
// Icon map for templates
// ---------------------------------------------------------------------------

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  CheckCircle2: <CheckCircle2 className="h-4 w-4" />,
  FolderKanban: <FolderKanban className="h-4 w-4" />,
  BookOpen: <BookOpen className="h-4 w-4" />,
  Users: <Users className="h-4 w-4" />,
  Calendar: <Calendar className="h-4 w-4" />,
};

const TEMPLATE_ICON_COLORS: Record<string, string> = {
  green: "bg-green-500/20 text-green-600 dark:text-green-400",
  purple: "bg-purple-500/20 text-purple-600 dark:text-purple-400",
  orange: "bg-orange-500/20 text-orange-600 dark:text-orange-400",
  blue: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
  red: "bg-red-500/20 text-red-600 dark:text-red-400",
};

// Property type labels for CSV preview dropdown
const PROPERTY_TYPES: PropertyType[] = [
  "text",
  "number",
  "select",
  "multi_select",
  "date",
  "checkbox",
  "url",
  "email",
  "phone",
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DatabaseCreationDialogProps {
  onCreated: (databaseId: string) => void;
  onError: (message: string) => void;
}

type Mode = "menu" | "creating" | "csv-preview";
type ImportStep = "creating" | "uploading" | "loading-rows";

export function DatabaseCreationDialog({ onCreated, onError }: DatabaseCreationDialogProps) {
  const t = useTranslations("database");
  const createDatabase = useDatabaseStore((state) => state.createDatabase);

  const [mode, setMode] = useState<Mode>("menu");
  const [csvData, setCsvData] = useState<ParsedCSV | null>(null);
  const [typeOverrides, setTypeOverrides] = useState<Record<number, PropertyType>>({});
  const [importStep, setImportStep] = useState<ImportStep>("creating");
  const [totalRowCount, setTotalRowCount] = useState(0);
  const [csvFileName, setCsvFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Handlers ──

  const handleCreateEmpty = useCallback(async () => {
    setMode("creating");
    try {
      const data = await createDatabase();
      onCreated(data.id);
    } catch {
      onError(t("failedToCreate"));
      setMode("menu");
    }
  }, [createDatabase, onCreated, onError, t]);

  const handleCreateFromTemplate = useCallback(
    async (template: DatabaseTemplate) => {
      setMode("creating");
      try {
        const payload = buildTemplatePayload(template);
        const data = await createDatabase({
          ...payload,
          title: t(`templates.${template.key}.name`),
        } as Parameters<typeof createDatabase>[0]);
        onCreated(data.id);
      } catch {
        onError(t("failedToCreate"));
        setMode("menu");
      }
    },
    [createDatabase, onCreated, onError, t]
  );

  const handleCSVFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const parsed = await parseCSVFile(file);
        setCsvData(parsed);
        setCsvFileName(file.name.replace(/\.csv$/i, ""));
        setTypeOverrides({});
        setMode("csv-preview");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "CSV_PARSE_ERROR";
        if (msg === "CSV_EMPTY") {
          onError(t("creation.csvEmpty"));
        } else {
          onError(t("creation.csvParseError"));
        }
      }

      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [onError, t]
  );

  const handleCSVImport = useCallback(async () => {
    if (!csvData) return;
    setMode("creating");
    setTotalRowCount(csvData.totalRows);
    setImportStep("uploading");
    try {
      const { properties_schema, rows } = csvToPayload(
        csvData.headers,
        csvData.dataRows,
        csvData.detectedTypes,
        typeOverrides
      );
      setImportStep("creating");
      const data = await createDatabase({
        title: csvFileName || "Imported Database",
        properties_schema: properties_schema as unknown as Record<string, unknown>[],
        rows: rows as {
          properties: Record<string, import("@/extensions/database/database-types").CellValue>;
        }[],
      });
      // If rows were loaded lazily, the store handles pagination in the background
      if (data.row_count && data.rows.length === 0) {
        setImportStep("loading-rows");
      }
      onCreated(data.id);
    } catch {
      onError(t("failedToCreate"));
      setMode("menu");
    }
  }, [csvData, csvFileName, typeOverrides, createDatabase, onCreated, onError, t]);

  const handleTypeOverride = useCallback((colIdx: number, type: PropertyType) => {
    setTypeOverrides((prev) => ({ ...prev, [colIdx]: type }));
  }, []);

  // ── CSV Preview ──

  if (mode === "csv-preview" && csvData) {
    const previewRows = csvData.dataRows.slice(0, 5);
    return (
      <div className="rounded-lg border border-border bg-background p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium">{t("creation.csvPreview")}</h3>
          <span className="text-xs text-muted-foreground">
            {t("creation.csvColumnsDetected", { count: csvData.headers.length })}
            {" · "}
            {t("creation.csvRowsDetected", { count: csvData.totalRows })}
            {csvData.totalRows > 10000 && (
              <span className="ml-1 text-amber-500">({t("creation.csvTooLarge")})</span>
            )}
          </span>
        </div>

        <div className="mb-3 max-h-64 overflow-auto rounded border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {csvData.headers.map((header, i) => (
                  <th key={i} className="px-2 py-1.5 text-left font-medium">
                    <div className="mb-1">{header}</div>
                    <TypeDropdown
                      value={typeOverrides[i] ?? csvData.detectedTypes[i]}
                      onChange={(type) => handleTypeOverride(i, type)}
                      t={t}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, rowIdx) => (
                <tr key={rowIdx} className="border-b border-border last:border-0">
                  {csvData.headers.map((_, colIdx) => (
                    <td
                      key={colIdx}
                      className="max-w-[180px] truncate px-2 py-1 text-muted-foreground"
                    >
                      {row[colIdx] || ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={() => {
              setMode("menu");
              setCsvData(null);
            }}
            className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            {t("creation.csvCancel")}
          </button>
          <button
            onClick={handleCSVImport}
            className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
          >
            {t("creation.csvImport")}
          </button>
        </div>
      </div>
    );
  }

  // ── Creating spinner ──

  if (mode === "creating") {
    const stepLabel =
      importStep === "uploading"
        ? t("creation.stepUploading")
        : importStep === "loading-rows"
          ? t("creation.stepLoadingRows")
          : t("creation.creating");

    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border p-8">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">{stepLabel}</span>
        {totalRowCount > 100 && (
          <span className="text-xs text-muted-foreground/60">
            {t("creation.csvRowsDetected", { count: totalRowCount })}
          </span>
        )}
      </div>
    );
  }

  // ── Main menu ──

  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Database className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="text-sm font-semibold">{t("creation.title")}</span>
        </div>
      </div>

      <div className="p-1.5">
        {/* Empty database */}
        <button
          onClick={handleCreateEmpty}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded bg-muted">
            <Plus className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <div className="font-medium">{t("creation.empty")}</div>
            <div className="text-xs text-muted-foreground">{t("creation.emptyDescription")}</div>
          </div>
        </button>

        {/* Import CSV */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded bg-muted">
            <Upload className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <div className="font-medium">{t("creation.importCsv")}</div>
            <div className="text-xs text-muted-foreground">
              {t("creation.importCsvDescription")}
            </div>
          </div>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleCSVFileSelect}
        />

        {/* Divider + Templates */}
        <div className="my-1 border-t border-border" />
        <div className="px-3 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("creation.templates")}
          </span>
        </div>

        {DATABASE_TEMPLATES.map((template) => (
          <button
            key={template.key}
            onClick={() => handleCreateFromTemplate(template)}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
          >
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded",
                TEMPLATE_ICON_COLORS[template.color] || "bg-muted text-muted-foreground"
              )}
            >
              {TEMPLATE_ICONS[template.icon] || <Database className="h-4 w-4" />}
            </div>
            <div>
              <div className="font-medium">{t(`templates.${template.key}.name`)}</div>
              <div className="text-xs text-muted-foreground">
                {t(`templates.${template.key}.description`)}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Type dropdown for CSV column type override
// ---------------------------------------------------------------------------

function TypeDropdown({
  value,
  onChange,
  t,
}: {
  value: PropertyType;
  onChange: (type: PropertyType) => void;
  t: ReturnType<typeof useTranslations<"database">>;
}) {
  return (
    <div className="relative inline-block">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as PropertyType)}
        className="text-ui-xs appearance-none rounded border border-border bg-background px-1.5 py-0.5 pr-5 font-normal text-muted-foreground hover:border-primary/50 focus:outline-none"
      >
        {PROPERTY_TYPES.map((type) => (
          <option key={type} value={type}>
            {t(`propertyTypes.${type}`)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-0.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
