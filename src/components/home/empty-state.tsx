"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  name: string;
  description: string;
  icon: React.ReactNode;
  highlight?: boolean;
  getMarkdown: () => string;
  fileName: string;
}

const TEMPLATE_CARDS: TemplateCard[] = [
  {
    id: "welcome",
    name: "Welcome to doXmind",
    description: "Interactive tutorial with examples to try",
    icon: <Sparkles className="h-5 w-5" />,
    highlight: true,
    getMarkdown: getWelcomeDocumentMarkdown,
    fileName: WELCOME_DOCUMENT_FILENAME,
  },
  {
    id: "blank",
    name: "Blank Document",
    description: "Start from scratch",
    icon: <FileText className="h-5 w-5" />,
    getMarkdown: () => "",
    fileName: "Untitled-1.md",
  },
  {
    id: "blog-post",
    name: "Blog Post",
    description: "Article or blog post template",
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
    name: "Meeting Notes",
    description: "Structured meeting agenda and notes",
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
    const toastId = toast.loading(`Importing "${file.name}"...`);
    try {
      await importFile(file);
      toast.success(`Imported "${file.name}" successfully`, { id: toastId });
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

      <h2 className="text-xl font-semibold tracking-tight">Your blank canvas awaits</h2>
      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground/65 dark:text-muted-foreground/75">
        Every great piece of writing starts with a single word.
        <br />
        Pick a template to get started.
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
                <span className="text-sm font-medium">{template.name}</span>
              </div>
              <p className="text-xs text-muted-foreground/80">{template.description}</p>
            </motion.button>
          );
        })}
      </div>

      {/* Import link */}
      <p className="mt-8 text-xs text-muted-foreground/55 dark:text-muted-foreground/65">
        or{" "}
        <button
          onClick={handleImportClick}
          disabled={isImporting}
          className="text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
        >
          {isImporting ? "importing..." : "import a file"}
        </button>{" "}
        (PDF, DOCX, Markdown)
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
