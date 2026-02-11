"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Upload, Loader2, PenLine } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useFileStore } from "@/stores/file-store";
import { getErrorMessage } from "@/lib/utils";

export function EmptyState() {
  const router = useRouter();
  const { files, createFile, importFile } = useFileStore();
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCreate = async () => {
    try {
      const newId = await createFile(`Untitled-${files.length + 1}.md`);
      router.push(`/editor/${newId}`);
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setIsImporting(true);
    try {
      const newId = await importFile(file);
      router.push(`/editor/${newId}`);
      toast.success(`Imported "${file.name}" successfully`);
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <motion.div
      className="mx-auto flex max-w-md flex-col items-center justify-center py-24 text-center"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Decorative icon */}
      <motion.div
        className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-foreground/[0.04] dark:bg-foreground/[0.08]"
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.5, delay: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
      >
        <PenLine className="h-7 w-7 text-muted-foreground/40" strokeWidth={1.5} />
      </motion.div>

      <h2 className="text-xl font-semibold tracking-tight">Your blank canvas awaits</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground/60">
        Every great piece of writing starts with a single word.
        <br />
        Create a new document or import one to begin.
      </p>

      <div className="mt-8 flex items-center gap-3">
        <Button onClick={handleCreate} className="gap-2 rounded-xl px-5">
          <Plus className="h-4 w-4" />
          New Document
        </Button>
        <Button
          variant="outline"
          onClick={handleImportClick}
          disabled={isImporting}
          className="gap-2 rounded-xl border-border/50 px-5"
        >
          {isImporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Import
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.md,.markdown"
        onChange={handleFileSelect}
        className="hidden"
      />
    </motion.div>
  );
}
