import type katex from "katex";

let katexPromise: Promise<typeof katex> | null = null;

export function loadKatex(): Promise<typeof katex> {
  if (!katexPromise) {
    katexPromise = import("katex").then((m) => m.default);
  }
  return katexPromise;
}
