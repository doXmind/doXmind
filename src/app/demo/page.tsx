"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { MockEditorShowcase } from "@/components/demo/mock-editor-showcase";
import { FeatureHighlights } from "@/components/demo/feature-highlights";
import { WorkflowShowcase } from "@/components/demo/workflow-showcase";
import { HeroBackground } from "@/components/demo/hero-background";
import { DemoFooter } from "@/components/demo/demo-footer";

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero — Codex layout: header inside gradient background */}
      <HeroBackground>
        {/* Header — transparent over gradient */}
        <header className="sticky top-0 z-50 border-b border-white/10 backdrop-blur-md dark:border-white/5">
          <div className="flex items-center justify-between px-8 py-4 sm:px-12">
            <Link href="/" className="text-2xl tracking-tight text-foreground">
              <span className="font-light">do</span>
              <span className="font-black">X</span>
              <span className="font-light">mind</span>
            </Link>
            <div className="flex items-center gap-5">
              <Link
                href="/help"
                className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
              >
                Features
              </Link>
              <Link href="/login">
                <Button size="default">Log in</Button>
              </Link>
            </div>
          </div>
        </header>

        <section className="relative px-4 pb-0 pt-16 lg:pt-24">
          {/* Centered branding */}
          <motion.div
            className="mx-auto max-w-3xl text-center"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            {/* Large logo icon */}
            <div className="mb-6 flex justify-center">
              <Logo variant="icon" size="lg" animated />
            </div>

            {/* Product name — large, like Codex */}
            <h1 className="text-5xl font-light tracking-tight sm:text-6xl lg:text-7xl">
              <span className="font-light">do</span>
              <span className="font-black">X</span>
              <span className="font-light">mind</span>
            </h1>

            {/* Subtitle */}
            <p className="mx-auto mt-5 max-w-lg text-base text-muted-foreground sm:text-lg">
              Write, edit, and refine your ideas with an AI assistant built into every corner of the
              editor.
            </p>

            {/* Two CTAs side by side */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/login">
                <Button size="lg" className="px-8 text-base">
                  Try for Free
                </Button>
              </Link>
              <Link href="/help">
                <Button variant="outline" size="lg" className="px-8 text-base">
                  Learn More
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Mock Editor — hangs below the gradient */}
          <motion.div
            className="relative mx-auto mt-14 max-w-5xl lg:mt-20"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25 }}
          >
            <div className="h-[420px] overflow-hidden rounded-xl md:h-[630px] lg:h-auto lg:overflow-visible">
              <div className="origin-top-left scale-[0.43] md:scale-[0.65] lg:origin-top lg:scale-[0.87]">
                <MockEditorShowcase />
              </div>
            </div>
          </motion.div>
        </section>
      </HeroBackground>

      {/* Feature Highlights */}
      <section className="px-6 pb-16 pt-16 lg:pb-24 lg:pt-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-2 text-center text-2xl font-bold sm:text-3xl">
            Everything you need to write
          </h2>
          <p className="mb-16 text-center text-sm text-muted-foreground sm:text-base">
            AI-powered features built into every part of the editor.
          </p>
          <FeatureHighlights />
        </div>
      </section>

      {/* Workflow Showcase */}
      <section className="px-6 py-16 lg:py-24">
        <div className="mx-auto max-w-6xl">
          <WorkflowShowcase />
        </div>
      </section>

      {/* CTA — gradient background matching hero */}
      <section className="relative overflow-hidden px-4 pb-24 pt-32 text-center lg:pb-32 lg:pt-40">
        {/* Base gradient — white/background at top, color at bottom */}
        <div className="absolute inset-0 bg-gradient-to-b from-background via-[#edf2f8] to-[#dbe9f8] dark:from-background dark:via-[#0a1120] dark:to-[#0c1529]" />

        {/* Ambient mesh blobs — pushed down to avoid top edge */}
        <div className="absolute -left-20 bottom-0 h-[400px] w-[500px] rounded-full bg-sky-300/20 blur-[140px] dark:bg-blue-600/[0.10]" />
        <div className="absolute -right-10 bottom-1/4 h-[350px] w-[400px] rounded-full bg-indigo-300/15 blur-[140px] dark:bg-indigo-500/[0.08]" />
        <div className="absolute bottom-0 left-1/3 h-[300px] w-[400px] rounded-full bg-violet-200/15 blur-[140px] dark:bg-violet-600/[0.06]" />

        {/* Content */}
        <div className="relative z-10">
          <h2 className="text-3xl font-bold sm:text-4xl">Try doXmind today</h2>
          <p className="mx-auto mt-4 max-w-lg text-base text-muted-foreground">
            Start writing with AI for free. No credit card required.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/login">
              <Button size="lg" className="px-8 text-base">
                Get Started
              </Button>
            </Link>
            <Link href="/help">
              <Button variant="outline" size="lg" className="px-8 text-base">
                Learn More
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <DemoFooter />
    </div>
  );
}
