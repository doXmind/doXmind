"use client";

import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Upload } from "lucide-react";
import { useFileStore } from "@/stores/file-store";
import { Button } from "@/components/ui/button";
import { AnimatedLogo } from "@/components/ui/animated-logo";
import { cn } from "@/lib/utils";
import { storeLogger } from "@/lib/logger";

const log = storeLogger.child("Welcome");

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.3,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.34, 1.56, 0.64, 1] as const,
    },
  },
};

export function WelcomeScreen() {
  const { createFile, importFile } = useFileStore();
  const [isDragging, setIsDragging] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateFile = async () => {
    setIsCreating(true);
    try {
      await createFile("Untitled.md");
    } catch (error) {
      log.error("Failed to create file", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files?.[0];
      if (file) {
        try {
          await importFile(file);
        } catch (error) {
          log.error("Failed to import file", error);
        }
      }
    },
    [importFile]
  );

  return (
    <div
      className={cn(
        "relative flex flex-1 items-center justify-center p-6 md:p-8",
        "transition-colors duration-300",
        isDragging && "bg-primary/5"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <motion.div
        className={cn(
          "w-full max-w-md space-y-8 text-center",
          // Offset downward on mobile to visually center accounting for bottom navigation (64px nav + FAB)
          "translate-y-16 md:translate-y-0"
        )}
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Logo */}
        <motion.div variants={itemVariants}>
          <AnimatedLogo size="lg" />
        </motion.div>

        {/* Primary CTA */}
        <motion.div variants={itemVariants}>
          <motion.div
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.2 }}
          >
            <Button
              size="lg"
              onClick={handleCreateFile}
              disabled={isCreating}
              className={cn(
                "h-14 gap-2 px-8 text-base font-medium",
                "shadow-lg shadow-primary/20 dark:shadow-primary/10",
                "transition-shadow duration-300"
              )}
            >
              {isCreating ? (
                "Creating..."
              ) : (
                <>
                  Start Writing
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </motion.div>
        </motion.div>

        {/* Drop hint */}
        <motion.div
          variants={itemVariants}
          className={cn(
            "flex items-center justify-center gap-2 text-sm text-muted-foreground",
            "transition-colors duration-200",
            isDragging && "font-medium text-primary"
          )}
        >
          <Upload className="h-4 w-4" />
          <span>{isDragging ? "Drop to import" : "or drop a file here"}</span>
        </motion.div>
      </motion.div>

      {/* Drag overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            className="pointer-events-none absolute inset-4 rounded-xl border-2 border-dashed border-primary/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
