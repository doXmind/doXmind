"use client";

/**
 * Voice Waveform Component
 *
 * Animated waveform visualization for voice recording.
 * Shows audio level feedback during recording.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface VoiceWaveformProps {
  /** Audio level (0-1) */
  audioLevel: number;
  /** Number of bars to display */
  barCount?: number;
  /** Whether recording is active */
  isActive?: boolean;
  /** Additional class names */
  className?: string;
}

export function VoiceWaveform({
  audioLevel,
  barCount = 20,
  isActive = true,
  className,
}: VoiceWaveformProps) {
  // Generate bar heights based on audio level with randomization for visual interest
  const barHeights = useMemo(() => {
    if (!isActive) {
      return Array(barCount).fill(8); // Minimum height when inactive
    }

    return Array(barCount)
      .fill(0)
      .map((_, i) => {
        // Create a wave-like pattern
        const position = i / barCount;
        const wave = Math.sin(position * Math.PI);

        // Add randomization based on audio level
        const randomFactor = 0.3 + Math.random() * 0.7;

        // Calculate height: base + audio contribution
        const baseHeight = 8;
        const maxHeight = 48;
        const audioContribution = audioLevel * wave * randomFactor * (maxHeight - baseHeight);

        return Math.max(baseHeight, baseHeight + audioContribution);
      });
  }, [audioLevel, barCount, isActive]);

  return (
    <div
      className={cn(
        "voice-waveform flex items-center justify-center gap-[3px]",
        className
      )}
    >
      {barHeights.map((height, index) => (
        <motion.div
          key={index}
          className="voice-waveform-bar"
          animate={{
            height: height,
          }}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 20,
            mass: 0.5,
          }}
          style={{
            width: 4,
            minHeight: 8,
            backgroundColor: isActive
              ? "hsl(var(--primary))"
              : "hsl(var(--muted-foreground) / 0.3)",
            borderRadius: 2,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Simple recording indicator dot
 */
interface RecordingIndicatorProps {
  isRecording: boolean;
  className?: string;
}

export function RecordingIndicator({
  isRecording,
  className,
}: RecordingIndicatorProps) {
  return (
    <motion.div
      className={cn(
        "w-3 h-3 rounded-full",
        isRecording ? "bg-destructive recording-indicator" : "bg-muted-foreground/30",
        className
      )}
      animate={
        isRecording
          ? {
              scale: [1, 1.2, 1],
              opacity: [1, 0.7, 1],
            }
          : {}
      }
      transition={{
        duration: 1,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  );
}

/**
 * Duration display for recording
 */
interface RecordingDurationProps {
  /** Duration in milliseconds */
  duration: number;
  /** Maximum duration in milliseconds */
  maxDuration?: number;
  className?: string;
}

export function RecordingDuration({
  duration,
  maxDuration = 60000,
  className,
}: RecordingDurationProps) {
  const seconds = Math.floor(duration / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  const formatted = `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;

  // Show warning color when approaching max duration
  const isNearMax = maxDuration && duration > maxDuration * 0.8;

  return (
    <span
      className={cn(
        "font-mono text-sm tabular-nums",
        isNearMax ? "text-destructive" : "text-muted-foreground",
        className
      )}
    >
      {formatted}
    </span>
  );
}
