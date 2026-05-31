import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ContextMenuGuard } from "@/components/context-menu-guard";

afterEach(cleanup);

/** Dispatch a contextmenu event from `target` and report whether it was suppressed. */
function rightClick(target: EventTarget): boolean {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("ContextMenuGuard", () => {
  it("suppresses the native menu on plain elements", () => {
    render(<ContextMenuGuard />);
    const div = document.createElement("div");
    document.body.appendChild(div);
    expect(rightClick(div)).toBe(true);
  });

  it("leaves the native menu on inputs and textareas", () => {
    render(<ContextMenuGuard />);
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    document.body.append(input, textarea);
    expect(rightClick(input)).toBe(false);
    expect(rightClick(textarea)).toBe(false);
  });

  it("leaves the native menu inside contenteditable surfaces", () => {
    render(<ContextMenuGuard />);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const childSpan = document.createElement("span");
    editable.appendChild(childSpan);
    document.body.appendChild(editable);
    // A right-click on a descendant of a contenteditable must also be exempt.
    expect(rightClick(childSpan)).toBe(false);
  });

  it("stays out of the way when a custom menu already handled the event", () => {
    render(<ContextMenuGuard />);
    const div = document.createElement("div");
    document.body.appendChild(div);
    // Simulate an inner custom menu that preventDefaults but does not stop
    // propagation (as the TipTap editor menu does) — the guard must not
    // re-handle it, but the event stays prevented.
    div.addEventListener("contextmenu", (e) => e.preventDefault());
    expect(rightClick(div)).toBe(true);
  });

  it("removes its listener on unmount", () => {
    const { unmount } = render(<ContextMenuGuard />);
    unmount();
    const div = document.createElement("div");
    document.body.appendChild(div);
    // With the guard gone, nothing suppresses the menu.
    expect(rightClick(div)).toBe(false);
  });
});
