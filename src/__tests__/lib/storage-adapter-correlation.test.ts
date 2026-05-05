import { describe, expect, it, vi } from "vitest";

import { DiskStorageAdapter, type CorrelationReport } from "@/lib/storage";

const baseHandle = {
  mode: "disk" as const,
  id: "doc-1",
  documentType: "markdown" as const,
  path: "/workspace/Notes.md",
};

const meta = { id: "doc-1", title: "Notes", updated: "2026-05-04T12:00:00Z" };

describe("DiskStorageAdapter correlation plumbing", () => {
  it("preserves a populated correlation report on read", async () => {
    const correlation: CorrelationReport = {
      events: [
        {
          kind: "duplicate",
          block_type: "pdf-block",
          id: "abc",
          how_handled: "errored",
          detail: { locations: [{ line: 1 }, { line: 3 }] },
        },
      ],
      blocking: true,
    };
    const invokeMock = vi.fn(async (command: string) => {
      if (command !== "doc_read") throw new Error(`Unexpected command: ${command}`);
      return {
        html: "<p>x</p>",
        markdown: "x",
        meta,
        extras: null,
        source: "sidecar",
        correlation,
      };
    });
    const invoke = invokeMock as unknown as <T>(
      command: string,
      payload: Record<string, unknown>
    ) => Promise<T>;

    const adapter = new DiskStorageAdapter({ root: "/workspace", invoke });
    const content = await adapter.read(baseHandle);

    expect(content.correlation).toEqual(correlation);
  });

  it("normalises an empty correlation report (correlator ran cleanly)", async () => {
    const correlation: CorrelationReport = { events: [], blocking: false };
    const invoke = (async () => ({
      html: "",
      markdown: "",
      meta,
      extras: null,
      source: "empty",
      correlation,
    })) as unknown as <T>(command: string, payload: Record<string, unknown>) => Promise<T>;

    const adapter = new DiskStorageAdapter({ root: "/workspace", invoke });
    const content = await adapter.read(baseHandle);

    expect(content.correlation).toEqual({ events: [], blocking: false });
  });

  it("falls back to null when the wire response omits correlation", async () => {
    const invoke = (async () => ({
      html: "<p>x</p>",
      markdown: "x",
      meta,
      extras: null,
      source: "markdown",
    })) as unknown as <T>(command: string, payload: Record<string, unknown>) => Promise<T>;

    const adapter = new DiskStorageAdapter({ root: "/workspace", invoke });
    const content = await adapter.read(baseHandle);

    expect(content.correlation).toBeNull();
  });
});
