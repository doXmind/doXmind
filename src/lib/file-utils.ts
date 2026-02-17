/**
 * Shared file utility functions used across home page components.
 */

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export function getWordCount(content: string): number {
  const text = stripHtml(content);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

export function formatWordCount(count: number): string {
  if (count === 0) return "Empty";
  if (count < 1000) return `${count} words`;
  return `${(count / 1000).toFixed(1)}k words`;
}

export function getNameWithoutExtension(name: string): string {
  return name.replace(/\.md$/, "");
}
