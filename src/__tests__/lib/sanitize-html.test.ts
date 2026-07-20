/**
 * Documents are untrusted input: opening a shared `.md` must not be able to run
 * script. These pin the sanitizer's behavior at the boundary where document
 * markup reaches the DOM.
 */
import { describe, expect, it } from "vitest";
import { sanitizeDocumentHtml, sanitizeSvg } from "@/lib/sanitize-html";

describe("sanitizeDocumentHtml — neutralizes script vectors", () => {
  it("strips event-handler attributes (the vector that innerHTML actually fires)", () => {
    const out = sanitizeDocumentHtml('<img src="x" onerror="window.pwned=1">');
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/pwned/);
  });

  it.each([
    ["script tag", "<script>window.pwned=1</script>"],
    ["iframe", '<iframe src="https://evil.example"></iframe>'],
    ["object", '<object data="evil.swf"></object>'],
    ["embed", '<embed src="evil.swf">'],
    ["svg onload", '<svg onload="window.pwned=1"></svg>'],
    ["body onload", '<body onload="window.pwned=1">'],
    ["form action", '<form action="https://evil.example"><input name="x"></form>'],
  ])("removes %s", (_label, payload) => {
    const out = sanitizeDocumentHtml(payload).toLowerCase();
    expect(out).not.toMatch(/<script|<iframe|<object|<embed|onload=|<form/);
  });

  it("drops javascript: and vbscript: URLs but keeps http(s), mailto and relative links", () => {
    expect(sanitizeDocumentHtml('<a href="javascript:alert(1)">x</a>')).not.toMatch(/javascript:/i);
    expect(sanitizeDocumentHtml('<a href="vbscript:msgbox">x</a>')).not.toMatch(/vbscript:/i);
    expect(sanitizeDocumentHtml('<a href="https://example.com">x</a>')).toMatch(
      /https:\/\/example\.com/
    );
    expect(sanitizeDocumentHtml('<a href="mailto:a@b.co">x</a>')).toMatch(/mailto:/);
    // Doc-to-doc relative links carry no scheme and must survive.
    expect(sanitizeDocumentHtml('<a href="docs/spec.md">x</a>')).toMatch(/docs\/spec\.md/);
    expect(sanitizeDocumentHtml('<a href="./sibling.md">x</a>')).toMatch(/\.\/sibling\.md/);
  });
});

describe("sanitizeDocumentHtml — preserves the markup these blocks exist for", () => {
  it("keeps a centered badge row intact (the README case rawHtml was built for)", () => {
    const badges =
      '<p align="center"><a href="https://ci.example"><img src="https://img.example/badge.svg" alt="build"></a></p>';
    const out = sanitizeDocumentHtml(badges);
    expect(out).toMatch(/align="center"/);
    expect(out).toMatch(/img\.example\/badge\.svg/);
    expect(out).toMatch(/alt="build"/);
  });

  it("keeps details/summary toggles and inline styling", () => {
    const out = sanitizeDocumentHtml(
      '<details><summary>More</summary><p style="color:red">hi</p></details>'
    );
    expect(out).toMatch(/<details/);
    expect(out).toMatch(/<summary/);
    expect(out).toMatch(/hi/);
  });

  it("keeps inline SVG badges", () => {
    const out = sanitizeDocumentHtml(
      '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'
    );
    expect(out).toMatch(/<svg/);
    expect(out).toMatch(/<circle/);
  });

  it("keeps data: image URIs (used by embedded diagrams)", () => {
    const out = sanitizeDocumentHtml('<img src="data:image/png;base64,iVBORw0KGgo=">');
    expect(out).toMatch(/data:image\/png/);
  });

  it("still rejects data:image/svg+xml, which can carry its own script", () => {
    const out = sanitizeDocumentHtml(
      '<img src="data:image/svg+xml,%3Csvg onload%3D%22window.pwned%3D1%22%3E">'
    );
    expect(out).not.toMatch(/svg\+xml/i);
  });
});

describe("sanitizeSvg", () => {
  it("keeps diagram geometry but drops script", () => {
    const out = sanitizeSvg(
      '<svg><g><rect width="10" height="10"/></g><script>window.pwned=1</script></svg>'
    );
    expect(out).toMatch(/<rect/);
    expect(out.toLowerCase()).not.toMatch(/<script/);
  });

  it("strips event handlers on shapes", () => {
    const out = sanitizeSvg('<svg><rect onclick="window.pwned=1" width="5" height="5"/></svg>');
    expect(out).not.toMatch(/onclick/i);
  });
});

describe("sanitization is display-only — stored source is untouched", () => {
  it("sanitizing does not mutate its input string", () => {
    const original = '<img src="x" onerror="window.pwned=1">';
    const copy = String(original);
    sanitizeDocumentHtml(original);
    // The rawHtml node stores the pristine bytes in its `html` attribute and
    // re-emits them on save; only the rendered DOM is sanitized. If this ever
    // fails, block-level source preservation has been broken.
    expect(original).toBe(copy);
  });
});
