import { describe, expect, it } from 'vitest';

import { toObservation } from './activity-observation.js';
import { ClaudeStreamDecoder } from './claude-stream.decoder.js';
import { CodexStreamDecoder } from './codex-stream.decoder.js';
import { GeminiStreamDecoder } from './gemini-stream.decoder.js';
import { JsonLineSplitter } from './json-line-splitter.js';
import type { RawActivity, StreamDecoder } from './stream-decoder.js';

const ROOT = 'C:\\work\\checkout';

function feed(decoder: StreamDecoder, events: unknown[]): void {
  for (const event of events) decoder.handle(event as Record<string, unknown>, JSON.stringify(event));
}

function collect(): { emit: (activity: RawActivity) => void; seen: RawActivity[] } {
  const seen: RawActivity[] = [];

  return { emit: (activity) => seen.push(activity), seen };
}

describe('JsonLineSplitter', () => {
  it('reassembles lines and multi-byte characters split across chunks', () => {
    const lines: string[] = [];
    const splitter = new JsonLineSplitter(1_024, (line) => lines.push(line));
    const bytes = Buffer.from('{"a":"é"}\r\n{"b":1}\n{"c":', 'utf8');

    // Split inside the two-byte "é" and inside the third line.
    splitter.push(bytes.subarray(0, 7));
    splitter.push(bytes.subarray(7, 20));
    splitter.push(bytes.subarray(20));
    splitter.push(Buffer.from('2}'));
    splitter.end();

    expect(lines).toEqual(['{"a":"é"}', '{"b":1}', '{"c":2}']);
    expect(splitter.dropped).toBe(0);
  });

  it('drops an oversized line whole without buffering it, then continues', () => {
    const lines: string[] = [];
    const splitter = new JsonLineSplitter(16, (line) => lines.push(line));

    splitter.push(Buffer.from(`{"big":"${'x'.repeat(40)}`));
    splitter.push(Buffer.from(`${'y'.repeat(40)}"}\n{"ok":1}\n\n   \n`));
    splitter.end();

    expect(lines).toEqual(['{"ok":1}']);
    expect(splitter.dropped).toBe(1);
  });
});

describe('ClaudeStreamDecoder', () => {
  it('reports tool use with paths and line ranges, never thinking text, patterns or tool output', () => {
    const { emit, seen } = collect();
    const decoder = new ClaudeStreamDecoder(emit, 10_000);
    const result = { type: 'result', subtype: 'success', is_error: false, result: '{}', structured_output: { findings: [] } };

    feed(decoder, [
      { type: 'system', subtype: 'init', tools: ['Read'] },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'secret plan' },
            { type: 'tool_use', name: 'Read', input: { file_path: `${ROOT}\\src\\a.ts`, offset: 5, limit: 10 } },
            { type: 'tool_use', name: 'Grep', input: { pattern: 'p@ss', path: `${ROOT}\\src` } },
            { type: 'tool_use', name: 'Glob', input: { pattern: '**/*.ts' } },
            { type: 'tool_use', name: 'Bash', input: { command: 'rm -rf /' } },
            { type: 'text', text: '  ' },
            { type: 'text', text: 'Summary' },
          ],
        },
      },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'file body' }] } },
      result,
    ]);

    expect(seen).toEqual([
      { action: 'thinking' },
      { action: 'reading_file', tool: 'Read', path: `${ROOT}\\src\\a.ts`, startLine: 5, endLine: 14 },
      { action: 'searching', tool: 'Grep', path: `${ROOT}\\src` },
      { action: 'listing_files', tool: 'Glob' },
      { action: 'tool_other' },
      { action: 'writing_answer' },
    ]);
    expect(JSON.stringify(seen)).not.toMatch(/secret plan|p@ss|rm -rf|file body|\*\*/u);
    expect(decoder.finalOutput()).toBe(JSON.stringify(result));
    expect(decoder.diagnostics()).toBe('');
  });

  it('marks an oversized result as truncated and keeps error text for classification', () => {
    const decoder = new ClaudeStreamDecoder(() => undefined, 50);
    feed(decoder, [{ type: 'result', is_error: false, result: 'x'.repeat(100) }]);
    expect(decoder.finalTruncated).toBe(true);
    expect(decoder.finalOutput()).toBeUndefined();

    const failing = new ClaudeStreamDecoder(() => undefined, 10_000);
    feed(failing, [{ type: 'result', is_error: true, result: 'Not logged in' }]);
    expect(failing.diagnostics()).toBe('Not logged in');
  });

  it('ignores Read ranges without a path and malformed block shapes', () => {
    const { emit, seen } = collect();
    const decoder = new ClaudeStreamDecoder(emit, 10_000);
    feed(decoder, [
      { type: 'assistant', message: { content: 'not-an-array' } },
      { type: 'assistant', message: { content: [null, 7, { type: 'tool_use', name: 'Read', input: { offset: 3, limit: -1 } }] } },
    ]);
    expect(seen).toEqual([{ action: 'reading_file', tool: 'Read' }]);
  });
});

describe('CodexStreamDecoder', () => {
  it('reports action kinds once per item and keeps the last agent message as the answer', () => {
    const { emit, seen } = collect();
    const decoder = new CodexStreamDecoder(emit, 10_000);

    feed(decoder, [
      { type: 'thread.started', thread_id: 't' },
      { type: 'item.completed', item: { id: 'r1', type: 'reasoning', text: 'hidden reasoning' } },
      { type: 'item.started', item: { id: 'c1', type: 'command_execution', command: 'cat .env', status: 'in_progress' } },
      { type: 'item.updated', item: { id: 'c1', type: 'command_execution', command: 'cat .env' } },
      { type: 'item.completed', item: { id: 'c1', type: 'command_execution', command: 'cat .env', aggregated_output: 'TOKEN=1' } },
      { type: 'item.started', item: { id: 'm1', type: 'agent_message' } },
      { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'first' } },
      { type: 'item.completed', item: { id: 'm2', type: 'agent_message', text: '{"findings":[]}' } },
      { type: 'item.completed', item: { id: 'w1', type: 'web_search', query: 'q' } },
    ]);

    expect(seen).toEqual([
      { action: 'thinking' },
      { action: 'running_command', tool: 'shell' },
      { action: 'writing_answer' },
      { action: 'writing_answer' },
      { action: 'tool_other', tool: 'web_search' },
    ]);
    expect(JSON.stringify(seen)).not.toMatch(/\.env|TOKEN|hidden|path/u);
    expect(decoder.visibility).toBe('partial');
    expect(decoder.finalOutput()).toBe('{"findings":[]}');
  });

  it('collects error events and caps the answer', () => {
    const decoder = new CodexStreamDecoder(() => undefined, 5);
    feed(decoder, [
      { type: 'error', message: 'stream disconnected' },
      { type: 'turn.failed', error: { message: 'model not found' } },
      { type: 'item.completed', item: { id: 'm', type: 'agent_message', text: 'too long answer' } },
    ]);
    expect(decoder.diagnostics()).toBe('stream disconnected\nmodel not found');
    expect(decoder.finalTruncated).toBe(true);
    expect(decoder.finalOutput()).toBeUndefined();
  });
});

describe('GeminiStreamDecoder', () => {
  it('maps tools, reassembles deltas into the json envelope and reports the answer once', () => {
    const { emit, seen } = collect();
    const decoder = new GeminiStreamDecoder(emit, 10_000);

    feed(decoder, [
      { type: 'init', model: 'm' },
      { type: 'message', role: 'user', content: 'PROMPT TEXT' },
      { type: 'tool_use', tool_name: 'read_file', parameters: { file_path: `${ROOT}\\a.ts`, offset: 0, limit: 50 } },
      { type: 'tool_result', tool_id: 'x', output: 'body' },
      { type: 'tool_use', tool_name: 'search_file_content', parameters: { pattern: 'secret', path: 'src' } },
      { type: 'tool_use', tool_name: 'list_directory', parameters: { dir_path: `${ROOT}\\lib` } },
      { type: 'tool_use', tool_name: 'run_shell_command', parameters: { command: 'ls' } },
      { type: 'message', role: 'assistant', content: '{"findings":', delta: true },
      { type: 'message', role: 'assistant', content: '[]}', delta: true },
      { type: 'result', status: 'success' },
    ]);

    expect(seen).toEqual([
      { action: 'reading_file', tool: 'read_file', path: `${ROOT}\\a.ts`, startLine: 1, endLine: 50 },
      { action: 'searching', tool: 'search_file_content', path: 'src' },
      { action: 'listing_files', tool: 'list_directory', path: `${ROOT}\\lib` },
      { action: 'tool_other' },
      { action: 'writing_answer' },
    ]);
    expect(decoder.finalOutput()).toBe(JSON.stringify({ response: '{"findings":[]}' }));
  });

  it('turns an error result into an error envelope and returns nothing for an empty stream', () => {
    const failed = new GeminiStreamDecoder(() => undefined, 10_000);
    feed(failed, [{ type: 'result', status: 'error', error: { message: 'quota exceeded' } }]);
    expect(JSON.parse(failed.finalOutput() ?? '')).toEqual({ response: '', error: { message: 'quota exceeded' } });
    expect(failed.diagnostics()).toBe('quota exceeded');

    expect(new GeminiStreamDecoder(() => undefined, 10).finalOutput()).toBeUndefined();

    const tooLong = new GeminiStreamDecoder(() => undefined, 3);
    feed(tooLong, [{ type: 'message', role: 'assistant', content: 'abcdef' }, { type: 'result', status: 'success' }]);
    expect(tooLong.finalTruncated).toBe(true);
    expect(tooLong.finalOutput()).toBeUndefined();
  });
});

describe('toObservation', () => {
  it('keeps only checkout-relative paths and line ranges', () => {
    expect(toObservation({ action: 'reading_file', tool: 'Read', path: `${ROOT}\\src\\a.ts`, startLine: 5, endLine: 9 }, ROOT, [])).toEqual({
      action: 'reading_file',
      tool: 'Read',
      target: { path: 'src/a.ts', startLine: 5, endLine: 9 },
    });
    expect(toObservation({ action: 'searching', path: 'src/lib' }, ROOT, [])).toEqual({
      action: 'searching',
      target: { path: 'src/lib' },
    });
  });

  it.each([
    'C:\\work\\other\\secret.txt',
    'C:\\Users\\me\\.ssh\\id_rsa',
    '..\\outside.ts',
    'src/../../outside.ts',
    '\\\\server\\share\\a.ts',
    'https://example.com/a.ts',
    'D:relative.ts',
    ROOT,
  ])('drops the unsafe or non-file path %s', (path) => {
    expect(toObservation({ action: 'reading_file', path, startLine: 1 }, ROOT, [])).toEqual({ action: 'reading_file' });
  });

  it('drops paths that redaction would change and tool names outside the allowlist shape', () => {
    const secret = 'abcdef0123456789secretvalue';
    expect(toObservation({ action: 'reading_file', path: `config/${secret}.json` }, ROOT, [secret])).toEqual({
      action: 'reading_file',
    });
    expect(toObservation({ action: 'tool_other', tool: 'rm -rf' }, ROOT, [])).toEqual({ action: 'tool_other' });
  });

  it('drops an end line before the start line', () => {
    expect(toObservation({ action: 'reading_file', path: 'a.ts', startLine: 9, endLine: 3 }, ROOT, [])).toEqual({
      action: 'reading_file',
      target: { path: 'a.ts', startLine: 9 },
    });
  });
});
