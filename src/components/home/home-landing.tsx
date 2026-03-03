"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { AnimatedLogo } from "@/components/ui/animated-logo";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

export function HomeLanding() {
  const t = useTranslations("home");
  return (
    <div className="flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background">
      <AnimatedLogo size="xl" />

      <motion.div
        className="mt-8 text-center"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 1.2 }}
      >
        <p className="text-2xl font-bold uppercase tracking-widest">{t("thinkWritePublish")}</p>
        <p className="mt-3 text-sm tracking-wide text-muted-foreground">{t("tagline")}</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 1.5 }}
      >
        <Link href="/login" className="mt-12 inline-block">
          <Button
            size="lg"
            className="px-10 py-6 text-base tracking-wide transition-all hover:scale-105 hover:shadow-lg"
          >
            {t("getStarted")}
          </Button>
        </Link>
      </motion.div>

      <motion.div
        className="pointer-events-none absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{
          opacity: [0, 0.02, 0],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          repeatType: "reverse",
          delay: 2,
        }}
        style={{
          background: "radial-gradient(circle at center, currentColor 0%, transparent 70%)",
        }}
      />
    </div>
  );
}
