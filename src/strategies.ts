import { Nodiom } from "@synexiom-labs/nodiom";
import type { OutlineNode } from "@synexiom-labs/nodiom";
import type { Operation } from "./targets.js";
import { projectOffset } from "./targets.js";

export type Arm = {
  key: string;
  label: string;

  /** What the model reads. */
  inputText: string;

  /** What the model must emit. */
  outputText: string;

  /** One-time per-document cost, amortised across edits. */
  discoveryText?: string;

  note?: string;
};

/**
 * Expands a window around the target until it occurs exactly once in
 * the document, snapping to line boundaries.
 *
 * This is not a stylistic choice: a patch-based edit tool needs an
 * unambiguous `old_string`, so the agent must quote enough surrounding
 * context to make the match unique. In documents with repeated
 * structure that window is much larger than the edit itself, and the
 * agent pays for it twice — once in `old_string`, once in `new_string`.
 */
export function minimalUniqueWindow(
  document: string,
  index: number,
  length: number
): string {
  let start = index;
  let end = index + length;

  const step = 128;

  for (let guard = 0; guard < 2000; guard++) {
    const candidate = document.slice(start, end);

    const unique =
      document.indexOf(candidate) === document.lastIndexOf(candidate);

    if (unique) return candidate;

    if (start === 0 && end === document.length) return candidate;

    start = Math.max(0, start - step);
    end = Math.min(document.length, end + step);

    /* Snap to line boundaries — agents quote whole lines. */
    const lineStart = document.lastIndexOf("\n", start);
    if (lineStart !== -1) start = lineStart + 1;

    const lineEnd = document.indexOf("\n", end);
    if (lineEnd !== -1) end = lineEnd;
  }

  return document.slice(start, end);
}

/** Every line matching the term, as `grep -n` would report it. */
export function grepHits(document: string, term: string): string[] {
  const hits: string[] = [];

  const lines = document.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(term)) {
      hits.push(`${i + 1}:${lines[i]}`);
    }
  }

  return hits;
}

/**
 * The outline an agent reads once to learn which selectors exist.
 *
 * This is the full heading tree, not just the top level: an agent
 * cannot address `## Architecture > ### Backend` without having seen
 * that those headings exist. Charging Nodiom only for the top level
 * would understate its real cost.
 */
export function outline(document: string): string {
  const lines: string[] = [];

  const walk = (nodes: OutlineNode[]): void => {
    for (const node of nodes) {
      lines.push(`${"#".repeat(node.depth)} ${node.heading}`);
      walk(node.children);
    }
  };

  walk(Nodiom.fromString(document).tree());

  return lines.join("\n");
}

/**
 * Builds the four comparison arms for a single edit.
 *
 * Arm 1 is the naive ceiling. Arm 2 is what shipping coding agents
 * actually do today and is the arm that matters. Arm 3 is a
 * well-optimised agent. Arm 4 is Nodiom.
 */
export function armsFor(
  document: string,
  operation: Operation
): Arm[] {
  const anchor = projectOffset(document, operation.project);

  const index = document.indexOf(operation.searchTerm, anchor);

  if (index === -1) {
    throw new Error(
      `Search term not found in Project ${operation.project}`
    );
  }

  const oldString = minimalUniqueWindow(
    document,
    index,
    operation.searchTerm.length
  );

  const newString = oldString.replace(
    operation.searchTerm,
    operation.replacement
  );

  const editedDocument =
    document.slice(0, index) +
    operation.replacement +
    document.slice(index + operation.searchTerm.length);

  const hits = grepHits(document, operation.searchTerm);

  const doc = Nodiom.fromString(document);

  const node = doc.read(operation.selector);

  const editedNode = node.replace(
    operation.searchTerm,
    operation.replacement
  );

  return [
    {
      key: "rewrite",
      label: "Full rewrite",
      inputText: document,
      outputText: editedDocument,
      note: "model re-emits the whole document"
    },
    {
      key: "readPatch",
      label: "Read + patch",
      inputText: document,
      /* The model emits both halves of the patch. */
      outputText: `${oldString}\n${newString}`,
      note: "reads the file, emits old_string/new_string"
    },
    {
      key: "grepPatch",
      label: "Grep + patch",
      /*
       * The agent greps, receives every hit, then must read around the
       * chosen one to build an unambiguous patch.
       */
      inputText: `${hits.join("\n")}\n${oldString}`,
      outputText: `${oldString}\n${newString}`,
      note: `${hits.length} grep hit${hits.length === 1 ? "" : "s"} to disambiguate`
    },
    {
      key: "nodiom",
      label: "Nodiom",
      inputText: node,
      /*
       * No old_string: the selector addresses the location, so the
       * target never has to be re-quoted.
       */
      outputText: editedNode,
      discoveryText: outline(document),
      note: "selector addresses the node directly"
    }
  ];
}
