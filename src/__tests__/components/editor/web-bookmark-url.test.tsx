/**
 * A bookmark card must point exactly where the user said. `mailto:` / `tel:`
 * carry no `//authority`, so there is no page to unfurl — and the sidecar's
 * normaliser prepends `https://` to anything without `://`, turning
 * `mailto:a@b.com` into `https://mailto:a@b.com` (host `b.com`). Sending those
 * URLs to unfurl and writing the answer back rewrites the user's link to a
 * different host, in the DOM and in the saved `.md`.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, waitFor } from "@testing-library/react";

vi.mock("@/lib/api/unfurl", () => ({
  unfurlLink: vi.fn(),
}));

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children, ...rest }: { children: React.ReactNode }) => (
    <div {...rest}>{children}</div>
  ),
}));

vi.mock("@/components/editor/web-bookmark-empty-state", () => ({
  WebBookmarkEmptyState: () => null,
}));

import { WebBookmarkNodeView } from "@/components/editor/web-bookmark-node-view";
import { unfurlLink } from "@/lib/api/unfurl";

const unfurlLinkMock = unfurlLink as unknown as Mock;

function renderBookmark(url: string) {
  const updateAttributes = vi.fn();
  const props = {
    node: { attrs: { url, title: "", description: null, faviconUrl: null, imageUrl: null } },
    updateAttributes,
    editor: { isEditable: true },
    getPos: () => 0,
    decorations: [],
    selected: false,
    extension: {} as never,
    innerDecorations: [] as never,
    HTMLAttributes: {},
    deleteNode: vi.fn(),
  } as unknown as Parameters<typeof WebBookmarkNodeView>[0];
  const view = render(<WebBookmarkNodeView {...props} />);
  return { ...view, updateAttributes };
}

describe("web bookmark URLs", () => {
  beforeEach(() => {
    unfurlLinkMock.mockReset();
    // Whatever the sidecar answers, an authority-less URL must not be rewritten.
    unfurlLinkMock.mockResolvedValue({
      url: "https://mailto:someone@example.com",
      title: "example.com",
      description: null,
      faviconUrl: null,
      imageUrl: null,
    });
  });

  it("does not unfurl a mailto: bookmark, and keeps the URL untouched", async () => {
    const { container, updateAttributes } = renderBookmark("mailto:someone@example.com");

    await waitFor(() => expect(container.querySelector("a")).not.toBeNull());
    const anchor = container.querySelector("a") as HTMLAnchorElement;
    expect(anchor.getAttribute("href")).toBe("mailto:someone@example.com");
    expect(unfurlLinkMock).not.toHaveBeenCalled();
    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it("does not unfurl a tel: bookmark", async () => {
    const { container } = renderBookmark("tel:+15551234567");
    const anchor = container.querySelector("a") as HTMLAnchorElement;
    expect(anchor.getAttribute("href")).toBe("tel:+15551234567");
    expect(unfurlLinkMock).not.toHaveBeenCalled();
  });

  it("labels an authority-less bookmark with the address, not the raw scheme", () => {
    const { container } = renderBookmark("mailto:someone@example.com");
    expect(container.textContent).toContain("someone@example.com");
  });

  it("still unfurls an ordinary https bookmark", async () => {
    unfurlLinkMock.mockResolvedValue({
      url: "https://example.com/",
      title: "Example",
      description: null,
      faviconUrl: null,
      imageUrl: null,
    });
    renderBookmark("https://example.com");
    await waitFor(() => expect(unfurlLinkMock).toHaveBeenCalledWith("https://example.com"));
  });

  it("refuses to make an unsupported scheme clickable", () => {
    const { container } = renderBookmark("javascript:alert(1)");
    expect(container.querySelector("a")).toBeNull();
    expect(unfurlLinkMock).not.toHaveBeenCalled();
  });
});
