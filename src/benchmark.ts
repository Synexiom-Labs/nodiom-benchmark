import fs from "node:fs/promises";
import { countTokens } from "./tokenizer.js";
import { documents, operationsFor } from "./targets.js";
import { armsFor } from "./strategies.js";
import {
  defaultModel,
  costOf,
  cachedCostOf,
  type Model
} from "./pricing.js";

type Row = {
  document: string;
  documentBytes: number;
  documentTokens: number;
  operation: string;
  selector: string;
  approach: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  discoveryTokens: number;
  costUsd: number;
  cachedCostUsd: number;
  exceedsOutputCap: boolean;
  model: string;
};

async function runForDocument(
  name: string,
  model: Model
): Promise<Row[]> {
  const path = `corpus/${name}.md`;

  const markdown = await fs.readFile(path, "utf8");

  const documentBytes = Buffer.byteLength(markdown);
  const documentTokens = countTokens(markdown);

  const rows: Row[] = [];

  for (const operation of operationsFor(markdown)) {
    for (const arm of armsFor(markdown, operation)) {
      const inputTokens = countTokens(arm.inputText);
      const outputTokens = countTokens(arm.outputText);

      rows.push({
        document: name,
        documentBytes,
        documentTokens,
        operation: operation.name,
        selector: operation.selector,
        approach: arm.label,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        discoveryTokens: arm.discoveryText
          ? countTokens(arm.discoveryText)
          : 0,
        costUsd: costOf(model, inputTokens, outputTokens),
        cachedCostUsd: cachedCostOf(model, inputTokens, outputTokens),
        exceedsOutputCap: outputTokens > model.maxOutputTokens,
        model: model.id
      });
    }
  }

  return rows;
}

function csvEscape(value: unknown): string {
  const text = String(value);

  return /[",\n]/.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

async function main() {
  const model = defaultModel;

  const all: Row[] = [];

  for (const name of documents) {
    console.log(`\nBenchmarking ${name}...`);

    const rows = await runForDocument(name, model);
    all.push(...rows);

    const approaches = [...new Set(rows.map(row => row.approach))];

    for (const approach of approaches) {
      const subset = rows.filter(row => row.approach === approach);

      const tokens = subset.reduce(
        (sum, row) => sum + row.totalTokens,
        0
      );

      const cost = subset.reduce((sum, row) => sum + row.costUsd, 0);

      const capped = subset.some(row => row.exceedsOutputCap);

      console.log(
        `  ${approach.padEnd(14)} ${String(tokens).padStart(9)} tokens  ` +
          `$${cost.toFixed(4)}${capped ? "  [exceeds output cap]" : ""}`
      );
    }
  }

  const headers = Object.keys(all[0]) as Array<keyof Row>;

  const csv = [
    headers.join(","),
    ...all.map(row =>
      headers.map(header => csvEscape(row[header])).join(",")
    )
  ].join("\n");

  await fs.writeFile("results/results.csv", csv);
  await fs.writeFile(
    "results/results.json",
    JSON.stringify(all, null, 2)
  );

  console.log("\nResults:");
  console.log("  results/results.csv");
  console.log("  results/results.json");
  console.log(
    "\nToken counts are cl100k estimates, not Claude's tokenizer."
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
