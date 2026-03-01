import {
  Sparkles,
  CheckCircle,
  Paperclip,
  FileText,
  Loader2,
  ArrowUp,
  Wand2,
  Check,
  Heading1,
  Heading2,
  List,
  Code,
  Quote,
  ListChecks,
  Bot,
  BookOpen,
  Send,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
} from "lucide-react";

/* ── Shared layout for one feature row ── */

function FeatureRow({
  title,
  description,
  children,
  reversed = false,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  reversed?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-10 lg:gap-16 ${reversed ? "lg:flex-row-reverse" : "lg:flex-row"}`}
    >
      {/* Mock wrapped in gradient background */}
      <div className="relative w-full flex-1 overflow-hidden rounded-3xl border border-white/10 dark:border-white/5">
        {/* Background gradient — hero-matching palette */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#dbe9f8] via-[#e8eef6] to-[#edf2f8] dark:from-[#0c1529] dark:via-[#0f1a2e] dark:to-[#111d33]" />

        {/* Ambient mesh blobs */}
        <div className="absolute -left-20 -top-20 h-64 w-72 rounded-full bg-sky-300/25 blur-[100px] dark:bg-blue-600/[0.12]" />
        <div className="absolute -right-10 top-0 h-52 w-52 rounded-full bg-indigo-300/20 blur-[100px] dark:bg-indigo-500/[0.10]" />
        <div className="absolute -bottom-10 left-1/3 h-40 w-56 rounded-full bg-violet-200/15 blur-[80px] dark:bg-violet-600/[0.08]" />

        {/* Mock content */}
        <div className="relative flex min-h-[420px] items-end p-5 lg:min-h-[480px] lg:p-6">
          <div className="w-full overflow-hidden rounded-xl border border-white/20 bg-background shadow-2xl dark:border-white/10">
            {children}
          </div>
        </div>
      </div>
      {/* Text */}
      <div className="flex-1 text-center lg:text-left">
        <h3 className="text-xl font-bold sm:text-2xl">{title}</h3>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

/* ── Mini mocks ── */

function MiniChatMock() {
  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">AI Assistant</span>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          Demo
        </span>
      </div>
      <div className="space-y-3 px-4 py-4">
        {/* User message */}
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary/10 px-3.5 py-2.5 text-[13px] text-foreground">
            Make the introduction more compelling and fix grammar issues
          </div>
        </div>
        {/* Tool steps */}
        <div className="space-y-1.5 px-1">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <CheckCircle className="h-3 w-3 text-green-500" />
            <span>Analyzing document</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <CheckCircle className="h-3 w-3 text-green-500" />
            <span>Editing introduction</span>
          </div>
        </div>
        {/* AI response */}
        <div className="max-w-[90%]">
          <div className="rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground">
            <p>I&apos;ve improved the introduction:</p>
            <ul className="mt-2 space-y-1 text-[12px]">
              <li>
                Fixed <strong>&quot;efficently&quot;</strong> →{" "}
                <strong>&quot;efficiently&quot;</strong>
              </li>
              <li>Made the opening more engaging</li>
              <li>Tightened language for better flow</li>
            </ul>
          </div>
          <div className="mt-2 inline-flex items-center rounded-md bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
            Review changes in editor
          </div>
        </div>
        {/* Suggestion chips */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {["Summarize doc", "Brainstorm ideas", "Fix grammar"].map((label) => (
            <span
              key={label}
              className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[11px] text-muted-foreground"
            >
              {label}
            </span>
          ))}
        </div>
      </div>
      {/* Input bar */}
      <div className="border-t border-border px-3 py-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
          <span className="flex-1 text-[13px] text-muted-foreground/50">Ask AI anything...</span>
          <Paperclip className="h-3.5 w-3.5 text-muted-foreground/40" />
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
            <ArrowUp className="h-3.5 w-3.5 text-primary" />
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniEditorMock() {
  return (
    <div className="px-8 py-6">
      {/* Paragraph with bubble toolbar */}
      <p className="mb-5 text-[15px] leading-relaxed text-foreground">
        Modern AI tools are enabling writers to produce clearer, more{" "}
        <span className="relative">
          <span className="rounded bg-blue-500/20 px-0.5">compelling</span>
          <span className="absolute -top-9 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-popover px-1 py-1 shadow-lg">
            <span className="flex h-6 w-6 items-center justify-center rounded text-xs font-bold text-foreground">
              B
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded text-xs italic text-foreground">
              I
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded text-xs text-foreground underline">
              U
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded text-xs text-foreground line-through">
              S
            </span>
            <span className="mx-0.5 h-4 w-px bg-border" />
            <span className="flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold text-muted-foreground">
              H1
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold text-muted-foreground">
              H2
            </span>
            <span className="mx-0.5 h-4 w-px bg-border" />
            <span className="flex h-6 w-6 items-center justify-center rounded text-primary">
              <Wand2 className="h-3.5 w-3.5" />
            </span>
          </span>
        </span>{" "}
        prose in a fraction of the time.
      </p>

      {/* Autocomplete ghost text */}
      <p className="mb-5 text-[15px] leading-relaxed">
        <span className="text-foreground">The writing assistant analyzes context</span>
        <span className="relative mx-0.5 inline-block h-5 w-[2px] animate-pulse bg-primary align-middle" />
        <span className="text-muted-foreground/40">
          to provide suggestions that maintain consistency in voice and style.
        </span>
      </p>

      {/* Task list */}
      <div className="mb-5 space-y-2 text-[15px]">
        <label className="flex items-center gap-3">
          <span className="flex h-4 w-4 items-center justify-center rounded border border-primary bg-primary">
            <Check className="h-3 w-3 text-primary-foreground" />
          </span>
          <span className="text-muted-foreground line-through">
            Real-time AI suggestions as you type
          </span>
        </label>
        <label className="flex items-center gap-3">
          <span className="h-4 w-4 rounded border border-border bg-background" />
          <span className="text-foreground">Knowledge base integration for research</span>
        </label>
      </div>

      {/* Slash command */}
      <div className="relative">
        <p className="text-[15px] leading-relaxed text-foreground">
          <span className="text-muted-foreground">/</span>
          <span className="relative mx-0.5 inline-block h-5 w-[2px] animate-pulse bg-primary align-middle" />
        </p>
        <div className="absolute left-0 top-8 z-10 w-[200px] overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-lg">
          <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Blocks
          </div>
          <div className="flex items-center gap-2 rounded-sm bg-primary/10 px-3 py-1.5 text-[13px] text-foreground">
            <Heading1 className="h-4 w-4 text-muted-foreground" />
            Heading 1
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-foreground">
            <Heading2 className="h-4 w-4 text-muted-foreground" />
            Heading 2
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-foreground">
            <List className="h-4 w-4 text-muted-foreground" />
            Bullet List
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-foreground">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            Task List
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-foreground">
            <Code className="h-4 w-4 text-muted-foreground" />
            Code Block
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-foreground">
            <Quote className="h-4 w-4 text-muted-foreground" />
            Blockquote
          </div>
        </div>
        {/* Spacer for dropdown */}
        <div className="h-48" />
      </div>
    </div>
  );
}

function MiniDiffMock() {
  return (
    <div className="px-6 py-5">
      <p className="mb-4 text-[15px] leading-relaxed text-foreground">
        Each AI edit appears as an inline diff you can review before accepting:
      </p>
      <div className="overflow-hidden rounded-lg border border-border">
        <div
          className="px-4 py-2 text-[14px]"
          style={{ backgroundColor: "var(--diff-deleted-bg)" }}
        >
          <span className="mr-2 text-red-500/70">-</span>
          <span className="text-foreground/70 line-through">
            The product was very good and helped us a lot with our daily tasks.
          </span>
        </div>
        <div
          className="px-4 py-2 text-[14px]"
          style={{ backgroundColor: "var(--diff-inserted-bg)" }}
        >
          <span className="mr-2 text-green-500/70">+</span>
          <span className="text-foreground">
            The product delivered exceptional performance, streamlining daily workflows.
          </span>
        </div>
        <div className="flex gap-2 border-t border-border px-4 py-2">
          <span
            className="inline-flex cursor-default items-center rounded px-2.5 py-1 text-xs font-medium text-green-600 dark:text-green-400"
            style={{ background: "rgba(52, 199, 89, 0.12)" }}
          >
            Accept
          </span>
          <span className="inline-flex cursor-default items-center rounded border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
            Reject
          </span>
        </div>
      </div>
    </div>
  );
}

function MiniKBMock() {
  return (
    <div className="px-6 py-5">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-foreground">
        <Paperclip className="h-4 w-4 text-primary" />
        Knowledge Base
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
          <FileText className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-foreground">research-paper.pdf</div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-[65%] rounded-full bg-primary" />
            </div>
          </div>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        </div>
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
          <FileText className="h-4 w-4 shrink-0 text-green-500" />
          <span className="flex-1 text-[13px] text-foreground">style-guide.md</span>
          <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
        </div>
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
          <FileText className="h-4 w-4 shrink-0 text-green-500" />
          <span className="flex-1 text-[13px] text-foreground">brand-guidelines.pdf</span>
          <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
        </div>
      </div>
      <p className="mt-3 text-[12px] text-muted-foreground">3 files · 2 indexed · 1 processing</p>
    </div>
  );
}

function MiniKBAgentMock() {
  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Bot className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">KB Assistant</span>
      </div>
      <div className="space-y-3 px-4 py-4">
        {/* User question */}
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary/10 px-3.5 py-2.5 text-[13px] text-foreground">
            What are the key findings from the Q4 report?
          </div>
        </div>
        {/* Tool steps */}
        <div className="space-y-1.5 px-1">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <CheckCircle className="h-3 w-3 text-green-500" />
            <span>Searching documents...</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <CheckCircle className="h-3 w-3 text-green-500" />
            <span>Reading Q4-report.pdf</span>
          </div>
        </div>
        {/* AI response */}
        <div className="max-w-[90%]">
          <div className="rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground">
            <p>Based on the Q4 report, the key findings are:</p>
            <ul className="mt-2 space-y-1 text-[12px]">
              <li>Revenue grew 23% year-over-year</li>
              <li>Customer retention improved to 94%</li>
              <li>Three new product lines launched</li>
            </ul>
          </div>
          {/* Sources */}
          <div className="mt-2 space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Sources
            </div>
            <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5">
              <BookOpen className="h-3 w-3 shrink-0 text-primary" />
              <span className="text-[11px] text-foreground">Q4-report.pdf</span>
              <span className="ml-auto rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                92%
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5">
              <BookOpen className="h-3 w-3 shrink-0 text-primary" />
              <span className="text-[11px] text-foreground">annual-summary.md</span>
              <span className="ml-auto rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                78%
              </span>
            </div>
          </div>
        </div>
      </div>
      {/* Follow-up input */}
      <div className="border-t border-border px-3 py-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
          <span className="flex-1 text-[13px] text-muted-foreground/50">Ask a follow-up...</span>
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
            <Send className="h-3.5 w-3.5 text-primary" />
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniPresentationMock() {
  return (
    <div className="relative bg-white">
      {/* Slide content */}
      <div className="flex flex-col items-center justify-center px-10 py-12">
        <h2 className="text-center text-2xl font-bold text-zinc-900">
          The Future of AI-Powered Writing
        </h2>
        <p className="mt-2 text-center text-sm text-zinc-500">By John Doe · January 2025</p>
        <div className="mx-auto mt-6 max-w-md space-y-3 text-left">
          <p className="text-[14px] leading-relaxed text-zinc-700">
            AI tools are fundamentally transforming how we approach the craft of writing, enabling
            writers to produce clearer, more compelling prose.
          </p>
          <ul className="space-y-1.5 text-[13px] text-zinc-600">
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Real-time AI suggestions as you type
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Inline diff review for AI-generated edits
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Knowledge base integration for research
            </li>
          </ul>
        </div>
      </div>
      {/* Navigation arrows */}
      <div className="absolute left-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-900/5 text-zinc-400">
        <ChevronLeft className="h-4 w-4" />
      </div>
      <div className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-900/5 text-zinc-400">
        <ChevronRight className="h-4 w-4" />
      </div>
      {/* Bottom bar */}
      <div className="flex items-center justify-center py-2 text-[11px] text-zinc-400">2 / 5</div>
      {/* Progress bar */}
      <div className="h-0.5 w-full bg-zinc-200">
        <div className="h-full w-[40%] bg-primary" />
      </div>
    </div>
  );
}

function MiniReviewMock() {
  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Writing Review</span>
        <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          4 suggestions
        </span>
      </div>
      {/* Summary */}
      <div className="border-b border-border px-4 py-3">
        <p className="text-[12px] italic text-muted-foreground">
          Your writing is clear overall. A few improvements can tighten the language and fix minor
          issues.
        </p>
      </div>
      {/* Suggestion list */}
      <div className="space-y-2 px-4 py-3">
        {/* Suggestion 1 */}
        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-red-600 dark:text-red-400">
              Grammar
            </span>
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            <span className="rounded bg-red-500/10 px-1 text-foreground/70 line-through">
              efficently
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="rounded bg-green-500/10 px-1 text-foreground">efficiently</span>
          </div>
          <div className="mt-2 flex gap-1.5">
            <span
              className="inline-flex cursor-default items-center rounded px-2 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-400"
              style={{ background: "rgba(52, 199, 89, 0.12)" }}
            >
              Accept
            </span>
            <span className="inline-flex cursor-default items-center rounded border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Dismiss
            </span>
          </div>
        </div>
        {/* Suggestion 2 */}
        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-blue-600 dark:text-blue-400">
              Clarity
            </span>
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            <span className="rounded bg-red-500/10 px-1 text-foreground/70 line-through">
              very good and helped us a lot
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="rounded bg-green-500/10 px-1 text-foreground">
              delivered exceptional results
            </span>
          </div>
          <div className="mt-2 flex gap-1.5">
            <span
              className="inline-flex cursor-default items-center rounded px-2 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-400"
              style={{ background: "rgba(52, 199, 89, 0.12)" }}
            >
              Accept
            </span>
            <span className="inline-flex cursor-default items-center rounded border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Dismiss
            </span>
          </div>
        </div>
        {/* Suggestion 3 */}
        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">
              Tone
            </span>
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            <span className="rounded bg-red-500/10 px-1 text-foreground/70 line-through">
              stuff we need to do
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="rounded bg-green-500/10 px-1 text-foreground">
              tasks to accomplish
            </span>
          </div>
          <div className="mt-2 flex gap-1.5">
            <span
              className="inline-flex cursor-default items-center rounded px-2 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-400"
              style={{ background: "rgba(52, 199, 89, 0.12)" }}
            >
              Accept
            </span>
            <span className="inline-flex cursor-default items-center rounded border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Dismiss
            </span>
          </div>
        </div>
      </div>
      {/* Footer */}
      <div className="flex gap-2 border-t border-border px-4 py-2.5">
        <span className="inline-flex cursor-default items-center rounded px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          Dismiss All
        </span>
        <span
          className="ml-auto inline-flex cursor-default items-center rounded px-2.5 py-1 text-[11px] font-medium text-green-600 dark:text-green-400"
          style={{ background: "rgba(52, 199, 89, 0.12)" }}
        >
          Accept All
        </span>
      </div>
    </div>
  );
}

/* ── Main export ── */

export function FeatureHighlights() {
  return (
    <div className="space-y-20 lg:space-y-28">
      <FeatureRow
        title="Your AI writing partner"
        description="Chat with AI about your document. Get intelligent suggestions, fix grammar, rewrite paragraphs, and brainstorm ideas — all within a contextual conversation that understands your content."
      >
        <MiniChatMock />
      </FeatureRow>

      <FeatureRow
        title="Write with intelligent assistance"
        description="AI autocomplete suggests text as you type. Select any text to access formatting and AI tools from the bubble toolbar. Use slash commands to quickly insert headings, lists, code blocks, and more."
        reversed
      >
        <MiniEditorMock />
      </FeatureRow>

      <FeatureRow
        title="Review AI changes with confidence"
        description="Every AI edit appears as an inline diff. Review additions and deletions side by side, then accept or reject changes with a single click. You stay in full control of your document."
      >
        <MiniDiffMock />
      </FeatureRow>

      <FeatureRow
        title="Ground AI in your research"
        description="Upload reference documents, papers, and notes to your knowledge base. The AI cites your sources when answering questions and suggests content grounded in your research materials."
        reversed
      >
        <MiniKBMock />
      </FeatureRow>

      <FeatureRow
        title="Ask your knowledge base anything"
        description="The KB Agent searches across all your uploaded documents, reads relevant sections, and synthesizes answers with source citations and relevance scores. Ask follow-up questions for deeper exploration."
      >
        <MiniKBAgentMock />
      </FeatureRow>

      <FeatureRow
        title="Present your writing full-screen"
        description="Turn any document into a polished slideshow with a single click. Navigate slides with keyboard shortcuts or click navigation, with automatic slide splitting by headings."
        reversed
      >
        <MiniPresentationMock />
      </FeatureRow>

      <FeatureRow
        title="AI-powered writing review"
        description="Get comprehensive feedback on grammar, clarity, tone, and engagement. Review categorized suggestions one by one or accept them all at once. Every suggestion shows the original text, the improvement, and why."
        reversed
      >
        <MiniReviewMock />
      </FeatureRow>
    </div>
  );
}
