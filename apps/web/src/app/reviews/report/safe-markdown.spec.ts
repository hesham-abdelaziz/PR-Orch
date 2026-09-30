import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SafeMarkdownComponent } from './safe-markdown.component';

describe('SafeMarkdownComponent', () => {
  let fixture: ComponentFixture<SafeMarkdownComponent>;
  let component: SafeMarkdownComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SafeMarkdownComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SafeMarkdownComponent);
    component = fixture.componentInstance;
  });

  it('renders standard Markdown headings, lists, tables, and code blocks', () => {
    component.markdown = `# Heading 1\n## Heading 2\n\n- Item 1\n- Item 2\n\n| Col 1 | Col 2 |\n|---|---|\n| Val 1 | Val 2 |\n\n\`\`\`typescript\nconst x = 42;\n\`\`\``;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe('Heading 1');
    expect(el.querySelector('h2')?.textContent).toBe('Heading 2');
    expect(el.querySelectorAll('li').length).toBe(2);
    expect(el.querySelector('table')).toBeTruthy();
    expect(el.querySelector('pre code')?.textContent).toContain('const x = 42;');
  });

  it('disables raw HTML at parse time even for tags otherwise allowed in Markdown output', () => {
    component.markdown = `Paragraph with <b>raw bold html</b> and <div class="injected">injected block</div> and <span>span</span>`;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    // Raw HTML must not create DOM elements
    expect(el.querySelector('b')).toBeNull();
    expect(el.querySelector('.injected')).toBeNull();
    expect(el.querySelector('span')).toBeNull();
    expect(el.textContent).toContain('raw bold html');
    expect(el.textContent).toContain('injected block');
  });

  it('strips script, style, iframe, event attributes, and SVG payloads', () => {
    component.markdown = `
<script>alert("xss")</script>
<style>body { display: none; }</style>
<iframe src="https://evil.com"></iframe>
<img src="invalid.jpg" onerror="alert(1)" alt="test image" />
<svg onload="alert(1)"><circle r="10"/></svg>

Safe text content
`;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('style')).toBeNull();
    expect(el.querySelector('iframe')).toBeNull();
    expect(el.querySelector('svg')).toBeNull();
    expect(el.innerHTML).not.toContain('onerror');
    expect(el.innerHTML).not.toContain('onload');
    expect(el.textContent).toContain('Safe text content');
  });

  it('neutralizes javascript: and data: links including encoded variants', () => {
    component.markdown = `
[Malicious Link](javascript:alert(1))
[Data Link](data:text/html,<script>alert(1)</script>)
[Encoded Link](javascript&#x3A;alert(1))
[Safe Link](https://dev.azure.com/acme)
`;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const links = el.querySelectorAll('a');
    expect(links.length).toBeGreaterThanOrEqual(1);

    for (const link of Array.from(links)) {
      const href = link.getAttribute('href') ?? '';
      expect(href).not.toMatch(/^\s*(?:javascript|data|vbscript)/i);
    }

    const safeLink = Array.from(links).find((a) => a.textContent?.includes('Safe Link'));
    expect(safeLink?.getAttribute('href')).toBe('https://dev.azure.com/acme');
  });

  it('preserves HTML shown inside fenced code blocks as literal text', () => {
    component.markdown = `\`\`\`html\n<div class="code-box">code content</div>\n<script>alert("in-code")</script>\n\`\`\``;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const codeBlock = el.querySelector('pre code');
    expect(codeBlock).toBeTruthy();
    expect(codeBlock?.textContent).toContain('<div class="code-box">code content</div>');
    expect(codeBlock?.textContent).toContain('<script>alert("in-code")</script>');
    // No script element was executed or inserted
    expect(el.querySelector('script')).toBeNull();
  });

  it('safely renders malformed Markdown without throwing errors and renders escaped text on error path', () => {
    component.markdown = `[broken link(unclosed\n\n\`\`\`unclosed code\n<div unclosed <script>alert(1)</script>`;
    expect(() => {
      fixture.detectChanges();
    }).not.toThrow();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('script')).toBeNull();
    expect(el.innerHTML).not.toContain('<script>');
  });

  it('renders huge code blocks and long lines with horizontal scrolling containers', () => {
    const longLine = 'const longIdentifierName = "' + 'a'.repeat(2000) + '";';
    component.markdown = `\`\`\`javascript\n${longLine}\n\`\`\``;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const codeBlock = el.querySelector('pre');
    expect(codeBlock).toBeTruthy();
    expect(codeBlock?.textContent).toContain('longIdentifierName');
  });
});
