import fs from "node:fs/promises";
import { Nodiom } from "@synexiom-labs/nodiom";
import { documents, operationsFor } from "./targets.js";

async function main() {
  console.log("Verifying Nodiom selectors...\n");

  let passed = 0;
  let total = 0;

  for (const document of documents) {
    const path = `corpus/${document}.md`;

    let markdown: string;

    try {
      markdown = await fs.readFile(path, "utf8");
    } catch {
      console.log(
        `SKIP: ${path} is missing. Run \`npm run generate\` first.\n`
      );
      continue;
    }

    const doc = Nodiom.fromString(markdown);
    const operations = operationsFor(markdown);

    console.log(`${path}`);

    for (const operation of operations) {
      total++;

      /*
       * query() reports existence without throwing, so a bad selector
       * is reported as a test failure rather than crashing the run.
       */
      if (!doc.query(operation.selector).exists) {
        console.log(`  FAIL: ${operation.selector}`);
        console.log(`        selector does not resolve`);
        continue;
      }

      const result = doc.read(operation.selector);

      if (result.includes(operation.expected)) {
        console.log(`  PASS: ${operation.selector}`);
        passed++;
      } else {
        console.log(`  FAIL: ${operation.selector}`);
        console.log(`        expected: ${operation.expected}`);
        console.log(`        received: ${result.slice(0, 200)}`);
      }
    }

    console.log();
  }

  console.log(`${passed}/${total} selector tests passed.`);

  if (total === 0 || passed !== total) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
