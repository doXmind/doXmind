"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TodoItem } from "@/hooks/use-chat";

interface TodoProgressProps {
  todos: TodoItem[];
  className?: string;
}

const statusConfig = {
  pending: {
    icon: Circle,
    color: "text-muted-foreground",
    bgColor: "bg-muted/50",
  },
  in_progress: {
    icon: Loader2,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    animate: true,
  },
  completed: {
    icon: CheckCircle2,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
  },
};

export function TodoProgress({ todos, className }: TodoProgressProps) {
  if (todos.length === 0) return null;

  const completedCount = todos.filter((t) => t.status === "completed").length;
  const progress = (completedCount / todos.length) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        "rounded-lg border bg-card/50 backdrop-blur-sm p-3 space-y-2",
        className
      )}
    >
      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {completedCount}/{todos.length}
        </span>
      </div>

      {/* Todo items */}
      <ul className="space-y-1">
        <AnimatePresence mode="popLayout">
          {todos.map((todo) => {
            const config = statusConfig[todo.status];
            const Icon = config.icon;

            return (
              <motion.li
                key={todo.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className={cn(
                  "flex items-center gap-2 text-sm py-1 px-2 rounded",
                  config.bgColor
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    config.color,
                    config.animate && "animate-spin"
                  )}
                />
                <span
                  className={cn(
                    "truncate",
                    todo.status === "completed" && "line-through text-muted-foreground"
                  )}
                >
                  {todo.status === "in_progress" ? todo.activeForm : todo.content}
                </span>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </motion.div>
  );
}
