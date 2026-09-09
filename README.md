# Nodiom Markdown Editing Benchmark

Measures what it costs, in tokens and dollars, to make a small edit to a
large Markdown document — four ways.

No LLM is called. The benchmark measures how much text must cross the
model boundary, which is what you are billed for. That keeps it free to
run and deterministic in front of an audience.

## Requirements

- Node.js 18+
- npm

## Install

    npm install

## The demo

    npm run generate      # once, to build the corpus
    npm run demo

Options:

    npm run demo -- --doc 1mb              # 10kb | 50kb | 250kb | 1mb
    npm run demo -- --model sonnet-5       # opus-5 | sonnet-5 | haiku-4.5
    npm run demo -- --agents 10 --edits 50 # multi-agent projection
    npm run demo -- --file path/to/doc.md  # any Markdown file

`--file` derives its own edit targets from the document's heading tree,
so you can point it at a customer's own docs live.

## The four approaches

| Approach | Input | Output |
|---|---|---|
| Full rewrite | whole document | whole document |
| Read + patch | whole document | `old_string` + `new_string` |
| Grep + patch | grep hits + context | `old_string` + `new_string` |
| Nodiom | one addressed node | one node |

**Read + patch is the arm that matters.** It is what shipping coding
agents do today: read the file, emit a string-replacement pair. Full
rewrite is included as a ceiling, not as a serious competitor — above
roughly 350 KB it stops being merely expensive and becomes impossible,
because the edited document exceeds the model's output-token cap. The
demo flags that when it happens.

Two costs the naive framing misses, both measured rather than asserted:

- **A patch tool needs an unambiguous `old_string`.** The benchmark
  expands the quoted window until it occurs exactly once in the
  document, and the model pays for that window twice — once in
  `old_string`, once in `new_string`. In documents with repeated
  structure the window is far larger than the edit.
- **Nodiom has to learn the structure.** It is charged for a one-time
  read of the full heading outline, amortised across the edits in the
  run. Ignoring that would understate its cost.

## What the numbers depend on

Nodiom's advantage is driven by **repeated structure first, document
size second**. Repetition makes grep ambiguous and inflates the unique
window; size only grows the read arm.

That ordering is empirical, not assumed: on this corpus Nodiom wins at
13 KB, where grep returns 4 hits, but loses to grep + patch on a
unique-content README of similar size where grep returns 1 hit. The demo
prints whichever verdict the measurements support, including when Nodiom
is not the cheapest option.

## Latency

    npm run latency
    npm run latency -- --doc 50kb --samples 5 --throughput 90

**The one stage that needs the network.** Everything else here is offline
and deterministic; this makes real calls to Nodiom Cloud and times them.

It reports two things separately, because only one is measured:

- **Measured** — wall-clock API round trips, median of N samples after a
  warm-up. At 250 KB this is only ~1.4×: round-trip *count* matters more
  than payload size, since a 258 KB body transfers fast.
- **Modelled** — time for the model to *generate* its output, at a stated
  tokens-per-second rate. This dominates, and it cannot be measured
  without an LLM in the loop, so it is computed and labelled as such.

On the 250 KB corpus, a five-edit session comes out around **50s versus
8s** — roughly 6× — almost all of it generation, because a patch tool
emits `old_string` and `new_string` and so pays for the quoted window
twice.

Note the per-edit table: on `modify overview` the target embeds its
project id, so it's already unique, the patch window is 21 tokens, and
the patch tool emits *less* than Nodiom does. Measuring only that edit
would invert the result — which is why this averages all five.

Documents above the API's 256 KB per-document limit are rejected, so
`--doc 1mb` is for the offline cost benchmark only.

`src/latency.ts` contains a working API key on purpose, so this stage runs
with no setup. It is a shared, hard-capped, rate-limited sandbox key scoped
to a throwaway account — not a leak. Use your own for anything real:

    NODIOM_API_KEY=nk_live_yourkey npm run latency

## Other stages

    npm run verify        # every selector resolves to the expected node
    npm run integrity     # proves edits are contained
    npm run benchmark     # writes results/results.csv and .json
    npm run all           # generate, verify, integrity, benchmark

`integrity` is the safety claim rather than the cost claim: it applies
each edit through Nodiom's `write()` and proves that exactly one
contiguous region changed and every other byte in the file is identical,
with no headings gained or lost.

## Known limitations

Be ready to state these; they are the questions a technical audience
asks first.

- **Tokenizer.** Counts come from `js-tiktoken` (`cl100k_base`), which
  is OpenAI's tokenizer, not Claude's. The same bias applies to every
  arm, so the *ratios* are sound; treat absolute dollar figures as
  approximate. Switching to Anthropic's `messages.count_tokens` is the
  fix, and needs an API key.
- **Prices are cached.** See `src/pricing.ts` (Anthropic list rates,
  cached 2026-06-24). Verify before quoting to a customer.
- **The corpus is synthetic and highly repetitive** — every generated
  project is byte-identical boilerplate. That is the regime Nodiom is
  strongest in, so it flatters the result. Use `--file` on a real
  document when credibility matters more than a clean number.
- **Size labels are approximate.** The generator appends whole ~3.2 KB
  project blocks until it crosses the threshold, so `10kb.md` is
  13,159 bytes. The recorded `documentBytes` is always the true size.
- **No LLM in the loop.** Not yet measured: latency, tool-call
  overhead, retries, whether the model picks the right selector, and
  edit correctness. Those need a real API key and a real agent loop.
