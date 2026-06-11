import { NextIntlClientProvider } from "next-intl";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { WelcomeScreen } from "@/components/welcome-screen";
import { StratigraphyWelcome } from "@/components/welcome/stratigraphy";
import { useFileStore } from "@/stores/file-store";

vi.mock("@/lib/notifications", () => ({
  notify: {
    error: vi.fn(),
    promise: vi.fn(),
    startProgress: vi.fn(),
    resolveProgress: vi.fn(),
    failProgress: vi.fn(),
  },
}));

vi.mock("@/lib/native-dialog", () => ({
  pickNativeFolder: vi.fn(),
}));

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>
  );
}

describe("StratigraphyWelcome", () => {
  it("covers first-run actions and routes New through the supplied handler", async () => {
    const user = userEvent.setup();
    const onOpenFolder = vi.fn();
    const onStartWriting = vi.fn();
    const onCreateNew = vi.fn();

    renderWithIntl(
      <StratigraphyWelcome
        recentFiles={[]}
        recentWorkspaces={[]}
        isDesktopShell={false}
        hasWorkspace={false}
        onOpenFolder={onOpenFolder}
        onCreateNew={onCreateNew}
        onStartWriting={onStartWriting}
        onOpenRecentFile={vi.fn()}
        onOpenRecentWorkspace={vi.fn()}
        onDropFiles={vi.fn()}
      />
    );

    expect(screen.getByText("Welcome to doxmind.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose a folder/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start writing/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pick up tomorrow/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /choose a folder/i }));
    await user.click(screen.getByRole("button", { name: /start writing/i }));
    await user.click(screen.getByRole("button", { name: "Open Folder" }));
    await user.click(screen.getByRole("button", { name: "New" }));

    expect(onOpenFolder).toHaveBeenCalledTimes(2);
    expect(onStartWriting).toHaveBeenCalledOnce();
    expect(onCreateNew).toHaveBeenCalledOnce();
  });

  it("shows recent folders before files and opens the selected file", async () => {
    const user = userEvent.setup();
    const onOpenRecentFile = vi.fn();
    const onOpenRecentWorkspace = vi.fn();

    renderWithIntl(
      <StratigraphyWelcome
        recentFiles={[
          {
            absolutePath: "/tmp/work/Project.md",
            workspacePath: "/tmp/work",
            name: "Project.md",
            documentType: "markdown",
            lastOpened: "",
            editCount: 0,
            wordCount: 0,
            preview: "/tmp/work",
          },
        ]}
        recentWorkspaces={[{ path: "/tmp/notes", name: "notes", parent: "/tmp" }]}
        isDesktopShell={false}
        hasWorkspace={false}
        onOpenFolder={vi.fn()}
        onCreateNew={vi.fn()}
        onStartWriting={vi.fn()}
        onOpenRecentFile={onOpenRecentFile}
        onOpenRecentWorkspace={onOpenRecentWorkspace}
        onDropFiles={vi.fn()}
      />
    );

    expect(screen.getByText(/stratigraphy/)).toBeInTheDocument();
    // VSCode-style precedence: recent folders render first, then standalone
    // files — both are shown (stratigraphy.tsx renders `[...folders, ...files]`).
    const folderButton = screen.getByRole("button", { name: /notes/i });
    const fileButton = screen.getByRole("button", { name: /Project\.md/i });
    expect(folderButton).toBeInTheDocument();
    expect(fileButton).toBeInTheDocument();
    // The folder layer precedes the file layer in the DOM.
    expect(
      folderButton.compareDocumentPosition(fileButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    await user.click(fileButton);

    expect(onOpenRecentFile).toHaveBeenCalledWith(
      expect.objectContaining({ absolutePath: "/tmp/work/Project.md" })
    );
    expect(onOpenRecentWorkspace).not.toHaveBeenCalled();
  });

  it("shows recent workspaces when there are no recent files", async () => {
    const user = userEvent.setup();
    const onOpenRecentWorkspace = vi.fn();

    renderWithIntl(
      <StratigraphyWelcome
        recentFiles={[]}
        recentWorkspaces={[{ path: "/tmp/notes", name: "notes", parent: "/tmp" }]}
        isDesktopShell={false}
        hasWorkspace={false}
        onOpenFolder={vi.fn()}
        onCreateNew={vi.fn()}
        onStartWriting={vi.fn()}
        onOpenRecentFile={vi.fn()}
        onOpenRecentWorkspace={onOpenRecentWorkspace}
        onDropFiles={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /notes/i }));

    expect(onOpenRecentWorkspace).toHaveBeenCalledWith("/tmp/notes");
  });

  it("enables New inside a mounted workspace", async () => {
    const user = userEvent.setup();
    const onCreateNew = vi.fn();

    renderWithIntl(
      <StratigraphyWelcome
        recentFiles={[]}
        recentWorkspaces={[{ path: "/tmp/older", name: "older", parent: "/tmp" }]}
        isDesktopShell={false}
        hasWorkspace={true}
        onOpenFolder={vi.fn()}
        onCreateNew={onCreateNew}
        onStartWriting={vi.fn()}
        onOpenRecentFile={vi.fn()}
        onOpenRecentWorkspace={vi.fn()}
        onDropFiles={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "New" }));

    expect(onCreateNew).toHaveBeenCalledOnce();
  });
});

describe("WelcomeScreen store wiring", () => {
  beforeEach(() => {
    useFileStore.setState({
      files: [],
      currentFileId: null,
      openTarget: "none",
      rootPath: null,
      openFilePath: null,
      transientFile: null,
      recents: [],
      isSynced: true,
      isLoading: false,
      loadedContentIds: new Set(),
    });
    window.history.replaceState({}, "", "/editor");
    vi.restoreAllMocks();
  });

  it("starts an untitled transient document from first-run", async () => {
    const user = userEvent.setup();

    renderWithIntl(<WelcomeScreen />);

    await user.click(screen.getByRole("button", { name: /start writing/i }));

    const state = useFileStore.getState();
    expect(state.transientFile?.name).toBe("Untitled-1.md");
    expect(state.currentFileId).toMatch(/^transient-/);
    expect(window.location.pathname).toMatch(/^\/editor\/transient-/);
  });

  it("starts an untitled transient document from bottom-bar New without a workspace", async () => {
    const user = userEvent.setup();

    renderWithIntl(<WelcomeScreen />);

    await user.click(screen.getByRole("button", { name: "New" }));

    const state = useFileStore.getState();
    expect(state.transientFile?.name).toBe("Untitled-1.md");
    expect(state.currentFileId).toMatch(/^transient-/);
    expect(window.location.pathname).toMatch(/^\/editor\/transient-/);
  });

  it("blocks browser-only folder opening with the desktop-required notification", async () => {
    const user = userEvent.setup();
    const { notify } = await import("@/lib/notifications");
    const { pickNativeFolder } = await import("@/lib/native-dialog");

    renderWithIntl(<WelcomeScreen />);

    await user.click(screen.getByRole("button", { name: "Open Folder" }));

    await waitFor(() => {
      expect(notify.error).toHaveBeenCalledWith(
        "Opening folders and files requires the desktop app."
      );
    });
    expect(pickNativeFolder).not.toHaveBeenCalled();
  });
});
