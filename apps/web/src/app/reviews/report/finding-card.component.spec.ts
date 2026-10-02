import { ComponentFixture, TestBed } from '@angular/core/testing';
import axe from 'axe-core';
import { FindingCardComponent } from './finding-card.component';
import { ReviewFinding } from '@pr-orchestrator/contracts';

describe('FindingCardComponent', () => {
  let fixture: ComponentFixture<FindingCardComponent>;
  let component: FindingCardComponent;

  const baseFinding: ReviewFinding = {
    id: 'b6f709c9-53e7-4933-a3d2-315ec0f61d27',
    title: 'Null entry crashes mapper predicate',
    severity: 'high',
    filePath: 'src/mappers/section-mapper.ts',
    location: { startLine: 42, endLine: 48 },
    evidence: 'return sections.map(s => s.title);',
    impact: 'Uncaught TypeError when section is null',
    suggestedFix: 'Guard with Boolean filter before mapping',
    origins: [{ provider: 'codex', model: 'gpt-4o' }],
  };

  const findingWithProbe: ReviewFinding = {
    ...baseFinding,
    probe: {
      summary: 'Passing [null] throws TypeError: Cannot read properties of null.',
      script: 'const { mapSections } = require("./section-mapper");\nmapSections([null]);',
      output: 'TypeError: Cannot read properties of null (reading "title")\n    at section-mapper.ts:43:18',
    },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FindingCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FindingCardComponent);
    component = fixture.componentInstance;
  });

  it('renders finding without probe as standard card without badge or expander', () => {
    component.finding = baseFinding;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.badge-severity')?.textContent?.trim()).toBe('HIGH');
    expect(el.querySelector('.badge-reproduced')).toBeNull();
    expect(el.querySelector('.probe-section')).toBeNull();
    expect(el.querySelector('.probe-toggle-btn')).toBeNull();
  });

  it('renders "Reproduced" badge next to severity when probe exists', () => {
    component.finding = findingWithProbe;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const badge = el.querySelector('.badge-reproduced');
    expect(badge).toBeTruthy();
    expect(badge?.textContent?.trim()).toBe('Reproduced');
    expect(badge?.classList.contains('font-mono')).toBe(true);
  });

  it('has probe section collapsed by default with accessible button attributes', () => {
    component.finding = findingWithProbe;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const toggleBtn = el.querySelector('.probe-toggle-btn') as HTMLButtonElement;
    expect(toggleBtn).toBeTruthy();
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    expect(toggleBtn.getAttribute('aria-controls')).toBe(`probe-details-${findingWithProbe.id}`);
    expect(el.querySelector('.probe-details')).toBeNull();
  });

  it('toggles probe section on button click and exposes accessible code blocks', () => {
    component.finding = findingWithProbe;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const toggleBtn = el.querySelector('.probe-toggle-btn') as HTMLButtonElement;

    // Expand
    toggleBtn.click();
    fixture.detectChanges();

    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    const details = el.querySelector('.probe-details');
    expect(details).toBeTruthy();
    expect(details?.id).toBe(`probe-details-${findingWithProbe.id}`);

    // Verify summary text
    expect(el.querySelector('.probe-summary-text')?.textContent?.trim()).toBe(
      findingWithProbe.probe!.summary,
    );

    // Verify script and output pre blocks and accessible names
    const preBlocks = el.querySelectorAll('.probe-code-block');
    expect(preBlocks.length).toBe(2);

    const scriptPre = preBlocks[0] as HTMLPreElement;
    expect(scriptPre.getAttribute('aria-label')).toBe('Probe script');
    expect(scriptPre.textContent).toBe(findingWithProbe.probe!.script);

    const outputPre = preBlocks[1] as HTMLPreElement;
    expect(outputPre.getAttribute('aria-label')).toBe('Probe output');
    expect(outputPre.textContent).toBe(findingWithProbe.probe!.output);

    // Collapse
    toggleBtn.click();
    fixture.detectChanges();

    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('.probe-details')).toBeNull();
  });

  it('renders probe script and output safely as plain text without HTML interpretation', () => {
    const maliciousProbe: ReviewFinding = {
      ...baseFinding,
      probe: {
        summary: '<b>HTML injection attempt</b>',
        script: '<script>alert("xss")</script><img src="x" onerror="alert(1)">',
        output: '<svg onload="alert(1)">error</svg>',
      },
    };

    component.finding = maliciousProbe;
    fixture.detectChanges();

    const toggleBtn = fixture.nativeElement.querySelector('.probe-toggle-btn') as HTMLButtonElement;
    toggleBtn.click();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    // Ensure no actual <script>, <img>, or <svg> elements were parsed or injected
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img.probe-injected')).toBeNull();
    expect(el.querySelector('svg.probe-injected')).toBeNull();

    const preBlocks = el.querySelectorAll('.probe-code-block');
    expect(preBlocks[0].textContent).toBe('<script>alert("xss")</script><img src="x" onerror="alert(1)">');
    expect(preBlocks[1].textContent).toBe('<svg onload="alert(1)">error</svg>');
  });

  it('passes axe-core accessibility audit in both collapsed and expanded states', async () => {
    component.finding = findingWithProbe;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;

    // Audit collapsed state
    const collapsedResults = await axe.run(el, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });
    const collapsedViolations = collapsedResults.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(collapsedViolations).toHaveLength(0);

    // Expand and audit expanded state
    const toggleBtn = el.querySelector('.probe-toggle-btn') as HTMLButtonElement;
    toggleBtn.click();
    fixture.detectChanges();

    const expandedResults = await axe.run(el, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });
    const expandedViolations = expandedResults.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(expandedViolations).toHaveLength(0);
  });
});
