"use client";

import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api";
import { processSSEStream, createStreamController, isAbortError } from "@/lib/streaming";
import { telemetry } from "@/lib/telemetry";

export interface KBSource {
  file_id: string;
  file_name: string;
  score: number;
}

export interface KBTurn {
  question: string;
  answer: string;
  sources: KBSource[];
}

interface KBAgentEvent {
  type: string;
  content?: string;
  tool?: string;
  tool_id?: string;
  output?: string;
  success?: boolean;
  sources?: KBSource[];
  conversationId?: string;
}

export function useKBAgent() {
  const [isAnswering, setIsAnswering] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<KBSource[]>([]);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<KBTurn[]>([]);

  // Refs to track current values for saving to history
  const questionRef = useRef("");
  const answerRef = useRef("");
  const sourcesRef = useRef<KBSource[]>([]);
  const turnIndexRef = useRef(0);

  // Telemetry refs
  const startTimeRef = useRef(0);
  const firstTokenTimeRef = useRef<number | null>(null);
  const searchFilesCountRef = useRef(0);
  const readFileSectionsCountRef = useRef(0);
  const conversationStartTimeRef = useRef<number | null>(null);
  const answerCompleteTimeRef = useRef<number | null>(null);

  const streamController = useRef(createStreamController());

  const ask = useCallback(
    async (q: string) => {
      // Abort any existing stream
      streamController.current.abort();
      const signal = streamController.current.start();

      // Save previous completed turn to history
      if (questionRef.current && answerRef.current) {
        setHistory((prev) => [
          ...prev,
          { question: questionRef.current, answer: answerRef.current, sources: sourcesRef.current },
        ]);
        turnIndexRef.current++;
      }

      // Reset for new turn
      questionRef.current = q;
      answerRef.current = "";
      sourcesRef.current = [];
      firstTokenTimeRef.current = null;
      searchFilesCountRef.current = 0;
      readFileSectionsCountRef.current = 0;
      answerCompleteTimeRef.current = null;
      if (conversationStartTimeRef.current === null) {
        conversationStartTimeRef.current = Date.now();
      }
      setQuestion(q);
      setAnswer("");
      setSources([]);
      setActiveTool(null);
      setError(null);
      setIsAnswering(true);

      const startTime = Date.now();
      startTimeRef.current = startTime;

      try {
        const response = await api.kbAgentStream(q, conversationId, signal);

        await processSSEStream<KBAgentEvent>(
          response,
          (event) => {
            switch (event.type) {
              case "text": {
                const chunk = event.content || "";
                if (firstTokenTimeRef.current === null) {
                  firstTokenTimeRef.current = Date.now();
                  telemetry.trackFeature("kb_search", "completed", undefined, {
                    event: "first_token",
                    latency_ms: Date.now() - startTime,
                    turn_index: turnIndexRef.current,
                  });
                }
                answerRef.current += chunk;
                setAnswer((prev) => prev + chunk);
                break;
              }
              case "tool_start":
                if (event.tool === "search_files") searchFilesCountRef.current++;
                if (event.tool === "read_file_sections") readFileSectionsCountRef.current++;
                setActiveTool(event.tool || null);
                break;
              case "tool_end":
                setActiveTool(null);
                break;
              case "sources":
                if (event.sources) {
                  sourcesRef.current = event.sources;
                  setSources(event.sources);
                }
                break;
              case "summary":
                if (event.conversationId) setConversationId(event.conversationId);
                break;
              case "error":
                setError(event.content || "An error occurred");
                telemetry.trackFeature("kb_search", "error", Date.now() - startTime, {
                  turn_index: turnIndexRef.current,
                });
                break;
              case "done":
              case "heartbeat":
                break;
            }
          },
          () => {
            setIsAnswering(false);
            setActiveTool(null);
            answerCompleteTimeRef.current = Date.now();
            telemetry.trackFeature("kb_search", "completed", Date.now() - startTime, {
              turn_index: turnIndexRef.current,
              tool_calls: {
                search_files: searchFilesCountRef.current,
                read_file_sections: readFileSectionsCountRef.current,
              },
              sources_count: sourcesRef.current.length,
              answer_length: answerRef.current.length,
            });
          }
        );
      } catch (err) {
        if (!isAbortError(err)) {
          setError(err instanceof Error ? err.message : "Failed to get answer");
          setIsAnswering(false);
          telemetry.trackFeature("kb_search", "error", Date.now() - startTime, {
            turn_index: turnIndexRef.current,
          });
        } else {
          telemetry.trackFeature("kb_search", "abandoned", Date.now() - startTime, {
            turn_index: turnIndexRef.current,
          });
        }
      }
    },
    [conversationId]
  );

  const stop = useCallback(() => {
    const duration = startTimeRef.current ? Date.now() - startTimeRef.current : undefined;
    telemetry.trackFeature("kb_search", "abandoned", duration, {
      event: "stop_clicked",
      turn_index: turnIndexRef.current,
      answer_length: answerRef.current.length,
      had_sources: sourcesRef.current.length > 0,
      tool_calls: {
        search_files: searchFilesCountRef.current,
        read_file_sections: readFileSectionsCountRef.current,
      },
    });
    streamController.current.abort();
    setIsAnswering(false);
    setActiveTool(null);
  }, []);

  const clear = useCallback(() => {
    // Track conversation end with total follow-ups
    if (turnIndexRef.current > 0) {
      telemetry.trackFeature("kb_search", "completed", undefined, {
        event: "conversation_end",
        total_turns: turnIndexRef.current + 1,
        follow_ups: turnIndexRef.current,
        session_duration_ms: conversationStartTimeRef.current
          ? Date.now() - conversationStartTimeRef.current
          : undefined,
      });
    }

    streamController.current.abort();
    setIsAnswering(false);
    setQuestion("");
    setAnswer("");
    setSources([]);
    setActiveTool(null);
    setError(null);
    setConversationId(null);
    setHistory([]);
    questionRef.current = "";
    answerRef.current = "";
    sourcesRef.current = [];
    turnIndexRef.current = 0;
    conversationStartTimeRef.current = null;
  }, []);

  return {
    ask,
    stop,
    clear,
    question,
    answer,
    sources,
    activeTool,
    isAnswering,
    conversationId,
    error,
    history,
    lastAnswerCompletedAt: answerCompleteTimeRef.current,
  };
}
