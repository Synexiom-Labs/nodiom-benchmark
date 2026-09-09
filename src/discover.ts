import { Nodiom } from "@synexiom-labs/nodiom";
import type { OutlineNode } from "@synexiom-labs/nodiom";
import type { Operation } from "./targets.js";

type Section = {
  selector: string;
  body: string;
};

function walk(
  nodes: OutlineNode[],
  prefix: string[],
  out: Section[],
  doc: Nodiom
): void {
  for (const node of nodes) {
    const segment = `${"#".repeat(node.depth)} ${node.heading}`;
    const path = [...prefix, segment];
    const selector = path.join(" > ");

    if (node.children.length === 0) {
      try {
        out.push({ selector, body: doc.read(selector) });
      } catch {
        /* Ignore headings the selector grammar cannot address. */
      }
    }

    walk(node.children, path, out, doc);
  }
}

/**
 * A sentence that exists verbatim in the body.
 *
 * Scans line by line rather than joining the prose first: a sentence
 * assembled across a line break is not a literal substring of the
 * document, so no edit could be anchored to it.
 */
function firstSentence(body: string): string | null {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();

    if (
      line.length === 0 ||
      line.startsWith("#") ||
      line.startsWith("-") ||
      line.startsWith("*") ||
      line.startsWith("|") ||
      line.startsWith("```") ||
      line.startsWith(">") ||
      line.startsWith("    ")
    ) {
      continue;
    }

    const match = line.match(/[A-Z][^.!?]{30,280}[.!?]/);

    if (match) return match[0];
  }

  return null;
}

/**
 * Derives edit targets from any Markdown document, so the demo can be
 * pointed at a customer's own file instead of the synthetic corpus.
 */
export function discoverOperations(
  markdown: string,
  count = 5
): Operation[] {
  const doc = Nodiom.fromString(markdown);

  const sections: Section[] = [];
  walk(doc.tree(), [], sections, doc);

  const usable = sections.filter(
    section => firstSentence(section.body) !== null
  );

  if (usable.length === 0) {
    throw new Error(
      "No prose sections found to edit. Nodiom needs headings with " +
        "paragraph text under them."
    );
  }

  const picked: Operation[] = [];

  for (let i = 0; i < Math.min(count, usable.length); i++) {
    /* Spread the picks across the document rather than clustering. */
    const position = Math.floor(
      ((i + 0.5) / Math.min(count, usable.length)) * usable.length
    );

    const section = usable[Math.min(position, usable.length - 1)];
    const sentence = firstSentence(section.body)!;

    if (picked.some(operation => operation.selector === section.selector)) {
      continue;
    }

    picked.push({
      name: section.selector.split(" > ").pop()!.replace(/^#+\s*/, ""),
      project: "",
      selector: section.selector,
      searchTerm: sentence,
      replacement: `${sentence.replace(/[.!?]$/, "")}, as revised by an automated agent.`,
      expected: sentence
    });
  }

  return picked;
}
