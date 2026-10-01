import type { ProviderActivityAction } from '@pr-orchestrator/contracts';

/**
 * An activity as read from a provider event, before the adapter validates the
 * path against the checkout. Only allowlisted fields are ever copied here.
 */
export interface RawActivity {
  action: ProviderActivityAction;
  tool?: string;
  /** Path exactly as the provider reported it (absolute or relative). */
  path?: string;
  startLine?: number;
  endLine?: number;
}

export type JsonObject = Record<string, unknown>;

/**
 * Consumes one provider's structured output stream (one JSON object per line),
 * reports observable actions and retains only the final-answer channel.
 */
export interface StreamDecoder {
  /** `full`: tool events with paths; `partial`: action kinds only. */
  readonly visibility: 'full' | 'partial';
  handle(event: JsonObject, rawLine: string): void;
  /**
   * The final answer in the shape the output parser and `inspectCompletedOutput`
   * already understand, or undefined when the stream carried none.
   */
  finalOutput(): string | undefined;
  /** True when the final answer exceeded its byte cap and was discarded. */
  readonly finalTruncated: boolean;
  /** Bounded provider error text for failure classification (no tool output). */
  diagnostics(): string;
}

export type ActivityEmitter = (activity: RawActivity) => void;

export const MAX_DIAGNOSTICS_CHARS = 8_192;
const MAX_LINE_NUMBER = 10_000_000;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringField(source: JsonObject, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }

  return undefined;
}

/** A non-negative integer field, or undefined. */
export function integerField(source: JsonObject, key: string): number | undefined {
  const value = source[key];

  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_LINE_NUMBER
    ? value
    : undefined;
}

/**
 * Converts a 1-based start line and a line count into an inclusive range. A
 * count without a start means "from the top". Returns {} when nothing is known.
 */
export function lineRange(start: number | undefined, count: number | undefined): Pick<RawActivity, 'startLine' | 'endLine'> {
  const first = start ?? (count !== undefined && count > 0 ? 1 : undefined);
  if (first === undefined || first < 1) return {};
  if (count === undefined || count < 1) return { startLine: first };

  return { startLine: first, endLine: Math.min(first + count - 1, MAX_LINE_NUMBER) };
}

/** Appends text to a bounded diagnostics list. */
export class DiagnosticsBuffer {
  private text = '';

  add(message: string | undefined): void {
    if (message === undefined || message.trim().length === 0) return;
    if (this.text.length >= MAX_DIAGNOSTICS_CHARS) return;
    const next = this.text.length === 0 ? message : `${this.text}\n${message}`;
    this.text = next.slice(0, MAX_DIAGNOSTICS_CHARS);
  }

  toString(): string {
    return this.text;
  }
}

/** Remembers ids already reported, bounded so a long run cannot grow it forever. */
export class SeenIds {
  private readonly ids = new Set<string>();

  firstTime(id: string | undefined): boolean {
    if (id === undefined) return true;
    if (this.ids.has(id)) return false;
    if (this.ids.size >= 2_000) this.ids.clear();
    this.ids.add(id);

    return true;
  }
}
