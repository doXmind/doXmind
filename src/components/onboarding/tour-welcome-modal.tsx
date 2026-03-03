"use client";

import { motion } from "framer-motion";
import { ArrowRight, Pencil, Wand2, MessageCircle, Compass, Home, FolderOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { AnimatedLogo } from "@/components/ui/animated-logo";
import { cn } from "@/lib/utils";

interface TourWelcomeModalProps {
  onStart: () => void;
  onSkip: () => void;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.4 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.34, 1.56, 0.64, 1] as const },
  },
};

const STEP_GROUPS = [
  { icon: Home, labelKey: "groupHomeSearch", count: 2 },
  { icon: Pencil, labelKey: "groupAIWriting", count: 2 },
  { icon: Wand2, labelKey: "groupAIEditing", count: 3 },
  { icon: MessageCircle, labelKey: "groupChatKnowledge", count: 2 },
  { icon: Compass, labelKey: "groupNavigation", count: 4 },
  { icon: FolderOpen, labelKey: "groupFileManagement", count: 4 },
];

export function TourWelcomeModal({ onStart, onSkip }: TourWelcomeModalProps) {
  const t = useTranslations("onboarding");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="pointer-events-auto fixed inset-0 z-[65] flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className={cn(
          "relative mx-4 w-full max-w-md",
          "rounded-2xl border border-border bg-popover shadow-2xl"
        )}
      >
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="flex flex-col items-center"
        >
          {/* Logo */}
          <motion.div variants={itemVariants} className="pt-8">
            <AnimatedLogo size="md" />
          </motion.div>

          {/* Content */}
          <motion.div variants={itemVariants} className="px-8 pt-5 text-center">
            <h2 className="text-xl font-semibold tracking-tight">{t("tourWelcomeTitle")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("tourWelcomeMessage")}
            </p>
          </motion.div>

          {/* Step groups */}
          <motion.div variants={itemVariants} className="mt-5 w-full space-y-1.5 px-8">
            {STEP_GROUPS.map((group) => (
              <div
                key={group.labelKey}
                className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-2.5"
              >
                <group.icon className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-sm text-foreground">{t(group.labelKey)}</span>
                <span className="text-xs text-muted-foreground/60">
                  {group.count === 1
                    ? t("featureCountSingular", { count: group.count })
                    : t("featureCount", { count: group.count })}
                </span>
              </div>
            ))}
          </motion.div>

          {/* Actions */}
          <motion.div variants={itemVariants} className="flex w-full flex-col gap-2 px-8 pb-8 pt-6">
            <Button onClick={onStart} className="w-full gap-2">
              {t("startTutorial")}
              <ArrowRight className="h-4 w-4" />
            </Button>
            <button
              onClick={onSkip}
              className="text-xs text-muted-foreground/50 transition-colors hover:text-muted-foreground dark:text-muted-foreground/70"
            >
              {t("skipExplore")}
            </button>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
