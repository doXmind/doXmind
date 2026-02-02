"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, ChevronRight, Check, AlertCircle, Download, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GeneratedFile } from "@/types/stream-events";

interface CodeExecutionOutputProps {
  stdout?: string;
  stderr?: string;
  returnCode: number;
  files?: GeneratedFile[];
}

/**
 * Code execution output component that displays the result of code execution.
 * Shows stdout/stderr, exit code, and any generated files.
 */
export function CodeExecutionOutput({
  stdout,
  stderr,
  returnCode,
  files = [],
}: CodeExecutionOutputProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isSuccess = returnCode === 0;
  const hasOutput = stdout || stderr;
  const hasFiles = files.length > 0;

  if (!hasOutput && !hasFiles) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="mb-2 ml-11"
    >
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors duration-200",
          isSuccess
            ? "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
            : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
        )}
      >
        <div className="relative flex-shrink-0">
          <Terminal className="h-4 w-4" />
        </div>
        <span className="flex-1 truncate font-medium">
          {isSuccess ? "Code executed successfully" : "Code execution failed"}
          {hasFiles && ` (${files.length} file${files.length > 1 ? "s" : ""} created)`}
        </span>
        {isSuccess ? (
          <Check className="h-4 w-4 flex-shrink-0" />
        ) : (
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
        )}
        <motion.span animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronRight className="h-4 w-4 flex-shrink-0" />
        </motion.span>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-1 space-y-2">
              {/* stdout */}
              {stdout && (
                <div className="max-h-[200px] overflow-y-auto rounded-lg border border-border/50 bg-muted/50 px-3 py-2 text-xs">
                  <div className="mb-1 font-medium text-muted-foreground">Output:</div>
                  <pre className="whitespace-pre-wrap font-mono text-foreground/80">{stdout}</pre>
                </div>
              )}

              {/* stderr */}
              {stderr && (
                <div className="max-h-[150px] overflow-y-auto rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs">
                  <div className="mb-1 font-medium text-red-600 dark:text-red-400">Error:</div>
                  <pre className="whitespace-pre-wrap font-mono text-red-600/80 dark:text-red-400/80">
                    {stderr}
                  </pre>
                </div>
              )}

              {/* Generated files */}
              {hasFiles && (
                <div className="rounded-lg border border-border/50 bg-muted/50 px-3 py-2 text-xs">
                  <div className="mb-2 font-medium text-muted-foreground">Generated files:</div>
                  <div className="space-y-1">
                    {files.map((file) => (
                      <div
                        key={file.file_id}
                        className="flex items-center gap-2 text-foreground/80"
                      >
                        <FileText className="h-3 w-3 flex-shrink-0" />
                        <span className="flex-1 truncate font-mono">{file.filename}</span>
                        <button
                          type="button"
                          className="flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                          onClick={(e) => {
                            e.stopPropagation();
                            // TODO: Implement file download via Anthropic Files API
                            console.log("Download file:", file.file_id);
                          }}
                        >
                          <Download className="h-3 w-3" />
                          <span>Download</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Exit code */}
              <div className="px-3 py-1 text-xs text-muted-foreground">Exit code: {returnCode}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
