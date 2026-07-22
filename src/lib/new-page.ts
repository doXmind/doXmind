import type { OpenTarget } from "@/stores/file-store";

export interface NewPageContext {
  openTarget: OpenTarget;
  rootPath: string | null;
  nextUntitledName: () => string;
  createFile: (name: string, markdown?: string, parentId?: string | null) => Promise<string>;
  createTransientFile: (name: string) => string;
}

/** Create on disk only for an opened folder; all other contexts get a draft. */
export async function createPageForContext(context: NewPageContext): Promise<string> {
  const name = context.nextUntitledName();
  if (context.openTarget === "folder" && context.rootPath) {
    return context.createFile(name, "", null);
  }
  return context.createTransientFile(name);
}
