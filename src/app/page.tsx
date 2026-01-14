"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { AnimatedLogo } from "@/components/ui/animated-logo";
import { Button } from "@/components/ui/button";

export default function BrandPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background overflow-hidden">
      {/* Animated Logo */}
      <AnimatedLogo size="xl" />

      {/* Tagline */}
      <motion.div
        className="text-center mt-8"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 1.2 }}
      >
        <p className="text-2xl font-bold tracking-widest uppercase">
          Think. Write. Publish.
        </p>
        <p className="text-sm text-muted-foreground mt-3 tracking-wide">
          The AI editor that reasons with you
        </p>
      </motion.div>

      {/* CTA Button */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 1.5 }}
      >
        <Link href="/editor" className="mt-12 inline-block">
          <Button
            size="lg"
            className="px-10 py-6 text-base tracking-wide transition-all hover:scale-105 hover:shadow-lg"
          >
            Enter Editor
          </Button>
        </Link>
      </motion.div>

      {/* Subtle background pulse */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
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
