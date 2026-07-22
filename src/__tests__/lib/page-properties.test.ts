import { describe, expect, it } from "vitest";

import {
  diffPageProperties,
  isEditablePagePropertyKey,
  isPagePropertyValue,
  pagePropertiesFromMeta,
  parsePagePropertyInput,
} from "@/lib/page-properties";

describe("Page properties", () => {
  it("projects only string arrays from Page frontmatter metadata", () => {
    expect(
      pagePropertiesFromMeta({
        id: "page-1",
        tags: ["local", " knowledge "],
        aliases: "not-an-array" as unknown as string[],
      })
    ).toEqual({ tags: ["local", "knowledge"], aliases: [], custom: {} });
  });

  it("normalizes comma/newline input without persisting blanks or duplicates", () => {
    expect(parsePagePropertyInput(" local, knowledge\nlocal\n  ")).toEqual(["local", "knowledge"]);
  });

  it("patches only changed keys and uses null to remove an existing property", () => {
    expect(
      diffPageProperties(
        { tags: ["local"], aliases: ["Home"], custom: { status: "idea", priority: 1 } },
        {
          tags: ["local", "markdown"],
          aliases: [],
          custom: { status: "doing", published: false },
        }
      )
    ).toEqual({
      tags: ["local", "markdown"],
      aliases: null,
      priority: null,
      published: false,
      status: "doing",
    });
    expect(
      diffPageProperties(
        { tags: ["local"], aliases: ["Home"], custom: { topics: ["one"] } },
        { tags: ["local"], aliases: ["Home"], custom: { topics: ["one"] } }
      )
    ).toEqual({});
  });

  it("projects only portable custom properties and keeps system fields read-only", () => {
    expect(
      pagePropertiesFromMeta({
        id: "page-1",
        title: "System title",
        status: "doing",
        priority: 2,
        published: false,
        topics: ["local", "markdown"],
        invalidNumber: Number.NaN,
        object: { nested: true },
        mixed: ["one", 2],
        "bad key": "ignored",
      })
    ).toEqual({
      tags: [],
      aliases: [],
      custom: {
        priority: 2,
        published: false,
        status: "doing",
        topics: ["local", "markdown"],
      },
    });
    expect(isEditablePagePropertyKey("workflow.status")).toBe(true);
    expect(isEditablePagePropertyKey("id")).toBe(false);
    expect(isEditablePagePropertyKey("bad key")).toBe(false);
    expect(isPagePropertyValue(["one", "two"])).toBe(true);
    expect(isPagePropertyValue(["one", 2])).toBe(false);
  });
});
