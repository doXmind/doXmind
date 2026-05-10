import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowsingRuntime } from "@/components/workspace/browsing-runtime";
import { DocumentWorkspace } from "@/components/workspace/document-workspace";
import { useLayoutStore } from "@/stores/layout-store";
import type { FileItem } from "@/types";

const { editorMock, pdfMock, excelMock, perfMarkMock, perfMeasureMock } = vi.hoisted(() => ({
  editorMock: vi.fn(
    ({
      initialScrollTop,
      activationIntent,
    }: {
      initialScrollTop?: number;
      activationIntent?: { type: string; key?: string; clientX?: number; clientY?: number };
    }) => (
      <div
        data-testid="full-editor-runtime"
        data-initial-scroll-top={initialScrollTop ?? 0}
        data-activation-type={activationIntent?.type ?? ""}
        data-activation-key={activationIntent?.key ?? ""}
        data-activation-client-x={activationIntent?.clientX ?? ""}
        data-activation-client-y={activationIntent?.clientY ?? ""}
      />
    )
  ),
  pdfMock: vi.fn(() => <div data-testid="pdf-runtime" />),
  excelMock: vi.fn(() => <div data-testid="excel-runtime" />),
  perfMarkMock: vi.fn(),
  perfMeasureMock: vi.fn(),
}));

vi.mock("@/lib/perf", () => ({
  perfMark: perfMarkMock,
  perfMeasure: perfMeasureMock,
}));

vi.mock("@/components/editor/editor", () => ({
  Editor: editorMock,
}));

vi.mock("@/components/pdf-editor/pdf-editor-workspace", () => ({
  PdfEditorWorkspace: pdfMock,
}));

vi.mock("@/components/excel-editor/excel-editor-workspace", () => ({
  ExcelEditorWorkspace: excelMock,
}));

const now = "2026-05-09T00:00:00.000Z";

function markdownFile(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: "doc-1",
    name: "Doc.md",
    content: "<p>Editor html</p>",
    editorHtml: "<p>Editor html</p>",
    browsingHtml:
      '<h1 id="intro">Intro</h1><p>Alpha <a href="https://example.com">link</a></p><h2 id="details">Details</h2><p>alpha tail</p>',
    contentMarkdown: "# Intro\n\nAlpha [link](https://example.com)\n\n## Details\n\nalpha tail",
    sourceState: "sidecar_fresh",
    outline: [
      { id: "intro", depth: 1, text: "Intro" },
      { id: "details", depth: 2, text: "Details" },
    ],
    browsingRendererVersion: "browsing-html/v1",
    isFolder: false,
    parentId: null,
    position: 0,
    isFavorite: false,
    icon: null,
    coverImageUrl: null,
    coverPosition: 0.5,
    createdAt: now,
    updatedAt: now,
    wordCount: 0,
    preview: "",
    documentType: "markdown",
    ...overrides,
  };
}

describe("BrowsingRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.__doxmindSwitchStartMark = undefined;
    window.__doxmindSwitchFileId = undefined;
    window.__doxmindEditorActivationStartMark = undefined;
    window.__doxmindEditorActivationFileId = undefined;
    useLayoutStore.setState({
      isSearchBarOpen: false,
      lineHeight: "normal",
    });
    Element.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  it("routes Markdown documents to browsing mode without mounting the full editor runtime", () => {
    render(<DocumentWorkspace file={markdownFile()} />);

    expect(screen.getByTestId("browsing-runtime")).toBeInTheDocument();
    expect(screen.queryByTestId("full-editor-runtime")).not.toBeInTheDocument();
    expect(editorMock).not.toHaveBeenCalled();
  });

  it("keeps PDF and Excel workspace routing unchanged", () => {
    const { rerender } = render(
      <DocumentWorkspace
        file={markdownFile({ id: "pdf-1", name: "Doc.pdf", documentType: "pdf" })}
      />
    );
    expect(screen.getByTestId("pdf-runtime")).toBeInTheDocument();

    rerender(
      <DocumentWorkspace
        file={markdownFile({ id: "xls-1", name: "Sheet.xlsx", documentType: "excel" })}
      />
    );
    expect(screen.getByTestId("excel-runtime")).toBeInTheDocument();
  });

  it("renders sanitized browsingHtml and keeps links clickable", () => {
    render(<BrowsingRuntime file={markdownFile()} />);

    expect(screen.getByRole("heading", { name: "Intro" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "link" })).toHaveAttribute(
      "href",
      "https://example.com"
    );
    expect(screen.queryByText("Editor html")).not.toBeInTheDocument();
  });

  it("keeps image and heavy-block browsing output lightweight", () => {
    render(
      <BrowsingRuntime
        file={markdownFile({
          browsingHtml:
            '<p><img src="/diagram.png" alt="Diagram"></p><pre><code class="language-mermaid">graph TD; A-->B;</code></pre>',
        })}
      />
    );

    expect(screen.getByAltText("Diagram")).toHaveAttribute("loading", "lazy");
    expect(screen.getByAltText("Diagram")).toHaveAttribute("decoding", "async");
    expect(document.querySelector('[data-browsing-heavy-block="mermaid"]')).toBeInTheDocument();
  });

  it("renders custom-block diagrams and equations as placeholders without eager hydration", () => {
    render(
      <BrowsingRuntime
        file={markdownFile({
          browsingHtml: [
            '<div data-type="mermaid-chart" data-code="graph TD; A--&gt;B;" class="mermaid-chart"></div>',
            '<div data-type="block-math" data-latex="x^2 + y^2 = z^2" class="block-math"></div>',
            '<p>Inline <span data-type="inline-math" data-latex="a+b" class="inline-math"></span> case.</p>',
          ].join(""),
        })}
      />
    );

    const mermaid = document.querySelector<HTMLElement>('[data-type="mermaid-chart"]');
    expect(mermaid).not.toBeNull();
    expect(mermaid).toHaveAttribute("data-browsing-heavy-block", "mermaid");
    expect(mermaid).toHaveAttribute("data-browsing-block-state", "placeholder");
    expect(mermaid?.textContent).toContain("graph TD");

    const blockMath = document.querySelector<HTMLElement>('[data-type="block-math"]');
    expect(blockMath).not.toBeNull();
    expect(blockMath).toHaveAttribute("data-browsing-heavy-block", "math");
    expect(blockMath).toHaveAttribute("data-browsing-block-state", "placeholder");
    expect(blockMath?.textContent).toBe("x^2 + y^2 = z^2");

    const inline = document.querySelector<HTMLElement>('[data-type="inline-math"]');
    expect(inline?.textContent).toBe("a+b");
    expect(inline).not.toHaveAttribute("data-browsing-heavy-block");
  });

  it("renders PDF and Excel external-reference blocks as lightweight placeholders without eager-loading second-class state", () => {
    render(
      <BrowsingRuntime
        file={markdownFile({
          browsingHtml: [
            '<div data-type="pdf-block" data-id="pdf-1" data-src="docs/spec.pdf" class="custom-block-external-reference">PDF: docs/spec.pdf</div>',
            '<div data-type="excel-block" data-id="xls-1" data-src="data/q3.xlsx" class="custom-block-external-reference">Excel: data/q3.xlsx</div>',
          ].join(""),
        })}
      />
    );

    const pdf = document.querySelector<HTMLElement>('[data-type="pdf-block"]');
    expect(pdf).toHaveAttribute("data-browsing-heavy-block", "pdf-block");
    expect(pdf).toHaveAttribute("data-browsing-block-state", "placeholder");
    expect(pdf?.textContent).toContain("docs/spec.pdf");

    const xls = document.querySelector<HTMLElement>('[data-type="excel-block"]');
    expect(xls).toHaveAttribute("data-browsing-heavy-block", "excel-block");
    expect(xls).toHaveAttribute("data-browsing-block-state", "placeholder");

    expect(pdfMock).not.toHaveBeenCalled();
    expect(excelMock).not.toHaveBeenCalled();
  });

  it("hydrates a heavy block when it enters the viewport", () => {
    interface FakeObserver {
      callback: IntersectionObserverCallback;
      observed: Element[];
      unobserve: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }
    const observers: FakeObserver[] = [];
    class CapturingIntersectionObserver {
      private record: FakeObserver;
      constructor(callback: IntersectionObserverCallback) {
        this.record = {
          callback,
          observed: [],
          unobserve: vi.fn(),
          disconnect: vi.fn(),
        };
        observers.push(this.record);
      }
      observe = (element: Element) => {
        this.record.observed.push(element);
      };
      unobserve = (element: Element) => {
        this.record.unobserve(element);
      };
      disconnect = () => {
        this.record.disconnect();
      };
    }
    const previous = window.IntersectionObserver;
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      CapturingIntersectionObserver as unknown as typeof IntersectionObserver;

    try {
      render(
        <BrowsingRuntime
          file={markdownFile({
            browsingHtml:
              '<div data-type="mermaid-chart" data-code="graph LR; A-->B" class="mermaid-chart"></div>',
          })}
        />
      );

      expect(observers).toHaveLength(1);
      const observer = observers[0];
      expect(observer.observed).toHaveLength(1);
      const target = observer.observed[0] as HTMLElement;
      expect(target).toHaveAttribute("data-browsing-block-state", "placeholder");

      observer.callback(
        [
          {
            isIntersecting: true,
            target,
            intersectionRatio: 1,
            boundingClientRect: target.getBoundingClientRect(),
            intersectionRect: target.getBoundingClientRect(),
            rootBounds: null,
            time: 0,
          } as IntersectionObserverEntry,
        ],
        {
          unobserve: (el: Element) => observer.unobserve(el),
          disconnect: () => observer.disconnect(),
        } as unknown as IntersectionObserver
      );

      expect(target).toHaveAttribute("data-browsing-block-state", "hydrated");
      expect(observer.unobserve).toHaveBeenCalledWith(target);
    } finally {
      (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = previous;
    }
  });

  it("hydrates a heavy block on click and activates the editor", () => {
    render(
      <DocumentWorkspace
        file={markdownFile({
          browsingHtml:
            '<div data-type="pdf-block" data-id="pdf-1" data-src="report.pdf" class="custom-block-external-reference">PDF: report.pdf</div>',
        })}
      />
    );

    const pdf = document.querySelector<HTMLElement>('[data-type="pdf-block"]')!;
    expect(pdf).toHaveAttribute("data-browsing-block-state", "placeholder");

    fireEvent.mouseDown(pdf);

    expect(pdf).toHaveAttribute("data-browsing-block-state", "hydrated");
    expect(editorMock).toHaveBeenCalledOnce();
  });

  it("emits separate browsing first-paint instrumentation", async () => {
    window.__doxmindSwitchStartMark = "switch-start";
    window.__doxmindSwitchFileId = "doc-1";

    render(<BrowsingRuntime file={markdownFile()} />);

    await waitFor(() => {
      expect(perfMeasureMock).toHaveBeenCalledWith(
        "doxmind.browsing.firstPaint",
        expect.stringContaining("doxmind.browsing.open.start:doc-1"),
        undefined,
        expect.objectContaining({ documentType: "markdown", runtime: "browsing" })
      );
    });
    expect(perfMeasureMock).toHaveBeenCalledWith(
      "doxmind.switch.firstPaint",
      "switch-start",
      undefined,
      expect.objectContaining({ documentType: "markdown", runtime: "browsing" })
    );
    expect(window.__doxmindSwitchStartMark).toBeUndefined();
  });

  it("navigates by the precomputed outline", () => {
    render(
      <BrowsingRuntime
        file={markdownFile({
          browsingHtml: "<h1>Intro</h1><p>Alpha</p><h2>Details</h2><p>Tail</p>",
        })}
      />
    );

    fireEvent.click(screen.getByLabelText("Navigate to: Details"));

    expect(HTMLElement.prototype.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" })
    );
  });

  it("searches visible browsing content without an editor instance", async () => {
    const user = userEvent.setup();
    useLayoutStore.setState({ isSearchBarOpen: true });

    render(<BrowsingRuntime file={markdownFile()} />);

    await user.type(screen.getByLabelText("Search text"), "alpha");

    expect(document.querySelectorAll('[data-browsing-search-result="true"]')).toHaveLength(2);
    expect(screen.getByText("1 of 2")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Next result"));

    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-browsing-search-current="true"]')).toHaveLength(1);
    expect(editorMock).not.toHaveBeenCalled();
  });

  it("activates the full editor once on document click and preserves scroll and pointer context", () => {
    render(<DocumentWorkspace file={markdownFile()} />);
    const scrollArea = document.querySelector<HTMLElement>("[data-browsing-scroll]");
    expect(scrollArea).not.toBeNull();
    scrollArea!.scrollTop = 128;

    fireEvent.mouseDown(screen.getByTestId("browsing-document"), { clientX: 88, clientY: 144 });
    fireEvent.mouseDown(screen.getByTestId("full-editor-runtime"));

    expect(screen.getByTestId("full-editor-runtime")).toHaveAttribute(
      "data-initial-scroll-top",
      "128"
    );
    expect(screen.getByTestId("full-editor-runtime")).toHaveAttribute(
      "data-activation-type",
      "pointer"
    );
    expect(screen.getByTestId("full-editor-runtime")).toHaveAttribute(
      "data-activation-client-x",
      "88"
    );
    expect(screen.getByTestId("full-editor-runtime")).toHaveAttribute(
      "data-activation-client-y",
      "144"
    );
    expect(editorMock).toHaveBeenCalledOnce();
    expect(perfMarkMock).toHaveBeenCalledWith(
      expect.stringContaining("doxmind.editor.activation.start:doc-1")
    );
    expect(window.__doxmindEditorActivationFileId).toBe("doc-1");
  });

  it("activates the full editor once on printable keyboard edit intent", () => {
    render(<DocumentWorkspace file={markdownFile()} />);
    const scrollArea = document.querySelector<HTMLElement>("[data-browsing-scroll]");
    expect(scrollArea).not.toBeNull();
    scrollArea!.scrollTop = 96;

    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "b" });

    expect(screen.getByTestId("full-editor-runtime")).toBeInTheDocument();
    expect(screen.getByTestId("full-editor-runtime")).toHaveAttribute(
      "data-initial-scroll-top",
      "96"
    );
    expect(screen.getByTestId("full-editor-runtime")).toHaveAttribute(
      "data-activation-type",
      "keyboard"
    );
    expect(screen.getByTestId("full-editor-runtime")).toHaveAttribute("data-activation-key", "a");
    expect(editorMock).toHaveBeenCalledOnce();
  });

  it("preserves slash edit intent for the full editor", () => {
    render(<DocumentWorkspace file={markdownFile()} />);

    fireEvent.keyDown(window, { key: "/" });

    expect(screen.getByTestId("full-editor-runtime")).toHaveAttribute(
      "data-activation-type",
      "keyboard"
    );
    expect(screen.getByTestId("full-editor-runtime")).toHaveAttribute("data-activation-key", "/");
    expect(editorMock).toHaveBeenCalledOnce();
  });

  it("deduplicates repeated keyboard activation before the workspace swaps runtimes", () => {
    const onActivateEdit = vi.fn();
    render(<BrowsingRuntime file={markdownFile()} onActivateEdit={onActivateEdit} />);
    const scrollArea = document.querySelector<HTMLElement>("[data-browsing-scroll]");
    expect(scrollArea).not.toBeNull();
    scrollArea!.scrollTop = 72;

    fireEvent.keyDown(window, { key: "/" });
    fireEvent.keyDown(window, { key: "a" });

    expect(onActivateEdit).toHaveBeenCalledOnce();
    expect(onActivateEdit).toHaveBeenCalledWith({
      scrollTop: 72,
      intent: { type: "keyboard", key: "/" },
    });
  });
});
