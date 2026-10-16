import type { Extension, JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Table,
  TableRow,
  TableCell,
  TableHeader,
} from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";

export interface DocumentHeadingItem {
  id: string;
  level: 1 | 2 | 3;
  text: string;
  pos: number;
}

export interface SlashCommandDefinition {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  shortcut: string;
}

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  {
    id: "h1",
    title: "Heading 1",
    description: "Large top-level section heading",
    keywords: ["h1", "heading", "title", "large"],
    shortcut: "#",
  },
  {
    id: "h2",
    title: "Heading 2",
    description: "Medium section heading",
    keywords: ["h2", "heading", "subtitle", "medium"],
    shortcut: "##",
  },
  {
    id: "h3",
    title: "Heading 3",
    description: "Compact subsection heading",
    keywords: ["h3", "heading", "small", "sub"],
    shortcut: "###",
  },
  {
    id: "bulletList",
    title: "Bullet List",
    description: "Create an unordered bulleted list",
    keywords: ["ul", "bullet", "list", "unordered"],
    shortcut: "-",
  },
  {
    id: "orderedList",
    title: "Numbered List",
    description: "Create a sequential numbered list",
    keywords: ["ol", "numbered", "ordered", "list", "1"],
    shortcut: "1.",
  },
  {
    id: "taskList",
    title: "Task List",
    description: "Track action items with checkboxes",
    keywords: ["todo", "task", "checkbox", "check"],
    shortcut: "[]",
  },
  {
    id: "blockquote",
    title: "Blockquote",
    description: "Highlight an important quote or callout",
    keywords: ["quote", "blockquote", "callout"],
    shortcut: ">",
  },
  {
    id: "codeBlock",
    title: "Code Block",
    description: "Insert a monospace technical code snippet",
    keywords: ["code", "pre", "snippet", "terminal"],
    shortcut: "```",
  },
  {
    id: "table",
    title: "Table (3x3)",
    description: "Insert a structured resizable data table",
    keywords: ["table", "grid", "rows", "columns"],
    shortcut: "|",
  },
  {
    id: "horizontalRule",
    title: "Divider",
    description: "Visually separate document sections",
    keywords: ["hr", "divider", "line", "rule", "separator"],
    shortcut: "---",
  },
];

/**
 * Validates that a user-provided link URL uses a safe protocol (http, https, mailto)
 * to prevent javascript: or data: URI XSS injection.
 */
export function isSafeLinkUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== "string") {
    return false;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "mailto:"
    );
  } catch {
    return false;
  }
}

/**
 * Normalizes a user-entered URL by prefixing https:// when no protocol is present,
 * and returns null if the resulting URL is unsafe or invalid.
 */
export function normalizeSafeLinkUrl(rawInput: string): string | null {
  if (!rawInput || typeof rawInput !== "string") {
    return null;
  }
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return null;
  }

  const candidate =
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;

  return isSafeLinkUrl(candidate) ? candidate : null;
}

/**
 * Filters slash commands by a query string entered after '/'.
 */
export function filterSlashCommands(query: string): SlashCommandDefinition[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return SLASH_COMMANDS;
  }

  return SLASH_COMMANDS.filter(
    (cmd) =>
      cmd.title.toLowerCase().includes(normalized) ||
      cmd.description.toLowerCase().includes(normalized) ||
      cmd.keywords.some((kw) => kw.includes(normalized))
  );
}

/**
 * Extracts H1-H3 headings from a Tiptap JSONContent tree for the Document Outline panel.
 */
export function extractHeadingsFromJson(
  docJson: JSONContent | null | undefined
): DocumentHeadingItem[] {
  if (!docJson?.content || !Array.isArray(docJson.content)) {
    return [];
  }

  const headings: DocumentHeadingItem[] = [];
  let index = 0;

  for (const node of docJson.content) {
    if (node.type === "heading") {
      const level = Number(node.attrs?.level ?? 1);
      if (level === 1 || level === 2 || level === 3) {
        const text = (node.content ?? [])
          .map((child) => (typeof child.text === "string" ? child.text : ""))
          .join("")
          .trim();

        if (text.length > 0) {
          headings.push({
            id: `heading-${index}-${level}`,
            level,
            text,
            pos: index,
          });
        }
      }
    }
    index += 1;
  }

  return headings;
}

/**
 * Builds the default initial content for a newly created collaborative document.
 */
export function buildDefaultDocumentContent(title: string): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Overview & Objectives" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `Welcome to "${title}". This collaborative specification is powered by Tiptap, Yjs CRDTs, and Liveblocks rooms. Type '/' on any line to insert headings, lists, code blocks, or tables.`,
          },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Key Decisions & Architecture" }],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    marks: [{ type: "bold" }],
                    text: "Conflict-Free Replicated Data Types (Yjs): ",
                  },
                  {
                    type: "text",
                    text: "Concurrent edits merge deterministically across connected collaborators.",
                  },
                ],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    marks: [{ type: "bold" }],
                    text: "Zero-Trust Room Authorization: ",
                  },
                  {
                    type: "text",
                    text: "Access tokens are minted strictly by /api/liveblocks-auth after verifying PostgreSQL RBAC and per-artifact permission overrides.",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Creates the standard SyncSpace Tiptap extension suite.
 * Disables StarterKit's built-in undoRedo when a Liveblocks/Yjs extension is attached
 * so Yjs UndoManager handles collaborative undo/redo without reverting remote users' edits.
 */
export function createDocumentEditorExtensions(options?: {
  liveblocksExtension?: Extension | null;
  placeholder?: string;
}) {
  const hasCollaborativeUndo = Boolean(options?.liveblocksExtension);

  const extensions = [
    StarterKit.configure({
      // Disable Tiptap's local undoRedo when Liveblocks Yjs collaboration extension is active
      undoRedo: hasCollaborativeUndo ? false : undefined,
      heading: {
        levels: [1, 2, 3],
      },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
        isAllowedUri: (url) => isSafeLinkUrl(url),
      },
    }),
    Placeholder.configure({
      placeholder:
        options?.placeholder ??
        "Write technical specifications, type '/' for commands...",
    }),
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
  ];

  if (options?.liveblocksExtension) {
    extensions.push(options.liveblocksExtension);
  }

  return extensions;
}
