"use client";

import { Fragment, useMemo, useRef, type MouseEvent } from "react";

import {
  parsePageCollection,
  projectPageCollection,
  type PageCollectionBoardProjection,
  type PageCollectionCalendarProjection,
  type PageCollectionCatalogRow,
  type PageCollectionPropertyValue,
  type PageCollectionRelationNavigation,
  type PageCollectionTableProjection,
} from "@/lib/page-collection";
import type {
  PageComputedPropertyDiagnostic,
  PageComputedRelationTarget,
} from "@/lib/page-computed-properties";
import type { WorkspaceCatalogPage } from "@/lib/workspace-page-catalog";

export interface PageCollectionPreviewContext {
  status: "loading" | "ready" | "error";
  pages: readonly WorkspaceCatalogPage[] | null;
  onOpenPage?: (pageId: string) => void;
}

export interface PageCollectionPreviewProps {
  source: string;
  context?: PageCollectionPreviewContext;
}

export function PageCollectionPreview({ source, context }: PageCollectionPreviewProps) {
  const parsed = useMemo(() => parsePageCollection(source), [source]);
  const catalog = useStableCatalog(context?.status === "ready" ? context.pages : null);
  const projection = useMemo(
    () => (parsed.ok && catalog ? projectPageCollection(parsed.definition, catalog) : null),
    [parsed, catalog]
  );
  if (!parsed.ok) {
    return <CollectionMessage tone="error">{parsed.diagnostics[0].message}</CollectionMessage>;
  }
  if (!context || context.status === "loading") {
    return <CollectionMessage loading>Loading Page collection…</CollectionMessage>;
  }
  if (context.status === "error" || !projection) {
    return <CollectionMessage tone="error">Page collection is unavailable.</CollectionMessage>;
  }

  if (projection.view === "table") {
    return (
      <CollectionTable
        columns={parsed.definition.columns}
        projection={projection}
        onOpenPage={context.onOpenPage}
      />
    );
  }
  if (projection.view === "board") {
    return (
      <CollectionBoard
        columns={parsed.definition.columns}
        projection={projection}
        onOpenPage={context.onOpenPage}
      />
    );
  }
  return (
    <CollectionCalendar
      columns={parsed.definition.columns}
      projection={projection}
      onOpenPage={context.onOpenPage}
    />
  );
}

/**
 * Hold the catalog identity steady across renders that only changed Page
 * Markdown. The editor rebuilds the catalog array on every keystroke, and the
 * projection is quadratic in catalog size once a computed relation is declared,
 * so re-projecting per keystroke froze typing in large workspaces.
 */
function useStableCatalog(
  pages: readonly WorkspaceCatalogPage[] | null
): readonly WorkspaceCatalogPage[] | null {
  const cached = useRef<{ key: string; pages: readonly WorkspaceCatalogPage[] } | null>(null);
  if (!pages) return null;
  const key = JSON.stringify(
    pages.map(({ id, path, title, aliases, properties }) => [id, path, title, aliases, properties])
  );
  if (cached.current?.key !== key) cached.current = { key, pages };
  return cached.current.pages;
}

function CollectionMessage({
  children,
  loading = false,
  tone = "neutral",
}: {
  children: string;
  loading?: boolean;
  tone?: "neutral" | "error";
}) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      data-testid="collection-block"
      data-native-print-ready={loading ? "false" : "true"}
      className={
        tone === "error"
          ? "my-1 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          : "my-1 rounded-md border border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground"
      }
    >
      {children}
    </div>
  );
}

function CollectionTable({
  columns,
  projection,
  onOpenPage,
}: {
  columns: readonly string[];
  projection: PageCollectionTableProjection;
  onOpenPage?: (pageId: string) => void;
}) {
  return (
    <div data-testid="collection-block" data-native-print-ready="true" className="my-1 min-h-9">
      <CollectionDiagnostics diagnostics={projection.computedDiagnostics} />
      <div className="overflow-x-auto rounded-lg border border-border print:overflow-visible">
        <table
          aria-label="Page collection table"
          className="w-full border-collapse text-left text-sm"
        >
          <thead>
            <tr>
              <th className="border-b border-r border-border bg-muted/50 px-3 py-2 font-medium">
                Page
              </th>
              {columns.map((column) => (
                <th
                  key={column}
                  className="border-b border-r border-border bg-muted/50 px-3 py-2 font-medium last:border-r-0"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projection.rows.length ? (
              projection.rows.map((row) => (
                <tr key={`${row.path}\u0000${row.id}`}>
                  <td className="border-b border-r border-border px-3 py-2 last:border-b-0">
                    <PageButton id={row.id} title={row.title} onOpenPage={onOpenPage} />
                  </td>
                  {columns.map((column) => (
                    <td
                      key={column}
                      className="border-b border-r border-border px-3 py-2 text-muted-foreground last:border-r-0"
                    >
                      <PropertyValue
                        column={column}
                        row={row}
                        relationNavigation={projection.relationNavigation}
                        onOpenPage={onOpenPage}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-3 py-3 text-center text-muted-foreground"
                >
                  No matching Pages
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CollectionBoard({
  columns,
  projection,
  onOpenPage,
}: {
  columns: readonly string[];
  projection: PageCollectionBoardProjection;
  onOpenPage?: (pageId: string) => void;
}) {
  return (
    <section
      aria-label="Page collection board"
      data-testid="collection-block"
      data-native-print-ready="true"
      className="my-1 rounded-lg border border-border p-3"
    >
      <CollectionDiagnostics diagnostics={projection.computedDiagnostics} />
      {projection.rows.length ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3 print:block">
          {projection.columns.map((column) => {
            const label = column.value === null ? "Missing" : formatProperty(column.value);
            return (
              <div
                key={column.key}
                role="group"
                aria-label={label}
                className="min-w-0 rounded-md border border-border bg-muted/20 p-2 print:mb-3 print:break-inside-avoid"
              >
                <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{label}</h3>
                <div className="space-y-2">
                  {column.rows.map((row) => (
                    <article
                      key={`${row.path}\u0000${row.id}`}
                      className="break-inside-avoid rounded-md border border-border bg-background px-3 py-2"
                    >
                      <PageButton id={row.id} title={row.title} onOpenPage={onOpenPage} />
                      <PropertyList
                        columns={columns}
                        row={row}
                        relationNavigation={projection.relationNavigation}
                        onOpenPage={onOpenPage}
                      />
                    </article>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyCollection />
      )}
    </section>
  );
}

function CollectionCalendar({
  columns,
  projection,
  onOpenPage,
}: {
  columns: readonly string[];
  projection: PageCollectionCalendarProjection;
  onOpenPage?: (pageId: string) => void;
}) {
  return (
    <section
      aria-label="Page collection calendar"
      data-testid="collection-block"
      data-native-print-ready="true"
      className="my-1 rounded-lg border border-border p-3"
    >
      <CollectionDiagnostics diagnostics={projection.computedDiagnostics} />
      {projection.rows.length ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3 print:block">
          {projection.days.map((day) => (
            <CalendarBucket
              key={day.date}
              label={day.date}
              date={day.date}
              rows={day.rows}
              columns={columns}
              relationNavigation={projection.relationNavigation}
              onOpenPage={onOpenPage}
            />
          ))}
          <CalendarBucket
            label="Unscheduled"
            rows={projection.unscheduled.rows}
            columns={columns}
            relationNavigation={projection.relationNavigation}
            onOpenPage={onOpenPage}
          />
        </div>
      ) : (
        <EmptyCollection />
      )}
    </section>
  );
}

function CalendarBucket({
  label,
  date,
  rows,
  columns,
  relationNavigation,
  onOpenPage,
}: {
  label: string;
  date?: string;
  rows: readonly PageCollectionCatalogRow[];
  columns: readonly string[];
  relationNavigation?: readonly PageCollectionRelationNavigation[];
  onOpenPage?: (pageId: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="min-w-0 rounded-md border border-border bg-muted/20 p-2 print:mb-3 print:break-inside-avoid"
    >
      <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
        {date ? <time dateTime={date}>{label}</time> : label}
      </h3>
      {rows.length ? (
        <div className="space-y-2">
          {rows.map((row) => (
            <article
              key={`${row.path}\u0000${row.id}`}
              className="break-inside-avoid rounded-md border border-border bg-background px-3 py-2"
            >
              <PageButton id={row.id} title={row.title} onOpenPage={onOpenPage} />
              <PropertyList
                columns={columns}
                row={row}
                relationNavigation={relationNavigation}
                onOpenPage={onOpenPage}
              />
            </article>
          ))}
        </div>
      ) : (
        <p className="py-2 text-center text-xs text-muted-foreground">No Pages</p>
      )}
    </div>
  );
}

function PropertyList({
  columns,
  row,
  relationNavigation,
  onOpenPage,
}: {
  columns: readonly string[];
  row: PageCollectionCatalogRow;
  relationNavigation?: readonly PageCollectionRelationNavigation[];
  onOpenPage?: (pageId: string) => void;
}) {
  if (!columns.length) return null;
  return (
    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {columns.map((column) => (
        <Fragment key={column}>
          <dt>{column}</dt>
          <dd className="min-w-0 break-words text-right">
            <PropertyValue
              column={column}
              row={row}
              relationNavigation={relationNavigation}
              onOpenPage={onOpenPage}
            />
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function PropertyValue({
  column,
  row,
  relationNavigation,
  onOpenPage,
}: {
  column: string;
  row: PageCollectionCatalogRow;
  relationNavigation?: readonly PageCollectionRelationNavigation[];
  onOpenPage?: (pageId: string) => void;
}) {
  const targets = findRelationTargets(relationNavigation, row, column);
  if (targets === undefined) return formatProperty(row.properties[column]);
  if (!targets.length) return "—";
  return (
    <span>
      {targets.map((target, index) => (
        <Fragment key={`${target.path}\u0000${target.id}`}>
          {index > 0 ? ", " : null}
          <PageButton id={target.id} title={target.title} onOpenPage={onOpenPage} />
        </Fragment>
      ))}
    </span>
  );
}

function findRelationTargets(
  relationNavigation: readonly PageCollectionRelationNavigation[] | undefined,
  row: PageCollectionCatalogRow,
  column: string
): readonly PageComputedRelationTarget[] | undefined {
  const navigation = relationNavigation?.find(
    (entry) => entry.rowId === row.id && entry.rowPath === row.path
  );
  return navigation?.relations[column];
}

function CollectionDiagnostics({
  diagnostics,
}: {
  diagnostics: readonly PageComputedPropertyDiagnostic[] | undefined;
}) {
  if (!diagnostics?.length) return null;
  return (
    <div
      role="alert"
      aria-label="Collection diagnostics"
      className="mb-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
    >
      <ul className="list-disc space-y-1 pl-4">
        {diagnostics.map((diagnostic) => (
          <li
            key={`${diagnostic.rowPath}\u0000${diagnostic.rowId}\u0000${diagnostic.property}\u0000${diagnostic.code}\u0000${diagnostic.message}`}
          >
            {diagnostic.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyCollection() {
  return <p className="px-3 py-3 text-center text-sm text-muted-foreground">No matching Pages</p>;
}

function PageButton({
  id,
  title,
  onOpenPage,
}: {
  id: string;
  title: string;
  onOpenPage?: (pageId: string) => void;
}) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onOpenPage?.(id);
  };
  return (
    <button
      type="button"
      className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={handleClick}
    >
      {title}
    </button>
  );
}

function formatProperty(value: PageCollectionPropertyValue | undefined): string {
  if (value === undefined) return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "✓" : "–";
  return String(value);
}
