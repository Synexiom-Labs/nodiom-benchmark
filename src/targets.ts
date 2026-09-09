import { Nodiom } from "@synexiom-labs/nodiom";

export type Operation = {
  name: string;

  /** Zero-padded project id, e.g. "007". */
  project: string;

  /** Full Nodiom selector, e.g. "# Project 007 > ## Overview". */
  selector: string;

  searchTerm: string;
  replacement: string;
  expected: string;
};

type Blueprint = {
  name: string;

  /** Heading path below the project heading. */
  section: string;

  /** Position within the document, as a fraction of the project count. */
  depth: number;

  searchTerm: (project: string) => string;
  replacement: (project: string) => string;
};

/*
 * Every generated project shares the same section structure, so an
 * operation is described relative to a project rather than against a
 * hard-coded project number. The concrete project is chosen per document
 * in operationsFor(), because a 10kb document contains far fewer
 * projects than a 1mb one.
 */
const blueprints: Blueprint[] = [
  {
    name: "modify overview",
    section: "## Overview",
    depth: 0.15,
    searchTerm: project =>
      `Project ${project} is an internal analytics platform`,
    replacement: project =>
      `Project ${project} is now a high-priority internal analytics platform`
  },
  {
    name: "modify backend",
    section: "## Architecture > ### Backend",
    depth: 0.35,
    searchTerm: () =>
      "The backend is implemented using Node.js and PostgreSQL",
    replacement: () =>
      "The backend is implemented using Node.js, PostgreSQL, and a worker queue"
  },
  {
    name: "modify decision",
    section: "## Decisions",
    depth: 0.55,
    searchTerm: () =>
      "We selected PostgreSQL because the workload requires relational queries",
    replacement: () =>
      "We selected PostgreSQL because the workload requires relational queries and strong transactional guarantees"
  },
  {
    name: "modify notes",
    section: "## Notes",
    depth: 0.75,
    searchTerm: () =>
      "The team is currently evaluating whether Redis should be introduced",
    replacement: () =>
      "The team has postponed the Redis evaluation until the next architecture review"
  },
  {
    name: "modify risks",
    section: "## Risks",
    depth: 0.95,
    searchTerm: () => "The primary risks are database growth",
    replacement: () =>
      "The primary risks are database growth, increasing event volume, and migration complexity"
  }
];

const projectHeading = /^Project (\d+)$/;

/**
 * Returns the project ids present in the document, in document order,
 * read from the Markdown structure rather than assumed from the
 * generator.
 */
export function projectIds(markdown: string): string[] {
  const doc = Nodiom.fromString(markdown);

  return doc
    .tree()
    .filter(node => projectHeading.test(node.heading))
    .map(node => node.heading.replace(projectHeading, "$1"));
}

/**
 * Builds the operation set for a specific document. Targets are spread
 * across the document so that each size is exercised at real depth
 * instead of always editing the first few projects.
 */
export function operationsFor(markdown: string): Operation[] {
  const ids = projectIds(markdown);

  if (ids.length === 0) {
    throw new Error(
      "No '# Project NNN' sections found. Run `npm run generate` first."
    );
  }

  return blueprints.map(blueprint => {
    const position = Math.min(
      ids.length,
      Math.max(1, Math.ceil(blueprint.depth * ids.length))
    );

    const project = ids[position - 1];

    return {
      name: blueprint.name,
      project,
      selector: `# Project ${project} > ${blueprint.section}`,
      searchTerm: blueprint.searchTerm(project),
      replacement: blueprint.replacement(project),
      expected: blueprint.searchTerm(project)
    };
  });
}

/**
 * Offset of a project's heading in the raw document.
 *
 * Most section bodies are identical across projects, so a plain
 * indexOf() of the search term would always land in the first project.
 * Anchoring on the heading keeps the search+patch baseline pointed at
 * the same node Nodiom addresses.
 */
export function projectOffset(
  markdown: string,
  project: string
): number {
  /*
   * Documents outside the generated corpus have no project id. Anchor
   * from the start rather than matching a bare "# Project " prefix,
   * which can appear in unrelated prose or fenced code.
   */
  if (project === "") return 0;

  const offset = markdown.indexOf(`# Project ${project}`);

  return offset === -1 ? 0 : offset;
}

export const documents = ["10kb", "50kb", "250kb", "1mb"] as const;
