"use client";

/**
 * Voice Recording Overlay Component
 *
 * WeChat-style voice recording overlay that appears at the bottom
 * of the screen without obstructing selected content.
 */

import { useCallback, useEffect } from "react";
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
  const { selectedBlocks, getSelectedText } = useBlockSelectionStore();

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
                    ? "Recording..."
                    : isTranscribing
                      ? "Transcribing..."
                      : "Voice Input"}
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
                  {selectedBlocks.length} block{selectedBlocks.length > 1 ? "s" : ""} selected
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
                    Try Again
                  </Button>
                </div>
              ) : isTranscribing ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Converting speech to text...</p>
                </div>
              ) : transcription ? (
                <div className="w-full">
                  <p className="mb-2 text-sm text-muted-foreground">Transcription:</p>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-sm">{transcription}</p>
                  </div>
                </div>
              ) : (
                <VoiceWaveform audioLevel={audioLevel} isActive={isRecording} barCount={24} />
              )}
            </div>

            {/* Action button */}
            <div className="flex justify-center px-4 pb-4">
              {!isTranscribing && !transcription && (
                <motion.button
                  type="button"
                  className={cn(
                    "flex h-16 w-16 items-center justify-center rounded-full",
                    "transition-colors",
                    isRecording
                      ? "bg-destructive text-destructive-foreground"
                      : "bg-primary text-primary-foreground"
                  )}
                  onTouchStart={() => {
                    if (!isRecording) {
                      haptics.medium();
                      handleStartRecording();
                    }
                  }}
                  onTouchEnd={() => {
                    if (isRecording) {
                      handleStopRecording();
                    }
                  }}
                  onMouseDown={() => {
                    if (!isRecording) {
                      haptics.medium();
                      handleStartRecording();
                    }
                  }}
                  onMouseUp={() => {
                    if (isRecording) {
                      handleStopRecording();
                    }
                  }}
                  onMouseLeave={() => {
                    if (isRecording) {
                      // Cancel if user drags away
                      cancel();
                    }
                  }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Mic className="h-7 w-7" />
                </motion.button>
              )}
            </div>

            {/* Instructions */}
            {!isRecording && !isTranscribing && !transcription && !error && (
              <p className="pb-4 text-center text-xs text-muted-foreground">
                Hold to record, release to send
              </p>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
