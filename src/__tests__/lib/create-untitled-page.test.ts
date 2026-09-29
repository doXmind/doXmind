import { describe, expect, it, vi } from "vitest";

import { createUntitledPage } from "@/lib/create-untitled-page";

describe("createUntitledPage", () => {
  it("retries a stale Untitled name collision in the requested folder", async () => {
    const createFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("document already exists: Notes/Untitled-4.md"))
      .mockResolvedValueOnce("created-page");

    await expect(createUntitledPage(createFile, 4, "folder:Notes")).resolves.toBe("created-page");
    expect(createFile.mock.calls).toEqual([
      ["Untitled-4.md", "", "folder:Notes"],
      ["Untitled-5.md", "", "folder:Notes"],
    ]);
  });

  it("does not retry non-collision failures", async () => {
    const failure = new Error("permission denied");
    const createFile = vi.fn().mockRejectedValue(failure);

    await expect(createUntitledPage(createFile, 1, null)).rejects.toBe(failure);
    expect(createFile).toHaveBeenCalledOnce();
  });
});
