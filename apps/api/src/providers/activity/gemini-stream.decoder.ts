import {
  DiagnosticsBuffer,
  integerField,
  isObject,
  lineRange,
  stringField,
  type ActivityEmitter,
  type JsonObject,
  type RawActivity,
  type StreamDecoder,
} from './stream-decoder.js';

/**
 * Gemini CLI `--output-format stream-json`: `init`, `message` (assistant text,
 * possibly as deltas), `tool_use` (`tool_name`, `parameters`), `tool_result`
 * (ignored: holds file contents), `error` and a final `result` with status.
 * The assistant text is reassembled into the `{ "response": … }` envelope that
 * `--output-format json` produced, with `error` set when the result failed.
 */
export class GeminiStreamDecoder implements StreamDecoder {
  readonly visibility = 'full' as const;
  private response = '';
  private responseBytes = 0;
  private truncated = false;
  private sawAnswerOrResult = false;
  private resultError: string | undefined;
  private lastAction: string | undefined;
  private readonly errors = new DiagnosticsBuffer();

  constructor(
    private readonly emit: ActivityEmitter,
    private readonly maxFinalBytes: number,
  ) {}

  get finalTruncated(): boolean {
    return this.truncated;
  }

  handle(event: JsonObject): void {
    switch (event['type']) {
      case 'message':
        if (event['role'] === 'assistant' && typeof event['content'] === 'string') this.answerText(event['content']);
        return;
      case 'tool_use':
        this.toolUse(event);
        return;
      case 'error':
        this.errors.add(stringField(event, 'message'));
        return;
      case 'result': {
        this.sawAnswerOrResult = true;
        if (event['status'] === 'error') {
          const error = isObject(event['error']) ? stringField(event['error'], 'message') : undefined;
          this.resultError = error ?? 'Gemini reported an error';
          this.errors.add(this.resultError);
        }
        return;
      }
      default:
        return;
    }
  }

  finalOutput(): string | undefined {
    if (!this.sawAnswerOrResult || this.truncated) return undefined;

    return JSON.stringify({
      response: this.response,
      ...(this.resultError === undefined ? {} : { error: { message: this.resultError } }),
    });
  }

  diagnostics(): string {
    return this.errors.toString();
  }

  private answerText(content: string): void {
    this.sawAnswerOrResult = true;
    if (!this.truncated) {
      this.responseBytes += Buffer.byteLength(content, 'utf8');
      if (this.responseBytes > this.maxFinalBytes) {
        this.truncated = true;
        this.response = '';
      } else {
        this.response += content;
      }
    }
    // Deltas of one answer are reported once, not per chunk.
    if (this.lastAction !== 'writing_answer' && content.trim().length > 0) this.report({ action: 'writing_answer' });
  }

  private toolUse(event: JsonObject): void {
    const name = typeof event['tool_name'] === 'string' ? event['tool_name'] : '';
    const parameters = isObject(event['parameters']) ? event['parameters'] : {};
    const directory = stringField(parameters, 'path', 'dir_path', 'directory');

    switch (name) {
      case 'read_file': {
        const path = stringField(parameters, 'file_path', 'absolute_path', 'path');
        // read_file's `offset` is a 0-based line number, `limit` a line count.
        const offset = integerField(parameters, 'offset');
        this.report({
          action: 'reading_file',
          tool: 'read_file',
          ...(path === undefined ? {} : { path }),
          ...(path === undefined
            ? {}
            : lineRange(offset === undefined ? undefined : offset + 1, integerField(parameters, 'limit'))),
        });
        return;
      }
      case 'read_many_files':
        this.report({ action: 'reading_file', tool: 'read_many_files' });
        return;
      case 'search_file_content':
      case 'grep_search':
        this.report({ action: 'searching', tool: name, ...(directory === undefined ? {} : { path: directory }) });
        return;
      case 'glob':
      case 'list_directory':
        this.report({ action: 'listing_files', tool: name, ...(directory === undefined ? {} : { path: directory }) });
        return;
      default:
        this.report({ action: 'tool_other' });
    }
  }

  private report(activity: RawActivity): void {
    this.lastAction = activity.action;
    this.emit(activity);
  }
}
