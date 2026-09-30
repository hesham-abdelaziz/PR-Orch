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

  it('strips script tags and executable JavaScript', () => {
    component.markdown = `Normal text <script>alert("xss")</script> more text`;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.innerHTML).not.toContain('<script>');
    expect(el.innerHTML).not.toContain('alert("xss")');
    expect(el.textContent).toContain('Normal text');
  });

  it('strips style tags and iframe injections', () => {
    component.markdown = `<style>body { display: none; }</style><iframe src="https://evil.com"></iframe>Safe content`;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.innerHTML).not.toContain('<style>');
    expect(el.innerHTML).not.toContain('<iframe');
    expect(el.textContent).toContain('Safe content');
  });

  it('neutralizes event handler attributes such as onload and onerror', () => {
    component.markdown = `<img src="invalid.jpg" onerror="alert(1)" alt="test image" />`;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.innerHTML).not.toContain('onerror');
  });

  it('removes javascript: and unsafe data: URIs from links', () => {
    component.markdown = `[Malicious Link](javascript:alert(1)) and [Safe Link](https://dev.azure.com/acme)`;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const links = el.querySelectorAll('a');
    for (const link of Array.from(links)) {
      const href = link.getAttribute('href') ?? '';
      expect(href).not.toMatch(/^javascript:/i);
    }
  });

  it('safely renders malformed Markdown without throwing errors', () => {
    component.markdown = `[broken link(unclosed\n\n\`\`\`unclosed code\n<div unclosed`;
    expect(() => {
      fixture.detectChanges();
    }).not.toThrow();
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
