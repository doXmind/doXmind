/**
 * Inline AI copilot stub — kept as an empty component.
 *
 * The original implementation imported a markdown renderer from
 * `@/components/comments/markdown-content`, which lived in the cloud-only
 * comments subtree we just removed. The actual inline-AI bubble is wired up
 * directly via `useInlineAI` in the editor, so this overlay is non-essential.
 */

export interface InlineAICopilotProps {
  fileId: string;
  isDemoMode?: boolean;
}

export function InlineAICopilot(_props: InlineAICopilotProps) {
  return null;
}
