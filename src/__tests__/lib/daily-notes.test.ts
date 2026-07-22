import { describe, expect, it, vi } from "vitest";

import { dailyNoteKey, openOrCreateDailyNote, type DailyNoteWorkspace } from "@/lib/daily-notes";
import type { FileItem } from "@/types";

function folder(id = "daily-folder"): FileItem {
  return {
    id,
    name: "Daily Notes",
    content: "",
    isFolder: true,
    parentId: null,
    position: 0,
    isFavorite: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    wordCount: 0,
    preview: "",
  };
}

function page(parentId = "daily-folder"): FileItem {
  return {
    ...folder("today"),
    name: "2026-07-22.md",
    isFolder: false,
    parentId,
    documentType: "markdown",
  };
}

function workspace(files: FileItem[] = []): DailyNoteWorkspace {
  return {
    files,
    createFolder: vi.fn().mockResolvedValue("daily-folder"),
    createFile: vi.fn().mockResolvedValue("today"),
    requestCurrentFile: vi.fn().mockResolvedValue(true),
    prepareNavigation: vi.fn().mockResolvedValue(true),
  };
}

describe("Daily Notes", () => {
  it("derives an ISO local-calendar key without UTC date drift", () => {
    expect(dailyNoteKey(new Date(2026, 6, 22, 23, 59))).toBe("2026-07-22");
  });

  it("opens today's ordinary Markdown Page without writing", async () => {
    const services = workspace([folder(), page()]);

    await expect(openOrCreateDailyNote(services, new Date(2026, 6, 22))).resolves.toBe("today");
    expect(services.prepareNavigation).toHaveBeenCalledOnce();
    expect(services.requestCurrentFile).toHaveBeenCalledWith("today");
    expect(services.createFolder).not.toHaveBeenCalled();
    expect(services.createFile).not.toHaveBeenCalled();
  });

  it("recognizes the existing Page when the browser projection strips its extension", async () => {
    const existing = {
      ...page(),
      name: "2026-07-22",
      storageHandle: {
        mode: "disk" as const,
        id: "today",
        kind: "document" as const,
        documentType: "markdown" as const,
        path: "Daily Notes/2026-07-22.md",
        relPath: "Daily Notes/2026-07-22.md",
      },
    };
    const services = workspace([folder(), existing]);

    await expect(openOrCreateDailyNote(services, new Date(2026, 6, 22))).resolves.toBe("today");
    expect(services.requestCurrentFile).toHaveBeenCalledWith("today");
    expect(services.createFile).not.toHaveBeenCalled();
  });

  it("creates only a normal folder and Markdown Page with portable source", async () => {
    const services = workspace();

    await expect(openOrCreateDailyNote(services, new Date(2026, 6, 22))).resolves.toBe("today");
    expect(services.createFolder).toHaveBeenCalledWith("Daily Notes", null, { silent: true });
    expect(services.createFile).toHaveBeenCalledWith(
      "2026-07-22.md",
      "# 2026-07-22\n\n",
      "daily-folder",
      { date: "2026-07-22", tags: ["daily-note"] }
    );
  });

  it("does not create or navigate when the active Page cannot be saved", async () => {
    const services = workspace();
    vi.mocked(services.prepareNavigation).mockResolvedValue(false);

    await expect(openOrCreateDailyNote(services, new Date(2026, 6, 22))).resolves.toBeNull();
    expect(services.createFolder).not.toHaveBeenCalled();
    expect(services.createFile).not.toHaveBeenCalled();
    expect(services.requestCurrentFile).not.toHaveBeenCalled();
  });
});
