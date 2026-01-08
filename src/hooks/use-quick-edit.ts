"use client";

import { useState, useCallback } from "react";

export function useQuickEdit() {
  const [isEditing, setIsEditing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const edit = useCallback(async (text: string, action: string) => {
    setIsEditing(true);
    setResult(null);

    try {
      const response = await fetch("/api/edit/quick", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text, action }),
      });

      if (!response.ok) {
        throw new Error("Failed to edit text");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body");
      }

      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") {
              break;
            }

            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                fullText += parsed.text;
              }
            } catch {
              // Ignore parsing errors
            }
          }
        }
      }

      setResult(fullText);
      return fullText;
    } catch (error) {
      console.error("Quick edit error:", error);
      setResult(null);
      return null;
    } finally {
      setIsEditing(false);
    }
  }, []);

  return {
    edit,
    isEditing,
    result,
  };
}
