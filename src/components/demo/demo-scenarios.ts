/**
 * Demo Scenarios - Predefined mock data for the demo mode
 *
 * This provides a fully offline demo experience with:
 * - Preset user action options
 * - Mock AI responses with simulated streaming
 * - Mock edits that get applied to the document
 */

// Icon names from lucide-react
export type IconName = "wand" | "check-circle" | "table" | "file-text" | "list";

export interface DemoScenario {
  id: string;
  label: string;
  icon: IconName;
  description: string;
  // Mock thinking content
  thinking: string;
  // Mock tool calls to display
  tools: Array<{
    name: string;
    status: "running" | "completed";
    message: string;
    duration: number; // ms to show this tool
  }>;
  // The AI response text (will be streamed)
  response: string;
  // Optional: edit to apply to the document
  edit?: {
    type: "replace" | "insert" | "append";
    // For replace: find this HTML and replace it
    search?: string;
    // Plain text version of search for finding position in document
    searchText?: string;
    // The new content (HTML)
    content: string;
    // Plain text version of new content for diff display
    newContentText?: string;
  };
}

// Demo document content - a sample project proposal with intentional issues for AI to fix
export const DEMO_DOCUMENT_CONTENT = `<h1>Project Proposal: AI Writing Assistant</h1>

<p>This document outlines our plan to build an AI-powered writing assistant that help users create better content more efficently.</p>

<h2>Problem Statement</h2>

<p>Many people struggle with writing. They face challenges like:</p>
<ul>
<li>Writers block and lack of inspiration</li>
<li>Grammar and spelling mistakes</li>
<li>Unclear or verbose expressions</li>
<li>Difficulty organizing thoughts</li>
</ul>

<h2>Our Solution</h2>

<p>We propose building an intelligent writing assistant with the following features:</p>

<p>Real-time suggestions, Grammar checking, Style improvements, Content generation</p>

<h2>Timeline</h2>

<p>Phase 1: Research (2 weeks), Phase 2: Development (8 weeks), Phase 3: Testing (2 weeks), Phase 4: Launch (1 week)</p>

<h2>Conclusion</h2>

<p>This project will revolutionize how people write by providing intelligent, context-aware assistance throughout the writing process.</p>
`;

// Predefined scenarios that match the demo document content
export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "improve-intro",
    label: "Improve Introduction",
    icon: "wand",
    description: "Fix typos and enhance the opening paragraph",
    thinking:
      "Let me analyze the introduction. I notice some typos: 'help' should be 'helps' for subject-verb agreement, and 'efficently' is misspelled. I'll also make the language more engaging.",
    tools: [
      {
        name: "Analyzing document",
        status: "completed",
        message: "Found issues in intro",
        duration: 600,
      },
      { name: "Editing", status: "completed", message: "Introduction improved", duration: 1000 },
    ],
    response:
      'I\'ve improved the introduction:\n\n- Fixed **"help"** → **"helps"** (subject-verb agreement)\n- Fixed **"efficently"** → **"efficiently"** (spelling)\n- Made the language more professional and engaging',
    edit: {
      type: "replace",
      search:
        "<p>This document outlines our plan to build an AI-powered writing assistant that help users create better content more efficently.</p>",
      searchText:
        "This document outlines our plan to build an AI-powered writing assistant that help users create better content more efficently.",
      content:
        "<p>This document outlines our vision for an innovative AI-powered writing assistant designed to help users create compelling, polished content with greater efficiency and confidence.</p>",
      newContentText:
        "This document outlines our vision for an innovative AI-powered writing assistant designed to help users create compelling, polished content with greater efficiency and confidence.",
    },
  },
  {
    id: "fix-grammar",
    label: "Fix Grammar Issues",
    icon: "check-circle",
    description: 'Correct the apostrophe in "Writers block"',
    thinking:
      "Scanning the document for grammar issues. I found that 'Writers block' is missing an apostrophe - it should be \"Writer's block\" to show possession.",
    tools: [
      { name: "Grammar check", status: "completed", message: "Found 1 issue", duration: 500 },
      { name: "Applying fix", status: "completed", message: "Grammar corrected", duration: 800 },
    ],
    response:
      'Fixed the grammar issue:\n\n**"Writers block"** → **"Writer\'s block"**\n\nThe apostrophe indicates possession (the block that belongs to the writer).',
    edit: {
      type: "replace",
      search: "<li>Writers block and lack of inspiration</li>",
      searchText: "Writers block and lack of inspiration",
      content: "<li>Writer's block and lack of inspiration</li>",
      newContentText: "Writer's block and lack of inspiration",
    },
  },
  {
    id: "create-timeline-table",
    label: "Create Timeline Table",
    icon: "table",
    description: "Convert the timeline into a structured table",
    thinking:
      "The timeline section currently lists phases in a comma-separated format. Converting this to a table will make it much clearer and easier to scan.",
    tools: [
      { name: "Parsing content", status: "completed", message: "Found 4 phases", duration: 400 },
      { name: "Creating table", status: "completed", message: "Table generated", duration: 1200 },
    ],
    response:
      "I've converted the timeline into a clear table format with columns for Phase, Activity, and Duration. This makes the project schedule much easier to understand at a glance.",
    edit: {
      type: "replace",
      search:
        "<p>Phase 1: Research (2 weeks), Phase 2: Development (8 weeks), Phase 3: Testing (2 weeks), Phase 4: Launch (1 week)</p>",
      searchText:
        "Phase 1: Research (2 weeks), Phase 2: Development (8 weeks), Phase 3: Testing (2 weeks), Phase 4: Launch (1 week)",
      content: `<table>
<thead>
<tr><th>Phase</th><th>Activity</th><th>Duration</th></tr>
</thead>
<tbody>
<tr><td>1</td><td>Research</td><td>2 weeks</td></tr>
<tr><td>2</td><td>Development</td><td>8 weeks</td></tr>
<tr><td>3</td><td>Testing</td><td>2 weeks</td></tr>
<tr><td>4</td><td>Launch</td><td>1 week</td></tr>
</tbody>
</table>`,
      newContentText:
        "Phase | Activity | Duration\n1 | Research | 2 weeks\n2 | Development | 8 weeks\n3 | Testing | 2 weeks\n4 | Launch | 1 week",
    },
  },
  {
    id: "summarize",
    label: "Generate Summary",
    icon: "file-text",
    description: "Create a brief executive summary",
    thinking:
      "Let me analyze the document structure and extract the key points for an executive summary. The document covers the problem, solution, and timeline for an AI writing assistant project.",
    tools: [
      {
        name: "Reading document",
        status: "completed",
        message: "Analyzed 5 sections",
        duration: 600,
      },
      { name: "Generating summary", status: "completed", message: "Summary ready", duration: 1000 },
    ],
    response:
      "## Executive Summary\n\n**Project:** AI Writing Assistant\n\n**Problem:** Users struggle with writer's block, grammar errors, unclear writing, and organizing thoughts.\n\n**Solution:** An intelligent assistant offering real-time suggestions, grammar checking, style improvements, and content generation.\n\n**Timeline:** 13 weeks total (Research → Development → Testing → Launch)",
  },
  {
    id: "format-features",
    label: "Format Feature List",
    icon: "list",
    description: "Convert features to a proper bullet list",
    thinking:
      "The features in the Solution section are listed in a comma-separated paragraph. Converting these to a bullet list will improve readability and highlight each capability.",
    tools: [
      { name: "Parsing features", status: "completed", message: "Found 4 features", duration: 400 },
      { name: "Formatting list", status: "completed", message: "List created", duration: 800 },
    ],
    response:
      "I've reformatted the features as a bullet list with descriptions. Each feature now stands out clearly, making the solution section more scannable.",
    edit: {
      type: "replace",
      search:
        "<p>Real-time suggestions, Grammar checking, Style improvements, Content generation</p>",
      searchText: "Real-time suggestions, Grammar checking, Style improvements, Content generation",
      content: `<ul>
<li><strong>Real-time suggestions</strong> — Get intelligent recommendations as you type</li>
<li><strong>Grammar checking</strong> — Catch and fix errors automatically</li>
<li><strong>Style improvements</strong> — Enhance clarity and readability</li>
<li><strong>Content generation</strong> — Generate ideas and draft content with AI</li>
</ul>`,
      newContentText:
        "• Real-time suggestions — Get intelligent recommendations as you type\n• Grammar checking — Catch and fix errors automatically\n• Style improvements — Enhance clarity and readability\n• Content generation — Generate ideas and draft content with AI",
    },
  },
];

// Get a scenario by ID
export function getScenarioById(id: string): DemoScenario | undefined {
  return DEMO_SCENARIOS.find((s) => s.id === id);
}
