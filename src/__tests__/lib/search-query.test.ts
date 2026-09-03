import { describe, expect, it } from "vitest";

import { hasStructuredCriteria, parseSearchQuery, tokenizeSearchQuery } from "@/lib/search-query";

const shape = (query: string) =>
  parseSearchQuery(query).criteria.groups.map((group) =>
    group.map((term) => `${term.negated ? "-" : ""}${term.field}:${term.value}`)
  );

describe("parseSearchQuery", () => {
  it("treats a bare query as one content term, exactly as before operators existed", () => {
    expect(shape("needle")).toEqual([["content:needle"]]);
    expect(parseSearchQuery("needle").text).toBe("needle");
    expect(parseSearchQuery("needle").error).toBeNull();
  });

  it("ANDs separate terms and reads each field prefix", () => {
    expect(shape("file:plan path:Notes roadmap")).toEqual([
      ["file:plan"],
      ["path:notes"],
      ["content:roadmap"],
    ]);
  });

  it("negates a term with a leading dash", () => {
    expect(shape("roadmap -path:draft")).toEqual([["content:roadmap"], ["-path:draft"]]);
  });

  it("keeps a quoted phrase together and strips its quotes", () => {
    expect(shape('"two words" alpha')).toEqual([["content:two words"], ["content:alpha"]]);
  });

  it("makes OR looser than the implicit AND", () => {
    // `a OR b c` is `(a OR b) AND c`.
    expect(shape("alpha OR beta gamma")).toEqual([
      ["content:alpha", "content:beta"],
      ["content:gamma"],
    ]);
  });

  it("compiles a regex term and reports a broken one instead of searching for it", () => {
    const ok = parseSearchQuery("/ne+dle/i");
    expect(ok.error).toBeNull();
    expect(ok.criteria.groups[0][0].regex?.test("NEEDLE")).toBe(true);

    expect(parseSearchQuery("/ne(+dle/").error).not.toBeNull();
  });

  it("refuses regex flags that would make matching stateful or expensive", () => {
    expect(parseSearchQuery("/needle/g").error).toMatch(/Unsupported regex flags/);
  });

  it("leaves an unsupported operator as literal text rather than failing", () => {
    // `line:` is not implemented; searching for the literal text is better than an error.
    expect(shape("line:12")).toEqual([["content:line:12"]]);
    expect(shape("tag:project")).toEqual([["content:tag:project"]]);
  });

  it("only highlights the plain positive words", () => {
    expect(parseSearchQuery("path:project -alpha needle").text).toBe("needle");
  });
});

describe("tokenizeSearchQuery", () => {
  it("splits on whitespace but keeps quoted and regex runs whole", () => {
    expect(tokenizeSearchQuery('a "b c" /d e/i f')).toEqual(["a", '"b c"', "/d e/i", "f"]);
  });

  it("does not treat a mid-word slash as a regex", () => {
    expect(tokenizeSearchQuery("path:Notes/Sub alpha")).toEqual(["path:Notes/Sub", "alpha"]);
  });
});

describe("hasStructuredCriteria", () => {
  it("is false for bare words, so they still obey the minimum query length", () => {
    expect(hasStructuredCriteria(parseSearchQuery("n").criteria)).toBe(false);
    expect(hasStructuredCriteria(parseSearchQuery("needle here").criteria)).toBe(false);
  });

  it("is true for anything a plain word could not say", () => {
    for (const query of ["file:x", "-alpha", "/a/", "path:n"]) {
      expect(hasStructuredCriteria(parseSearchQuery(query).criteria)).toBe(true);
    }
  });
});
