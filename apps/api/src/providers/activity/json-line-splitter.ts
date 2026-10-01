/**
 * Splits a byte stream into newline-terminated lines with a hard per-line byte
 * cap. Splitting happens on the raw `\n` byte, so multi-byte UTF-8 characters
 * that straddle chunk boundaries are reassembled before decoding. A line longer
 * than the cap is discarded as a whole (counted in `dropped`) without ever being
 * buffered beyond the cap, so memory stays bounded whatever the provider prints.
 */
export class JsonLineSplitter {
  private parts: Buffer[] = [];
  private size = 0;
  private overflow = false;
  private droppedLines = 0;

  constructor(
    private readonly maxLineBytes: number,
    private readonly onLine: (line: string) => void,
  ) {}

  /** Lines discarded because they exceeded the cap. */
  get dropped(): number {
    return this.droppedLines;
  }

  push(chunk: Buffer): void {
    let start = 0;

    while (start < chunk.length) {
      const newline = chunk.indexOf(0x0a, start);
      const end = newline === -1 ? chunk.length : newline;
      this.append(chunk.subarray(start, end));
      if (newline === -1) return;
      this.flushLine();
      start = newline + 1;
    }
  }

  /** Emits a final line that was not newline-terminated. */
  end(): void {
    if (this.size > 0 || this.overflow) this.flushLine();
  }

  private append(bytes: Buffer): void {
    if (this.overflow || bytes.length === 0) return;
    if (this.size + bytes.length > this.maxLineBytes) {
      this.overflow = true;
      this.parts = [];
      this.size = 0;

      return;
    }
    this.parts.push(Buffer.from(bytes));
    this.size += bytes.length;
  }

  private flushLine(): void {
    if (this.overflow) {
      this.droppedLines += 1;
    } else if (this.size > 0) {
      const text = Buffer.concat(this.parts).toString('utf8').replace(/\r$/u, '');
      if (text.trim().length > 0) this.onLine(text);
    }
    this.parts = [];
    this.size = 0;
    this.overflow = false;
  }
}
