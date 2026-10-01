import {
  DiagnosticsBuffer,
  integerField,
  isObject,
  lineRange,
  stringField,
  type ActivityEmitter,
  type JsonObject,
  type StreamDecoder,
} from './stream-decoder.js';

/**
 * Claude Code `-p --output-format stream-json --verbose`: one JSON object per
 * line. `assistant` messages carry `tool_use` blocks (`Read`, `Grep`, `Glob` in
 * the review profile), text and thinking blocks; `user` messages carry tool
 * results (ignored: they hold file contents); the last `result` event is the
 * same envelope `--output-format json` prints and is retained verbatim.
 */
export class ClaudeStreamDecoder implements StreamDecoder {
  readonly visibility = 'full' as const;
  private result: string | undefined;
  private truncated = false;
  private readonly errors = new DiagnosticsBuffer();

  constructor(
    private readonly emit: ActivityEmitter,
    private readonly maxFinalBytes: number,
  ) {}

  get finalTruncated(): boolean {
    return this.truncated;
  }

  handle(event: JsonObject, rawLine: string): void {
    if (event['type'] === 'result') {
      if (Buffer.byteLength(rawLine, 'utf8') > this.maxFinalBytes) {
        this.truncated = true;
        this.result = undefined;
      } else {
        this.result = rawLine;
        this.truncated = false;
      }
      if (event['is_error'] === true) {
        this.errors.add(typeof event['result'] === 'string' ? event['result'] : 'Claude reported an error');
      }

      return;
    }

    const message = event['message'];
    if (event['type'] !== 'assistant' || !isObject(message) || !Array.isArray(message['content'])) return;

    for (const block of message['content']) {
      if (!isObject(block)) continue;
      switch (block['type']) {
        case 'tool_use':
          this.toolUse(block);
          break;
        case 'thinking':
        case 'redacted_thinking':
          this.emit({ action: 'thinking' });
          break;
        case 'text':
          if (typeof block['text'] === 'string' && block['text'].trim().length > 0) {
            this.emit({ action: 'writing_answer' });
          }
          break;
        default:
          break;
      }
    }
  }

  finalOutput(): string | undefined {
    return this.result;
  }

  diagnostics(): string {
    return this.errors.toString();
  }

  private toolUse(block: JsonObject): void {
    const name = typeof block['name'] === 'string' ? block['name'] : '';
    const input = isObject(block['input']) ? block['input'] : {};

    switch (name) {
      case 'Read': {
        const path = stringField(input, 'file_path');
        // Read's `offset` is the 1-based first line, `limit` the line count.
        const offset = integerField(input, 'offset');
        this.emit({
          action: 'reading_file',
          tool: 'Read',
          ...(path === undefined ? {} : { path }),
          ...(path === undefined ? {} : lineRange(offset === 0 ? 1 : offset, integerField(input, 'limit'))),
        });
        break;
      }
      case 'Grep': {
        // Only the scope is reported; the search pattern is never exposed.
        const path = stringField(input, 'path');
        this.emit({ action: 'searching', tool: 'Grep', ...(path === undefined ? {} : { path }) });
        break;
      }
      case 'Glob': {
        const path = stringField(input, 'path');
        this.emit({ action: 'listing_files', tool: 'Glob', ...(path === undefined ? {} : { path }) });
        break;
      }
      default:
        this.emit({ action: 'tool_other' });
    }
  }
}
