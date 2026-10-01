import {
  DiagnosticsBuffer,
  SeenIds,
  isObject,
  stringField,
  type ActivityEmitter,
  type JsonObject,
  type StreamDecoder,
} from './stream-decoder.js';

/**
 * Codex `exec --json`: JSONL thread events. Items (`item.started`,
 * `item.updated`, `item.completed`) report reasoning, shell commands and agent
 * messages. Codex reads files through shell commands, so only the action kind
 * is observable: command text and output are never inspected or exposed, and no
 * path is derived from them (visibility `partial`). The final answer is the
 * text of the last completed agent message, which is what plain `exec` printed.
 */
export class CodexStreamDecoder implements StreamDecoder {
  readonly visibility = 'partial' as const;
  private answer: string | undefined;
  private truncated = false;
  private readonly seen = new SeenIds();
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
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        if (isObject(event['item'])) this.item(event['item'], event['type'] === 'item.completed');
        return;
      case 'error':
        this.errors.add(stringField(event, 'message'));
        return;
      case 'turn.failed':
        this.errors.add(isObject(event['error']) ? stringField(event['error'], 'message') : undefined);
        return;
      default:
        return;
    }
  }

  finalOutput(): string | undefined {
    return this.answer;
  }

  diagnostics(): string {
    return this.errors.toString();
  }

  private item(item: JsonObject, completed: boolean): void {
    const id = typeof item['id'] === 'string' ? item['id'] : undefined;
    const type = item['type'];

    if (type === 'agent_message') {
      if (!completed) return;
      const text = typeof item['text'] === 'string' ? item['text'] : '';
      if (Buffer.byteLength(text, 'utf8') > this.maxFinalBytes) {
        this.truncated = true;
        this.answer = undefined;
      } else {
        this.truncated = false;
        this.answer = text;
      }
      if (this.seen.firstTime(id)) this.emit({ action: 'writing_answer' });

      return;
    }
    if (type === 'error') {
      this.errors.add(stringField(item, 'message'));

      return;
    }

    const activity =
      type === 'command_execution'
        ? ({ action: 'running_command', tool: 'shell' } as const)
        : type === 'reasoning'
          ? ({ action: 'thinking' } as const)
          : type === 'web_search'
            ? ({ action: 'tool_other', tool: 'web_search' } as const)
            : type === 'mcp_tool_call'
              ? ({ action: 'tool_other', tool: 'mcp' } as const)
              : undefined;
    if (activity && this.seen.firstTime(id)) this.emit(activity);
  }
}
