"use client";

import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api";
import { processSSEStream, createStreamController, isAbortError } from "@/lib/streaming";

export interface KBSource {
  file_id: string;
  file_name: string;
  score: number;
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

  const streamController = useRef(createStreamController());

  const ask = useCallback(
    async (q: string) => {
      // Abort any existing stream
      streamController.current.abort();
      const signal = streamController.current.start();

      // Replace previous answer
      setQuestion(q);
      setAnswer("");
      setSources([]);
      setActiveTool(null);
      setError(null);
      setIsAnswering(true);

      try {
        const response = await api.kbAgentStream(q, conversationId, signal);

        await processSSEStream<KBAgentEvent>(
          response,
          (event) => {
            switch (event.type) {
              case "text":
                setAnswer((prev) => prev + (event.content || ""));
                break;
              case "tool_start":
                setActiveTool(event.tool || null);
                break;
              case "tool_end":
                setActiveTool(null);
                break;
              case "sources":
                if (event.sources) setSources(event.sources);
                break;
              case "summary":
                if (event.conversationId) setConversationId(event.conversationId);
                break;
              case "error":
                setError(event.content || "An error occurred");
                break;
              case "done":
              case "heartbeat":
                break;
            }
          },
          () => {
            setIsAnswering(false);
            setActiveTool(null);
          }
        );
      } catch (err) {
        if (!isAbortError(err)) {
          setError(err instanceof Error ? err.message : "Failed to get answer");
          setIsAnswering(false);
        }
      }
    },
    [conversationId]
  );

  const stop = useCallback(() => {
    streamController.current.abort();
    setIsAnswering(false);
    setActiveTool(null);
  }, []);

  const clear = useCallback(() => {
    streamController.current.abort();
    setIsAnswering(false);
    setQuestion("");
    setAnswer("");
    setSources([]);
    setActiveTool(null);
    setError(null);
    setConversationId(null);
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
  };
}
