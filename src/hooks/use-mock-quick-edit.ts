"use client";

import { useState, useCallback, useRef } from "react";

/**
 * Mock quick edit transformations for demo mode.
 * Maps action types to transformation functions.
 */
const MOCK_TRANSFORMATIONS: Record<string, (text: string) => string> = {
  // Grammar fix - simple corrections
  "fix-grammar": (text) => {
    return text
      .replace(/\bi\b/g, "I")
      .replace(/dont/gi, "don't")
      .replace(/cant/gi, "can't")
      .replace(/wont/gi, "won't")
      .replace(/its a/gi, "it's a")
      .replace(/your a/gi, "you're a")
      .replace(/there going/gi, "they're going")
      .replace(/\s{2,}/g, " ")
      .trim();
  },

  // Improve writing - more polished
  improve: (text) => {
    const improvements: [RegExp, string][] = [
      [/very good/gi, "excellent"],
      [/very bad/gi, "terrible"],
      [/a lot of/gi, "numerous"],
      [/because of/gi, "due to"],
      [/in order to/gi, "to"],
      [/at this point in time/gi, "currently"],
      [/make sure/gi, "ensure"],
      [/help users/gi, "empower users"],
      [/build an?/gi, "develop a"],
    ];
    let result = text;
    for (const [pattern, replacement] of improvements) {
      result = result.replace(pattern, replacement);
    }
    return result;
  },

  // Simplify - shorter, clearer
  simplify: (text) => {
    const simplifications: [RegExp, string][] = [
      [/utilize/gi, "use"],
      [/implement/gi, "add"],
      [/functionality/gi, "feature"],
      [/methodology/gi, "method"],
      [/approximately/gi, "about"],
      [/subsequently/gi, "then"],
      [/in the event that/gi, "if"],
      [/with regard to/gi, "about"],
      [/at the present time/gi, "now"],
    ];
    let result = text;
    for (const [pattern, replacement] of simplifications) {
      result = result.replace(pattern, replacement);
    }
    return result;
  },

  // Make longer - expand with details
  expand: (text) => {
    const words = text.split(" ");
    if (words.length < 5) {
      return `${text}. This point is particularly noteworthy as it highlights the key aspects that we should consider carefully.`;
    }
    return `${text} Furthermore, this aspect deserves additional attention as it plays a crucial role in the overall context.`;
  },

  // Make shorter - condense
  shorten: (text) => {
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim());
    if (sentences.length <= 1) {
      const words = text.split(" ");
      return words.slice(0, Math.ceil(words.length * 0.7)).join(" ");
    }
    return sentences.slice(0, Math.ceil(sentences.length * 0.6)).join(". ") + ".";
  },

  // Tone: Professional
  professional: (text) => {
    return text
      .replace(/hey/gi, "Hello")
      .replace(/gonna/gi, "going to")
      .replace(/wanna/gi, "want to")
      .replace(/gotta/gi, "have to")
      .replace(/yeah/gi, "yes")
      .replace(/nope/gi, "no")
      .replace(/awesome/gi, "excellent")
      .replace(/cool/gi, "satisfactory");
  },

  // Tone: Casual
  casual: (text) => {
    return text
      .replace(/Hello/g, "Hey")
      .replace(/Therefore/gi, "So")
      .replace(/However/gi, "But")
      .replace(/Additionally/gi, "Also")
      .replace(/Furthermore/gi, "Plus")
      .replace(/excellent/gi, "awesome")
      .replace(/satisfactory/gi, "cool");
  },

  // Tone: Friendly
  friendly: (text) => {
    const friendlyStart = text.charAt(0).toUpperCase() + text.slice(1);
    return `${friendlyStart} 😊`;
  },

  // Tone: Confident
  confident: (text) => {
    return text
      .replace(/I think/gi, "I know")
      .replace(/maybe/gi, "certainly")
      .replace(/perhaps/gi, "definitely")
      .replace(/might/gi, "will")
      .replace(/could be/gi, "is")
      .replace(/seems like/gi, "is clearly");
  },

  // Translate to English (mock - just returns as-is for demo)
  "translate-en": (text) => text,

  // Translate to Chinese (mock)
  "translate-zh": (text) => {
    // For demo, return a simple Chinese translation hint
    if (text.length < 20) {
      return "这是一个演示翻译";
    }
    return "这是一段示例中文翻译。在实际使用中，AI会提供准确的翻译结果。";
  },

  // Translate to Spanish (mock)
  "translate-es": (text) => {
    if (text.length < 20) {
      return "Esta es una traducción de demostración";
    }
    return "Este es un ejemplo de traducción al español. En uso real, la IA proporcionará traducciones precisas.";
  },

  // Translate to French (mock)
  "translate-fr": (text) => {
    if (text.length < 20) {
      return "Ceci est une traduction de démonstration";
    }
    return "Ceci est un exemple de traduction en français. En utilisation réelle, l'IA fournira des traductions précises.";
  },

  // Translate to German (mock)
  "translate-de": (text) => {
    if (text.length < 20) {
      return "Dies ist eine Demo-Übersetzung";
    }
    return "Dies ist ein Beispiel für eine deutsche Übersetzung. Bei der tatsächlichen Verwendung liefert die KI genaue Übersetzungen.";
  },

  // Translate to Japanese (mock)
  "translate-ja": (text) => {
    if (text.length < 20) {
      return "これはデモ翻訳です";
    }
    return "これは日本語への翻訳例です。実際の使用では、AIが正確な翻訳を提供します。";
  },
};

/**
 * Mock quick edit hook for demo mode.
 * Simulates AI editing without making API calls.
 */
export function useMockQuickEdit() {
  const [isEditing, setIsEditing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const abortRef = useRef(false);

  const edit = useCallback(async (text: string, action: string) => {
    setIsEditing(true);
    setResult(null);
    abortRef.current = false;

    // Get the transformation function
    const transform = MOCK_TRANSFORMATIONS[action];
    if (!transform) {
      // Default: return original text with minor cleanup
      setResult(text.trim());
      setIsEditing(false);
      return text.trim();
    }

    // Simulate processing delay (300-800ms)
    const delay = 300 + Math.random() * 500;
    await new Promise((r) => setTimeout(r, delay));

    if (abortRef.current) {
      setIsEditing(false);
      return null;
    }

    // Apply the transformation
    const transformed = transform(text);
    setResult(transformed);
    setIsEditing(false);
    return transformed;
  }, []);

  const cancel = useCallback(() => {
    abortRef.current = true;
    setIsEditing(false);
  }, []);

  return {
    edit,
    cancel,
    isEditing,
    result,
  };
}
