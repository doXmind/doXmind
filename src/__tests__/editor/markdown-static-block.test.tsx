import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MarkdownStaticBlock } from "@/editor/markdown-block/markdown-static-block";

/** Stands in for `BlockPreview`'s image arm, which is not exported from the row. */
function ImagePreview({ alt }: { alt: string }) {
  return (
    <figure data-testid="local-image-block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="blob:test" alt={alt} />
    </figure>
  );
}

function renderImage(
  source: string,
  overrides: Partial<Parameters<typeof MarkdownStaticBlock>[0]> = {}
) {
  const onChange = vi.fn();
  const onKeyDown = vi.fn();
  const view = render(
    <MarkdownStaticBlock
      blockId="block-1"
      kind="image"
      source={source}
      editable
      onChange={onChange}
      onKeyDown={onKeyDown}
      renderInline={(markdown) => markdown}
      {...overrides}
    >
      <ImagePreview alt="Alt" />
    </MarkdownStaticBlock>
  );
  return { ...view, onChange, onKeyDown };
}

async function openImageEditor() {
  await userEvent.click(
    screen.getByRole("button", { name: "Edit image alt text, path and caption" })
  );
}

describe("MarkdownStaticBlock", () => {
  it("keeps the rendered image on screen while the Block is editable and never shows its source", () => {
    renderImage("![Alt](assets/diagram.png)");

    expect(screen.getByTestId("local-image-block")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Alt" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /markdown block/i })).toBeNull();
    expect(document.body.textContent).not.toContain("![Alt](assets/diagram.png)");
  });

  it("keeps the rendered divider on screen while the Block is editable", () => {
    render(
      <MarkdownStaticBlock
        blockId="block-1"
        kind="thematic_break"
        source="---"
        editable
        onChange={vi.fn()}
        renderInline={(markdown) => markdown}
      >
        <hr data-testid="thematic-break-block" />
      </MarkdownStaticBlock>
    );

    expect(screen.getByTestId("thematic-break-block")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Divider" })).toHaveAttribute(
      "data-native-block-editor"
    );
    expect(document.body.textContent).not.toContain("---");
    // A divider has nothing to change, so it gets no controls at all.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("keeps the rendered collection on screen and shows no fence source", () => {
    render(
      <MarkdownStaticBlock
        blockId="block-1"
        kind="collection"
        source='```doxmind-collection\n{"version":1}\n```'
        editable
        onChange={vi.fn()}
        renderInline={(markdown) => markdown}
      >
        <table data-testid="collection-table">
          <tbody>
            <tr>
              <td>First task</td>
            </tr>
          </tbody>
        </table>
      </MarkdownStaticBlock>
    );

    expect(screen.getByTestId("collection-table")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Collection" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("doxmind-collection");
  });

  it("keeps the same rendered element mounted across activation", () => {
    const props = {
      blockId: "block-1",
      kind: "image" as const,
      source: "![Alt](assets/diagram.png)",
      onChange: vi.fn(),
      renderInline: (markdown: string) => markdown,
    };
    const { rerender } = render(
      <MarkdownStaticBlock {...props} editable={false}>
        <ImagePreview alt="Alt" />
      </MarkdownStaticBlock>
    );
    const before = screen.getByTestId("local-image-block");

    rerender(
      <MarkdownStaticBlock {...props} editable>
        <ImagePreview alt="Alt" />
      </MarkdownStaticBlock>
    );

    expect(screen.getByTestId("local-image-block")).toBe(before);
  });

  it("takes the focus when it becomes editable and hands its keys to the Block", async () => {
    const user = userEvent.setup();
    const { onKeyDown } = renderImage("![Alt](assets/diagram.png)");
    const shell = screen.getByRole("group", { name: "Image: Alt" });

    expect(shell).toHaveFocus();

    await user.keyboard("{Escape}");
    await user.keyboard("{Backspace}");
    await user.keyboard("{Enter}");
    await user.keyboard("x");

    expect(onKeyDown.mock.calls.map(([event]) => event.key)).toEqual([
      "Escape",
      "Backspace",
      "Enter",
      "x",
    ]);
    // Nothing typed: the source is unchanged and no text field ever appeared.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("exposes no editing control on a Block that is not editable", () => {
    renderImage("![Alt](assets/diagram.png)", { editable: false });

    expect(
      screen.queryByRole("button", { name: "Edit image alt text, path and caption" })
    ).toBeNull();
    expect(screen.getByRole("group", { name: "Image: Alt" })).not.toHaveAttribute(
      "data-native-block-editor"
    );
  });

  it("writes new alt text back as a normal image", async () => {
    const user = userEvent.setup();
    const { onChange } = renderImage("![Alt](assets/diagram.png)");

    await openImageEditor();
    const altField = screen.getByRole("textbox", { name: /alt text/i });
    await user.clear(altField);
    await user.type(altField, "架构图{Enter}");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("block-1", "![架构图](assets/diagram.png)");
  });

  it("writes a new path back and preserves the title the source carried", async () => {
    const user = userEvent.setup();
    const { onChange } = renderImage('![Alt](assets/diagram.png "Figure 1")');

    await openImageEditor();
    const pathField = screen.getByRole("textbox", { name: /path/i });
    await user.clear(pathField);
    await user.type(pathField, "assets/new.jpg{Enter}");

    expect(onChange).toHaveBeenCalledWith("block-1", '![Alt](assets/new.jpg "Figure 1")');
  });

  it("writes a new caption as a quoted CommonMark title", async () => {
    const user = userEvent.setup();
    const { onChange } = renderImage("![Alt](assets/diagram.png)");

    await openImageEditor();
    const captionField = screen.getByRole("textbox", { name: /caption/i });
    await user.type(captionField, "Figure 1{Enter}");

    expect(onChange).toHaveBeenCalledWith("block-1", '![Alt](assets/diagram.png "Figure 1")');
  });

  it("shows an existing title as the caption field's starting value", async () => {
    renderImage('![Alt](assets/diagram.png "Figure 1")');

    await openImageEditor();
    expect(screen.getByRole("textbox", { name: /caption/i })).toHaveValue("Figure 1");
  });

  it("clears a caption back to a bare image rather than an empty-quoted title", async () => {
    const user = userEvent.setup();
    const { onChange } = renderImage('![Alt](assets/diagram.png "Figure 1")');

    await openImageEditor();
    const captionField = screen.getByRole("textbox", { name: /caption/i });
    await user.clear(captionField);
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("block-1", "![Alt](assets/diagram.png)");
  });

  it("escapes a quote typed into the caption so the title stays one CommonMark string", async () => {
    const user = userEvent.setup();
    const { onChange } = renderImage("![Alt](assets/diagram.png)");

    await openImageEditor();
    const captionField = screen.getByRole("textbox", { name: /caption/i });
    await user.click(captionField);
    await user.paste('Figure "one"');
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith(
      "block-1",
      '![Alt](assets/diagram.png "Figure \\"one\\"")'
    );
  });

  it("angle-brackets a path that contains a space rather than writing a broken image", async () => {
    const user = userEvent.setup();
    const { onChange } = renderImage("![Alt](assets/diagram.png)");

    await openImageEditor();
    const pathField = screen.getByRole("textbox", { name: /path/i });
    await user.clear(pathField);
    await user.type(pathField, "assets/my diagram.png{Enter}");

    expect(onChange).toHaveBeenCalledWith("block-1", "![Alt](<assets/my diagram.png>)");
  });

  it("escapes brackets in alt text so the round trip stays one image", async () => {
    const user = userEvent.setup();
    const { onChange } = renderImage("![Alt](assets/diagram.png)");

    await openImageEditor();
    const altField = screen.getByRole("textbox", { name: /alt text/i });
    await user.clear(altField);
    // Pasted rather than typed: `[` opens a key descriptor in userEvent's keyboard grammar.
    await user.paste("[draft]");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("block-1", "![\\[draft\\]](assets/diagram.png)");
  });

  it("refuses a path that would stop the Block being an image", async () => {
    const user = userEvent.setup();
    const { onChange } = renderImage("![Alt](assets/diagram.png)");

    await openImageEditor();
    const pathField = screen.getByRole("textbox", { name: /path/i });
    await user.clear(pathField);
    await user.type(pathField, "notes/readme.txt{Enter}");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // The draft survives, so the typed path can be corrected instead of retyped.
    expect(screen.getByRole("textbox", { name: /path/i })).toHaveValue("notes/readme.txt");
  });

  it("discards the draft on Escape and gives the focus back to the Block", async () => {
    const user = userEvent.setup();
    const { onChange } = renderImage("![Alt](assets/diagram.png)");

    await openImageEditor();
    await user.type(screen.getByRole("textbox", { name: /path/i }), "-broken");
    await user.keyboard("{Escape}");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Image: Alt" })).toHaveFocus();
  });

  it("writes nothing when the fields are committed unchanged", async () => {
    const user = userEvent.setup();
    const { onChange } = renderImage("![Alt](assets/diagram.png)");

    await openImageEditor();
    await user.keyboard("{Enter}");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("leaves the markup inside an untouched alt exactly as the file had it", async () => {
    const user = userEvent.setup();
    // The parser decodes this alt to `Fig 1`, so a commit rebuilt from the decoded value would write
    // the emphasis out of a Block whose user only asked to change the path.
    const { onChange } = renderImage("![*Fig* 1](assets/diagram.png)");

    await openImageEditor();
    expect(screen.getByRole("textbox", { name: /alt text/i })).toHaveValue("Fig 1");
    const pathField = screen.getByRole("textbox", { name: /path/i });
    await user.clear(pathField);
    await user.type(pathField, "assets/new.png{Enter}");

    expect(onChange).toHaveBeenCalledWith("block-1", "![*Fig* 1](assets/new.png)");
  });

  it("keeps a title's own quoting and padding when the alt is what changed", async () => {
    const user = userEvent.setup();
    const { onChange } = renderImage("![Alt](assets/diagram.png   'Figure 1')");

    await openImageEditor();
    const altField = screen.getByRole("textbox", { name: /alt text/i });
    await user.clear(altField);
    await user.type(altField, "Overview{Enter}");

    expect(onChange).toHaveBeenCalledWith(
      "block-1",
      "![Overview](assets/diagram.png   'Figure 1')"
    );
  });

  it("keeps the angle brackets on an untouched path", async () => {
    const user = userEvent.setup();
    const { onChange } = renderImage("![Alt](<assets/my diagram.png>)");

    await openImageEditor();
    const altField = screen.getByRole("textbox", { name: /alt text/i });
    await user.clear(altField);
    await user.type(altField, "Overview{Enter}");

    expect(onChange).toHaveBeenCalledWith("block-1", "![Overview](<assets/my diagram.png>)");
  });

  it("keeps balanced parens inside an untouched path", async () => {
    const user = userEvent.setup();
    const { onChange } = renderImage("![Alt](assets/plan(final).png)");

    await openImageEditor();
    const altField = screen.getByRole("textbox", { name: /alt text/i });
    await user.clear(altField);
    await user.type(altField, "Overview{Enter}");

    expect(onChange).toHaveBeenCalledWith("block-1", "![Overview](assets/plan(final).png)");
  });

  it("keeps the indentation the Block was written with", async () => {
    const user = userEvent.setup();
    const { onChange } = renderImage("  ![Alt](assets/diagram.png)");

    await openImageEditor();
    const altField = screen.getByRole("textbox", { name: /alt text/i });
    await user.clear(altField);
    await user.type(altField, "Overview{Enter}");

    expect(onChange).toHaveBeenCalledWith("block-1", "  ![Overview](assets/diagram.png)");
  });

  it("escapes alt text that would otherwise be read as markup", async () => {
    const user = userEvent.setup();
    const { onChange } = renderImage("![Alt](assets/diagram.png)");

    await openImageEditor();
    const altField = screen.getByRole("textbox", { name: /alt text/i });
    await user.clear(altField);
    // Written plainly this is emphasis, and the decoded alt would come back as `a b c`. Refusing the
    // commit would make the asterisk a character you cannot put in alt text.
    await user.type(altField, "a *b* c{Enter}");

    expect(onChange).toHaveBeenCalledWith("block-1", "![a \\*b\\* c](assets/diagram.png)");
  });

  it("puts nothing in flow when the Block becomes editable", async () => {
    const props = {
      blockId: "block-1",
      kind: "image" as const,
      source: "![Alt](assets/diagram.png)",
      onChange: vi.fn(),
      renderInline: (markdown: string) => markdown,
    };
    const { container, rerender } = render(
      <MarkdownStaticBlock {...props} editable={false}>
        <ImagePreview alt="Alt" />
      </MarkdownStaticBlock>
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.children).toHaveLength(1);

    rerender(
      <MarkdownStaticBlock {...props} editable>
        <ImagePreview alt="Alt" />
      </MarkdownStaticBlock>
    );
    // Everything activation adds is out of flow, so the Block cannot grow when it is pressed.
    expect(
      [...wrapper.children].slice(1).every((child) => child.className.includes("absolute"))
    ).toBe(true);

    await openImageEditor();
    expect(
      [...wrapper.children].slice(1).every((child) => child.className.includes("absolute"))
    ).toBe(true);
  });

  it("adds no text of its own inside the Block's content", () => {
    renderImage("![Alt](assets/diagram.png)");

    // A visually hidden label here would be real text that the caret mapping counts, so the shell's
    // only text is whatever the rendered form itself carries — for an image, none.
    expect(screen.getByRole("group", { name: "Image: Alt" })).toHaveTextContent("");
  });
});
