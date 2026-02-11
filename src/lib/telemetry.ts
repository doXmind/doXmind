/**
 * Telemetry Service
 *
 * Collects user behavior data for:
 * 1. RLHF training (chosen/rejected pairs)
 * 2. Product analytics (usage statistics)
 *
 * Privacy:
 * - Default enabled, user can opt-out
 * - When disabled, only collects anonymous aggregate stats
 * - No PII is ever collected
 */

import { api } from "./api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Event types for different telemetry categories
export type TelemetryEventType =
  // Diff review events (highest value for RLHF)
  | "diff_hunk_accepted"
  | "diff_hunk_rejected"
  | "diff_all_accepted"
  | "diff_all_rejected"
  // Autocomplete events
  | "autocomplete_shown"
  | "autocomplete_accepted"
  | "autocomplete_dismissed"
  | "autocomplete_partial"
  // Chat feedback events
  | "chat_feedback"
  | "chat_regenerate"
  // KB feedback events
  | "kb_feedback"
  // Edit tracking events
  | "edit_applied"
  | "post_ai_edit"
  | "undo_after_ai"
  // Feature usage events
  | "feature_used"
  | "session_summary";

// Base event interface
interface BaseTelemetryEvent {
  event_type: TelemetryEventType;
  timestamp: number;
  session_id: string;
}

// Diff review event (RLHF core signal)
export interface DiffReviewEvent extends BaseTelemetryEvent {
  event_type:
    | "diff_hunk_accepted"
    | "diff_hunk_rejected"
    | "diff_all_accepted"
    | "diff_all_rejected";
  hunk_id?: string;
  file_id: string;
  // RLHF training data
  original_content: string;
  ai_suggestion: string;
  user_action: "accept" | "reject";
  // Timing analytics
  time_to_decision_ms?: number;
  decision_speed?: DecisionSpeed;
}

// Decision speed classification for analytics
export type DecisionSpeed = "instant" | "quick" | "normal" | "delayed";

/**
 * Classify decision latency into speed categories
 * - instant: < 200ms (reflexive acceptance)
 * - quick: 200-500ms (minimal deliberation)
 * - normal: 500-2000ms (typical reading/evaluation)
 * - delayed: > 2000ms (careful consideration)
 */
function classifyDecisionSpeed(latencyMs: number | undefined): DecisionSpeed | undefined {
  if (latencyMs === undefined) return undefined;
  if (latencyMs < 200) return "instant";
  if (latencyMs < 500) return "quick";
  if (latencyMs < 2000) return "normal";
  return "delayed";
}

// Autocomplete event
export interface AutocompleteEvent extends BaseTelemetryEvent {
  event_type:
    | "autocomplete_shown"
    | "autocomplete_accepted"
    | "autocomplete_dismissed"
    | "autocomplete_partial";
  suggestion_id: string;
  // RLHF training data
  text_before: string;
  suggestion: string;
  user_action: "accept" | "dismiss" | "partial";
  accepted_text?: string;
  // Analytics
  latency_ms?: number;
  trigger_mode: "auto" | "manual";
  decision_speed?: DecisionSpeed;
}

// Chat feedback event
export interface ChatFeedbackEvent extends BaseTelemetryEvent {
  event_type: "chat_feedback" | "chat_regenerate" | "kb_feedback";
  message_id: string;
  conversation_id: string;
  // RLHF training data
  user_prompt: string;
  ai_response: string;
  rating?: "positive" | "negative";
  feedback_text?: string;
  // Context
  file_id?: string;
  model?: string;
  had_tool_calls?: boolean;
  turn_index?: number;
}

// Post-AI edit event (for DPO training)
export interface PostAIEditEvent extends BaseTelemetryEvent {
  event_type: "post_ai_edit";
  original_ai_output: string;
  final_user_content: string;
  edit_delta: string;
  time_to_edit_ms: number;
}

// Undo after AI event (negative signal)
export interface UndoAfterAIEvent extends BaseTelemetryEvent {
  event_type: "undo_after_ai";
  ai_operation_type: "diff_accept" | "autocomplete" | "quick_edit";
  time_to_undo_ms: number;
}

// Feature usage event
export interface FeatureUsedEvent extends BaseTelemetryEvent {
  event_type: "feature_used";
  feature: "chat" | "quick_edit" | "autocomplete" | "kb_search" | "file_search" | "export";
  outcome: "completed" | "abandoned" | "error";
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

// Session summary event (aggregate stats)
export interface SessionSummaryEvent extends BaseTelemetryEvent {
  event_type: "session_summary";
  duration_ms: number;
  messages_sent: number;
  edits_applied: number;
  edits_rejected: number;
  autocomplete_accepts: number;
  autocomplete_dismisses: number;
}

// Edit applied event
export interface EditAppliedEvent extends BaseTelemetryEvent {
  event_type: "edit_applied";
  file_id: string;
  edit_type: "str_replace" | "replace_all";
  success: boolean;
}

// Union type of all events
export type TelemetryEvent =
  | DiffReviewEvent
  | AutocompleteEvent
  | ChatFeedbackEvent
  | PostAIEditEvent
  | UndoAfterAIEvent
  | FeatureUsedEvent
  | SessionSummaryEvent
  | EditAppliedEvent;

// Telemetry settings
export interface TelemetrySettings {
  productImprovementEnabled: boolean;
  collectEditFeedback: boolean;
  collectChatFeedback: boolean;
  collectAutocompleteStats: boolean;
  collectUsageStats: boolean;
}

// Default settings (all enabled)
const DEFAULT_SETTINGS: TelemetrySettings = {
  productImprovementEnabled: true,
  collectEditFeedback: true,
  collectChatFeedback: true,
  collectAutocompleteStats: true,
  collectUsageStats: true,
};

// Configuration
const CONFIG = {
  BATCH_SIZE: 10, // Send events in batches
  FLUSH_INTERVAL: 30000, // Flush every 30 seconds
  MAX_QUEUE_SIZE: 100, // Max events to queue
  STORAGE_KEY: "telemetry_settings",
  SESSION_KEY: "telemetry_session_id",
};

class TelemetryService {
  private eventQueue: TelemetryEvent[] = [];
  private settings: TelemetrySettings = DEFAULT_SETTINGS;
  private sessionId: string;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isInitialized = false;

  constructor() {
    this.sessionId = this.getOrCreateSessionId();
  }

  /**
   * Initialize the telemetry service
   * Should be called once on app startup
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Load settings from localStorage
    this.loadSettings();

    // Start flush timer
    this.startFlushTimer();

    // Flush on page unload
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => {
        this.flush(true);
      });
    }

    this.isInitialized = true;
  }

  /**
   * Get or create a session ID
   */
  private getOrCreateSessionId(): string {
    if (typeof window === "undefined") {
      return crypto.randomUUID();
    }

    let sessionId = sessionStorage.getItem(CONFIG.SESSION_KEY);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem(CONFIG.SESSION_KEY, sessionId);
    }
    return sessionId;
  }

  /**
   * Load settings from localStorage
   */
  private loadSettings(): void {
    if (typeof window === "undefined") return;

    const stored = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (stored) {
      try {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      } catch {
        this.settings = DEFAULT_SETTINGS;
      }
    }
  }

  /**
   * Save settings to localStorage
   */
  private saveSettings(): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(this.settings));
  }

  /**
   * Update telemetry settings
   */
  updateSettings(newSettings: Partial<TelemetrySettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    this.saveSettings();
  }

  /**
   * Get current settings
   */
  getSettings(): TelemetrySettings {
    return { ...this.settings };
  }

  /**
   * Check if a specific type of telemetry is enabled
   */
  private isEnabled(eventType: TelemetryEventType): boolean {
    if (!this.settings.productImprovementEnabled) {
      // Only aggregate stats when disabled
      return eventType === "session_summary" || eventType === "feature_used";
    }

    switch (eventType) {
      case "diff_hunk_accepted":
      case "diff_hunk_rejected":
      case "diff_all_accepted":
      case "diff_all_rejected":
      case "edit_applied":
      case "post_ai_edit":
      case "undo_after_ai":
        return this.settings.collectEditFeedback;

      case "chat_feedback":
      case "chat_regenerate":
      case "kb_feedback":
        return this.settings.collectChatFeedback;

      case "autocomplete_shown":
      case "autocomplete_accepted":
      case "autocomplete_dismissed":
      case "autocomplete_partial":
        return this.settings.collectAutocompleteStats;

      case "feature_used":
      case "session_summary":
        return this.settings.collectUsageStats;

      default:
        return true;
    }
  }

  /**
   * Track a telemetry event
   */
  track<T extends TelemetryEvent>(event: Omit<T, "timestamp" | "session_id">): void {
    if (!this.isEnabled(event.event_type)) {
      return;
    }

    const fullEvent: TelemetryEvent = {
      ...event,
      timestamp: Date.now(),
      session_id: this.sessionId,
    } as T;

    // Strip sensitive content if product improvement is disabled
    if (!this.settings.productImprovementEnabled) {
      this.stripSensitiveContent(fullEvent);
    }

    this.eventQueue.push(fullEvent);

    // Flush if queue is full
    if (this.eventQueue.length >= CONFIG.BATCH_SIZE) {
      this.flush();
    }
  }

  /**
   * Strip sensitive content from events when telemetry is limited
   */
  private stripSensitiveContent(event: TelemetryEvent): void {
    if ("original_content" in event) {
      event.original_content = "[redacted]";
    }
    if ("ai_suggestion" in event) {
      event.ai_suggestion = "[redacted]";
    }
    if ("text_before" in event) {
      event.text_before = "[redacted]";
    }
    if ("suggestion" in event) {
      event.suggestion = "[redacted]";
    }
    if ("user_prompt" in event) {
      event.user_prompt = "[redacted]";
    }
    if ("ai_response" in event) {
      event.ai_response = "[redacted]";
    }
    if ("original_ai_output" in event) {
      event.original_ai_output = "[redacted]";
    }
    if ("final_user_content" in event) {
      event.final_user_content = "[redacted]";
    }
    if ("edit_delta" in event) {
      event.edit_delta = "[redacted]";
    }
    if ("metadata" in event && event.metadata) {
      const m = event.metadata as Record<string, unknown>;
      if ("file_id" in m) m.file_id = "[redacted]";
      if ("file_name" in m) m.file_name = "[redacted]";
    }
  }

  /**
   * Start the periodic flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      this.flush();
    }, CONFIG.FLUSH_INTERVAL);
  }

  /**
   * Stop the flush timer
   */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Flush events to the backend
   */
  async flush(sync = false): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    try {
      if (sync && typeof navigator !== "undefined" && navigator.sendBeacon) {
        // Use sendBeacon for sync flush (page unload)
        const blob = new Blob([JSON.stringify({ events })], {
          type: "application/json",
        });
        navigator.sendBeacon(`${API_BASE}/api/telemetry/events`, blob);
      } else {
        // Use fetch for async flush
        const response = await fetch(`${API_BASE}/api/telemetry/events`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...api.getAuthorizationHeaders(),
          },
          body: JSON.stringify({ events }),
        });
        if (!response.ok) {
          const text = await response.text();
          console.warn(`[Telemetry] Flush failed: ${text}`);
          throw new Error(`HTTP ${response.status}: ${text}`);
        }
      }
    } catch (error) {
      // Re-queue events on failure (up to max size)
      const requeue = [...events, ...this.eventQueue].slice(0, CONFIG.MAX_QUEUE_SIZE);
      this.eventQueue = requeue;
      console.warn("[Telemetry] Failed to flush events:", error);
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopFlushTimer();
    this.flush(true);
  }

  // Convenience methods for common events

  /**
   * Track diff hunk accept/reject
   */
  trackDiffReview(
    data: Omit<DiffReviewEvent, "timestamp" | "session_id" | "decision_speed">
  ): void {
    const decision_speed = classifyDecisionSpeed(data.time_to_decision_ms);
    this.track<DiffReviewEvent>({ ...data, decision_speed });
  }

  /**
   * Track autocomplete interaction
   */
  trackAutocomplete(
    data: Omit<AutocompleteEvent, "timestamp" | "session_id" | "decision_speed">
  ): void {
    const decision_speed = classifyDecisionSpeed(data.latency_ms);
    this.track<AutocompleteEvent>({ ...data, decision_speed });
  }

  /**
   * Track chat feedback
   */
  trackChatFeedback(
    data: Omit<ChatFeedbackEvent, "event_type" | "timestamp" | "session_id"> & {
      event_type: ChatFeedbackEvent["event_type"];
    }
  ): void {
    this.track(data);
  }

  /**
   * Track feature usage
   */
  trackFeature(
    feature: FeatureUsedEvent["feature"],
    outcome: FeatureUsedEvent["outcome"],
    duration_ms?: number,
    metadata?: Record<string, unknown>
  ): void {
    this.track<FeatureUsedEvent>({
      event_type: "feature_used",
      feature,
      outcome,
      duration_ms,
      metadata,
    });
  }
}

// Singleton instance
export const telemetry = new TelemetryService();

// Initialize on module load (client-side only)
if (typeof window !== "undefined") {
  telemetry.initialize();
}
