"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, PenLine, FileText, ClipboardList, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { useFileStore } from "@/stores/file-store";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { getErrorMessage, cn } from "@/lib/utils";
import { markdownToHtml } from "@/lib/markdown";
import {
  getWelcomeDocumentMarkdown,
  WELCOME_DOCUMENT_FILENAME,
} from "@/components/onboarding/welcome-document";

interface TemplateCard {
  id: string;
  nameKey: string;
  descKey: string;
  icon: React.ReactNode;
  highlight?: boolean;
  getMarkdown: () => string;
  fileName: string;
}

const TEMPLATE_CARDS: TemplateCard[] = [
  {
    id: "welcome",
    nameKey: "welcomeToDoXmind",
    descKey: "interactiveTutorial",
    icon: <Sparkles className="h-5 w-5" />,
    highlight: true,
    getMarkdown: getWelcomeDocumentMarkdown,
    fileName: WELCOME_DOCUMENT_FILENAME,
  },
  {
    id: "blank",
    nameKey: "blankDocument",
    descKey: "startFromScratch",
    icon: <FileText className="h-5 w-5" />,
    getMarkdown: () => "",
    fileName: "Untitled-1.md",
  },
  {
    id: "blog-post",
    nameKey: "blogPost",
    descKey: "blogPostDesc",
    icon: <PenLine className="h-5 w-5" />,
    getMarkdown: () => `*A one-line hook that draws readers in.*

---

## Introduction

Set the context: what problem are you addressing, and why should readers care?

## Main Argument

Present your core ideas with supporting evidence, examples, or data.

## Conclusion

Summarize the key insights and end with a call to action or open question.
`,
    fileName: "Blog Post.md",
  },
  {
    id: "meeting-notes",
    nameKey: "meetingNotes",
    descKey: "meetingNotesDesc",
    icon: <ClipboardList className="h-5 w-5" />,
    getMarkdown: () => {
      const date = new Date().toISOString().split("T")[0];
      const time = new Date().toTimeString().slice(0, 5);
      return `**Date:** ${date} ${time}
**Location:**
**Attendees:**

---

### Agenda

1. Opening and introductions
2.
3.

### Discussion Notes



### Action Items

| Owner | Task | Deadline |
|-------|------|----------|
|  |  |  |
`;
    },
    fileName: "Meeting Notes.md",
  },
];

export function EmptyState() {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const router = useRouter();
  const { files, createFile, importFile, currentFolderId } = useFileStore();
  const { startOnboarding, onboardingCompleted } = useOnboardingStore();
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleTemplateCreate = async (template: TemplateCard) => {
    setCreatingId(template.id);
    try {
      // For the welcome template, reuse existing tutorial document
      if (template.id === "welcome") {
        const existing = files.find((f) => f.name.startsWith("Getting Started with doXmind"));
        if (existing) {
          if (!onboardingCompleted) startOnboarding(existing.id);
          router.push(`/editor/${existing.id}`);
          return;
        }
      }

      // Generate unique filename
      const currentFiles = files.filter((f) => !f.isFolder && f.parentId === currentFolderId);
      let fileName = template.fileName;
      if (currentFiles.some((f) => f.name === fileName)) {
        const base = fileName.replace(/\.md$/, "");
        let counter = 2;
        while (currentFiles.some((f) => f.name === `${base} ${counter}.md`)) {
          counter++;
        }
        fileName = `${base} ${counter}.md`;
      }

      const markdown = template.getMarkdown();
      const htmlContent = markdown ? markdownToHtml(markdown) : "";
      const newId = await createFile(fileName, htmlContent, currentFolderId);
      // Start onboarding when creating the tutorial document
      if (template.id === "welcome" && !onboardingCompleted) {
        startOnboarding(newId);
      }

      router.push(`/editor/${newId}`);
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    } finally {
      setCreatingId(null);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setIsImporting(true);
    const toastId = toast.loading(t("importing", { name: file.name }));
    try {
      await importFile(file, currentFolderId);
      toast.success(t("imported", { name: file.name }), { id: toastId });
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { id: toastId, description });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <motion.div
      className="mx-auto flex max-w-lg flex-col items-center justify-center py-24 text-center"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Decorative icon */}
      <motion.div
        className="mb-10 flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-foreground/[0.04] dark:bg-foreground/[0.08]"
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{
          duration: 0.5,
          delay: 0.5,
          ease: [0.34, 1.56, 0.64, 1],
        }}
      >
        <PenLine
          className="h-8 w-8 text-muted-foreground/55 dark:text-muted-foreground/65"
          strokeWidth={1.5}
        />
      </motion.div>

      <h2 className="text-xl font-semibold tracking-tight">{t("blankCanvasAwaits")}</h2>
      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground/65 dark:text-muted-foreground/75">
        {t("everyGreatPiece")}
        <br />
        {t("pickTemplateToStart")}
      </p>

      {/* Template cards grid */}
      <div className="mt-10 grid w-full grid-cols-2 gap-3.5">
        {TEMPLATE_CARDS.map((template, index) => {
          const isCreating = creatingId === template.id;
          return (
            <motion.button
              key={template.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.5 + index * 0.08 }}
              disabled={creatingId !== null}
              onClick={() => handleTemplateCreate(template)}
              className={cn(
                "flex flex-col items-start gap-2 rounded-xl border p-5 text-left transition-all",
                "hover:border-primary/50 hover:bg-accent/50 hover:shadow-sm",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                template.highlight ? "border-primary/30 bg-primary/[0.03]" : "border-border",
                isCreating && "border-primary/50 bg-accent/50",
                creatingId !== null && !isCreating && "cursor-not-allowed opacity-50"
              )}
            >
              <div className="flex items-center gap-2">
                <div className={cn("text-muted-foreground", template.highlight && "text-primary")}>
                  {isCreating ? <Loader2 className="h-5 w-5 animate-spin" /> : template.icon}
                </div>
                <span className="text-sm font-medium">
                  {t(template.nameKey as Parameters<typeof t>[0])}
                </span>
              </div>
              <p className="text-xs text-muted-foreground/80">
                {t(template.descKey as Parameters<typeof t>[0])}
              </p>
            </motion.button>
          );
        })}
      </div>

      {/* Import link */}
      <p className="mt-8 text-xs text-muted-foreground/55 dark:text-muted-foreground/65">
        {tc("or")}{" "}
        <button
          onClick={handleImportClick}
          disabled={isImporting}
          className="text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
        >
          {isImporting ? t("importingDots") : t("importAFile")}
        </button>{" "}
        {t("supportedFormats")}
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.md,.markdown"
        onChange={handleFileSelect}
        className="hidden"
      />
    </motion.div>
  );
}
