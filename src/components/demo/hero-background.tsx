"use client";

import { useCallback, useRef } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

export function HeroBackground({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0.5);
  const mouseY = useMotionValue(0.5);

  const smoothX = useSpring(mouseX, { stiffness: 30, damping: 30 });
  const smoothY = useSpring(mouseY, { stiffness: 30, damping: 30 });

  const spotlightX = useTransform(smoothX, [0, 1], ["-10%", "70%"]);
  const spotlightY = useTransform(smoothY, [0, 1], ["-5%", "60%"]);

  const blob2X = useTransform(smoothX, [0, 1], ["60%", "20%"]);
  const blob2Y = useTransform(smoothY, [0, 1], ["50%", "10%"]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      mouseX.set((e.clientX - rect.left) / rect.width);
      mouseY.set((e.clientY - rect.top) / rect.height);
    },
    [mouseX, mouseY]
  );

  return (
    <div ref={containerRef} className="relative overflow-clip" onMouseMove={handleMouseMove}>
      {/* Base gradient — rich depth like Codex but refined tones */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#dbe9f8] via-[#e8eef6] to-background dark:from-[#0c1529] dark:via-[#0f1a2e] dark:to-background" />

      {/* Ambient mesh blobs */}
      <div className="absolute inset-0">
        <div className="absolute -left-20 -top-20 h-[600px] w-[700px] rounded-full bg-sky-300/30 blur-[120px] dark:bg-blue-600/[0.12]" />
        <div className="absolute -right-10 top-0 h-[500px] w-[500px] rounded-full bg-indigo-300/25 blur-[120px] dark:bg-indigo-500/[0.10]" />
        <div className="absolute bottom-0 left-1/3 h-[400px] w-[600px] rounded-full bg-violet-200/20 blur-[120px] dark:bg-violet-600/[0.08]" />
        <div className="absolute -bottom-20 right-1/4 h-[350px] w-[450px] rounded-full bg-blue-200/15 blur-[100px] dark:bg-blue-500/[0.06]" />
      </div>

      {/* Mouse-following glow */}
      <motion.div
        className="pointer-events-none absolute h-[600px] w-[600px] rounded-full bg-sky-200/25 blur-[150px] dark:bg-blue-400/[0.08]"
        style={{ left: spotlightX, top: spotlightY }}
      />

      {/* Secondary parallax blob */}
      <motion.div
        className="pointer-events-none absolute h-[500px] w-[500px] rounded-full bg-indigo-200/20 blur-[130px] dark:bg-indigo-400/[0.06]"
        style={{ left: blob2X, top: blob2Y }}
      />

      {/* Bottom fade to page background */}
      <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-background to-transparent" />

      {/* Content */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
