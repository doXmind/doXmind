"use client";

import { memo } from "react";
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
    animate: false,
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
    animate: false,
  },
};

export const TodoProgress = memo(function TodoProgress({ todos, className }: TodoProgressProps) {
  if (todos.length === 0) return null;

  const completedCount = todos.filter((t) => t.status === "completed").length;
  const progress = (completedCount / todos.length) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn("space-y-2 rounded-lg border bg-card/50 p-3 backdrop-blur-sm", className)}
    >
      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {completedCount}/{todos.length}
        </span>
      </div>

      {/* Todo items */}
      <ul className="space-y-1">
        <AnimatePresence mode="popLayout">
          {todos.map((todo, index) => {
            const config = statusConfig[todo.status];
            const Icon = config.icon;

            return (
              <motion.li
                key={todo.id || `todo-${index}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className={cn("flex items-center gap-2 rounded px-2 py-1 text-sm", config.bgColor)}
              >
                <Icon
                  className={cn("h-4 w-4 shrink-0", config.color, config.animate && "animate-spin")}
                />
                <span
                  className={cn(
                    "truncate",
                    todo.status === "completed" && "text-muted-foreground line-through"
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
});
