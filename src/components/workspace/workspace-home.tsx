"use client";

import { FilePlus2, FolderOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { getErrorMessage } from "@/lib/utils";
import { storeLogger } from "@/lib/logger";
import { useFileStore } from "@/stores/file-store";
import { notify } from "@/lib/notifications";

const log = storeLogger.child("WorkspaceHome");

function workspaceLabel(root: string | null): string {
  if (!root) return "";
  const normalized = root.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

export function WorkspaceHome() {
  const t = useTranslations("workspaceHome");
  const rootPath = useFileStore((s) => s.rootPath);
  const createFile = useFileStore((s) => s.createFile);
  const nextUntitledName = useFileStore((s) => s.nextUntitledName);
  const label = workspaceLabel(rootPath);

  const handleCreateNew = async () => {
    try {
      const newId = await createFile(nextUntitledName(), "", null, { documentType: "markdown" });
      navigateToEditorFile(newId);
    } catch (error) {
      log.error("Failed to create workspace document", error);
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background pt-6 text-foreground">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-8 pb-20">
        <div className="text-[13px] text-muted-foreground" title={rootPath ?? undefined}>
          {label ? t("eyebrow", { name: label }) : t("eyebrowFallback")}
        </div>
        <h1 className="mt-2 text-[30px] font-semibold leading-[1.15] tracking-[-0.022em] text-foreground">
          {t("heading")}
        </h1>
        <p className="mt-3 max-w-[34rem] text-[14px] leading-relaxed text-muted-foreground">
          {t("body")}
        </p>

        <div className="mt-9 grid gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
          <section className="min-w-0">
            <h2 className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {t("workspaceSection")}
            </h2>
            <div className="rounded-lg border border-border bg-background/35 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/45 text-muted-foreground">
                  <FolderOpen className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold tracking-[-0.012em] text-foreground">
                    {label || t("eyebrowFallback")}
                  </div>
                  <div className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                    {rootPath ?? t("workspacePathFallback")}
                  </div>
                </div>
              </div>
              <p className="mt-4 border-t border-border pt-3 text-[13.5px] leading-relaxed text-muted-foreground">
                {t("workspaceNote")}
              </p>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {t("quickActions")}
            </h2>
            <button
              type="button"
              onClick={handleCreateNew}
              className="flex h-11 w-full items-center gap-2 rounded-lg border border-border bg-background/35 px-3 text-left text-[13.5px] font-medium text-foreground transition-colors hover:border-foreground/25 hover:bg-muted/35 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <FilePlus2 className="h-4 w-4 text-muted-foreground" />
              {t("newDocument")}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
