import { Sparkles, CheckCircle, Paperclip, ArrowUp, FileText, Loader2 } from "lucide-react";

export function MockChatPanel() {
  return (
    <div className="flex h-full w-[300px] shrink-0 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">AI Assistant</span>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          Demo
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-4 overflow-hidden px-4 py-4">
        {/* User message */}
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/10 px-3.5 py-2.5 text-[13px] text-foreground">
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
        <div className="flex flex-wrap gap-1.5 pt-2">
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

      {/* Knowledge Base - uploading state */}
      <div className="border-t border-border px-3 py-2">
        <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
          <Paperclip className="h-3 w-3" />
          <span>Knowledge Base</span>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5">
            <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-medium text-foreground">
                research-paper.pdf
              </div>
              <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full w-[65%] rounded-full bg-primary" />
              </div>
            </div>
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
          </div>
          <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5">
            <FileText className="h-3.5 w-3.5 shrink-0 text-green-500" />
            <span className="truncate text-[11px] text-muted-foreground">style-guide.md</span>
            <CheckCircle className="ml-auto h-3 w-3 shrink-0 text-green-500" />
          </div>
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
