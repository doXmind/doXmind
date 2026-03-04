"use client";

import { useState } from "react";
import { FileText, ClipboardList, BookOpen, PenLine, GraduationCap, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal, ModalHeader } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { zhTemplateContent, zhFileNames } from "./template-content-zh";

export interface FileTemplate {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  defaultFileName: string;
  getContent: (locale?: string) => string;
}

/**
 * Returns the localized filename for a template (without .md extension).
 */
export function getLocalizedFileName(
  templateId: string,
  defaultName: string,
  locale?: string
): string {
  if (locale === "zh" && zhFileNames[templateId]) {
    return zhFileNames[templateId];
  }
  return defaultName;
}

/**
 * Format a date as YYYY-MM-DD
 */
function formatDate(date: Date = new Date()): string {
  return date.toISOString().split("T")[0];
}

/**
 * Format a date with day-of-week, e.g. "Monday, 2026-02-10"
 */
function formatDateFull(date: Date = new Date()): string {
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  return `${weekday}, ${formatDate(date)}`;
}

/**
 * Format current time as HH:MM
 */
function formatTime(date: Date = new Date()): string {
  return date.toTimeString().slice(0, 5);
}

export const templates: FileTemplate[] = [
  {
    id: "blank",
    name: "Blank Document",
    description: "Start from scratch",
    icon: <FileText className="h-5 w-5" />,
    defaultFileName: "Untitled",
    getContent: () => "",
  },
  {
    id: "meeting-notes",
    name: "Meeting Notes",
    description: "Structured meeting agenda and notes",
    icon: <ClipboardList className="h-5 w-5" />,
    defaultFileName: "Meeting Notes",
    getContent: () => `**Date:** ${formatDate()} ${formatTime()}
**Attendees:** @Alice, @Bob, @Charlie

---

### Agenda

1. Sprint review — what shipped this week
2. Blocker discussion — API rate limiting issue
3. Next sprint priorities

### Discussion

**Sprint review**

- Shipped the new onboarding flow (Alice). Conversion up 12% in early testing.
- Search indexing migration complete (Bob). Query latency down from 800ms → 120ms.

**Blockers**

- API rate limiting hitting 429s during peak hours. Charlie to investigate caching options by Friday.

### Decisions

- Go with Redis for caching (over in-memory) — more scalable.
- Push dark mode launch to next release cycle.

### Action Items

| Who | What | By when |
|-----|------|---------|
| @Charlie | Evaluate Redis vs Memcached for caching | ${formatDate(new Date(Date.now() + 4 * 86400000))} |
| @Alice | Write dark mode implementation spec | ${formatDate(new Date(Date.now() + 4 * 86400000))} |
| @Bob | Set up performance monitoring alerts | ${formatDate(new Date(Date.now() + 2 * 86400000))} |
`,
  },
  {
    id: "blog-post",
    name: "Blog Post",
    description: "Article or blog post template",
    icon: <PenLine className="h-5 w-5" />,
    defaultFileName: "Blog Post",
    getContent: () => `*The problem isn't your willpower — it's your system.*

---

## Introduction

You've tried every to-do app. You've written lists on paper, on sticky notes, on your phone. And yet, by 3 PM, your carefully crafted list feels more like a guilt trip than a productivity tool.

The truth is, most to-do lists fail not because we're lazy, but because they treat all tasks as equal — when they're not.

## The Real Problem

Traditional to-do lists have three fatal flaws:

1. **No distinction between urgency and importance.** "Reply to email" sits next to "Plan Q2 strategy" as if they carry the same weight.
2. **No time awareness.** A list of 20 items looks manageable until you realize you only have 4 hours.
3. **No energy matching.** Your hardest tasks need your freshest brain, but lists don't account for that.

## A Better Approach

Instead of an endless list, limit yourself each day:

- **1** big thing — the task that would make today a success
- **3** medium things — important but not as demanding
- **5** small things — quick wins, emails, admin tasks

This forces prioritization and creates a realistic daily plan.

### Why It Works

Constraints create clarity. When you can only pick 9 tasks, you're forced to ask: *"What actually matters today?"*

## Try It Tomorrow

Before you open your to-do app tomorrow morning, write down your 1-3-5. Just those 9 items. Nothing else.

You might be surprised how much more you accomplish — and how much less stressed you feel.
`,
  },
  {
    id: "study-notes",
    name: "Study Notes",
    description: "Lecture or study session notes",
    icon: <GraduationCap className="h-5 w-5" />,
    defaultFileName: "Study Notes",
    getContent: () => `**Subject:** Cognitive Psychology — Working Memory
**Date:** ${formatDate()}
**Source:** Lecture 5 + Baddeley (2000) "The episodic buffer"

---

## Key Concepts

### Working Memory Model (Baddeley & Hitch, 1974)

**What it is:** A multi-component system for temporarily holding and manipulating information. Not just a passive "short-term store" — it's an active workspace.

**Components:**

- **Central executive** — Directs attention, coordinates information
- **Phonological loop** — Holds verbal/acoustic info (~2 sec without rehearsal)
- **Visuospatial sketchpad** — Handles visual and spatial info
- **Episodic buffer** (added 2000) — Integrates info from different sources into coherent episodes

**Why it matters:** Explains why you can listen to a lecture and take notes simultaneously (different subsystems), but can't listen to a podcast and read an article (both compete for the phonological loop).

### Cognitive Load Theory (Sweller, 1988)

**What it is:** Learning fails when working memory is overloaded. Three types:

- *Intrinsic* — complexity of the material itself
- *Extraneous* — caused by poor instruction design
- *Germane* — effort spent building mental models (the good kind)

**Why it matters:** Design learning materials to minimize extraneous load. Example: diagrams with integrated labels > diagrams with a separate legend.

## Questions

- How does the episodic buffer interact with long-term memory? Is retrieval also limited by WM capacity?
- If WM capacity is ~4 chunks (Cowan, 2001), does expertise increase chunk size or chunk count?
- Practical: How can I use spacing + interleaving to reduce intrinsic load?

## Summary

*Working memory is a limited-capacity active workspace, not a passive store. Baddeley's model explains why multitasking with similar information types fails. Cognitive load theory applies this to learning — good instruction minimizes wasted mental effort so learners can focus on building understanding.*
`,
  },
  {
    id: "journal",
    name: "Journal Entry",
    description: "Daily journal or reflection",
    icon: <BookOpen className="h-5 w-5" />,
    defaultFileName: "Journal",
    getContent: () => `**${formatDateFull()}**

---

### Today

Had a productive morning — finished the quarterly report before lunch, which I'd been putting off all week. The trick was closing Slack and working in 45-minute blocks.

Afternoon was trickier. Got pulled into two unplanned meetings. Need to protect deep work time better — maybe block 9–12 on my calendar as "Focus Time."

Had a good conversation with Sarah about the redesign project. She suggested we prototype first instead of jumping straight to code. Smart move.

### Learned

- The 45-minute work block works better for me than the classic Pomodoro (25 min). Enough time to get into flow, short enough to stay sharp.
- "Prototype first, code second" — this applies to writing too. Outline before drafting.

### Grateful for

1. Morning coffee ritual — small but grounding
2. Sarah's honest feedback on the project timeline
3. The quiet hour before everyone else logs on

### Tomorrow

Focus on the design review prep. Block the morning. Say no to any meeting that doesn't need me.
`,
  },
];

// Wrap each template's getContent with locale-aware dispatch
for (const tmpl of templates) {
  const originalContent = tmpl.getContent;
  tmpl.getContent = (locale?: string) => {
    if (locale === "zh" && zhTemplateContent[tmpl.id]) {
      return zhTemplateContent[tmpl.id]();
    }
    return originalContent();
  };
}

interface TemplatePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (template: FileTemplate) => Promise<void>;
}

export function TemplatePicker({ open, onClose, onSelect }: TemplatePickerProps) {
  const t = useTranslations("sidebar");
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const templateI18n: Record<string, { name: string; description: string }> = {
    blank: { name: t("templateBlankDocument"), description: t("templateBlankDocumentDesc") },
    "meeting-notes": {
      name: t("templateMeetingNotes"),
      description: t("templateMeetingNotesDesc"),
    },
    "blog-post": { name: t("templateBlogPost"), description: t("templateBlogPostDesc") },
    "study-notes": { name: t("templateStudyNotes"), description: t("templateStudyNotesDesc") },
    journal: { name: t("templateJournal"), description: t("templateJournalDesc") },
  };

  const handleSelect = async (template: FileTemplate) => {
    setCreatingId(template.id);
    try {
      await onSelect(template);
      onClose();
    } catch {
      // Error already handled by caller (toast shown there).
      // Modal stays open so user can retry.
    } finally {
      setCreatingId(null);
    }
  };

  return (
    <Modal open={open} onClose={creatingId ? () => {} : onClose}>
      <ModalHeader onClose={creatingId ? undefined : onClose}>{t("newFromTemplate")}</ModalHeader>
      <div className="grid grid-cols-2 gap-2">
        {templates.map((template) => {
          const isCreating = creatingId === template.id;
          return (
            <button
              key={template.id}
              disabled={creatingId !== null}
              onClick={() => handleSelect(template)}
              className={cn(
                "flex flex-col items-start gap-1.5 rounded-lg border border-border p-3 text-left transition-colors",
                "hover:border-primary/50 hover:bg-accent/50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isCreating && "border-primary/50 bg-accent/50",
                creatingId !== null && !isCreating && "cursor-not-allowed opacity-50"
              )}
            >
              <div className="flex items-center gap-2">
                <div className="text-muted-foreground">
                  {isCreating ? <Loader2 className="h-5 w-5 animate-spin" /> : template.icon}
                </div>
                <span className="text-sm font-medium">
                  {templateI18n[template.id]?.name ?? template.name}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {templateI18n[template.id]?.description ?? template.description}
              </p>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
