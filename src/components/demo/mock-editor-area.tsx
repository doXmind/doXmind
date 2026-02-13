import {
  Check,
  Wand2,
  GripVertical,
  Trash2,
  Copy,
  ArrowRightLeft,
  Heading1,
  Heading2,
  List,
  Code,
  Quote,
  ListChecks,
} from "lucide-react";

export function MockEditorArea() {
  return (
    <div className="flex-1 overflow-hidden">
      <div className="h-full overflow-y-auto px-10 py-8">
        {/* H1 Title */}
        <h1 className="mb-4 text-[28px] font-bold leading-tight text-foreground">
          The Future of AI-Powered Writing
        </h1>

        {/* Body paragraph */}
        <p className="mb-6 text-[15px] leading-relaxed text-foreground">
          Artificial intelligence is fundamentally transforming how we approach the craft of
          writing. From automated grammar checking to intelligent content suggestions, modern AI
          tools are enabling writers to produce clearer, more{" "}
          <span className="relative">
            <span className="rounded bg-blue-500/20 px-0.5">compelling</span>
            {/* Bubble toolbar floating above */}
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

        {/* H2: Key Features */}
        <h2 className="mb-3 mt-8 text-xl font-semibold text-foreground">Key Features</h2>

        {/* Task list */}
        <div className="mb-6 space-y-2 text-[15px]">
          <label className="flex items-center gap-3">
            <span className="flex h-4 w-4 items-center justify-center rounded border border-primary bg-primary">
              <Check className="h-3 w-3 text-primary-foreground" />
            </span>
            <span className="text-muted-foreground line-through">
              Real-time AI suggestions as you type
            </span>
          </label>
          <label className="flex items-center gap-3">
            <span className="flex h-4 w-4 items-center justify-center rounded border border-primary bg-primary">
              <Check className="h-3 w-3 text-primary-foreground" />
            </span>
            <span className="text-muted-foreground line-through">
              Inline diff review for AI-generated edits
            </span>
          </label>
          <label className="flex items-center gap-3">
            <span className="h-4 w-4 rounded border border-border bg-background" />
            <span className="text-foreground">Knowledge base integration for research</span>
          </label>
        </div>

        {/* Autocomplete ghost text */}
        <p className="mb-6 mt-8 text-[15px] leading-relaxed">
          <span className="text-foreground">The writing assistant analyzes context</span>
          <span className="relative mx-0.5 inline-block h-5 w-[2px] animate-pulse bg-primary align-middle" />
          <span className="text-muted-foreground/40">
            to provide suggestions that maintain consistency in voice and style.
          </span>
        </p>

        {/* Diff section */}
        <div className="mb-6 overflow-hidden rounded-lg border border-border">
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

        {/* Block select with drag handle menu */}
        <div className="relative mb-6">
          <div className="rounded-md bg-primary/5 px-3 py-2 text-[15px] leading-relaxed text-foreground ring-1 ring-primary/20">
            Each document can be exported as Markdown, PDF, or Word format for easy sharing.
          </div>
          {/* Drag handle */}
          <div className="absolute -left-7 top-1/2 -translate-y-1/2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-muted text-muted-foreground shadow-sm ring-1 ring-border">
              <GripVertical className="h-3.5 w-3.5" />
            </div>
          </div>
          {/* Handle dropdown menu */}
          <div className="absolute -left-7 top-[calc(50%+16px)] z-10 w-[160px] overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-lg">
            <div className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-foreground">
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              Delete
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-foreground">
              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              Duplicate
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-foreground">
              <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
              Turn into...
            </div>
          </div>
        </div>

        {/* Spacer for handle menu */}
        <div className="h-16" />

        {/* Slash command */}
        <div className="relative mb-6">
          <p className="text-[15px] leading-relaxed text-foreground">
            <span className="text-muted-foreground">/</span>
            <span className="relative mx-0.5 inline-block h-5 w-[2px] animate-pulse bg-primary align-middle" />
          </p>
          {/* Slash command dropdown */}
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
        </div>

        {/* Spacer for slash dropdown */}
        <div className="h-40" />

        {/* H2: Implementation */}
        <h2 className="mb-3 mt-8 text-xl font-semibold text-foreground">Implementation</h2>

        {/* Code block */}
        <div className="mb-6 overflow-hidden rounded-lg border border-border bg-muted">
          <div className="flex items-center justify-between border-b border-border px-4 py-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">TypeScript</span>
          </div>
          <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-relaxed">
            <code>
              <span className="text-blue-500 dark:text-blue-400">function</span>{" "}
              <span className="text-foreground">enhance</span>
              <span className="text-muted-foreground">(</span>
              <span className="text-foreground">text</span>
              <span className="text-muted-foreground">: </span>
              <span className="text-amber-600 dark:text-amber-400">string</span>
              <span className="text-muted-foreground">) {"{"}</span>
              {"\n"}
              {"  "}
              <span className="text-blue-500 dark:text-blue-400">return</span>{" "}
              <span className="text-foreground">ai</span>
              <span className="text-muted-foreground">.</span>
              <span className="text-foreground">improve</span>
              <span className="text-muted-foreground">(</span>
              <span className="text-foreground">text</span>
              <span className="text-muted-foreground">, {"{"}</span>
              {"\n"}
              {"    "}
              <span className="text-foreground">tone</span>
              <span className="text-muted-foreground">: </span>
              <span className="text-green-600 dark:text-green-400">&quot;professional&quot;</span>
              <span className="text-muted-foreground">,</span>
              {"\n"}
              {"    "}
              <span className="text-foreground">style</span>
              <span className="text-muted-foreground">: </span>
              <span className="text-green-600 dark:text-green-400">&quot;concise&quot;</span>
              {"\n"}
              {"  "}
              <span className="text-muted-foreground">{"}"});</span>
              {"\n"}
              <span className="text-muted-foreground">{"}"}</span>
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}
