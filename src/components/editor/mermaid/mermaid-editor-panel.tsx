"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Check, X, Trash2 } from "lucide-react";

interface MermaidEditorPanelProps {
  code: string;
  onChange: (code: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  previewRef: React.RefObject<HTMLDivElement | null>;
  renderError: string | null;
}

interface ChartTemplate {
  label: string;
  category: string;
  code: string;
}

const CHART_TEMPLATES: ChartTemplate[] = [
  // Process & Flow
  {
    label: "Flowchart",
    category: "Process & Flow",
    code: `graph TD
    A[Start] --> B{Decision?}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E`,
  },
  {
    label: "Sequence",
    category: "Process & Flow",
    code: `sequenceDiagram
    participant A as Client
    participant B as Server
    A->>B: Request
    B-->>A: Response`,
  },
  {
    label: "State",
    category: "Process & Flow",
    code: `stateDiagram-v2
    [*] --> Idle
    Idle --> Processing: Start
    Processing --> Done: Complete
    Processing --> Error: Fail
    Error --> Idle: Retry
    Done --> [*]`,
  },
  {
    label: "User Journey",
    category: "Process & Flow",
    code: `journey
    title User Purchase Flow
    section Browse
      Visit homepage: 5: User
      Search product: 4: User
    section Purchase
      Add to cart: 3: User
      Checkout: 2: User, System
      Payment: 3: User, System`,
  },
  {
    label: "ZenUML",
    category: "Process & Flow",
    code: `zenuml
    title Order Service
    @Actor Client
    @Boundary OrderController
    @Service OrderService
    Client->OrderController.placeOrder() {
      OrderController->OrderService.create() {
        return order
      }
    }`,
  },
  // Structural & Architecture
  {
    label: "Class",
    category: "Structure",
    code: `classDiagram
    class Animal {
        +String name
        +int age
        +makeSound()
    }
    class Dog {
        +fetch()
    }
    Animal <|-- Dog`,
  },
  {
    label: "ER Diagram",
    category: "Structure",
    code: `erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "is in"`,
  },
  {
    label: "C4 Context",
    category: "Structure",
    code: `C4Context
    title System Context
    Person(user, "User", "End user")
    System(system, "My System", "Main application")
    System_Ext(ext, "External API", "Third party")
    Rel(user, system, "Uses")
    Rel(system, ext, "Calls")`,
  },
  {
    label: "Architecture",
    category: "Structure",
    code: `architecture-beta
    group api(cloud)[API Layer]
    group backend(server)[Backend]

    service web(internet)[Web Client]
    service gateway(server)[API Gateway] in api
    service app(server)[App Service] in backend
    service db(database)[PostgreSQL] in backend

    web:R --> L:gateway
    gateway:R --> L:app
    app:R --> L:db`,
  },
  {
    label: "Block Diagram",
    category: "Structure",
    code: `block-beta
    columns 3
    Frontend blockArrowId<["  "]>(right) Backend
    space:2 DB[("Database")]`,
  },
  {
    label: "Requirement",
    category: "Structure",
    code: `requirementDiagram
    requirement req1 {
        id: REQ-001
        text: System shall authenticate users
        risk: high
        verifymethod: test
    }
    element app {
        type: application
    }
    app - satisfies -> req1`,
  },
  // Data Visualization
  {
    label: "Pie Chart",
    category: "Data",
    code: `pie title Distribution
    "Category A" : 40
    "Category B" : 30
    "Category C" : 20
    "Category D" : 10`,
  },
  {
    label: "XY Chart",
    category: "Data",
    code: `xychart-beta
    title "Monthly Revenue"
    x-axis ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
    y-axis "Revenue (k$)" 0 --> 150
    bar [50, 60, 75, 90, 100, 130]
    line [50, 60, 75, 90, 100, 130]`,
  },
  {
    label: "Quadrant",
    category: "Data",
    code: `quadrantChart
    title Priority Matrix
    x-axis Low Effort --> High Effort
    y-axis Low Impact --> High Impact
    quadrant-1 Do First
    quadrant-2 Plan
    quadrant-3 Delegate
    quadrant-4 Eliminate
    Task A: [0.2, 0.8]
    Task B: [0.7, 0.9]
    Task C: [0.3, 0.3]`,
  },
  {
    label: "Sankey",
    category: "Data",
    code: `sankey-beta
Revenue,Products,42
Revenue,Services,38
Products,Online,25
Products,Retail,17
Services,Consulting,20
Services,Support,18`,
  },
  {
    label: "Treemap",
    category: "Data",
    code: `treemap-beta
    "Revenue"
        "Products"
            "Electronics": 45
            "Clothing": 30
        "Services"
            "Consulting": 25
            "Support": 20`,
  },
  // Project & Planning
  {
    label: "Gantt",
    category: "Planning",
    code: `gantt
    title Project Timeline
    dateFormat YYYY-MM-DD
    section Phase 1
    Task A :a1, 2024-01-01, 30d
    Task B :after a1, 20d
    section Phase 2
    Task C :2024-02-20, 25d`,
  },
  {
    label: "Kanban",
    category: "Planning",
    code: `kanban
    Todo
        task1[Design UI]
        task2[Write specs]
    In Progress
        task3[Build API]
    Done
        task4[Setup project]`,
  },
  {
    label: "Timeline",
    category: "Planning",
    code: `timeline
    title Project Milestones
    2024-Q1 : Research
            : Requirements
    2024-Q2 : Design
            : Prototyping
    2024-Q3 : Development
    2024-Q4 : Launch`,
  },
  // Specialized
  {
    label: "Mindmap",
    category: "Specialized",
    code: `mindmap
  root((Main Topic))
    Branch A
      Leaf 1
      Leaf 2
    Branch B
      Leaf 3
    Branch C`,
  },
  {
    label: "GitGraph",
    category: "Specialized",
    code: `gitGraph
    commit
    branch feature
    checkout feature
    commit
    commit
    checkout main
    merge feature
    commit`,
  },
  {
    label: "Packet",
    category: "Specialized",
    code: `packet-beta
    0-15: "Source Port"
    16-31: "Destination Port"
    32-63: "Sequence Number"
    64-95: "Acknowledgment Number"`,
  },
];

/**
 * Mermaid Editor Panel Component
 *
 * Provides mermaid code input with live preview (stacked layout)
 */
export function MermaidEditorPanel({
  code,
  onChange,
  onSave,
  onCancel,
  onDelete,
  onKeyDown,
  previewRef,
  renderError,
}: MermaidEditorPanelProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  // Focus input on mount (desktop only)
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth >= 768) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  const handleKeyDownInternal = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl+Enter or Cmd+Enter to save
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onSave();
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }

      // Tab to insert 4 spaces
      if (e.key === "Tab") {
        e.preventDefault();
        const input = inputRef.current;
        if (!input) return;
        const start = input.selectionStart || 0;
        const end = input.selectionEnd || 0;
        const newCode = code.slice(0, start) + "    " + code.slice(end);
        onChange(newCode);
        setTimeout(() => {
          input.setSelectionRange(start + 4, start + 4);
        }, 0);
        return;
      }

      onKeyDown(e);
    },
    [code, onChange, onSave, onCancel, onKeyDown]
  );

  const applyTemplate = useCallback(
    (template: string) => {
      onChange(template);
      setShowTemplates(false);
      inputRef.current?.focus();
    },
    [onChange]
  );

  return (
    <div
      className={cn(
        "mermaid-editor-panel relative",
        "rounded-lg border border-border bg-popover shadow-lg",
        "animate-in fade-in-0 zoom-in-95 duration-150",
        "mx-auto max-w-3xl p-4"
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Live Preview */}
      <div
        ref={previewRef}
        className={cn(
          "mb-3 max-h-[480px] min-h-[4rem] overflow-auto border-b border-border py-4 text-center [&_svg]:mx-auto [&_svg]:max-h-[460px] [&_svg]:w-auto",
          renderError && "border-destructive/50"
        )}
      />

      {/* Input area */}
      <div className="flex flex-col gap-2">
        <div className="relative flex-1">
          <textarea
            ref={inputRef}
            value={code}
            onChange={handleInput}
            onKeyDown={handleKeyDownInternal}
            placeholder="graph TD&#10;    A[Start] --> B[End]"
            className={cn(
              "w-full resize-y font-mono text-sm",
              "rounded-md border border-input bg-background px-3 py-2",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
              "placeholder:text-muted-foreground",
              "min-h-[120px]"
            )}
            rows={6}
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-between">
          {/* Template selector */}
          <div className="relative">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowTemplates(!showTemplates)}
              className="h-8 text-xs"
            >
              Templates
            </Button>
            {showTemplates && (
              <div className="absolute bottom-full left-0 z-10 mb-1 max-h-72 w-48 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
                {(() => {
                  let lastCategory = "";
                  return CHART_TEMPLATES.map((t) => {
                    const showCategory = t.category !== lastCategory;
                    lastCategory = t.category;
                    return (
                      <div key={t.label}>
                        {showCategory && (
                          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {t.category}
                          </div>
                        )}
                        <button
                          onClick={() => applyTemplate(t.code)}
                          className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                        >
                          {t.label}
                        </button>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* Save button */}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={onSave}
              className="h-8 w-8 text-green-600 hover:bg-green-100 hover:text-green-700 dark:hover:bg-green-900/30"
              title="Save (Ctrl+Enter)"
            >
              <Check className="h-4 w-4" />
            </Button>

            {/* Cancel button */}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={onCancel}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              title="Cancel (Escape)"
            >
              <X className="h-4 w-4" />
            </Button>

            {/* Delete button */}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={onDelete}
              className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Keyboard hints */}
      <div className="mt-2 text-xs text-muted-foreground">
        <span className="mr-3">
          <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">Ctrl+Enter</kbd> to save
        </span>
        <span className="mr-3">
          <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">Esc</kbd> to cancel
        </span>
        <span>
          <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">Tab</kbd> to indent
        </span>
      </div>
    </div>
  );
}
