import { describe, expect, it } from "vitest";
import { compactPath } from "@/components/welcome/stratigraphy";

describe("compactPath (welcome recent rows)", () => {
  it("abbreviates the macOS home directory to ~", () => {
    expect(compactPath("/Users/alex/Documents/notes")).toBe("~/Documents/notes");
  });

  it("middle-ellipsizes deep paths, keeping the meaningful tail", () => {
    expect(
      compactPath(
        "/Users/alex/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/msg/file/2026-07"
      )
    ).toBe("~/Library/…/file/2026-07");
  });

  it("keeps short paths untouched", () => {
    expect(compactPath("/tmp/notes")).toBe("/tmp/notes");
  });

  it("keeps non-home absolute paths rooted", () => {
    expect(compactPath("/Volumes/backup/archive/2026/q3/reports/final")).toBe(
      "/Volumes/backup/…/reports/final"
    );
  });

  it("normalizes Windows separators and abbreviates the profile dir", () => {
    expect(compactPath("C:\\Users\\alex\\Documents\\notes")).toBe("~/Documents/notes");
  });

  it("returns / for the filesystem root", () => {
    expect(compactPath("/")).toBe("/");
  });
});
