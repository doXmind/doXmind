/**
 * Tests for file store
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock api module - vi.hoisted ensures mocks are available before imports
const { mockApi, mockDeleteConversation } = vi.hoisted(() => ({
  mockApi: {
    listFiles: vi.fn(),
    createFile: vi.fn(),
    importFile: vi.fn(),
    updateFile: vi.fn(),
    deleteFile: vi.fn(),
  },
  mockDeleteConversation: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: mockApi,
}));

// Mock chat store for deleteFile
vi.mock("@/stores/chat-store", () => ({
  useChatStore: {
    getState: () => ({
      deleteConversation: mockDeleteConversation,
    }),
  },
}));

// Import store after mocks are set up
import { useFileStore } from "@/stores/file-store";

describe("useFileStore", () => {
  // Reset store state before each test
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the store to initial state
    useFileStore.setState({
      files: [],
      currentFileId: null,
      isLoading: false,
      isSynced: false,
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ============================================================================
  // loadFiles tests
  // ============================================================================
  describe("loadFiles", () => {
    it("fetches files from server", async () => {
      const serverFiles = [
        {
          id: "file-1",
          name: "Document 1",
          content: "Content 1",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "file-2",
          name: "Document 2",
          content: "Content 2",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ];
      mockApi.listFiles.mockResolvedValueOnce(serverFiles);

      await useFileStore.getState().loadFiles();

      expect(mockApi.listFiles).toHaveBeenCalledOnce();
      const state = useFileStore.getState();
      expect(state.files).toHaveLength(2);
      expect(state.files[0].id).toBe("file-1");
      expect(state.files[0].name).toBe("Document 1");
      expect(state.isSynced).toBe(true);
    });

    it("sets isLoading during fetch", async () => {
      let loadingDuringFetch = false;
      mockApi.listFiles.mockImplementationOnce(() => {
        loadingDuringFetch = useFileStore.getState().isLoading;
        return Promise.resolve([]);
      });

      await useFileStore.getState().loadFiles();

      expect(loadingDuringFetch).toBe(true);
      expect(useFileStore.getState().isLoading).toBe(false);
    });

    it("handles server errors gracefully", async () => {
      mockApi.listFiles.mockRejectedValueOnce(new Error("Network error"));

      await useFileStore.getState().loadFiles();

      const state = useFileStore.getState();
      expect(state.isSynced).toBe(false);
      expect(state.isLoading).toBe(false);
    });

    it("maps server response fields correctly", async () => {
      mockApi.listFiles.mockResolvedValueOnce([
        {
          id: "file-123",
          name: "Test",
          content: "Test content",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ]);

      await useFileStore.getState().loadFiles();

      const file = useFileStore.getState().files[0];
      expect(file.createdAt).toBe("2024-01-01T00:00:00Z");
      expect(file.updatedAt).toBe("2024-01-02T00:00:00Z");
    });
  });

  // ============================================================================
  // createFile tests
  // ============================================================================
  describe("createFile", () => {
    it("creates file via API and adds to store", async () => {
      mockApi.createFile.mockResolvedValueOnce({
        id: "new-file-123",
        name: "New Document",
        content: "",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      });

      const fileId = await useFileStore.getState().createFile("New Document");

      expect(mockApi.createFile).toHaveBeenCalledWith("New Document", "", null);
      expect(fileId).toBe("new-file-123");

      const state = useFileStore.getState();
      expect(state.files).toHaveLength(1);
      expect(state.files[0].name).toBe("New Document");
      expect(state.currentFileId).toBe("new-file-123");
    });

    it("creates file with initial content", async () => {
      mockApi.createFile.mockResolvedValueOnce({
        id: "new-file-123",
        name: "New Document",
        content: "Initial content",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      });

      await useFileStore.getState().createFile("New Document", "Initial content");

      expect(mockApi.createFile).toHaveBeenCalledWith("New Document", "Initial content", null);
    });

    it("adds new file to the beginning of the list", async () => {
      // Setup existing files
      useFileStore.setState({
        files: [
          {
            id: "old-1",
            name: "Old 1",
            content: "",
            isFolder: false,
            parentId: null,
            position: 0,
            isFavorite: false,
            icon: null,
            coverImageUrl: null,
            coverPosition: 0.5,
            createdAt: "",
            updatedAt: "",
            wordCount: 0,
            preview: "",
          },
          {
            id: "old-2",
            name: "Old 2",
            content: "",
            isFolder: false,
            parentId: null,
            position: 0,
            isFavorite: false,
            icon: null,
            coverImageUrl: null,
            coverPosition: 0.5,
            createdAt: "",
            updatedAt: "",
            wordCount: 0,
            preview: "",
          },
        ],
      });

      mockApi.createFile.mockResolvedValueOnce({
        id: "new-file",
        name: "New",
        content: "",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      });

      await useFileStore.getState().createFile("New");

      const files = useFileStore.getState().files;
      expect(files[0].id).toBe("new-file");
      expect(files).toHaveLength(3);
    });

    it("throws error on API failure", async () => {
      mockApi.createFile.mockRejectedValueOnce(new Error("Server error"));

      await expect(useFileStore.getState().createFile("Test")).rejects.toThrow("Server error");
    });

    it("sets current file to newly created file", async () => {
      useFileStore.setState({ currentFileId: "old-file" });
      mockApi.createFile.mockResolvedValueOnce({
        id: "new-file",
        name: "New",
        content: "",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      });

      await useFileStore.getState().createFile("New");

      expect(useFileStore.getState().currentFileId).toBe("new-file");
    });
  });

  // ============================================================================
  // importFile tests
  // ============================================================================
  describe("importFile", () => {
    it("imports file via API", async () => {
      const mockFile = new File(["test content"], "test.pdf", { type: "application/pdf" });
      mockApi.importFile.mockResolvedValueOnce({
        id: "imported-123",
        name: "test.md",
        content: "# Converted content",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      });

      const fileId = await useFileStore.getState().importFile(mockFile);

      expect(mockApi.importFile).toHaveBeenCalledWith(mockFile, undefined);
      expect(fileId).toBe("imported-123");
    });

    it("adds imported file to store", async () => {
      const mockFile = new File(["test"], "test.docx");
      mockApi.importFile.mockResolvedValueOnce({
        id: "imported-123",
        name: "test.md",
        content: "Converted",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      });

      await useFileStore.getState().importFile(mockFile);

      const state = useFileStore.getState();
      expect(state.files).toHaveLength(1);
      expect(state.files[0].name).toBe("test.md");
      expect(state.currentFileId).toBe("imported-123");
    });

    it("throws error on import failure", async () => {
      const mockFile = new File(["test"], "test.pdf");
      mockApi.importFile.mockRejectedValueOnce(new Error("Import failed"));

      await expect(useFileStore.getState().importFile(mockFile)).rejects.toThrow("Import failed");
    });
  });

  // ============================================================================
  // updateFile tests
  // ============================================================================
  describe("updateFile", () => {
    beforeEach(() => {
      useFileStore.setState({
        files: [
          {
            id: "file-1",
            name: "Original Name",
            content: "Original content",
            isFolder: false,
            parentId: null,
            position: 0,
            isFavorite: false,
            icon: null,
            coverImageUrl: null,
            coverPosition: 0.5,
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z",
            wordCount: 0,
            preview: "",
          },
        ],
      });
    });

    it("updates file content optimistically", async () => {
      mockApi.updateFile.mockResolvedValueOnce({});

      await useFileStore.getState().updateFile("file-1", { content: "Updated content" });

      const file = useFileStore.getState().files[0];
      expect(file.content).toBe("Updated content");
    });

    it("updates file name", async () => {
      mockApi.updateFile.mockResolvedValueOnce({});

      await useFileStore.getState().updateFile("file-1", { name: "New Name" });

      const file = useFileStore.getState().files[0];
      expect(file.name).toBe("New Name");
    });

    it("updates the updatedAt timestamp", async () => {
      mockApi.updateFile.mockResolvedValueOnce({});
      const before = new Date().toISOString();

      await useFileStore.getState().updateFile("file-1", { content: "New" });

      const after = new Date().toISOString();
      const file = useFileStore.getState().files[0];
      expect(file.updatedAt >= before).toBe(true);
      expect(file.updatedAt <= after).toBe(true);
    });

    it("calls API with correct parameters", async () => {
      mockApi.updateFile.mockResolvedValueOnce({});

      await useFileStore.getState().updateFile("file-1", { name: "New", content: "Updated" });

      expect(mockApi.updateFile).toHaveBeenCalledWith("file-1", {
        name: "New",
        content: "Updated",
      });
    });

    it("reverts on API error", async () => {
      mockApi.updateFile.mockRejectedValueOnce(new Error("Server error"));
      mockApi.listFiles.mockResolvedValueOnce([
        {
          id: "file-1",
          name: "Original Name",
          content: "Original content",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ]);

      await useFileStore.getState().updateFile("file-1", { content: "New content" });

      // Should trigger loadFiles to revert
      expect(mockApi.listFiles).toHaveBeenCalled();
    });

    it("does not change other files", async () => {
      useFileStore.setState({
        files: [
          {
            id: "file-1",
            name: "File 1",
            content: "Content 1",
            isFolder: false,
            parentId: null,
            position: 0,
            isFavorite: false,
            icon: null,
            coverImageUrl: null,
            coverPosition: 0.5,
            createdAt: "",
            updatedAt: "",
            wordCount: 0,
            preview: "",
          },
          {
            id: "file-2",
            name: "File 2",
            content: "Content 2",
            isFolder: false,
            parentId: null,
            position: 0,
            isFavorite: false,
            icon: null,
            coverImageUrl: null,
            coverPosition: 0.5,
            createdAt: "",
            updatedAt: "",
            wordCount: 0,
            preview: "",
          },
        ],
      });
      mockApi.updateFile.mockResolvedValueOnce({});

      await useFileStore.getState().updateFile("file-1", { content: "Updated" });

      const files = useFileStore.getState().files;
      expect(files[1].content).toBe("Content 2");
    });
  });

  // ============================================================================
  // deleteFile tests
  // ============================================================================
  describe("deleteFile", () => {
    beforeEach(() => {
      useFileStore.setState({
        files: [
          {
            id: "file-1",
            name: "File 1",
            content: "",
            isFolder: false,
            parentId: null,
            position: 0,
            isFavorite: false,
            icon: null,
            coverImageUrl: null,
            coverPosition: 0.5,
            createdAt: "",
            updatedAt: "",
            wordCount: 0,
            preview: "",
          },
          {
            id: "file-2",
            name: "File 2",
            content: "",
            isFolder: false,
            parentId: null,
            position: 0,
            isFavorite: false,
            icon: null,
            coverImageUrl: null,
            coverPosition: 0.5,
            createdAt: "",
            updatedAt: "",
            wordCount: 0,
            preview: "",
          },
        ],
        currentFileId: "file-1",
      });
    });

    it("removes file from store", async () => {
      mockApi.deleteFile.mockResolvedValueOnce({});

      await useFileStore.getState().deleteFile("file-1");

      const files = useFileStore.getState().files;
      expect(files).toHaveLength(1);
      expect(files[0].id).toBe("file-2");
    });

    it("calls API to delete", async () => {
      mockApi.deleteFile.mockResolvedValueOnce({});

      await useFileStore.getState().deleteFile("file-1");

      expect(mockApi.deleteFile).toHaveBeenCalledWith("file-1");
    });

    it("deletes associated chat conversation", async () => {
      mockApi.deleteFile.mockResolvedValueOnce({});

      await useFileStore.getState().deleteFile("file-1");

      expect(mockDeleteConversation).toHaveBeenCalledWith("file-1");
    });

    it("switches current file when deleting current", async () => {
      mockApi.deleteFile.mockResolvedValueOnce({});

      await useFileStore.getState().deleteFile("file-1");

      expect(useFileStore.getState().currentFileId).toBe("file-2");
    });

    it("sets currentFileId to null when deleting last file", async () => {
      useFileStore.setState({
        files: [
          {
            id: "file-1",
            name: "File 1",
            content: "",
            isFolder: false,
            parentId: null,
            position: 0,
            isFavorite: false,
            icon: null,
            coverImageUrl: null,
            coverPosition: 0.5,
            createdAt: "",
            updatedAt: "",
            wordCount: 0,
            preview: "",
          },
        ],
        currentFileId: "file-1",
      });
      mockApi.deleteFile.mockResolvedValueOnce({});

      await useFileStore.getState().deleteFile("file-1");

      expect(useFileStore.getState().currentFileId).toBeNull();
      expect(useFileStore.getState().files).toHaveLength(0);
    });

    it("keeps currentFileId unchanged when deleting different file", async () => {
      mockApi.deleteFile.mockResolvedValueOnce({});

      await useFileStore.getState().deleteFile("file-2");

      expect(useFileStore.getState().currentFileId).toBe("file-1");
    });

    it("reverts on API error", async () => {
      mockApi.deleteFile.mockRejectedValueOnce(new Error("Server error"));
      mockApi.listFiles.mockResolvedValueOnce([
        { id: "file-1", name: "File 1", content: "", created_at: "", updated_at: "" },
        { id: "file-2", name: "File 2", content: "", created_at: "", updated_at: "" },
      ]);

      await useFileStore.getState().deleteFile("file-1");

      // Should trigger loadFiles to revert
      expect(mockApi.listFiles).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // setCurrentFile tests
  // ============================================================================
  describe("setCurrentFile", () => {
    it("sets current file id", () => {
      useFileStore.getState().setCurrentFile("file-123");

      expect(useFileStore.getState().currentFileId).toBe("file-123");
    });

    it("can set to null", () => {
      useFileStore.setState({ currentFileId: "file-123" });

      useFileStore.getState().setCurrentFile(null);

      expect(useFileStore.getState().currentFileId).toBeNull();
    });
  });

  // ============================================================================
  // renameFile tests
  // ============================================================================
  describe("renameFile", () => {
    beforeEach(() => {
      useFileStore.setState({
        files: [
          {
            id: "file-1",
            name: "Original",
            content: "Content",
            isFolder: false,
            parentId: null,
            position: 0,
            isFavorite: false,
            icon: null,
            coverImageUrl: null,
            coverPosition: 0.5,
            createdAt: "",
            updatedAt: "",
            wordCount: 0,
            preview: "",
          },
        ],
      });
    });

    it("updates file name", async () => {
      mockApi.updateFile.mockResolvedValueOnce({});

      await useFileStore.getState().renameFile("file-1", "New Name");

      const file = useFileStore.getState().files[0];
      expect(file.name).toBe("New Name");
    });

    it("calls updateFile with name only", async () => {
      mockApi.updateFile.mockResolvedValueOnce({});

      await useFileStore.getState().renameFile("file-1", "New Name");

      expect(mockApi.updateFile).toHaveBeenCalledWith("file-1", { name: "New Name" });
    });
  });

  // ============================================================================
  // getFile tests
  // ============================================================================
  describe("getFile", () => {
    beforeEach(() => {
      useFileStore.setState({
        files: [
          {
            id: "file-1",
            name: "File 1",
            content: "Content 1",
            isFolder: false,
            parentId: null,
            position: 0,
            isFavorite: false,
            icon: null,
            coverImageUrl: null,
            coverPosition: 0.5,
            createdAt: "",
            updatedAt: "",
            wordCount: 0,
            preview: "",
          },
          {
            id: "file-2",
            name: "File 2",
            content: "Content 2",
            isFolder: false,
            parentId: null,
            position: 0,
            isFavorite: false,
            icon: null,
            coverImageUrl: null,
            coverPosition: 0.5,
            createdAt: "",
            updatedAt: "",
            wordCount: 0,
            preview: "",
          },
        ],
      });
    });

    it("returns file by id", () => {
      const file = useFileStore.getState().getFile("file-1");

      expect(file).toBeDefined();
      expect(file?.name).toBe("File 1");
    });

    it("returns undefined for non-existent id", () => {
      const file = useFileStore.getState().getFile("non-existent");

      expect(file).toBeUndefined();
    });
  });

  // ==========================================================================
  // setFileIcon
  // ==========================================================================
  describe("setFileIcon", () => {
    beforeEach(() => {
      useFileStore.setState({
        files: [
          {
            id: "file-1",
            name: "File 1",
            content: "Content 1",
            isFolder: false,
            parentId: null,
            position: 0,
            isFavorite: false,
            icon: null,
            coverImageUrl: null,
            coverPosition: 0.5,
            createdAt: "",
            updatedAt: "",
            wordCount: 0,
            preview: "",
          },
        ],
      });
    });

    it("sets an emoji icon on a file", async () => {
      mockApi.updateFile.mockResolvedValue({});

      await useFileStore.getState().setFileIcon("file-1", "📝");

      const file = useFileStore.getState().getFile("file-1");
      expect(file?.icon).toBe("📝");
    });

    it("removes icon when set to null", async () => {
      // Start with an icon
      useFileStore.setState({
        files: [
          {
            id: "file-1",
            name: "File 1",
            content: "Content 1",
            isFolder: false,
            parentId: null,
            position: 0,
            isFavorite: false,
            icon: "📝",
            coverImageUrl: null,
            coverPosition: 0.5,
            createdAt: "",
            updatedAt: "",
            wordCount: 0,
            preview: "",
          },
        ],
      });
      mockApi.updateFile.mockResolvedValue({});

      await useFileStore.getState().setFileIcon("file-1", null);

      const file = useFileStore.getState().getFile("file-1");
      expect(file?.icon).toBeNull();
    });

    it("calls API with empty string to clear icon", async () => {
      mockApi.updateFile.mockResolvedValue({});

      await useFileStore.getState().setFileIcon("file-1", null);

      expect(mockApi.updateFile).toHaveBeenCalledWith("file-1", { icon: "" });
    });

    it("calls API with emoji string to set icon", async () => {
      mockApi.updateFile.mockResolvedValue({});

      await useFileStore.getState().setFileIcon("file-1", "🚀");

      expect(mockApi.updateFile).toHaveBeenCalledWith("file-1", { icon: "🚀" });
    });

    it("does nothing for non-existent file", async () => {
      await useFileStore.getState().setFileIcon("non-existent", "📝");

      expect(mockApi.updateFile).not.toHaveBeenCalled();
    });

    it("reverts icon on API error", async () => {
      mockApi.updateFile.mockRejectedValue(new Error("Server error"));

      await useFileStore.getState().setFileIcon("file-1", "📝");

      // Should revert to original null icon
      const file = useFileStore.getState().getFile("file-1");
      expect(file?.icon).toBeNull();
    });

    it("reverts to previous icon on API error", async () => {
      // Start with an existing icon
      useFileStore.setState({
        files: [
          {
            id: "file-1",
            name: "File 1",
            content: "",
            isFolder: false,
            parentId: null,
            position: 0,
            isFavorite: false,
            icon: "\u{1F4DD}",
            coverImageUrl: null,
            coverPosition: 0.5,
            createdAt: "",
            updatedAt: "",
            wordCount: 0,
            preview: "",
          },
        ],
      });
      mockApi.updateFile.mockRejectedValue(new Error("Server error"));

      await useFileStore.getState().setFileIcon("file-1", "🔥");

      // Should revert to the previous icon
      const file = useFileStore.getState().getFile("file-1");
      expect(file?.icon).toBe("\u{1F4DD}");
    });
  });
});
