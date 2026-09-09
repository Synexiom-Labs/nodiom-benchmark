/*
 * Latency of one edit, two ways.
 *
 * This is the only stage that needs the network. Everything else in this
 * repo is offline and deterministic; this one makes real calls to Nodiom
 * Cloud and times them.
 *
 *   npm run latency
 *   npm run latency -- --doc 50kb --samples 7 --throughput 90
 *
 * Two components, kept separate because only one of them is measured:
 *
 *   MEASURED  wall-clock round trips to the API, including transferring the
 *             payload. Median of N samples after a warm-up call.
 *   MODELLED  time for the model to *generate* its output, at a stated
 *             tokens-per-second throughput. This dominates the total and
 *             cannot be measured without an LLM in the loop, so it is
 *             computed and labelled rather than claimed as observed.
 */

import fs from "node:fs/promises";
import { countTokens } from "./tokenizer.js";
import { operationsFor } from "./targets.js";
import { armsFor } from "./strategies.js";

/* Matches nodiom-cloud's MAX_CONTENT_BYTES. A document above this is
 * rejected by the API, so the 1mb corpus cannot be used here. */
const MAX_CONTENT_BYTES = 256 * 1024;

const SANDBOX_KEY = "nk_live_9227e5a866d361e29a598e6bfadddbb883a61dae5d313174";
const API_KEY = process.env["NODIOM_API_KEY"] ?? SANDBOX_KEY;
const API_URL = process.env["NODIOM_API_URL"] ?? "https://api.nodiom.md/mcp";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const docName = arg("doc") ?? "250kb";
const samples = Number(arg("samples") ?? 5);
/* Output tokens per second. Conservative mid-range for a large model. */
const throughput = Number(arg("throughput") ?? 60);

async function callTool(name: string, args: unknown): Promise<string> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args }
    })
  });

  const text = await res.text();
  const line = text.split("\n").find(l => l.startsWith("data: "));
  if (!line) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(line.slice(6));
  if (parsed.error) throw new Error(parsed.error.message);
  if (parsed.result?.isError) throw new Error(parsed.result.content[0].text);
  return parsed.result.content[0].text;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

async function timed<T>(fn: () => Promise<T>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

const ms = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);
const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const lpad = (s: string | number, n: number): string => String(s).padStart(n);

async function main(): Promise<void> {
  const markdown = await fs.readFile(`corpus/${docName}.md`, "utf8");
  const bytes = Buffer.byteLength(markdown);

  if (bytes > MAX_CONTENT_BYTES) {
    console.error(
      `\ncorpus/${docName}.md is ${bytes.toLocaleString()} bytes, above the ` +
        `${MAX_CONTENT_BYTES.toLocaleString()}-byte per-document API limit.\n` +
        `Use --doc 250kb or smaller. The 1mb corpus is for the offline cost\n` +
        `benchmark only.\n`
    );
    process.exit(1);
  }

  /* All five operations, as the cost benchmark does. Measuring only one is
   * misleading in either direction: the "modify overview" target embeds its
   * project id and so is already unique, which makes the patch window tiny,
   * while the other four repeat across every project and force a large one. */
  const operations = operationsFor(markdown);

  const docId = `lat-${Math.random().toString(36).slice(2, 10)}`;

  console.log(`\n── LATENCY OF AN EDIT SESSION ${"─".repeat(41)}\n`);
  console.log(`  Document    corpus/${docName}.md (${bytes.toLocaleString()} bytes)`);
  console.log(`  Endpoint    ${API_URL}`);
  console.log(`  Workload    ${operations.length} single-section edits`);
  console.log(`  Samples     ${samples} per edit (median), after one warm-up\n`);

  try {
    await callTool("nodiom_create_doc", { doc_id: docId, content: markdown });

    /* Warm-up: first call pays TLS setup and any cold start. */
    await callTool("nodiom_tree", { doc_id: docId });

    type Row = { name: string; rpNet: number; ndNet: number; rpOut: number; ndOut: number };
    const rows: Row[] = [];

    for (const operation of operations) {
      const arms = armsFor(markdown, operation);
      const readPatch = arms.find(a => a.key === "readPatch")!;
      const nodiom = arms.find(a => a.key === "nodiom")!;
      /* Writing the node back unchanged keeps the patch payload constant
       * across samples and leaves the selector resolvable. */
      const nodeText = nodiom.inputText;

      const rpTimes: number[] = [];
      const ndTimes: number[] = [];

      for (let i = 0; i < samples; i++) {
        /* Read + patch: download the whole document to locate the target,
         * then apply the patch. Two round trips, the first carrying the
         * entire file. */
        rpTimes.push(
          await timed(async () => {
            await callTool("nodiom_get_doc", { doc_id: docId });
            await callTool("nodiom_write", {
              doc_id: docId,
              selector: operation.selector,
              new_content: nodeText
            });
          })
        );

        /* Nodiom: one round trip, one node. */
        ndTimes.push(
          await timed(() =>
            callTool("nodiom_append", {
              doc_id: docId,
              selector: operation.selector,
              new_content: `- latency sample ${i}`
            })
          )
        );
      }

      rows.push({
        name: operation.name,
        rpNet: median(rpTimes),
        ndNet: median(ndTimes),
        rpOut: countTokens(readPatch.outputText),
        ndOut: countTokens(nodiom.outputText)
      });
    }

    const sum = (f: (r: Row) => number): number => rows.reduce((a, r) => a + f(r), 0);
    const rpNet = sum(r => r.rpNet);
    const ndNet = sum(r => r.ndNet);
    const rpOut = sum(r => r.rpOut);
    const ndOut = sum(r => r.ndOut);
    const rpGen = (rpOut / throughput) * 1000;
    const ndGen = (ndOut / throughput) * 1000;

    console.log(`  PER-EDIT DETAIL — median round-trip time, and tokens emitted\n`);
    console.log(
      `    ${pad("edit", 20)}${lpad("r+p net", 10)}${lpad("nod net", 10)}${lpad("r+p out", 10)}${lpad("nod out", 10)}`
    );
    for (const r of rows) {
      console.log(
        `    ${pad(r.name, 20)}${lpad(ms(r.rpNet), 10)}${lpad(ms(r.ndNet), 10)}${lpad(r.rpOut.toLocaleString(), 10)}${lpad(r.ndOut.toLocaleString(), 10)}`
      );
    }
    console.log("");

    console.log(`  MEASURED — API round trips, whole session\n`);
    console.log(`    ${pad("", 18)}${lpad("total", 10)}${lpad("trips", 8)}`);
    console.log(
      `    ${pad("read + patch", 18)}${lpad(ms(rpNet), 10)}${lpad(operations.length * 2, 8)}`
    );
    console.log(
      `    ${pad("nodiom_append", 18)}${lpad(ms(ndNet), 10)}${lpad(operations.length, 8)}`
    );
    console.log(
      `\n    Network alone: ${(rpNet / ndNet).toFixed(1)}× — round-trip count matters` +
        `\n    more than payload size at this document size.\n`
    );

    console.log(`  MODELLED — model generating its output at ${throughput} tok/s\n`);
    console.log(`    ${pad("", 18)}${lpad("out tokens", 12)}${lpad("gen time", 12)}`);
    console.log(`    ${pad("read + patch", 18)}${lpad(rpOut.toLocaleString(), 12)}${lpad(ms(rpGen), 12)}`);
    console.log(`    ${pad("nodiom_append", 18)}${lpad(ndOut.toLocaleString(), 12)}${lpad(ms(ndGen), 12)}`);

    console.log(`\n  COMBINED — what the user waits for\n`);
    console.log(`    ${pad("read + patch", 18)}${lpad(ms(rpNet + rpGen), 12)}`);
    console.log(`    ${pad("nodiom_append", 18)}${lpad(ms(ndNet + ndGen), 12)}`);
    const rpTotal = rpNet + rpGen;
    const ndTotal = ndNet + ndGen;
    const ratio = rpTotal / ndTotal;

    if (ratio >= 1) {
      console.log(`\n    ${ratio.toFixed(1)}× faster end to end.`);
      console.log(`    Generation dominates: a patch tool emits old_string and new_string,`);
      console.log(`    so it regenerates the quoted window twice. Where the target repeats`);
      console.log(`    across the document that window is large, and it is paid for twice.\n`);
    } else {
      console.log(`\n    ${(1 / ratio).toFixed(1)}× SLOWER end to end on this workload.`);
      console.log(`    Nodiom emits the whole addressed node, so when a node is larger than`);
      console.log(`    the patch window — targets already unique, small sections — a patch`);
      console.log(`    tool emits less and wins. See the per-edit detail above for which.\n`);
    }

    console.log(`  Caveats: generation time is computed from token counts at the stated`);
    console.log(`  throughput, not observed — no model is called. Token counts are cl100k,`);
    console.log(`  not Claude's tokenizer. Network figures are from this machine to`);
    console.log(`  Railway and will differ on yours.\n`);
  } finally {
    try {
      await callTool("nodiom_delete_doc", { doc_id: docId });
    } catch {
      /* best effort */
    }
  }

  console.log(`${"─".repeat(70)}\n`);
}

await main();
