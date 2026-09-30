const ANSI_PATTERN =
  // CSI sequences, OSC sequences (BEL or ST terminated), and two-byte escapes.
  // eslint-disable-next-line no-control-regex
  /\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\u001B[@-Z\\-_]/gu;

// C0 controls except tab and newline, plus DEL and C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu;

/** Removes terminal escape sequences and control characters from decoded text. */
export function sanitizeTerminalText(text: string): string {
  return text
    .replace(/\r\n/gu, '\n')
    .replace(ANSI_PATTERN, '')
    .replace(CONTROL_PATTERN, '');
}

/** Number of trailing bytes that form an incomplete UTF-8 sequence. */
function incompleteUtf8Tail(bytes: Buffer): number {
  const lookback = Math.min(3, bytes.length);

  for (let offset = 1; offset <= lookback; offset += 1) {
    const byte = bytes[bytes.length - offset] as number;

    if ((byte & 0b1100_0000) === 0b1000_0000) continue; // continuation byte

    let expected = 1;
    if ((byte & 0b1110_0000) === 0b1100_0000) expected = 2;
    else if ((byte & 0b1111_0000) === 0b1110_0000) expected = 3;
    else if ((byte & 0b1111_1000) === 0b1111_0000) expected = 4;

    return expected > offset ? offset : 0;
  }

  return 0;
}

/**
 * Collects at most `maxBytes` raw bytes but accepts (and counts) unlimited
 * input so the producing pipe keeps draining. Decoding happens once at the end
 * so multi-byte characters and escape sequences that straddle chunk boundaries
 * are handled correctly.
 */
export class OutputBuffer {
  private readonly chunks: Buffer[] = [];
  private retainedBytes = 0;
  private receivedBytes = 0;

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer): void {
    this.receivedBytes += chunk.length;

    const remaining = this.maxBytes - this.retainedBytes;
    if (remaining <= 0) return;

    const kept = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
    this.chunks.push(Buffer.from(kept));
    this.retainedBytes += kept.length;
  }

  get totalBytes(): number {
    return this.receivedBytes;
  }

  get truncated(): boolean {
    return this.receivedBytes > this.retainedBytes;
  }

  toSanitizedString(): string {
    let bytes = Buffer.concat(this.chunks);

    if (this.truncated) {
      bytes = bytes.subarray(0, bytes.length - incompleteUtf8Tail(bytes));
    }

    return sanitizeTerminalText(bytes.toString('utf8'));
  }
}
