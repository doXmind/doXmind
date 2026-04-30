import { api, type ApiClient } from "@/lib/api";

import type {
  DocumentContent,
  DocumentHandle,
  StorageAdapter,
  StorageCreateInput,
  StorageWriteInput,
  WorkspaceEntry,
} from "./types";

type FilesApi = Pick<
  ApiClient,
  "listFiles" | "getFile" | "createFile" | "updateFile" | "createFolder" | "moveFile" | "deleteFile"
>;

interface DbFileRecord {
  id: string;
  name: string;
  content: string;
  content_markdown?: string | null;
  is_folder: boolean;
  parent_id: string | null;
  position: number;
  is_favorite: boolean;
  icon: string | null;
  cover_image_url: string | null;
  cover_position: number;
  created_at: string;
  updated_at: string;
  word_count?: number;
  preview?: string;
}

export interface DbStorageAdapterOptions {
  apiClient?: FilesApi;
}

export class DbStorageAdapter implements StorageAdapter {
  readonly mode = "db" as const;

  private readonly apiClient: FilesApi;

  constructor(options: DbStorageAdapterOptions = {}) {
    this.apiClient = options.apiClient ?? api;
  }

  async list(parent?: DocumentHandle | null): Promise<WorkspaceEntry[]> {
    const files = await this.apiClient.listFiles();
    const parentId = parent === undefined ? undefined : (parent?.id ?? null);

    return files
      .filter((file) => parentId === undefined || file.parent_id === parentId)
      .map((file) => this.toWorkspaceEntry(file));
  }

  async read(handle: DocumentHandle): Promise<DocumentContent> {
    const file = await this.apiClient.getFile(handle.id);
    return this.toDocumentContent(file);
  }

  async write(handle: DocumentHandle, content: StorageWriteInput): Promise<DocumentContent> {
    const file = await this.apiClient.updateFile(handle.id, {
      ...(content.name === undefined ? {} : { name: content.name }),
      ...(content.html === undefined ? {} : { content: content.html }),
      ...(content.markdown === undefined ? {} : { content_markdown: content.markdown ?? "" }),
    });

    return this.toDocumentContent(
      this.normalizeFile(file, {
        ...this.fallbackFile(handle),
        name: content.name ?? "Untitled",
        content: content.html ?? "",
        content_markdown: content.markdown ?? null,
      })
    );
  }

  async create(input: StorageCreateInput): Promise<WorkspaceEntry> {
    const parentId = input.parent?.id ?? null;
    const kind = input.kind ?? "document";
    const file =
      kind === "folder"
        ? await this.apiClient.createFolder(input.name, parentId)
        : await this.apiClient.createFile(input.name, input.content?.html ?? "", parentId);

    if (kind === "document" && input.content?.markdown !== undefined) {
      await this.apiClient.updateFile(file.id, {
        content_markdown: input.content.markdown ?? "",
      });
    }

    return this.toWorkspaceEntry(file);
  }

  async rename(handle: DocumentHandle, name: string): Promise<WorkspaceEntry> {
    const file = await this.apiClient.updateFile(handle.id, { name });
    return this.toWorkspaceEntry(
      this.normalizeFile(file, {
        ...this.fallbackFile(handle),
        name,
      })
    );
  }

  async move(handle: DocumentHandle, parent: DocumentHandle | null): Promise<WorkspaceEntry> {
    const file = await this.apiClient.moveFile(handle.id, parent?.id ?? null);
    return this.toWorkspaceEntry(file);
  }

  async delete(handle: DocumentHandle): Promise<void> {
    await this.apiClient.deleteFile(handle.id);
  }

  private toHandle(id: string): DocumentHandle {
    return { mode: this.mode, id };
  }

  private fallbackFile(handle: DocumentHandle): DbFileRecord {
    const now = new Date().toISOString();
    return {
      id: handle.id,
      name: "Untitled",
      content: "",
      content_markdown: null,
      is_folder: handle.kind === "folder",
      parent_id: null,
      position: 0,
      is_favorite: false,
      icon: null,
      cover_image_url: null,
      cover_position: 0.5,
      created_at: now,
      updated_at: now,
      word_count: 0,
      preview: "",
    };
  }

  private normalizeFile(
    file: Partial<DbFileRecord> | null | undefined,
    fallback: DbFileRecord
  ): DbFileRecord {
    return {
      id: file?.id ?? fallback.id,
      name: file?.name ?? fallback.name,
      content: file?.content ?? fallback.content,
      content_markdown: file?.content_markdown ?? fallback.content_markdown,
      is_folder: file?.is_folder ?? fallback.is_folder,
      parent_id: file?.parent_id ?? fallback.parent_id,
      position: file?.position ?? fallback.position,
      is_favorite: file?.is_favorite ?? fallback.is_favorite,
      icon: file?.icon ?? fallback.icon,
      cover_image_url: file?.cover_image_url ?? fallback.cover_image_url,
      cover_position: file?.cover_position ?? fallback.cover_position,
      created_at: file?.created_at ?? fallback.created_at,
      updated_at: file?.updated_at ?? fallback.updated_at,
      word_count: file?.word_count ?? fallback.word_count,
      preview: file?.preview ?? fallback.preview,
    };
  }

  private toParentHandle(parentId: string | null): DocumentHandle | null {
    return parentId ? this.toHandle(parentId) : null;
  }

  private toWorkspaceEntry(file: DbFileRecord): WorkspaceEntry {
    return {
      handle: this.toHandle(file.id),
      kind: file.is_folder ? "folder" : "document",
      name: file.name,
      parent: this.toParentHandle(file.parent_id),
      position: file.position,
      createdAt: file.created_at,
      updatedAt: file.updated_at,
      preview: file.preview,
      wordCount: file.word_count,
      isFavorite: file.is_favorite,
      icon: file.icon,
      coverImageUrl: file.cover_image_url,
      coverPosition: file.cover_position,
    };
  }

  private toDocumentContent(file: DbFileRecord): DocumentContent {
    return {
      handle: { ...this.toHandle(file.id), kind: file.is_folder ? "folder" : "document" },
      name: file.name,
      html: file.content,
      markdown: file.content_markdown ?? null,
      meta: {
        id: file.id,
        title: file.name,
        icon: file.icon,
        favorite: file.is_favorite,
        cover: file.cover_image_url,
        created: file.created_at,
        updated: file.updated_at,
      },
      updatedAt: file.updated_at,
    };
  }
}
