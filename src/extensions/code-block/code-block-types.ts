export interface Language {
  id: string;
  name: string;
  aliases?: string[];
}

export const SUPPORTED_LANGUAGES: Language[] = [
  // Popular languages
  { id: "javascript", name: "JavaScript", aliases: ["js"] },
  { id: "typescript", name: "TypeScript", aliases: ["ts"] },
  { id: "python", name: "Python", aliases: ["py"] },
  { id: "java", name: "Java" },
  { id: "cpp", name: "C++", aliases: ["c++"] },
  { id: "c", name: "C" },
  { id: "csharp", name: "C#", aliases: ["cs", "c#"] },
  { id: "go", name: "Go", aliases: ["golang"] },
  { id: "rust", name: "Rust", aliases: ["rs"] },
  { id: "ruby", name: "Ruby", aliases: ["rb"] },
  { id: "php", name: "PHP" },
  { id: "swift", name: "Swift" },
  { id: "kotlin", name: "Kotlin", aliases: ["kt"] },

  // Web
  { id: "html", name: "HTML" },
  { id: "css", name: "CSS" },
  { id: "scss", name: "SCSS", aliases: ["sass"] },
  { id: "json", name: "JSON" },
  { id: "xml", name: "XML" },
  { id: "yaml", name: "YAML", aliases: ["yml"] },
  { id: "graphql", name: "GraphQL", aliases: ["gql"] },

  // Shell & Config
  { id: "bash", name: "Bash", aliases: ["shell", "sh", "zsh"] },
  { id: "powershell", name: "PowerShell", aliases: ["ps", "ps1"] },
  { id: "dockerfile", name: "Dockerfile", aliases: ["docker"] },

  // Database
  { id: "sql", name: "SQL" },

  // Markup
  { id: "markdown", name: "Markdown", aliases: ["md"] },
  { id: "plaintext", name: "Plain Text", aliases: ["text", "txt"] },
];

export const POPULAR_LANGUAGE_IDS = [
  "javascript",
  "typescript",
  "python",
  "java",
  "html",
  "css",
  "json",
];

export function findLanguageById(id: string): Language | undefined {
  return SUPPORTED_LANGUAGES.find(
    (lang) =>
      lang.id === id || lang.aliases?.includes(id.toLowerCase())
  );
}

export function getLanguageDisplayName(id: string | null | undefined): string {
  if (!id) return "Plain Text";
  const lang = findLanguageById(id);
  return lang?.name || id;
}

export function getPopularLanguages(): Language[] {
  return SUPPORTED_LANGUAGES.filter((lang) =>
    POPULAR_LANGUAGE_IDS.includes(lang.id)
  );
}

export function getOtherLanguages(): Language[] {
  return SUPPORTED_LANGUAGES.filter(
    (lang) => !POPULAR_LANGUAGE_IDS.includes(lang.id)
  );
}

export function searchLanguages(query: string): Language[] {
  if (!query.trim()) return SUPPORTED_LANGUAGES;

  const q = query.toLowerCase();
  return SUPPORTED_LANGUAGES.filter(
    (lang) =>
      lang.name.toLowerCase().includes(q) ||
      lang.id.toLowerCase().includes(q) ||
      lang.aliases?.some((alias) => alias.toLowerCase().includes(q))
  );
}
