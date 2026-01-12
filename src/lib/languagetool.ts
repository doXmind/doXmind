/**
 * LanguageTool API Client
 *
 * Provides spell checking and grammar checking via LanguageTool's public API.
 * Supports auto language detection and multiple languages.
 */

const LANGUAGETOOL_API = "https://api.languagetool.org/v2/check";

export interface LanguageToolMatch {
  message: string;
  shortMessage: string;
  offset: number;
  length: number;
  replacements: Array<{ value: string }>;
  rule: {
    id: string;
    category: { id: string; name: string };
  };
  context: {
    text: string;
    offset: number;
    length: number;
  };
}

export interface LanguageToolResponse {
  language: {
    code: string;
    name: string;
    detectedLanguage?: {
      code: string;
      name: string;
      confidence: number;
    };
  };
  matches: LanguageToolMatch[];
}

/**
 * Check text for spelling and grammar errors using LanguageTool API.
 *
 * @param text - The text to check
 * @param language - Language code ("auto" for detection, or "en-US", "zh-CN", etc.)
 * @param signal - Optional AbortSignal for cancellation
 * @returns LanguageTool response with matches
 */
export async function checkSpelling(
  text: string,
  language: string = "auto",
  signal?: AbortSignal
): Promise<LanguageToolResponse> {
  const params = new URLSearchParams({
    text,
    language,
    enabledOnly: "false",
  });

  const response = await fetch(LANGUAGETOOL_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params,
    signal,
  });

  if (!response.ok) {
    throw new Error(`LanguageTool API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Simple hash function for caching purposes.
 */
export function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}
