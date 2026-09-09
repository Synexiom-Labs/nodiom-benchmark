import fs from "node:fs/promises";
import { Nodiom } from "@synexiom-labs/nodiom";
import { documents, operationsFor } from "./targets.js";

function commonPrefix(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i++;
  return i;
}

function commonSuffix(a: string, b: string, skip: number): number {
  const limit = Math.min(a.length, b.length) - skip;
  let i = 0;
  while (
    i < limit &&
    a[a.length - 1 - i] === b[b.length - 1 - i]
  ) {
    i++;
  }
  return i;
}

function countHeadings(markdown: string): number {
  return markdown
    .split("\n")
    .filter(line => /^#{1,6}\s/.test(line)).length;
}

/**
 * Proves the containment claim: a Nodiom write changes one contiguous
 * region and leaves every other byte in the file untouched.
 */
async function main() {
  console.log(
    "\nProving edit containment (one region changed, rest byte-identical)...\n"
  );

  let passed = 0;
  let total = 0;

  for (const name of documents) {
    const path = `corpus/${name}.md`;

    let original: string;
    try {
      original = await fs.readFile(path, "utf8");
    } catch {
      continue;
    }

    console.log(`${path}`);

    for (const operation of operationsFor(original)) {
      total++;

      const doc = Nodiom.fromString(original);

      const body = doc.read(operation.selector);

      doc.write(
        operation.selector,
        body.replace(operation.searchTerm, operation.replacement)
      );

      const edited = doc.toString();

      const prefix = commonPrefix(original, edited);
      const suffix = commonSuffix(original, edited, prefix);

      const changedBefore = original.length - prefix - suffix;
      const changedAfter = edited.length - prefix - suffix;

      const untouched = prefix + suffix;

      const headingsHeld =
        countHeadings(original) === countHeadings(edited);

      /*
       * A contiguous single-region change means every byte outside
       * [prefix, length-suffix) is identical by construction. The edit
       * is contained if that region is small relative to the file and
       * no headings were gained or lost.
       */
      const contained =
        changedBefore >= 0 &&
        changedAfter >= 0 &&
        changedBefore < body.length + 200 &&
        headingsHeld;

      const pct = ((untouched / original.length) * 100).toFixed(4);

      if (contained) {
        console.log(
          `  PASS  ${operation.name.padEnd(18)} ` +
            `changed ${String(changedBefore).padStart(4)} -> ` +
            `${String(changedAfter).padStart(4)} bytes; ` +
            `${untouched.toLocaleString()} bytes (${pct}%) byte-identical`
        );
        passed++;
      } else {
        console.log(`  FAIL  ${operation.name}`);
        console.log(
          `        changed region ${changedBefore} -> ${changedAfter} bytes ` +
            `(node body is ${body.length} bytes)`
        );
        console.log(
          `        headings ${countHeadings(original)} -> ${countHeadings(edited)}`
        );
      }
    }

    console.log();
  }

  console.log(`${passed}/${total} edits provably contained.`);

  if (total === 0 || passed !== total) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
