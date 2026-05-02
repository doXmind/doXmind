"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { getErrorMessage } from "@/lib/utils";
import { storeLogger } from "@/lib/logger";
import { useFileStore } from "@/stores/file-store";
import { toast } from "sonner";

const log = storeLogger.child("WorkspaceHome");

const FONT_SANS =
  '"Helvetica Neue", Helvetica, -apple-system, "SF Pro Text", system-ui, sans-serif';

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
      toast.error(title, { description });
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background pt-6 text-foreground">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-8 pb-20">
        <div
          style={{ fontFamily: FONT_SANS }}
          className="text-[13px] text-muted-foreground"
          title={rootPath ?? undefined}
        >
          {label ? t("eyebrow", { name: label }) : t("eyebrowFallback")}
        </div>
        <h1
          style={{ fontFamily: FONT_SANS }}
          className="mt-2 text-[30px] font-semibold leading-[1.15] text-foreground"
        >
          {t("heading")}
        </h1>
        <p
          style={{ fontFamily: FONT_SANS }}
          className="mt-5 max-w-xl text-[15px] leading-7 text-muted-foreground"
        >
          {t("body")}
        </p>

        <div className="mt-10 border-t border-border pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCreateNew}
            className="gap-1.5 font-mono text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("newDocument")}
          </Button>
        </div>
      </div>
    </div>
  );
}
