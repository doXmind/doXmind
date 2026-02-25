/**
 * Quick edit action to chat prompt mappings.
 * Used when quick edit is routed through the chat system.
 */

export const QUICK_EDIT_PROMPTS: Record<string, string> = {
  "fix-grammar":
    "Fix all grammar and spelling errors in the selected text. Keep the original meaning, style, and language intact.",
  improve:
    "Improve the writing quality of the selected text. Make it clearer, more engaging, and better structured while preserving the meaning and language.",
  simplify:
    "Rewrite the selected text using simpler language. Make it easier to understand for a general audience. Keep the same language as the original.",
  expand:
    "Expand the selected text with more details, examples, and explanations. Make it more comprehensive. Keep the same language as the original.",
  shorten:
    "Condense the selected text while keeping key information. Remove redundancy and make it more concise. Keep the same language as the original.",
  professional:
    "Rewrite the selected text in a professional, formal tone suitable for business communication. Keep the same language as the original.",
  casual:
    "Rewrite the selected text in a casual, friendly tone while maintaining clarity. Keep the same language as the original.",
  friendly:
    "Rewrite the selected text in a warm, friendly tone that feels personable and approachable. Keep the same language as the original.",
  confident:
    "Rewrite the selected text in a confident and assertive tone without being aggressive. Keep the same language as the original.",
  "translate-en": "Translate the selected text to English. Preserve the meaning and tone.",
  "translate-zh":
    "Translate the selected text to Chinese (Simplified). Preserve the meaning and tone.",
  "translate-es": "Translate the selected text to Spanish. Preserve the meaning and tone.",
  "translate-fr": "Translate the selected text to French. Preserve the meaning and tone.",
  "translate-de": "Translate the selected text to German. Preserve the meaning and tone.",
  "translate-ja": "Translate the selected text to Japanese. Preserve the meaning and tone.",
};

/** Quick edit action display labels (for chat message badges) */
export const QUICK_EDIT_LABELS: Record<string, string> = {
  "fix-grammar": "Fix Grammar",
  improve: "Improve Writing",
  simplify: "Simplify",
  expand: "Make Longer",
  shorten: "Make Shorter",
  professional: "Professional Tone",
  casual: "Casual Tone",
  friendly: "Friendly Tone",
  confident: "Confident Tone",
  "translate-en": "Translate to English",
  "translate-zh": "Translate to Chinese",
  "translate-es": "Translate to Spanish",
  "translate-fr": "Translate to French",
  "translate-de": "Translate to German",
  "translate-ja": "Translate to Japanese",
};
