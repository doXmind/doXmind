/**
 * Lightweight type-safe event bus for cross-store and cross-page communication.
 *
 * Usage:
 *   import { eventBus } from "@/lib/events";
 *   eventBus.emit("storage:changed");
 *   const unsub = eventBus.on("database:deleted", ({ databaseId }) => { ... });
 */

type EventMap = {
  "storage:changed": void;
  "database:deleted": { databaseId: string };
};

type Callback<T> = T extends void ? () => void : (data: T) => void;

class EventBus {
  private listeners = new Map<string, Set<Callback<never>>>();

  on<K extends keyof EventMap>(event: K, callback: Callback<EventMap[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as Callback<never>);
    return () => this.off(event, callback);
  }

  off<K extends keyof EventMap>(event: K, callback: Callback<EventMap[K]>): void {
    this.listeners.get(event)?.delete(callback as Callback<never>);
  }

  emit<K extends keyof EventMap>(
    ...args: EventMap[K] extends void ? [event: K] : [event: K, data: EventMap[K]]
  ): void {
    const [event, data] = args;
    this.listeners.get(event)?.forEach((cb) => {
      (cb as (data?: unknown) => void)(data);
    });
  }
}

export const eventBus = new EventBus();
