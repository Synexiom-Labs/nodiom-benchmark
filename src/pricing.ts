/*
 * Published Anthropic first-party API rates, USD per million tokens.
 * Source: Anthropic pricing, cached 2026-06-24. Verify before quoting
 * these figures to a customer.
 */
export type Model = {
  id: string;
  label: string;
  inputPerMTok: number;
  outputPerMTok: number;

  /** Hard ceiling on tokens the model can emit in one response. */
  maxOutputTokens: number;
};

export const models: Record<string, Model> = {
  "opus-5": {
    id: "claude-opus-5",
    label: "Claude Opus 5",
    inputPerMTok: 5.0,
    outputPerMTok: 25.0,
    maxOutputTokens: 128_000
  },
  "sonnet-5": {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    inputPerMTok: 2.0,
    outputPerMTok: 10.0,
    maxOutputTokens: 128_000
  },
  "haiku-4.5": {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    inputPerMTok: 1.0,
    outputPerMTok: 5.0,
    maxOutputTokens: 64_000
  }
};

export const defaultModel = models["opus-5"];

/** Cached input tokens are billed at a fraction of the input rate. */
export const cacheReadMultiplier = 0.1;

export function costOf(
  model: Model,
  inputTokens: number,
  outputTokens: number
): number {
  return (
    (inputTokens / 1_000_000) * model.inputPerMTok +
    (outputTokens / 1_000_000) * model.outputPerMTok
  );
}

/** Cost when the input is served from the prompt cache. */
export function cachedCostOf(
  model: Model,
  inputTokens: number,
  outputTokens: number
): number {
  return (
    (inputTokens / 1_000_000) *
      model.inputPerMTok *
      cacheReadMultiplier +
    (outputTokens / 1_000_000) * model.outputPerMTok
  );
}

export function usd(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(5)}`;
}
