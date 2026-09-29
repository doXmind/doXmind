export async function createUntitledPage(
  createFile: (name: string, markdown: string, parentId: string | null) => Promise<string>,
  firstNumber: number,
  parentId: string | null
): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const name = `Untitled-${firstNumber + attempt}.md`;
    try {
      return await createFile(name, "", parentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/document already exists|destination already exists/i.test(message)) throw error;
    }
  }
  throw new Error("Could not find an available Untitled Page name");
}
