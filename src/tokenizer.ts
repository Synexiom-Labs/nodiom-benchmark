import { getEncoding } from "js-tiktoken";

const encoding = getEncoding("cl100k_base");

export function countTokens(text: string): number {
  return encoding.encode(text).length;
}

export function tokenRatio(
  before: number,
  after: number
): number {
  if (before === 0) return 0;
  return ((before - after) / before) * 100;
}
