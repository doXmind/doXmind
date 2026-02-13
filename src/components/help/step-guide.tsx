import { cn } from "@/lib/utils";

interface Step {
  label: string;
  icon: React.ReactNode;
}

export function StepGuide({ steps }: { steps: Step[] }) {
  return (
    <div className="flex items-start justify-between gap-2 py-4">
      {steps.map((step, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-2">
          <div className="flex w-full items-center">
            {/* Left connector line */}
            <div className={cn("h-px flex-1", i === 0 ? "bg-transparent" : "bg-border")} />
            {/* Circle with number */}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-primary/10 text-sm font-semibold text-primary">
              {i + 1}
            </div>
            {/* Right connector line */}
            <div
              className={cn("h-px flex-1", i === steps.length - 1 ? "bg-transparent" : "bg-border")}
            />
          </div>
          <div className="flex flex-col items-center gap-1 text-center">
            <div className="text-muted-foreground">{step.icon}</div>
            <span className="text-xs font-medium">{step.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
