import fs from "node:fs/promises";
import { countTokens } from "./tokenizer.js";
import { operationsFor } from "./targets.js";
import { discoverOperations } from "./discover.js";
import { armsFor } from "./strategies.js";
import {
  models,
  defaultModel,
  costOf,
  cachedCostOf,
  usd,
  cacheReadMultiplier,
  type Model
} from "./pricing.js";

type Totals = {
  key: string;
  label: string;
  note: string;
  inputTokens: number;
  outputTokens: number;
  discoveryTokens: number;
  cost: number;
  cachedCost: number;
  exceedsOutputCap: boolean;
};

function parseArgs() {
  const argv = process.argv.slice(2);

  const get = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };

  return {
    file: get("--file"),
    doc: get("--doc") ?? "250kb",
    model: get("--model") ?? "opus-5",
    agents: Number(get("--agents") ?? 5),
    edits: Number(get("--edits") ?? 20)
  };
}

function bar(width: number): string {
  return "─".repeat(width);
}

function rightPad(text: string, width: number): string {
  return text.length >= width
    ? text
    : text + " ".repeat(width - text.length);
}

function leftPad(text: string, width: number): string {
  return text.length >= width
    ? text
    : " ".repeat(width - text.length) + text;
}

function num(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

async function main() {
  const args = parseArgs();

  const model: Model = models[args.model] ?? defaultModel;

  const path = args.file ?? `corpus/${args.doc}.md`;

  const markdown = await fs.readFile(path, "utf8");

  const operations = args.file
    ? discoverOperations(markdown)
    : operationsFor(markdown);

  const documentBytes = Buffer.byteLength(markdown);
  const documentTokens = countTokens(markdown);

  const totals = new Map<string, Totals>();

  for (const operation of operations) {
    for (const arm of armsFor(markdown, operation)) {
      const inputTokens = countTokens(arm.inputText);
      const outputTokens = countTokens(arm.outputText);

      const existing = totals.get(arm.key) ?? {
        key: arm.key,
        label: arm.label,
        note: arm.note ?? "",
        inputTokens: 0,
        outputTokens: 0,
        discoveryTokens: arm.discoveryText
          ? countTokens(arm.discoveryText)
          : 0,
        cost: 0,
        cachedCost: 0,
        exceedsOutputCap: false
      };

      existing.inputTokens += inputTokens;
      existing.outputTokens += outputTokens;
      existing.cost += costOf(model, inputTokens, outputTokens);
      existing.cachedCost += cachedCostOf(
        model,
        inputTokens,
        outputTokens
      );
      existing.note = arm.note ?? existing.note;

      if (outputTokens > model.maxOutputTokens) {
        existing.exceedsOutputCap = true;
      }

      totals.set(arm.key, existing);
    }
  }

  const rows = [...totals.values()];
  const nodiom = rows.find(row => row.key === "nodiom")!;

  /* Nodiom pays the one-time outline read once, not per edit. */
  const nodiomCost =
    nodiom.cost + costOf(model, nodiom.discoveryTokens, 0);

  console.log();
  console.log(bar(78));
  console.log("  NODIOM — TOKEN COST OF EDITING MARKDOWN AT SCALE");
  console.log(bar(78));
  console.log();
  console.log(
    `  Document   ${path}  (${num(documentBytes)} bytes, ~${num(documentTokens)} tokens)`
  );
  console.log(
    `  Model      ${model.label}  ($${model.inputPerMTok}/M in, $${model.outputPerMTok}/M out)`
  );
  console.log(`  Workload   ${operations.length} single-section edits`);
  console.log();

  console.log(
    "  " +
      rightPad("Approach", 16) +
      leftPad("Input", 12) +
      leftPad("Output", 10) +
      leftPad("Cost", 12) +
      leftPad("vs Nodiom", 12)
  );
  console.log("  " + bar(62));

  for (const row of rows) {
    const cost =
      row.key === "nodiom"
        ? nodiomCost
        : row.cost;

    const multiple = cost / nodiomCost;

    console.log(
      "  " +
        rightPad(row.label, 16) +
        leftPad(num(row.inputTokens), 12) +
        leftPad(num(row.outputTokens), 10) +
        leftPad(usd(cost), 12) +
        leftPad(
          row.key === "nodiom" ? "—" : `${multiple.toFixed(1)}x`,
          12
        )
    );

    console.log(
      "  " + rightPad("", 16) + `  ${row.note}`
    );

    if (row.exceedsOutputCap) {
      console.log(
        "  " +
          rightPad("", 16) +
          `  NOT POSSIBLE: exceeds ${num(model.maxOutputTokens)}-token output cap`
      );
    }
  }

  console.log();
  console.log(
    `  Nodiom pays a one-time ${num(nodiom.discoveryTokens)}-token outline read to learn the`
  );
  console.log(
    `  document structure. That is included in the figure above.`
  );

  /*
   * The comparison that decides the sale: a competent agent that keeps
   * the document in a cached prompt prefix, versus Nodiom.
   */
  const readPatch = rows.find(row => row.key === "readPatch")!;

  console.log();
  console.log(bar(78));
  console.log("  THE OBJECTION: \"WE USE PROMPT CACHING\"");
  console.log(bar(78));
  console.log();
  console.log(
    `  Read + patch, document cached at ${cacheReadMultiplier}x input rate:`
  );
  console.log(
    `    ${usd(readPatch.cachedCost)}  vs Nodiom ${usd(nodiomCost)}  ->  ${(
      readPatch.cachedCost / nodiomCost
    ).toFixed(1)}x`
  );
  console.log();

  if (readPatch.cachedCost > nodiomCost) {
    console.log(
      "  Caching narrows the gap but does not close it: the cached prefix is"
    );
    console.log(
      "  re-read on every turn, expires, and is per-agent — so in a fan-out"
    );
    console.log("  each agent pays its own cache-write.");
  } else {
    console.log(
      "  On this document caching wins: it is small enough that a cached"
    );
    console.log(
      "  full read costs less than addressing the node. Nodiom's advantage"
    );
    console.log(
      "  is a function of document size — see the verdict below."
    );
  }

  /* Multi-agent projection — the Nodiom Cloud case. */
  const perEditReadPatch = readPatch.cost / operations.length;
  const perEditNodiom = nodiom.cost / operations.length;

  const workloadEdits = args.agents * args.edits;

  const projectedReadPatch = perEditReadPatch * workloadEdits;
  const projectedNodiom =
    perEditNodiom * workloadEdits +
    costOf(model, nodiom.discoveryTokens, 0) * args.agents;

  console.log();
  console.log(bar(78));
  console.log("  MULTI-AGENT WORKLOAD");
  console.log(bar(78));
  console.log();
  console.log(
    `  ${args.agents} agents x ${args.edits} edits each = ${num(workloadEdits)} edits on one document`
  );
  console.log();
  console.log(
    `    Read + patch   ${leftPad(usd(projectedReadPatch), 12)}`
  );
  console.log(
    `    Nodiom         ${leftPad(usd(projectedNodiom), 12)}`
  );
  console.log(
    `    Saved          ${leftPad(usd(projectedReadPatch - projectedNodiom), 12)}   (${(
      ((projectedReadPatch - projectedNodiom) / projectedReadPatch) *
      100
    ).toFixed(1)}%)`
  );
  console.log();
  console.log(
    `  Per 1,000 such runs: ${usd(
      (projectedReadPatch - projectedNodiom) * 1000
    )} saved.`
  );

  /*
   * State the verdict from the measured numbers rather than asserting
   * a fixed conclusion. On a small document with unique prose, a
   * well-optimised grep agent legitimately beats Nodiom, and the demo
   * has to say so.
   */
  const grepPatch = rows.find(row => row.key === "grepPatch")!;

  const beatsGrep = grepPatch.cost > nodiomCost;
  const beatsCache = readPatch.cachedCost > nodiomCost;

  console.log();
  console.log(bar(78));
  console.log("  VERDICT");
  console.log(bar(78));
  console.log();

  if (beatsGrep && beatsCache) {
    console.log(
      "  Nodiom is cheaper than every alternative on this document,"
    );
    console.log(
      "  including a grep-optimised agent and a cache-optimised one."
    );
  } else if (beatsCache) {
    console.log(
      "  Nodiom beats reading the document, cached or not, but a"
    );
    console.log(
      `  grep-optimised agent is cheaper here (${usd(grepPatch.cost)} vs ${usd(nodiomCost)}).`
    );
  } else {
    console.log(
      "  On this document Nodiom is NOT the cheapest option. It is small"
    );
    console.log(
      "  enough, and its content unique enough, that grep finds the target"
    );
    console.log("  in one hit and caching makes re-reading nearly free.");
  }

  console.log();
  console.log(
    "  Nodiom's advantage is driven by two properties, in this order:"
  );
  console.log(
    "    1. Repeated structure — repeated headings and boilerplate make"
  );
  console.log(
    "       grep ambiguous, forcing a large unique-context window that"
  );
  console.log(
    "       the model pays for twice (old_string and new_string)."
  );
  console.log(
    "    2. Document size      — the read arm grows with the file, the"
  );
  console.log("       node arm does not.");
  console.log();
  console.log(
    "  Repetition dominates: on this corpus Nodiom wins at 13 KB, where"
  );
  console.log(
    "  grep returns 4 hits — but loses on a unique-content file of"
  );
  console.log(
    "  similar size where grep returns 1. Documents with neither"
  );
  console.log("  property are not the case to sell against.");

  console.log();
  console.log(bar(78));
  console.log(
    "  Token counts are cl100k estimates, not Claude's tokenizer; treat the"
  );
  console.log(
    "  ratios as sound and the absolute dollars as approximate."
  );
  console.log(bar(78));
  console.log();
}

main().catch(error => {
  console.error(error.message ?? error);
  process.exit(1);
});
