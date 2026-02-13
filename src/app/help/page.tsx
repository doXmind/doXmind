"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Sparkles,
  Type,
  MessageSquare,
  GitCompare,
  BookOpen,
  Search,
  FolderOpen,
  Presentation,
  List,
  Settings,
  Share2,
  Keyboard,
  Zap,
  Layout,
  ChevronDown,
  ChevronRight,
  MousePointerClick,
  Mic,
  Image as ImageIcon,
  FileText,
  CheckCircle,
  ArrowUp,
  ArrowDown,
  Languages,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { FeatureCard } from "@/components/help/feature-card";
import { StepGuide } from "@/components/help/step-guide";
import { ShortcutCombo, ShortcutKey, useIsMac } from "@/components/help/shortcut-key";
import {
  LayoutIllustration,
  ToolbarIllustration,
  QuickEditIllustration,
  AutocompleteIllustration,
  ChatIllustration,
  DiffReviewIllustration,
  KnowledgeBaseIllustration,
  CommandPaletteIllustration,
  FileTreeIllustration,
  PresentationIllustration,
  OutlineIllustration,
  CustomizationIllustration,
  SharingIllustration,
} from "@/components/help/help-illustrations";

const TOC_ITEMS = [
  { id: "getting-started", label: "Getting Started", icon: Layout },
  { id: "editor", label: "Editor Basics", icon: Type },
  { id: "quick-edit", label: "AI Quick Edit", icon: Sparkles },
  { id: "autocomplete", label: "AI Autocomplete", icon: Zap },
  { id: "chat", label: "AI Chat", icon: MessageSquare },
  { id: "diff-review", label: "Diff Review", icon: GitCompare },
  { id: "knowledge-base", label: "Knowledge Base", icon: BookOpen },
  { id: "search", label: "Search & Navigation", icon: Search },
  { id: "documents", label: "Document Management", icon: FolderOpen },
  { id: "presentation", label: "Presentation Mode", icon: Presentation },
  { id: "outline", label: "Outline & Mindlines", icon: List },
  { id: "customization", label: "Customization", icon: Settings },
  { id: "sharing", label: "Sharing", icon: Share2 },
  { id: "shortcuts", label: "Keyboard Shortcuts", icon: Keyboard },
] as const;

function TocNav() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Desktop: sticky sidebar */}
      <nav className="fixed right-8 top-24 hidden w-48 xl:block" aria-label="Table of contents">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          On this page
        </p>
        <ul className="space-y-1">
          {TOC_ITEMS.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <item.icon className="h-3 w-3 shrink-0" />
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* Mobile: collapsible dropdown */}
      <div className="sticky top-0 z-30 mb-8 border-b border-border bg-background/80 backdrop-blur-sm xl:hidden">
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        >
          <span className="flex items-center gap-2">
            <List className="h-4 w-4" />
            Table of Contents
          </span>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {open && (
          <ul className="max-h-60 overflow-y-auto border-t border-border px-4 pb-3 pt-2">
            {TOC_ITEMS.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <item.icon className="h-3 w-3 shrink-0" />
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function SectionHeading({
  id,
  icon: Icon,
  children,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <h2 id={id} className="mb-4 flex scroll-mt-20 items-center gap-3 text-2xl font-bold">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      {children}
    </h2>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
      <span className="mr-2 font-semibold text-primary">Tip:</span>
      {children}
    </div>
  );
}

export default function HelpPage() {
  const isMac = useIsMac();

  return (
    <div className="min-h-screen bg-background">
      <TocNav />

      <div className="mx-auto max-w-4xl px-4 py-12 xl:pr-56">
        {/* Header */}
        <div className="mb-8">
          <Link href="/" className="inline-block">
            <Logo size="md" />
          </Link>
        </div>

        <h1 className="mb-2 text-3xl font-bold">Help & Feature Guide</h1>
        <p className="mb-12 text-muted-foreground">
          Everything you need to know about using doXmind, the AI-powered writing assistant.
        </p>

        <div className="space-y-16">
          {/* ─── 1. Getting Started ──────────────────────────────────────── */}
          <section>
            <SectionHeading id="getting-started" icon={Layout}>
              Getting Started
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              doXmind has three main areas. The{" "}
              <strong className="text-foreground">Outline Sidebar</strong> (left) shows your
              document structure. The <strong className="text-foreground">Editor</strong> (center)
              is where you write. The <strong className="text-foreground">AI Chat</strong> (right)
              lets you interact with AI.
            </p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <LayoutIllustration />
            </div>
            <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>
                <strong className="text-foreground">Create your first document:</strong> Click the{" "}
                <strong className="text-foreground">+ New Document</strong> button on the home
                dashboard, or use the Command Palette (<ShortcutCombo keys={["Ctrl", "K"]} />) and
                type &quot;New Document&quot;.
              </p>
              <p>
                <strong className="text-foreground">Onboarding tour:</strong> When you first sign
                in, an interactive tour walks you through the key features. You can restart it
                anytime from the user menu →{" "}
                <strong className="text-foreground">Restart Tour</strong>.
              </p>
            </div>
          </section>

          {/* ─── 2. Editor Basics ────────────────────────────────────────── */}
          <section>
            <SectionHeading id="editor" icon={Type}>
              Editor Basics
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              The editor supports rich markdown with a what-you-see-is-what-you-get experience.
              Format text using the toolbar, keyboard shortcuts, or markdown syntax.
            </p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <ToolbarIllustration />
            </div>

            <h3 className="mb-3 text-lg font-semibold">Text Formatting</h3>
            <div className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                { label: "Bold", keys: ["Ctrl", "B"] },
                { label: "Italic", keys: ["Ctrl", "I"] },
                { label: "Underline", keys: ["Ctrl", "U"] },
                { label: "Strikethrough", keys: ["Ctrl", "Shift", "S"] },
                { label: "Highlight", keys: ["Ctrl", "Shift", "H"] },
                { label: "Inline Code", keys: ["Ctrl", "E"] },
                { label: "Add Link", keys: ["Ctrl", "K"] },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                >
                  <span className="text-sm">{item.label}</span>
                  <ShortcutCombo keys={item.keys} />
                </div>
              ))}
            </div>

            <h3 className="mb-3 text-lg font-semibold">Block Types</h3>
            <div className="mb-4 space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                <strong className="text-foreground">Headings:</strong> Three levels (H1–H3) via{" "}
                <ShortcutCombo keys={["Ctrl", "Alt", "1"]} /> / <ShortcutKey>2</ShortcutKey> /{" "}
                <ShortcutKey>3</ShortcutKey>, or type{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">#</code>,{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">##</code>,{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">###</code> followed by a
                space.
              </p>
              <p>
                <strong className="text-foreground">Lists:</strong> Bullet (
                <ShortcutCombo keys={["Ctrl", "Shift", "8"]} />
                ), Numbered (
                <ShortcutCombo keys={["Ctrl", "Shift", "7"]} />
                ), and Task lists (
                <ShortcutCombo keys={["Ctrl", "Shift", "9"]} />) with checkboxes.
              </p>
              <p>
                <strong className="text-foreground">Code Blocks:</strong> Fenced with{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">```</code>. Supports syntax
                highlighting with a language selector and line numbers.
              </p>
              <p>
                <strong className="text-foreground">Math Blocks:</strong> Inline math with{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">$...$</code> and display
                math with <code className="rounded bg-muted px-1.5 py-0.5 text-xs">$$...$$</code>.
                Supports full LaTeX syntax.
              </p>
              <p>
                <strong className="text-foreground">Tables:</strong> Insert via slash command. Use
                the column/row menus to add, remove, or reorder rows and columns.
              </p>
              <p>
                <strong className="text-foreground">Other blocks:</strong> Callouts (info, warning,
                error, success), Toggle/collapsible sections, Images (with resize handles), and
                Horizontal dividers.
              </p>
            </div>

            <Tip>
              Type <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/</code> at the start of
              a new line to open the slash command menu and quickly insert any block type.
            </Tip>
          </section>

          {/* ─── 3. AI Quick Edit ────────────────────────────────────────── */}
          <section>
            <SectionHeading id="quick-edit" icon={Sparkles}>
              AI Quick Edit
            </SectionHeading>
            <p className="mb-4 leading-relaxed text-muted-foreground">
              Select any text in the editor to see a floating AI menu with instant editing options.
              The AI processes your selection and shows a visual diff you can accept or reject.
            </p>

            <StepGuide
              steps={[
                { label: "Select text", icon: <MousePointerClick className="h-4 w-4" /> },
                { label: "Menu appears", icon: <Sparkles className="h-4 w-4" /> },
                { label: "Choose action", icon: <CheckCircle className="h-4 w-4" /> },
                { label: "Review diff", icon: <GitCompare className="h-4 w-4" /> },
              ]}
            />

            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <QuickEditIllustration />
            </div>

            <h3 className="mb-3 text-lg font-semibold">Available Actions</h3>
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                {
                  icon: <CheckCircle className="h-4 w-4" />,
                  label: "Fix Grammar",
                  desc: "Correct spelling and grammar errors",
                },
                {
                  icon: <Sparkles className="h-4 w-4" />,
                  label: "Improve Writing",
                  desc: "Enhance clarity and style",
                },
                {
                  icon: <FileText className="h-4 w-4" />,
                  label: "Simplify",
                  desc: "Make text more concise",
                },
                {
                  icon: <ArrowUp className="h-4 w-4" />,
                  label: "Make Longer",
                  desc: "Expand with more detail",
                },
                {
                  icon: <ArrowDown className="h-4 w-4" />,
                  label: "Make Shorter",
                  desc: "Condense the content",
                },
                {
                  icon: <MessageSquare className="h-4 w-4" />,
                  label: "Change Tone",
                  desc: "Professional, Casual, Friendly, or Confident",
                },
                {
                  icon: <Languages className="h-4 w-4" />,
                  label: "Translate",
                  desc: "EN, ZH, ES, FR, DE, JA",
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5"
                >
                  <div className="mt-0.5 text-primary">{item.icon}</div>
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <Tip>
              Choose <strong>Ask in Chat</strong> at the bottom of the menu to send your selection
              to the AI chat with a custom instruction.
            </Tip>
          </section>

          {/* ─── 4. AI Autocomplete ──────────────────────────────────────── */}
          <section>
            <SectionHeading id="autocomplete" icon={Zap}>
              AI Autocomplete
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              As you type, the AI suggests continuations displayed as ghost text after your cursor.
              Suggestions appear automatically after a brief pause, or trigger them manually.
            </p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <AutocompleteIllustration />
            </div>

            <h3 className="mb-3 text-lg font-semibold">How to Use</h3>
            <div className="mb-4 space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                <strong className="text-foreground">Auto trigger:</strong> Pause typing for ~750ms
                and a suggestion appears. Press <ShortcutKey>Tab</ShortcutKey> to accept, or{" "}
                <ShortcutKey>Esc</ShortcutKey> to dismiss.
              </p>
              <p>
                <strong className="text-foreground">Manual trigger:</strong> Press{" "}
                <ShortcutCombo keys={["Alt", "/"]} /> at any time to request a suggestion
                immediately.
              </p>
              <p>
                <strong className="text-foreground">Long mode:</strong> Press{" "}
                <ShortcutCombo keys={["Ctrl", "Shift", "Space"]} /> to get a multi-sentence
                suggestion instead of a short one.
              </p>
            </div>

            <h3 className="mb-3 text-lg font-semibold">Modes</h3>
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                { mode: "Adaptive", desc: "AI picks short or long based on context" },
                { mode: "Short", desc: "One word + at most one more" },
                { mode: "Long", desc: "Multi-sentence completions" },
              ].map((item) => (
                <div
                  key={item.mode}
                  className="rounded-lg border border-border px-3 py-2.5 text-center"
                >
                  <p className="text-sm font-medium">{item.mode}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>

            <Tip>
              Autocomplete is disabled inside code blocks, tables, headings, and math blocks to
              avoid unwanted suggestions. Configure modes in Settings → Typography.
            </Tip>
          </section>

          {/* ─── 5. AI Chat ──────────────────────────────────────────────── */}
          <section>
            <SectionHeading id="chat" icon={MessageSquare}>
              AI Chat
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              The AI chat panel lets you have a conversation with Claude about your document. Ask
              questions, request edits, brainstorm ideas, or have the AI rewrite entire sections.
            </p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <ChatIllustration />
            </div>

            <h3 className="mb-3 text-lg font-semibold">Chat Modes</h3>
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-border px-4 py-3">
                <p className="text-sm font-medium">Sidebar Mode</p>
                <p className="text-xs text-muted-foreground">
                  Chat panel sits to the right of the editor. Drag the border to resize.
                </p>
              </div>
              <div className="rounded-lg border border-border px-4 py-3">
                <p className="text-sm font-medium">Floating Mode</p>
                <p className="text-xs text-muted-foreground">
                  Chat window overlays the editor. Move it anywhere on screen.
                </p>
              </div>
            </div>

            <h3 className="mb-3 text-lg font-semibold">Features</h3>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                <strong className="text-foreground">Send messages:</strong> Type in the input box
                and press <ShortcutKey>Enter</ShortcutKey>. Use{" "}
                <ShortcutCombo keys={["Shift", "Enter"]} /> for a new line.
              </p>
              <p>
                <strong className="text-foreground">Voice input:</strong> Press and hold the{" "}
                <Mic className="inline h-3.5 w-3.5" /> microphone button for at least 1 second, then
                release to send your transcribed speech.
              </p>
              <p>
                <strong className="text-foreground">Image attachments:</strong> Click the{" "}
                <ImageIcon className="inline h-3.5 w-3.5" /> image button or paste an image. Up to
                10 images per message (5MB each).
              </p>
              <p>
                <strong className="text-foreground">Quick suggestions:</strong> Click the suggestion
                chips (e.g., &quot;Summarize document&quot;, &quot;Brainstorm ideas&quot;) for
                instant prompts.
              </p>
              <p>
                <strong className="text-foreground">Document editing:</strong> The AI can directly
                edit your document during chat. Changes appear as a visual diff you can accept or
                reject.
              </p>
              <p>
                <strong className="text-foreground">Extended thinking:</strong> Enable deep
                reasoning mode for complex requests that require multi-step analysis.
              </p>
            </div>
          </section>

          {/* ─── 6. Diff Review ──────────────────────────────────────────── */}
          <section>
            <SectionHeading id="diff-review" icon={GitCompare}>
              Diff Review
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              When the AI edits your document (via Quick Edit or Chat), changes are shown as a
              visual diff. Green highlights indicate additions; red highlights indicate removals.
            </p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <DiffReviewIllustration />
            </div>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                <strong className="text-foreground">Accept or reject individually:</strong> Each
                change (hunk) has its own <strong className="text-foreground">Accept</strong> and{" "}
                <strong className="text-foreground">Reject</strong> buttons. Click to apply or
                discard that specific change.
              </p>
              <p>
                <strong className="text-foreground">Bulk actions:</strong> Use{" "}
                <strong className="text-foreground">Accept All</strong> or{" "}
                <strong className="text-foreground">Reject All</strong> in the toolbar to process
                all changes at once.
              </p>
              <p>
                <strong className="text-foreground">Version snapshots:</strong> When you accept
                edits, a version snapshot is automatically saved. You can always restore to a
                previous version from the version history panel.
              </p>
            </div>
          </section>

          {/* ─── 7. Knowledge Base ───────────────────────────────────────── */}
          <section>
            <SectionHeading id="knowledge-base" icon={BookOpen}>
              Knowledge Base
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              Upload reference documents so the AI can search and cite them when answering your
              questions. Perfect for research papers, specifications, or reference material.
            </p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <KnowledgeBaseIllustration />
            </div>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                <strong className="text-foreground">Supported formats:</strong> PDF, DOCX, and PPTX
                files. Upload multiple files at once via drag-and-drop or the file picker.
              </p>
              <p>
                <strong className="text-foreground">Processing:</strong> After upload, files are
                chunked and indexed for vector search. Status indicators show: uploading →
                processing → indexed.
              </p>
              <p>
                <strong className="text-foreground">How it works:</strong> When you ask the AI a
                question, it automatically searches your uploaded documents and references relevant
                passages in its response, with source citations.
              </p>
              <p>
                <strong className="text-foreground">Per-conversation:</strong> Each chat
                conversation has its own set of attachments. Different conversations can reference
                different documents.
              </p>
            </div>
          </section>

          {/* ─── 8. Search & Navigation ──────────────────────────────────── */}
          <section>
            <SectionHeading id="search" icon={Search}>
              Search & Navigation
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              Quickly find anything in your documents and navigate your workspace.
            </p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <CommandPaletteIllustration />
            </div>

            <div className="space-y-4">
              <FeatureCard
                icon={<Search className="h-5 w-5" />}
                title="Semantic Search"
                className="border-0 bg-transparent p-0"
              >
                <p>
                  Press <ShortcutCombo keys={["Ctrl", "Shift", "F"]} /> to open AI-powered semantic
                  search. Unlike plain text search, this understands meaning — search for
                  &quot;budget discussion&quot; to find paragraphs about financial planning even if
                  they don&apos;t contain those exact words. Results are ranked by relevance with
                  highlighting.
                </p>
              </FeatureCard>

              <FeatureCard
                icon={<Search className="h-5 w-5" />}
                title="Find & Replace"
                className="border-0 bg-transparent p-0"
              >
                <p>
                  Press <ShortcutCombo keys={["Ctrl", "F"]} /> for traditional text search within
                  your document. Supports{" "}
                  <strong className="text-foreground">case-sensitive</strong>,{" "}
                  <strong className="text-foreground">whole word</strong>, and{" "}
                  <strong className="text-foreground">regex</strong> modes. Navigate matches with
                  arrow buttons or <ShortcutKey>Enter</ShortcutKey> /{" "}
                  <ShortcutCombo keys={["Shift", "Enter"]} />.
                </p>
              </FeatureCard>

              <FeatureCard
                icon={<Zap className="h-5 w-5" />}
                title="Command Palette"
                className="border-0 bg-transparent p-0"
              >
                <p>
                  Press <ShortcutCombo keys={["Ctrl", "K"]} /> to open the command palette. Quickly
                  access any action: create documents, toggle panels, change themes, search files,
                  and more. Start typing to filter results.
                </p>
              </FeatureCard>

              <FeatureCard
                icon={<FolderOpen className="h-5 w-5" />}
                title="Quick File Switcher"
                className="border-0 bg-transparent p-0"
              >
                <p>
                  Press <ShortcutCombo keys={["Ctrl", "Tab"]} /> to quickly switch between your open
                  and recent documents.
                </p>
              </FeatureCard>
            </div>
          </section>

          {/* ─── 9. Document Management ──────────────────────────────────── */}
          <section>
            <SectionHeading id="documents" icon={FolderOpen}>
              Document Management
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              Organize your documents with folders, manage versions, and export to multiple formats.
            </p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <FileTreeIllustration />
            </div>

            <h3 className="mb-3 text-lg font-semibold">Organization</h3>
            <div className="mb-4 space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                <strong className="text-foreground">Folders:</strong> Create folders to organize
                your documents hierarchically. Drag and drop files between folders.
              </p>
              <p>
                <strong className="text-foreground">Bulk actions:</strong> Select multiple files to
                delete or move them together.
              </p>
              <p>
                <strong className="text-foreground">Trash:</strong> Deleted files go to the trash
                first. You can recover them or permanently delete.
              </p>
              <p>
                <strong className="text-foreground">Import:</strong> Upload existing markdown files
                or use a template to start quickly.
              </p>
            </div>

            <h3 className="mb-3 text-lg font-semibold">Version History</h3>
            <div className="mb-4 space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                Every change is tracked. Open the version history panel to browse all saved
                versions. Each version is tagged with its type: manual save, AI edit, quick edit, or
                restored.
              </p>
              <p>
                Click any version to preview it. Use{" "}
                <strong className="text-foreground">Restore</strong> to revert your document to that
                point.
              </p>
            </div>

            <h3 className="mb-3 text-lg font-semibold">Export</h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                { format: "Markdown", ext: ".md" },
                { format: "PDF", ext: ".pdf" },
                { format: "Word", ext: ".docx" },
              ].map((item) => (
                <div
                  key={item.format}
                  className="flex flex-col items-center rounded-lg border border-border px-3 py-3"
                >
                  <p className="text-sm font-medium">{item.format}</p>
                  <p className="text-xs text-muted-foreground">{item.ext}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ─── 10. Presentation Mode ───────────────────────────────────── */}
          <section>
            <SectionHeading id="presentation" icon={Presentation}>
              Presentation Mode
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              Turn your document into a full-screen slideshow. Present directly from your writing
              without exporting to a separate presentation tool.
            </p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <PresentationIllustration />
            </div>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                <strong className="text-foreground">Activate:</strong> Press{" "}
                <ShortcutKey>F5</ShortcutKey> or click the presentation button in the header
                toolbar.
              </p>
              <p>
                <strong className="text-foreground">Slide splitting:</strong> Slides are created
                from horizontal dividers (
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">---</code>) in your
                document. If none are found, the document splits at H1/H2 headings.
              </p>
              <p>
                <strong className="text-foreground">Navigate:</strong> Use{" "}
                <ShortcutKey>←</ShortcutKey> <ShortcutKey>→</ShortcutKey> arrow keys or click the
                on-screen navigation buttons. Dot indicators show your current position.
              </p>
              <p>
                <strong className="text-foreground">Exit:</strong> Press{" "}
                <ShortcutKey>Esc</ShortcutKey> or click the exit button.
              </p>
            </div>

            <Tip>
              The first slide automatically becomes a cover slide with your document title. Add{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">---</code> between sections
              to control exactly where slides break.
            </Tip>
          </section>

          {/* ─── 11. Outline & Mindlines ─────────────────────────────────── */}
          <section>
            <SectionHeading id="outline" icon={List}>
              Outline & Mindlines
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              Navigate your document structure at a glance with the outline sidebar and the visual
              mindlines map.
            </p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <OutlineIllustration />
            </div>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                <strong className="text-foreground">Outline sidebar:</strong> Toggle with{" "}
                <ShortcutCombo keys={["Ctrl", "Shift", "O"]} />. Shows all headings (H1–H6) in a
                nested tree. Click any heading to scroll directly to that section. Drag the border
                to resize.
              </p>
              <p>
                <strong className="text-foreground">Mindlines:</strong> A visual node-based map of
                your document headings. Click nodes to navigate. Toggle between expanded and
                collapsed views for a minimal, line-indicator mode.
              </p>
            </div>
          </section>

          {/* ─── 12. Customization ───────────────────────────────────────── */}
          <section>
            <SectionHeading id="customization" icon={Settings}>
              Customization
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              Personalize your writing environment to match your preferences.
            </p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <CustomizationIllustration />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-border px-4 py-3">
                <p className="mb-1 text-sm font-medium">Typography</p>
                <p className="text-xs text-muted-foreground">
                  Font family (Sans / Serif / Mono), font size (Small / Normal / Large), and line
                  height (Compact / Normal / Relaxed). Access via user menu → Settings → Typography.
                </p>
              </div>
              <div className="rounded-lg border border-border px-4 py-3">
                <p className="mb-1 text-sm font-medium">Editor Width</p>
                <p className="text-xs text-muted-foreground">
                  Switch between Narrow, Normal, Wide, and Full width. Cycle through options via the
                  Command Palette.
                </p>
              </div>
              <div className="rounded-lg border border-border px-4 py-3">
                <p className="mb-1 text-sm font-medium">Themes</p>
                <p className="text-xs text-muted-foreground">
                  Light, Dark, or System (follows your OS). Plus a High Contrast mode for
                  accessibility. Toggle in the header with the sun/moon icon.
                </p>
              </div>
              <div className="rounded-lg border border-border px-4 py-3">
                <p className="mb-1 text-sm font-medium">Spellcheck</p>
                <p className="text-xs text-muted-foreground">
                  Real-time spell and grammar checking. Toggle on/off in the header toolbar. Click
                  underlined words to see correction suggestions.
                </p>
              </div>
            </div>
          </section>

          {/* ─── 13. Sharing ─────────────────────────────────────────────── */}
          <section>
            <SectionHeading id="sharing" icon={Share2}>
              Sharing
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              Share your documents with anyone via a read-only link. No sign-up required for
              viewers.
            </p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <SharingIllustration />
            </div>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                <strong className="text-foreground">Generate a link:</strong> Click the{" "}
                <Share2 className="inline h-3.5 w-3.5" /> Share button in the header. A unique URL
                is generated for your document. Copy it to share with others.
              </p>
              <p>
                <strong className="text-foreground">Viewer experience:</strong> Viewers see a clean,
                read-only version of your document with the outline sidebar for navigation. They can
                also enter presentation mode.
              </p>
            </div>
          </section>

          {/* ─── 14. Keyboard Shortcuts ──────────────────────────────────── */}
          <section>
            <SectionHeading id="shortcuts" icon={Keyboard}>
              Keyboard Shortcuts
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              Press <ShortcutCombo keys={["Ctrl", "?"]} /> anywhere in the app to see this
              reference.
              {isMac ? " Showing macOS keys." : " Showing Windows/Linux keys."}
            </p>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {/* Text Formatting */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                  Text Formatting
                </h3>
                <div className="space-y-2">
                  {[
                    { keys: ["Ctrl", "B"], desc: "Bold" },
                    { keys: ["Ctrl", "I"], desc: "Italic" },
                    { keys: ["Ctrl", "U"], desc: "Underline" },
                    { keys: ["Ctrl", "Shift", "S"], desc: "Strikethrough" },
                    { keys: ["Ctrl", "E"], desc: "Inline code" },
                    { keys: ["Ctrl", "Shift", "H"], desc: "Highlight" },
                    { keys: ["Ctrl", "K"], desc: "Add link" },
                  ].map((s) => (
                    <div key={s.desc} className="flex items-center justify-between py-1">
                      <span className="text-sm">{s.desc}</span>
                      <ShortcutCombo keys={s.keys} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Headings & Blocks */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                  Headings & Blocks
                </h3>
                <div className="space-y-2">
                  {[
                    { keys: ["Ctrl", "Alt", "1"], desc: "Heading 1" },
                    { keys: ["Ctrl", "Alt", "2"], desc: "Heading 2" },
                    { keys: ["Ctrl", "Alt", "3"], desc: "Heading 3" },
                    { keys: ["Ctrl", "Shift", "8"], desc: "Bullet list" },
                    { keys: ["Ctrl", "Shift", "7"], desc: "Numbered list" },
                    { keys: ["Ctrl", "Shift", "9"], desc: "Task list" },
                  ].map((s) => (
                    <div key={s.desc} className="flex items-center justify-between py-1">
                      <span className="text-sm">{s.desc}</span>
                      <ShortcutCombo keys={s.keys} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Navigation & View */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                  Navigation & View
                </h3>
                <div className="space-y-2">
                  {[
                    { keys: ["Ctrl", "K"], desc: "Command palette" },
                    { keys: ["Ctrl", "F"], desc: "Find in document" },
                    { keys: ["Ctrl", "Shift", "F"], desc: "Semantic search" },
                    { keys: ["Ctrl", "Shift", "O"], desc: "Toggle outline" },
                    { keys: ["Ctrl", "Tab"], desc: "Quick file switcher" },
                    { keys: ["Ctrl", "?"], desc: "Keyboard shortcuts" },
                  ].map((s) => (
                    <div key={s.desc} className="flex items-center justify-between py-1">
                      <span className="text-sm">{s.desc}</span>
                      <ShortcutCombo keys={s.keys} />
                    </div>
                  ))}
                </div>
              </div>

              {/* AI & Editing */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-muted-foreground">AI & Editing</h3>
                <div className="space-y-2">
                  {[
                    { keys: ["Alt", "/"], desc: "Trigger autocomplete" },
                    { keys: ["Ctrl", "Shift", "Space"], desc: "Force long autocomplete" },
                    { keys: ["Ctrl", "Z"], desc: "Undo" },
                    { keys: ["Ctrl", "Y"], desc: "Redo" },
                  ].map((s) => (
                    <div key={s.desc} className="flex items-center justify-between py-1">
                      <span className="text-sm">{s.desc}</span>
                      <ShortcutCombo keys={s.keys} />
                    </div>
                  ))}
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm">Accept autocomplete</span>
                    <ShortcutKey>Tab</ShortcutKey>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm">Show quick edit menu</span>
                    <span className="text-xs text-muted-foreground">Select text</span>
                  </div>
                </div>
              </div>

              {/* Chat */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Chat</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm">Send message</span>
                    <ShortcutKey>Enter</ShortcutKey>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm">New line in chat</span>
                    <ShortcutCombo keys={["Shift", "Enter"]} />
                  </div>
                </div>
              </div>

              {/* Presentation */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Presentation</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm">Start presentation</span>
                    <ShortcutKey>F5</ShortcutKey>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm">Navigate slides</span>
                    <span className="inline-flex gap-1">
                      <ShortcutKey>←</ShortcutKey>
                      <ShortcutKey>→</ShortcutKey>
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm">Exit presentation</span>
                    <ShortcutKey>Esc</ShortcutKey>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="mt-16 border-t border-border pt-8">
          <Link href="/" className="text-primary hover:underline">
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
