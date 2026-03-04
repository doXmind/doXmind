"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, X, FilePlus, FolderPlus, LayoutTemplate, Upload } from "lucide-react";
import { AiLogoIcon } from "@/components/ui/ai-logo-icon";
import { haptics } from "@/lib/haptics";
import { useLayoutStore } from "@/stores/layout-store";
import { MOBILE_SPRINGS, Z_INDEX } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface SpeedDialAction {
  id: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface MobileSpeedDialProps {
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onOpenTemplate: () => void;
  onImport: () => void;
  isImporting?: boolean;
  disableFolder?: boolean;
}

export function MobileSpeedDial({
  onCreateFile,
  onCreateFolder,
  onOpenTemplate,
  onImport,
  isImporting,
  disableFolder,
}: MobileSpeedDialProps) {
  const [isOpen, setIsOpen] = useState(false);
  const t = useTranslations("home");
  const toggleAgentSheet = useLayoutStore((s) => s.toggleAgentSheet);

  const actions: SpeedDialAction[] = [
    {
      id: "ai",
      icon: <AiLogoIcon size={20} />,
      label: t("aiAgent"),
      onClick: () => {
        setIsOpen(false);
        toggleAgentSheet();
      },
    },
    {
      id: "import",
      icon: <Upload className="h-4.5 w-4.5" />,
      label: t("import"),
      onClick: () => {
        setIsOpen(false);
        onImport();
      },
      disabled: isImporting,
    },
    {
      id: "template",
      icon: <LayoutTemplate className="h-4.5 w-4.5" />,
      label: t("template"),
      onClick: () => {
        setIsOpen(false);
        onOpenTemplate();
      },
    },
    {
      id: "folder",
      icon: <FolderPlus className="h-4.5 w-4.5" />,
      label: t("folder"),
      onClick: () => {
        setIsOpen(false);
        onCreateFolder();
      },
      disabled: disableFolder,
    },
    {
      id: "file",
      icon: <FilePlus className="h-5 w-5" />,
      label: t("newDoc"),
      onClick: () => {
        setIsOpen(false);
        onCreateFile();
      },
    },
  ];

  const toggle = () => {
    haptics.light();
    setIsOpen((prev) => !prev);
  };

  return (
    <div
      className="fixed bottom-[72px] right-5 md:hidden"
      style={{
        zIndex: Z_INDEX.FLOATING_BUTTON,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {/* Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="fixed inset-0"
            style={{ zIndex: Z_INDEX.FLOATING_BUTTON - 1 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setIsOpen(false)}
          >
            <div className="h-full w-full bg-black/20" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Speed dial actions */}
      <AnimatePresence>
        {isOpen &&
          actions.map((action, index) => (
            <motion.div
              key={action.id}
              className="absolute right-0 flex items-center gap-3"
              style={{ bottom: 56 + 12 + index * 52 }}
              initial={{ opacity: 0, scale: 0.3, y: 20 }}
              animate={{
                opacity: 1,
                scale: 1,
                y: 0,
                transition: {
                  type: "spring",
                  ...MOBILE_SPRINGS.SNAPPY,
                  delay: index * 0.04,
                },
              }}
              exit={{
                opacity: 0,
                scale: 0.3,
                y: 10,
                transition: { duration: 0.1, delay: (actions.length - index) * 0.02 },
              }}
            >
              {/* Label */}
              <span className="rounded-lg bg-background/90 px-2.5 py-1 text-[12px] font-medium text-foreground/80 shadow-sm backdrop-blur-sm">
                {action.label}
              </span>

              {/* Action button */}
              <motion.button
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full border border-border/60 bg-background text-foreground shadow-md",
                  "active:scale-90",
                  action.disabled && "opacity-40"
                )}
                disabled={action.disabled}
                onClick={() => {
                  haptics.light();
                  action.onClick();
                }}
                whileTap={{ scale: 0.85 }}
              >
                {action.icon}
              </motion.button>
            </motion.div>
          ))}
      </AnimatePresence>

      {/* Main FAB button */}
      <motion.button
        className="relative flex h-14 w-14 items-center justify-center rounded-full border border-border/60 bg-background text-foreground shadow-lg active:scale-95"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          type: "spring",
          ...MOBILE_SPRINGS.BOUNCY,
          delay: 0.6,
        }}
        whileTap={{ scale: 0.9 }}
        onClick={toggle}
        aria-label={isOpen ? t("closeMenu") : t("createNew")}
      >
        <motion.div
          animate={{ rotate: isOpen ? 45 : 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          {isOpen ? <X className="h-6 w-6" /> : <Plus className="h-6 w-6" />}
        </motion.div>
      </motion.button>
    </div>
  );
}
