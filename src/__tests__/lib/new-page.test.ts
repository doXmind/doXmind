import { describe, expect, it, vi } from "vitest";
import { createPageForContext, type NewPageContext } from "@/lib/new-page";

function context(openTarget: NewPageContext["openTarget"], rootPath: string | null) {
  return {
    openTarget,
    rootPath,
    nextUntitledName: () => "Untitled-1.md",
    createFile: vi.fn(async () => "disk-page"),
    createTransientFile: vi.fn(() => "transient-page"),
  } satisfies NewPageContext;
}

describe("New Page context", () => {
  it("creates a real file only inside an opened folder", async () => {
    const input = context("folder", "/workspace");

    await expect(createPageForContext(input)).resolves.toBe("disk-page");
    expect(input.createFile).toHaveBeenCalledWith("Untitled-1.md", "", null);
    expect(input.createTransientFile).not.toHaveBeenCalled();
  });

  it.each([
    ["none", null],
    ["file", "/workspace"],
    ["folder", null],
  ] as const)("creates a transient Page for %s context", async (openTarget, rootPath) => {
    const input = context(openTarget, rootPath);

    await expect(createPageForContext(input)).resolves.toBe("transient-page");
    expect(input.createFile).not.toHaveBeenCalled();
    expect(input.createTransientFile).toHaveBeenCalledWith("Untitled-1.md");
  });
});
