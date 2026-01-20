/**
 * Voice Recording Hook
 *
 * WeChat-style voice recording with long-press interaction.
 * Uses MediaRecorder API for audio capture.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { haptics } from "@/lib/haptics";

export interface UseVoiceRecordingOptions {
  /** Minimum recording duration in ms (default: 500ms) */
  minDuration?: number;
  /** Maximum recording duration in ms (default: 60000ms / 1 minute) */
  maxDuration?: number;
  /** Called when recording starts */
  onStart?: () => void;
  /** Called when recording stops with audio blob */
  onStop?: (blob: Blob, duration: number) => void;
  /** Called when recording is cancelled */
  onCancel?: () => void;
  /** Called when an error occurs */
  onError?: (error: string) => void;
}

export interface UseVoiceRecordingReturn {
  /** Whether currently recording */
  isRecording: boolean;
  /** Recording duration in milliseconds */
  duration: number;
  /** Error message if any */
  error: string | null;
  /** Current audio level (0-1) for waveform visualization */
  audioLevel: number;
  /** Start recording */
  start: () => Promise<void>;
  /** Stop recording and return blob */
  stop: () => void;
  /** Cancel recording without saving */
  cancel: () => void;
}

export function useVoiceRecording(options: UseVoiceRecordingOptions = {}): UseVoiceRecordingReturn {
  const { minDuration = 500, maxDuration = 60000, onStart, onStop, onCancel, onError } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  // Refs for cleanup
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const isRecordingRef = useRef(false);

  // Cleanup function
  const cleanup = useCallback(() => {
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Stop animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop media recorder
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    // Stop all tracks in the stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current?.state !== "closed") {
      audioContextRef.current?.close();
    }
    audioContextRef.current = null;
    analyserRef.current = null;

    // Reset chunks
    chunksRef.current = [];
  }, []);

  // Start recording
  const start = useCallback(async () => {
    try {
      setError(null);
      cleanup();

      // Check browser support
      if (!navigator.mediaDevices?.getUserMedia) {
        const msg = "Voice recording is not supported in this browser";
        setError(msg);
        onError?.(msg);
        haptics.error();
        return;
      }

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // Create MediaRecorder
      // Try formats in order of OpenAI Whisper compatibility
      // webm with opus codec is widely supported and works with Whisper
      const supportedTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "audio/mp4",
      ];

      const mimeType =
        supportedTypes.find((type) => MediaRecorder.isTypeSupported(type)) || "audio/webm";
      console.log("[VoiceRecording] Using MIME type:", mimeType);

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      // Setup audio analysis for waveform visualization
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Handle data available
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      // Handle recording stop
      mediaRecorder.onstop = () => {
        const recordedDuration = Date.now() - startTimeRef.current;

        // Check minimum duration
        if (recordedDuration < minDuration) {
          haptics.error();
          setError("Recording too short");
          onCancel?.();
        } else if (chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          haptics.success();
          onStop?.(blob, recordedDuration);
        }

        // Cleanup after stop
        cleanup();
        setIsRecording(false);
        isRecordingRef.current = false;
        setDuration(0);
        setAudioLevel(0);
      };

      // Start recording
      mediaRecorder.start(100); // Collect data every 100ms
      startTimeRef.current = Date.now();
      setIsRecording(true);
      isRecordingRef.current = true;
      haptics.medium();
      onStart?.();

      // Update audio level for waveform visualization
      const updateAudioLevel = () => {
        if (!analyserRef.current || !isRecordingRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        // Calculate average level
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(average / 255);

        animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
      };
      updateAudioLevel();

      // Update duration timer
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        setDuration(elapsed);

        // Auto-stop at max duration
        if (elapsed >= maxDuration) {
          if (mediaRecorderRef.current?.state === "recording") {
            mediaRecorderRef.current.stop();
          }
        }
      }, 100);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to access microphone";

      // Handle specific error types
      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError") {
          setError("Microphone access denied. Please enable microphone permission.");
        } else if (err.name === "NotFoundError") {
          setError("No microphone found. Please connect a microphone.");
        } else {
          setError(errorMessage);
        }
      } else {
        setError(errorMessage);
      }

      onError?.(errorMessage);
      haptics.error();
      cleanup();
    }
  }, [cleanup, minDuration, maxDuration, onStart, onStop, onCancel, onError]);

  // Stop recording
  const stop = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // Cancel recording
  const cancel = useCallback(() => {
    cleanup();
    setIsRecording(false);
    isRecordingRef.current = false;
    setDuration(0);
    setAudioLevel(0);
    setError(null);
    haptics.light();
    onCancel?.();
  }, [cleanup, onCancel]);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    isRecording,
    duration,
    error,
    audioLevel,
    start,
    stop,
    cancel,
  };
}

/**
 * Hook for speech-to-text transcription
 */
export interface UseSpeechToTextOptions {
  /** Language hint (e.g., "zh", "en") */
  language?: string;
  /** Called when transcription starts */
  onStart?: () => void;
  /** Called when transcription completes */
  onComplete?: (text: string) => void;
  /** Called when an error occurs */
  onError?: (error: string) => void;
}

export interface UseSpeechToTextReturn {
  /** Whether transcription is in progress */
  isTranscribing: boolean;
  /** Transcription result */
  transcription: string | null;
  /** Error message if any */
  error: string | null;
  /** Transcribe audio blob */
  transcribe: (audioBlob: Blob) => Promise<string | null>;
  /** Reset state */
  reset: () => void;
}

export function useSpeechToText(options: UseSpeechToTextOptions = {}): UseSpeechToTextReturn {
  const { language, onStart, onComplete, onError } = options;

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcription, setTranscription] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const transcribe = useCallback(
    async (audioBlob: Blob): Promise<string | null> => {
      try {
        setIsTranscribing(true);
        setError(null);
        onStart?.();

        // Determine file extension from blob type
        const mimeToExt: Record<string, string> = {
          "audio/webm": "webm",
          "audio/webm;codecs=opus": "webm",
          "audio/mp4": "mp4",
          "audio/ogg": "ogg",
          "audio/ogg;codecs=opus": "ogg",
          "audio/wav": "wav",
          "audio/mpeg": "mp3",
          "audio/mp3": "mp3",
        };
        const ext = mimeToExt[audioBlob.type] || "webm";
        const filename = `recording.${ext}`;

        // Create form data
        const formData = new FormData();
        formData.append("audio", audioBlob, filename);
        if (language) {
          formData.append("language", language);
        }

        // Call transcription API
        const response = await fetch("/api/speech/transcribe", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || "Transcription failed");
        }

        const data = await response.json();
        const text = data.text || "";

        setTranscription(text);
        onComplete?.(text);
        return text;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Transcription failed";
        setError(errorMessage);
        onError?.(errorMessage);
        return null;
      } finally {
        setIsTranscribing(false);
      }
    },
    [language, onStart, onComplete, onError]
  );

  const reset = useCallback(() => {
    setIsTranscribing(false);
    setTranscription(null);
    setError(null);
  }, []);

  return {
    isTranscribing,
    transcription,
    error,
    transcribe,
    reset,
  };
}
