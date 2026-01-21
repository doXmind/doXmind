/**
 * Stream Event Types
 *
 * Strongly-typed discriminated union for SSE chat stream events.
 * Each event type has its own interface with required fields.
 */

import type { EditOperation, ToolCall } from "./index";

// =============================================================================
// Todo Item (from AI agent)
// =============================================================================

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

// =============================================================================
// Stream Event Types (Discriminated Union)
// =============================================================================

/** Text content from AI response */
export interface TextEvent {
  type: "text";
  content: string;
}

/** AI starts thinking (extended thinking mode) */
export interface ThinkingStartEvent {
  type: "thinking_start";
}

/** AI thinking content (extended thinking mode) */
export interface ThinkingEvent {
  type: "thinking";
  content: string;
}

/** AI finishes thinking */
export interface ThinkingEndEvent {
  type: "thinking_end";
}

/** Tool execution starts */
export interface ToolStartEvent {
  type: "tool_start";
  tool: string;
  tool_id?: string;
}

/** Tool input being streamed */
export interface ToolInputDeltaEvent {
  type: "tool_input_delta";
  delta: string;
}

/** Tool execution completes */
export interface ToolEndEvent {
  type: "tool_end";
  tool: string;
  tool_id?: string;
  output?: string;
  success?: boolean;
}

/** Single edit operation */
export interface EditEvent {
  type: "edit";
  edit: EditOperation;
}

/** Batch of edit operations */
export interface EditsBatchEvent {
  type: "edits_batch";
  edits: EditOperation[];
}

/** Stream summary (sent at end) */
export interface SummaryEvent {
  type: "summary";
  content: string;
  thinking?: string | null;
  toolCalls?: ToolCall[] | null;
  edits?: EditOperation[] | null;
  model: string;
}

/** Error event */
export interface ErrorEvent {
  type: "error";
  content: string;
}

/** Server-side tool (web_search, web_fetch) starts */
export interface ServerToolStartEvent {
  type: "server_tool_start";
  tool: string;
  tool_id?: string;
}

/** Web search results */
export interface WebSearchResultEvent {
  type: "web_search_result";
  tool_id?: string;
  results?: Array<{
    title?: string;
    url?: string;
    snippet?: string;
  }>;
}

/** Web fetch result */
export interface WebFetchResultEvent {
  type: "web_fetch_result";
  tool_id?: string;
  url?: string;
}

/** Todo list update from AI */
export interface TodoUpdateEvent {
  type: "todo_update";
  todos: TodoItem[];
}

// =============================================================================
// Union Type
// =============================================================================

/**
 * Discriminated union of all possible chat stream events.
 * Use `event.type` to narrow the type.
 *
 * @example
 * ```typescript
 * function handleEvent(event: ChatStreamEvent) {
 *   switch (event.type) {
 *     case "text":
 *       // event is TextEvent, event.content is string
 *       console.log(event.content);
 *       break;
 *     case "tool_start":
 *       // event is ToolStartEvent, event.tool is string
 *       console.log(`Starting tool: ${event.tool}`);
 *       break;
 *     // ... handle other event types
 *   }
 * }
 * ```
 */
export type ChatStreamEvent =
  | TextEvent
  | ThinkingStartEvent
  | ThinkingEvent
  | ThinkingEndEvent
  | ToolStartEvent
  | ToolInputDeltaEvent
  | ToolEndEvent
  | EditEvent
  | EditsBatchEvent
  | SummaryEvent
  | ErrorEvent
  | ServerToolStartEvent
  | WebSearchResultEvent
  | WebFetchResultEvent
  | TodoUpdateEvent;

// =============================================================================
// Type Guards
// =============================================================================

export function isTextEvent(event: ChatStreamEvent): event is TextEvent {
  return event.type === "text";
}

export function isThinkingEvent(event: ChatStreamEvent): event is ThinkingEvent {
  return event.type === "thinking";
}

export function isToolStartEvent(event: ChatStreamEvent): event is ToolStartEvent {
  return event.type === "tool_start";
}

export function isToolEndEvent(event: ChatStreamEvent): event is ToolEndEvent {
  return event.type === "tool_end";
}

export function isEditsBatchEvent(event: ChatStreamEvent): event is EditsBatchEvent {
  return event.type === "edits_batch";
}

export function isSummaryEvent(event: ChatStreamEvent): event is SummaryEvent {
  return event.type === "summary";
}

export function isErrorEvent(event: ChatStreamEvent): event is ErrorEvent {
  return event.type === "error";
}

export function isTodoUpdateEvent(event: ChatStreamEvent): event is TodoUpdateEvent {
  return event.type === "todo_update";
}
