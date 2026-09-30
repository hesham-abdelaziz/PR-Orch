import { Injectable } from '@nestjs/common';
import type { ProviderId } from '@pr-orchestrator/contracts';
import type { z } from 'zod';

import {
  ReviewerOutputSchema,
  VerifierOutputSchema,
  type ReviewerOutput,
  type VerifierOutput,
} from './review-output.schemas.js';

export type CorrectionReason = 'empty_output' | 'no_json' | 'invalid_json' | 'schema_violation';

/** The answer cannot be used as-is; one correction attempt may fix it. */
export interface CorrectionNeededError {
  kind: 'correction_needed';
  reason: CorrectionReason;
  /** Field paths and validation messages only; never the rejected values. */
  issues: string[];
}

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; error: CorrectionNeededError };

export interface ParseInput {
  provider: ProviderId;
  rawOutput: string;
}

const MAX_ISSUES = 20;
const MAX_ISSUE_LENGTH = 300;
const FENCE_PATTERN = /```[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)```/gu;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Finds balanced `{...}` spans, honouring JSON string escapes. */
function balancedObjects(text: string): string[] {
  const spans: string[] = [];
  let index = 0;

  while (index < text.length) {
    if (text[index] !== '{') {
      index += 1;
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let cursor = index; cursor < text.length; cursor += 1) {
      const character = text[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
      } else if (character === '"') {
        inString = true;
      } else if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          end = cursor;
          break;
        }
      }
    }

    if (end === -1) break; // unbalanced: nothing after this can be complete
    spans.push(text.slice(index, end + 1));
    index = end + 1;
  }

  return spans;
}

/**
 * Extracts only the provider's final result channel and validates it once
 * against a strict schema. It never repairs, completes, or guesses fields.
 */
@Injectable()
export class ProviderOutputParser {
  parseReviewer(input: ParseInput): ParseOutcome<ReviewerOutput> {
    return this.parse(input, ReviewerOutputSchema, 'findings');
  }

  parseVerifier(input: ParseInput): ParseOutcome<VerifierOutput> {
    return this.parse(input, VerifierOutputSchema, 'decisions');
  }

  private parse<T extends z.ZodType>(
    input: ParseInput,
    schema: T,
    discriminator: string,
  ): ParseOutcome<z.infer<T>> {
    const text = input.rawOutput.trim();
    if (text.length === 0) return failure('empty_output', ['The answer was empty.']);

    const channel = this.finalChannel(input.provider, text);
    const objects =
      channel.kind === 'object' ? [channel.value] : this.objectsFromText(channel.text);

    if (objects.length === 0) {
      const looksLikeJson = (channel.kind === 'text' ? channel.text : text).includes('{');

      return looksLikeJson
        ? failure('invalid_json', ['The answer contained JSON that could not be parsed or was cut off.'])
        : failure('no_json', ['The answer did not contain a JSON object.']);
    }

    const chosen = [...objects].reverse().find((candidate) => discriminator in candidate) ?? objects.at(-1);
    const validated = schema.safeParse(chosen);
    if (validated.success) return { ok: true, value: validated.data };

    return failure(
      'schema_violation',
      validated.error.issues
        .slice(0, MAX_ISSUES)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`.slice(0, MAX_ISSUE_LENGTH)),
    );
  }

  /** Resolves provider envelopes and event streams down to the final answer. */
  private finalChannel(
    provider: ProviderId,
    text: string,
  ): { kind: 'object'; value: JsonObject } | { kind: 'text'; text: string } {
    const whole = tryParse(text);
    if (isObject(whole)) return this.fromDocument(whole, text);

    const events = this.jsonLines(text);
    if (events !== undefined) return this.fromEvents(provider, events, text);

    return { kind: 'text', text };
  }

  private fromDocument(document: JsonObject, fallbackText: string) {
    if (isObject(document['structured_output'])) {
      return { kind: 'object', value: document['structured_output'] } as const;
    }
    if (document['type'] === 'result' && typeof document['result'] === 'string') {
      return { kind: 'text', text: document['result'] } as const;
    }
    if (typeof document['response'] === 'string' && !('findings' in document) && !('decisions' in document)) {
      return { kind: 'text', text: document['response'] } as const;
    }
    if ('findings' in document || 'decisions' in document) {
      return { kind: 'object', value: document } as const;
    }

    return { kind: 'text', text: fallbackText } as const;
  }

  private jsonLines(text: string): JsonObject[] | undefined {
    const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
    if (lines.length < 2) return undefined;

    const events: JsonObject[] = [];
    for (const line of lines) {
      const parsed = tryParse(line.trim());
      if (!isObject(parsed)) return undefined;
      events.push(parsed);
    }

    return events;
  }

  private fromEvents(provider: ProviderId, events: JsonObject[], fallbackText: string) {
    const result = [...events].reverse().find((event) => event['type'] === 'result');
    if (result) return this.fromDocument(result, fallbackText);

    // Codex: the final answer is the last completed agent message.
    for (const event of [...events].reverse()) {
      const item = event['item'];
      if (
        event['type'] === 'item.completed' &&
        isObject(item) &&
        item['type'] === 'agent_message' &&
        typeof item['text'] === 'string'
      ) {
        return { kind: 'text', text: item['text'] } as const;
      }
    }

    const response = [...events].reverse().find((event) => typeof event['response'] === 'string');
    if (response && provider === 'gemini') {
      return { kind: 'text', text: response['response'] as string } as const;
    }

    return { kind: 'text', text: fallbackText } as const;
  }

  private objectsFromText(text: string): JsonObject[] {
    const seen = new Set<string>();
    const objects: JsonObject[] = [];
    const consider = (candidate: string) => {
      if (seen.has(candidate)) return;
      seen.add(candidate);
      const parsed = tryParse(candidate);
      if (isObject(parsed)) objects.push(parsed);
    };

    for (const match of text.matchAll(FENCE_PATTERN)) {
      const body = (match[1] ?? '').trim();
      const whole = tryParse(body);
      if (isObject(whole)) consider(body);
      else balancedObjects(body).forEach(consider);
    }
    balancedObjects(text).forEach(consider);

    return objects;
  }
}

function failure(reason: CorrectionReason, issues: string[]): { ok: false; error: CorrectionNeededError } {
  return { ok: false, error: { kind: 'correction_needed', reason, issues } };
}
