"use client";

import { useState } from "react";
import {
  FileText,
  ClipboardList,
  Calendar,
  BookOpen,
  Code2,
  Presentation,
  PenLine,
  GraduationCap,
  Loader2,
} from "lucide-react";
import { Modal, ModalHeader } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

export interface FileTemplate {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  defaultFileName: string;
  getContent: () => string;
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

const templates: FileTemplate[] = [
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
**Location:**
**Attendees:**

---

### Agenda

1. Opening and introductions
2.
3.

### Discussion Notes



### Decisions Made

-

### Action Items

| Owner | Task | Deadline |
|-------|------|----------|
|  |  |  |

### Next Meeting

`,
  },
  {
    id: "weekly-report",
    name: "Weekly Report",
    description: "Weekly progress and planning",
    icon: <Calendar className="h-5 w-5" />,
    defaultFileName: "Weekly Report",
    getContent: () => `**Week of:** ${formatDate()}

---

### Completed

-

### In Progress

-

### Blocked / At Risk

-

### Key Metrics

| Metric | Target | Actual |
|--------|--------|--------|
|  |  |  |

### Plan for Next Week

-

`,
  },
  {
    id: "blog-post",
    name: "Blog Post",
    description: "Article or blog post template",
    icon: <PenLine className="h-5 w-5" />,
    defaultFileName: "Blog Post",
    getContent: () => `*A one-line hook that draws readers in.*

---

## Introduction

Set the context: what problem are you addressing, and why should readers care?

## Background

Provide necessary background or define key terms for your audience.

## Main Argument

Present your core ideas with supporting evidence, examples, or data.

### Key Point 1



### Key Point 2



## Practical Takeaways

What can the reader do with this information?

-

## Conclusion

Summarize the key insights and end with a call to action or open question.

`,
  },
  {
    id: "technical-doc",
    name: "Technical Document",
    description: "API docs, architecture, or specs",
    icon: <Code2 className="h-5 w-5" />,
    defaultFileName: "Technical Doc",
    getContent: () => `## Overview

Brief description of the system, feature, or API.

## Architecture

Describe the high-level architecture, components, and data flow.

## API Reference

### \`GET /api/resource\`

Retrieves a resource by ID.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| id | string | Yes | Resource identifier |

**Response:**

\`\`\`json
{
  "id": "abc-123",
  "status": "active",
  "created_at": "2026-01-01T00:00:00Z"
}
\`\`\`

**Error Codes:**

| Code | Description |
|------|-------------|
| 400 | Invalid request parameters |
| 404 | Resource not found |

## Setup & Installation

\`\`\`bash
# Prerequisites and installation steps
\`\`\`

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
|  |  |  |

## Known Limitations

-

`,
  },
  {
    id: "project-brief",
    name: "Project Brief",
    description: "Project overview and requirements",
    icon: <Presentation className="h-5 w-5" />,
    defaultFileName: "Project Brief",
    getContent: () => `## Problem Statement

What problem are we solving, and who does it affect?

## Objective

Define the desired outcome in one or two sentences.

## Scope

**In Scope:**

-

**Out of Scope:**

-

## Requirements

### Functional Requirements

1.

### Non-Functional Requirements

1.

## Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Discovery |  |  |
| Design |  |  |
| Development |  |  |
| Testing |  |  |
| Launch |  |  |

## Success Metrics

| Metric | Baseline | Target |
|--------|----------|--------|
|  |  |  |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
|  |  |  |

## Stakeholders

| Name | Role | Responsibility |
|------|------|----------------|
|  |  |  |

`,
  },
  {
    id: "study-notes",
    name: "Study Notes",
    description: "Lecture or study session notes",
    icon: <GraduationCap className="h-5 w-5" />,
    defaultFileName: "Study Notes",
    getContent: () => `**Subject:**
**Date:** ${formatDate()}
**Source:**

---

## Key Concepts

### Concept 1

**Definition:**

**Why it matters:**

### Concept 2

**Definition:**

**Why it matters:**

## Important Details

-

## Connections & Insights

How does this relate to what I already know?

## Open Questions

-

## Summary

Write a 2-3 sentence summary in your own words.

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

### What happened today



### What I learned

-

### What I'm grateful for

1.
2.
3.

### What I want to focus on tomorrow

-

`,
  },
];

interface TemplatePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (template: FileTemplate) => Promise<void>;
}

export function TemplatePicker({ open, onClose, onSelect }: TemplatePickerProps) {
  const [creatingId, setCreatingId] = useState<string | null>(null);

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
      <ModalHeader onClose={creatingId ? undefined : onClose}>New from Template</ModalHeader>
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
                <span className="text-sm font-medium">{template.name}</span>
              </div>
              <p className="text-xs text-muted-foreground">{template.description}</p>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
