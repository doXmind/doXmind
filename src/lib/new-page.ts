import type { OpenTarget } from "@/stores/file-store";

export interface NewPageContext {
  openTarget: OpenTarget;
  rootPath: string | null;
  nextUntitledName: () => string;
  createFile: (name: string, markdown?: string, parentId?: string | null) => Promise<string>;
  createTransientFile: (name: string) => string;
}

/** Append `.md` unless the user already typed a Markdown extension. */
export function ensurePageExtension(name: string): string {
  return /\.(md|markdown)$/i.test(name) ? name : `${name}.md`;
}

/**
 * Create on disk only for an opened folder; all other contexts get a draft.
 *
 * `name` is the title the user typed — the quick switcher offers to create the Page they were
 * looking for. Without one the next Untitled name is used.
 */
export async function createPageForContext(
  context: NewPageContext,
  name?: string
): Promise<string> {
  const requested = name?.trim();
  if (requested) {
    const fileName = ensurePageExtension(requested);
    if (context.openTarget === "folder" && context.rootPath) {
      return context.createFile(fileName, "", null);
    }
    return context.createTransientFile(fileName);
  }
  return createUntitledPage(context);
}

async function createUntitledPage(context: NewPageContext): Promise<string> {
  const name = context.nextUntitledName();
  if (context.openTarget === "folder" && context.rootPath) {
    return context.createFile(name, "", null);
  }
  return context.createTransientFile(name);
}
