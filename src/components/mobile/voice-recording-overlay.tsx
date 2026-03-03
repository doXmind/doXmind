"use client";

/**
 * Voice Recording Overlay Component
 *
 * WeChat-style voice recording overlay that appears at the bottom
 * of the screen without obstructing selected content.
 *
 * Interaction: Tap to show overlay, then press-and-hold the button to record.
 * Releasing the button stops recording and sends for transcription.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { VoiceWaveform, RecordingIndicator, RecordingDuration } from "./voice-waveform";
import { useVoiceRecording, useSpeechToText } from "@/hooks/use-voice-recording";
import { useBlockSelectionStore } from "@/stores/block-selection-store";
import { haptics } from "@/lib/haptics";
import { Z_INDEX, MOBILE_SPRINGS } from "@/lib/constants";

interface VoiceRecordingOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean;
  /** Callback to close the overlay */
  onClose: () => void;
  /** Callback when transcription is complete */
  onTranscriptionComplete: (text: string, selectedText: string) => void;
  /** Maximum recording duration in ms */
  maxDuration?: number;
}

export function VoiceRecordingOverlay({
  isOpen,
  onClose,
  onTranscriptionComplete,
  maxDuration = 60000,
}: VoiceRecordingOverlayProps) {
  const t = useTranslations("mobile");
  const { selectedBlocks, getSelectedText } = useBlockSelectionStore();
  const [isPressing, setIsPressing] = useState(false);

  const {
    isTranscribing,
    transcription,
    error: transcriptionError,
    transcribe,
    reset: resetTranscription,
  } = useSpeechToText({
    onComplete: (text) => {
      if (text) {
        const selectedText = getSelectedText();
        onTranscriptionComplete(text, selectedText);
      }
    },
  });

  const handleRecordingStop = useCallback(
    async (blob: Blob) => {
      await transcribe(blob);
    },
    [transcribe]
  );

  const {
    isRecording,
    duration,
    error: recordingError,
    audioLevel,
    start,
    stop,
    cancel,
  } = useVoiceRecording({
    maxDuration,
    onStop: handleRecordingStop,
    onCancel: () => {
      resetTranscription();
    },
  });

  const handleClose = useCallback(() => {
    cancel();
    resetTranscription();
    onClose();
  }, [cancel, resetTranscription, onClose]);

  const handleStartRecording = useCallback(async () => {
    await start();
  }, [start]);

  const handleStopRecording = useCallback(() => {
    stop();
  }, [stop]);

  const error = recordingError || transcriptionError;

  // Reset state when overlay opens
  useEffect(() => {
    if (isOpen) {
      resetTranscription();
    }
  }, [isOpen, resetTranscription]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Gradient overlay - doesn't block content above */}
          <motion.div
            className="voice-recording-gradient fixed inset-x-0 bottom-0 md:hidden"
            style={{
              zIndex: Z_INDEX.MOBILE_OVERLAY,
              height: "50vh",
              pointerEvents: "none",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Recording panel */}
          <motion.div
            className={cn(
              "fixed inset-x-0 bottom-0 md:hidden",
              "bg-background/95 backdrop-blur-xl",
              "border-t border-border/50",
              "rounded-t-2xl",
              "pb-[env(safe-area-inset-bottom)]"
            )}
            style={{ zIndex: Z_INDEX.MOBILE_PANEL }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", ...MOBILE_SPRINGS.SMOOTH }}
          >
            {/* Drag handle */}
            <div className="flex justify-center py-2">
              <div className="h-1 w-10 rounded-full bg-border" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-2">
              <div className="flex items-center gap-2">
                <RecordingIndicator isRecording={isRecording} />
                <span className="text-sm font-medium">
                  {isRecording
                    ? t("recording")
                    : isTranscribing
                      ? t("transcribing")
                      : t("voiceInputTitle")}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {isRecording && <RecordingDuration duration={duration} maxDuration={maxDuration} />}
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Context info */}
            {selectedBlocks.length > 0 && (
              <div className="mx-4 mb-3 rounded-lg bg-muted/30 px-4 py-2">
                <p className="text-xs text-muted-foreground">
                  {selectedBlocks.length === 1
                    ? t("blocksSelected", { count: selectedBlocks.length })
                    : t("blocksSelectedPlural", { count: selectedBlocks.length })}
                </p>
                <p className="mt-1 truncate text-sm">
                  {getSelectedText().slice(0, 100)}
                  {getSelectedText().length > 100 ? "..." : ""}
                </p>
              </div>
            )}

            {/* Waveform or status */}
            <div className="flex flex-col items-center gap-4 px-4 py-6">
              {error ? (
                <div className="text-center">
                  <p className="text-sm text-destructive">{error}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      cancel();
                      resetTranscription();
                    }}
                  >
                    {t("tryAgain")}
                  </Button>
                </div>
              ) : isTranscribing ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">{t("convertingSpeech")}</p>
                </div>
              ) : transcription ? (
                <div className="w-full">
                  <p className="mb-2 text-sm text-muted-foreground">{t("transcriptionLabel")}</p>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-sm">{transcription}</p>
                  </div>
                </div>
              ) : (
                <VoiceWaveform audioLevel={audioLevel} isActive={isRecording} barCount={24} />
              )}
            </div>

            {/* WeChat-style press-and-hold button */}
            <div className="flex justify-center px-4 pb-4">
              {!isTranscribing && !transcription && (
                <motion.button
                  type="button"
                  className={cn(
                    "flex w-full max-w-xs items-center justify-center gap-2 rounded-full px-6 py-4",
                    "transition-all duration-150",
                    "touch-none select-none",
                    isRecording || isPressing
                      ? "scale-[0.98] bg-destructive text-destructive-foreground"
                      : "bg-muted text-muted-foreground active:bg-muted/80"
                  )}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    if (!isRecording) {
                      setIsPressing(true);
                      haptics.medium();
                      handleStartRecording();
                    }
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    setIsPressing(false);
                    if (isRecording) {
                      haptics.light();
                      handleStopRecording();
                    }
                  }}
                  onTouchCancel={() => {
                    setIsPressing(false);
                    if (isRecording) {
                      cancel();
                    }
                  }}
                  onMouseDown={() => {
                    if (!isRecording) {
                      setIsPressing(true);
                      haptics.medium();
                      handleStartRecording();
                    }
                  }}
                  onMouseUp={() => {
                    setIsPressing(false);
                    if (isRecording) {
                      haptics.light();
                      handleStopRecording();
                    }
                  }}
                  onMouseLeave={() => {
                    if (isRecording || isPressing) {
                      setIsPressing(false);
                      cancel();
                    }
                  }}
                  animate={{
                    scale: isRecording || isPressing ? 0.98 : 1,
                  }}
                  transition={{ duration: 0.1 }}
                >
                  <Mic className={cn("h-5 w-5", isRecording && "animate-pulse")} />
                  <span className="text-sm font-medium">
                    {isRecording ? t("releaseToSend") : t("holdToTalk")}
                  </span>
                </motion.button>
              )}
            </div>

            {/* Instructions - hidden when recording */}
            {!isRecording && !isTranscribing && !transcription && !error && (
              <p className="pb-4 text-center text-xs text-muted-foreground">{t("holdToRecord")}</p>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
