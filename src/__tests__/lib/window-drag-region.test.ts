import { describe, expect, it } from "vitest";
import { shouldStartWindowDrag } from "@/lib/window-drag-region";

function eventFor(target: Element, currentTarget: Element, button = 0) {
  return { target, currentTarget, button };
}

describe("shouldStartWindowDrag", () => {
  it("allows primary-button drags from ordinary header content", () => {
    const header = document.createElement("header");
    const title = document.createElement("span");
    header.appendChild(title);

    expect(shouldStartWindowDrag(eventFor(title, header))).toBe(true);
  });

  it("ignores interactive controls inside the header", () => {
    const header = document.createElement("header");
    const button = document.createElement("button");
    const icon = document.createElement("span");
    button.appendChild(icon);
    header.appendChild(button);

    expect(shouldStartWindowDrag(eventFor(icon, header))).toBe(false);
  });

  it("ignores editor tabs inside the header", () => {
    const header = document.createElement("header");
    const tab = document.createElement("div");
    const label = document.createElement("span");
    tab.setAttribute("role", "tab");
    tab.appendChild(label);
    header.appendChild(tab);

    expect(shouldStartWindowDrag(eventFor(label, header))).toBe(false);
  });

  it("ignores non-primary mouse buttons", () => {
    const header = document.createElement("header");
    const title = document.createElement("span");
    header.appendChild(title);

    expect(shouldStartWindowDrag(eventFor(title, header, 2))).toBe(false);
  });
});
