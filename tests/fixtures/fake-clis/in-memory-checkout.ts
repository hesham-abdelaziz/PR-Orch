import {
  splitLines,
  type CheckoutInspector,
  type CheckoutInspectorFactory,
  type InspectOutcome,
} from '../../../apps/api/src/reviews/output/checkout-inspector.js';

/** Lines 1..60 of a synthetic source file; line 12 holds `config.value`. */
export function syntheticSource(lineCount = 60): string {
  return Array.from({ length: lineCount }, (_, index) =>
    index + 1 === 12 ? '  const port = config.value.port;' : `  const value${index + 1} = compute(${index + 1});`,
  ).join('\n');
}

/**
 * Deterministic stand-in for a prepared checkout, keyed by checkout-relative
 * path. Used where the checkout path is Windows-style or does not exist on the
 * test machine; `FileSystemCheckoutInspector` has its own real-disk tests.
 */
export class InMemoryCheckout implements CheckoutInspectorFactory {
  readonly roots: string[] = [];
  private readonly files: Map<string, string>;

  constructor(files: Record<string, string> = {}) {
    this.files = new Map(Object.entries(files));
  }

  set(path: string, content: string): void {
    this.files.set(path, content);
  }

  lines(path: string): string[] {
    return splitLines(this.files.get(path) ?? '');
  }

  forCheckout(checkoutRoot: string): CheckoutInspector {
    this.roots.push(checkoutRoot);

    return {
      inspect: (relativePath): Promise<InspectOutcome> => {
        const content = this.files.get(relativePath);

        return Promise.resolve(
          content === undefined
            ? { ok: false, reason: 'missing' }
            : { ok: true, file: { path: relativePath, lines: splitLines(content) } },
        );
      },
    };
  }
}
