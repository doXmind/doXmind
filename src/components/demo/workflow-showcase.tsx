import {
  Sparkles,
  CheckCircle,
  BookOpen,
  Send,
  ChevronLeft,
  ChevronRight,
  FileDown,
  Presentation,
} from "lucide-react";

function WorkflowCard({
  children,
  title,
  cta,
}: {
  children: React.ReactNode;
  title: string;
  cta: string;
}) {
  return (
    <div className="flex flex-col">
      {/* Card with hero-matching gradient background — fixed height for uniformity */}
      <div className="relative flex min-h-[380px] items-end overflow-hidden rounded-2xl border border-white/10 dark:border-white/5">
        {/* Base gradient — same palette as hero section */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#dbe9f8] via-[#e8eef6] to-[#edf2f8] dark:from-[#0c1529] dark:via-[#0f1a2e] dark:to-[#111d33]" />

        {/* Ambient mesh blobs — hero-matching colors */}
        <div className="absolute -left-16 -top-16 h-48 w-56 rounded-full bg-sky-300/30 blur-[80px] dark:bg-blue-600/[0.15]" />
        <div className="absolute -right-10 top-0 h-40 w-40 rounded-full bg-indigo-300/25 blur-[80px] dark:bg-indigo-500/[0.12]" />
        <div className="absolute bottom-0 left-1/3 h-32 w-48 rounded-full bg-violet-200/20 blur-[80px] dark:bg-violet-600/[0.10]" />
        <div className="absolute -bottom-10 right-1/4 h-28 w-36 rounded-full bg-blue-200/15 blur-[60px] dark:bg-blue-500/[0.08]" />

        {/* Mock content floating inside gradient */}
        <div className="relative w-full p-4 sm:p-5">
          <div className="overflow-hidden rounded-xl border border-white/20 bg-background shadow-2xl dark:border-white/10">
            {children}
          </div>
        </div>
      </div>

      {/* Title — bold, left-aligned */}
      <h3 className="mt-5 text-lg font-bold text-foreground">{title}</h3>

      {/* Full-width CTA pill */}
      <button className="mt-3 w-full rounded-full border border-border bg-background py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted">
        {cta}
      </button>
    </div>
  );
}

function MiniWriteMock() {
  return (
    <div className="px-5 py-5">
      <h3 className="mb-2 text-base font-bold text-foreground">The Future of AI Writing</h3>
      <p className="mb-3 text-[13px] leading-relaxed text-foreground">
        Modern AI tools are enabling writers to produce clearer, more compelling prose in a fraction
        of the time.
      </p>
      {/* Autocomplete ghost text */}
      <p className="text-[13px] leading-relaxed">
        <span className="text-foreground">The writing assistant</span>
        <span className="relative mx-0.5 inline-block h-4 w-[2px] animate-pulse bg-primary align-middle" />
        <span className="text-muted-foreground/40">analyzes context to provide suggestions.</span>
      </p>
      {/* Diff preview */}
      <div className="mt-4 overflow-hidden rounded-md border border-border text-[12px]">
        <div className="px-3 py-1.5" style={{ backgroundColor: "var(--diff-deleted-bg)" }}>
          <span className="mr-1.5 text-red-500/70">-</span>
          <span className="text-foreground/70 line-through">helped us a lot</span>
        </div>
        <div className="px-3 py-1.5" style={{ backgroundColor: "var(--diff-inserted-bg)" }}>
          <span className="mr-1.5 text-green-500/70">+</span>
          <span className="text-foreground">streamlined daily workflows</span>
        </div>
      </div>
      {/* Inline suggestion chips */}
      <div className="mt-3 flex gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          <Sparkles className="h-2.5 w-2.5" />
          Improve
        </span>
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          Simplify
        </span>
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          Expand
        </span>
      </div>
    </div>
  );
}

function MiniResearchMock() {
  return (
    <div className="px-5 py-5">
      {/* Question */}
      <div className="mb-3 flex justify-end">
        <div className="rounded-2xl rounded-br-md bg-primary/10 px-3 py-2 text-[12px] text-foreground">
          What does the research say about AI adoption?
        </div>
      </div>
      {/* Tool steps */}
      <div className="mb-2 space-y-1 px-1">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <CheckCircle className="h-2.5 w-2.5 text-green-500" />
          Searching 3 documents...
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <CheckCircle className="h-2.5 w-2.5 text-green-500" />
          Reading research-paper.pdf
        </div>
      </div>
      {/* Answer */}
      <div className="rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-[12px] leading-relaxed text-foreground">
        According to the research, AI adoption has increased 40% year-over-year across industries.
      </div>
      {/* Sources */}
      <div className="mt-2 space-y-1">
        <div className="flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1">
          <BookOpen className="h-2.5 w-2.5 text-primary" />
          <span className="text-[10px] text-foreground">research-paper.pdf</span>
          <span className="ml-auto rounded bg-green-500/10 px-1 text-[9px] font-medium text-green-600 dark:text-green-400">
            94%
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1">
          <BookOpen className="h-2.5 w-2.5 text-primary" />
          <span className="text-[10px] text-foreground">industry-report.md</span>
          <span className="ml-auto rounded bg-green-500/10 px-1 text-[9px] font-medium text-green-600 dark:text-green-400">
            81%
          </span>
        </div>
      </div>
      {/* Follow-up */}
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
        <span className="flex-1 text-[11px] text-muted-foreground/50">Ask a follow-up...</span>
        <Send className="h-3 w-3 text-primary" />
      </div>
    </div>
  );
}

function MiniPresentMock() {
  return (
    <div className="relative bg-white">
      {/* Slide */}
      <div className="flex flex-col items-center justify-center px-8 py-8">
        <h3 className="text-center text-lg font-bold text-zinc-900">AI-Powered Writing</h3>
        <p className="mt-1 text-center text-[11px] text-zinc-500">By John Doe · 2025</p>
        <div className="mx-auto mt-4 max-w-[260px] space-y-1.5 text-left text-[12px] text-zinc-600">
          <div className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-primary" />
            Real-time AI suggestions
          </div>
          <div className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-primary" />
            Inline diff review
          </div>
          <div className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-primary" />
            Knowledge base integration
          </div>
        </div>
      </div>
      {/* Nav arrows */}
      <div className="absolute left-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-900/5 text-zinc-400">
        <ChevronLeft className="h-3 w-3" />
      </div>
      <div className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-900/5 text-zinc-400">
        <ChevronRight className="h-3 w-3" />
      </div>
      {/* Slide counter + progress */}
      <div className="flex items-center justify-center pb-1.5 text-[10px] text-zinc-400">2 / 5</div>
      <div className="h-0.5 w-full bg-zinc-200">
        <div className="h-full w-[40%] bg-primary" />
      </div>
      {/* Export bar */}
      <div className="flex items-center justify-center gap-3 border-t border-zinc-100 bg-zinc-50 px-4 py-2">
        <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
          <Presentation className="h-3 w-3" />
          Present
        </span>
        <span className="h-3 w-px bg-zinc-200" />
        <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
          <FileDown className="h-3 w-3" />
          Export PDF
        </span>
        <span className="h-3 w-px bg-zinc-200" />
        <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
          <FileDown className="h-3 w-3" />
          Export MD
        </span>
      </div>
    </div>
  );
}

export function WorkflowShowcase() {
  return (
    <div>
      <h2 className="mb-2 text-center text-2xl font-bold sm:text-3xl">
        One workspace, every workflow
      </h2>
      <p className="mb-14 text-center text-sm text-muted-foreground sm:text-base">
        Write, research, and present — all from the same document.
      </p>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <WorkflowCard title="Write with AI" cta="Start writing">
          <MiniWriteMock />
        </WorkflowCard>
        <WorkflowCard title="Research your docs" cta="Upload documents">
          <MiniResearchMock />
        </WorkflowCard>
        <WorkflowCard title="Present & Export" cta="Try presentation mode">
          <MiniPresentMock />
        </WorkflowCard>
      </div>
    </div>
  );
}
