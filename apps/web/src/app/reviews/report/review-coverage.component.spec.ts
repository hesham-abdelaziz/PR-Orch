import { ComponentFixture, TestBed } from '@angular/core/testing';
import axe from 'axe-core';
import { ReviewCoverageComponent } from './review-coverage.component';
import { ReviewAreaCoverage, ReviewerCoverage } from './review-coverage.model';

describe('ReviewCoverageComponent', () => {
  let fixture: ComponentFixture<ReviewCoverageComponent>;
  let component: ReviewCoverageComponent;

  const mockProtocolAreas: ReviewAreaCoverage[] = [
    {
      area: 'sec-auth',
      title: 'Authentication & Session Security',
      source: 'protocol',
      status: 'checked',
    },
    {
      area: 'perf-queries',
      title: 'Database Query Performance',
      source: 'protocol',
      status: 'checked',
    },
  ];

  const mockStandardsAreas: ReviewAreaCoverage[] = [
    {
      area: 'std-error-handling',
      title: 'Standardized Error Handling',
      source: 'standards',
      status: 'checked',
    },
  ];

  const createMockCoverage = (overrides?: {
    reviewer1Status?: { area: string; status: 'checked' | 'not_applicable' | 'missing'; note?: string };
    reviewer2Status?: { area: string; status: 'checked' | 'not_applicable' | 'missing'; note?: string };
  }): ReviewerCoverage[] => {
    const rev1Areas = [
      ...mockProtocolAreas.map((a) => ({ ...a })),
      ...mockStandardsAreas.map((a) => ({ ...a })),
    ];
    const rev2Areas = [
      ...mockProtocolAreas.map((a) => ({ ...a })),
      ...mockStandardsAreas.map((a) => ({ ...a })),
    ];

    if (overrides?.reviewer1Status) {
      const idx = rev1Areas.findIndex((a) => a.area === overrides.reviewer1Status!.area);
      if (idx !== -1) {
        rev1Areas[idx] = {
          ...rev1Areas[idx],
          status: overrides.reviewer1Status.status,
          note: overrides.reviewer1Status.note,
        };
      }
    }

    if (overrides?.reviewer2Status) {
      const idx = rev2Areas.findIndex((a) => a.area === overrides.reviewer2Status!.area);
      if (idx !== -1) {
        rev2Areas[idx] = {
          ...rev2Areas[idx],
          status: overrides.reviewer2Status.status,
          note: overrides.reviewer2Status.note,
        };
      }
    }

    return [
      {
        reviewer: { provider: 'codex', model: 'gpt-4o' },
        areas: rev1Areas,
      },
      {
        reviewer: { provider: 'claude', model: 'claude-3-7-sonnet' },
        areas: rev2Areas,
      },
    ];
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReviewCoverageComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ReviewCoverageComponent);
    component = fixture.componentInstance;
  });

  it('hides the section when coverage is absent or empty', () => {
    component.coverage = undefined;
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('#review-coverage')).toBeNull();
    expect(element.querySelector('table')).toBeNull();

    component.coverage = [];
    fixture.detectChanges();
    expect(element.querySelector('#review-coverage')).toBeNull();
    expect(element.querySelector('table')).toBeNull();
  });

  it('renders all areas covered with summary line and no missing row highlights', () => {
    component.coverage = createMockCoverage();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const section = element.querySelector('#review-coverage');
    expect(section).toBeTruthy();

    // Collapsed by default
    const details = element.querySelector('details.coverage-details') as HTMLDetailsElement;
    expect(details.open).toBe(false);

    // Summary line
    const summaryBadge = element.querySelector('.coverage-summary-badge');
    expect(summaryBadge?.textContent?.trim()).toBe('All 3 areas covered by every reviewer');
    expect(summaryBadge?.classList.contains('badge-clean')).toBe(true);

    // Rows
    const missingRows = element.querySelectorAll('tr.row-missing');
    expect(missingRows.length).toBe(0);

    const unreviewedBadges = element.querySelectorAll('.badge-not-reviewed');
    expect(unreviewedBadges.length).toBe(0);

    // Table headers and columns
    const thCols = element.querySelectorAll('thead th');
    expect(thCols[0].textContent?.trim()).toBe('Review Area');
    expect(thCols[1].textContent?.trim()).toBe('codex/gpt-4o');
    expect(thCols[2].textContent?.trim()).toBe('claude/claude-3-7-sonnet');

    // Group headers: Protocol Areas first, then Project Standards
    const groupHeaders = element.querySelectorAll('.group-header');
    expect(groupHeaders[0].textContent?.trim()).toBe('Protocol Areas');
    expect(groupHeaders[1].textContent?.trim()).toBe('Project Standards');
  });

  it('handles a missing area for one reviewer: highlights the row and updates summary line', () => {
    component.coverage = createMockCoverage({
      reviewer1Status: {
        area: 'sec-auth',
        status: 'missing',
      },
      reviewer2Status: {
        area: 'sec-auth',
        status: 'checked',
      },
    });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    // Summary line
    const summaryBadge = element.querySelector('.coverage-summary-badge');
    expect(summaryBadge?.textContent?.trim()).toBe('1 area not reviewed by at least one reviewer');
    expect(summaryBadge?.classList.contains('badge-warning')).toBe(true);

    // Row is highlighted with row-missing
    const missingRows = element.querySelectorAll('tr.row-missing');
    expect(missingRows.length).toBe(1);

    // It was checked by reviewer 2, so it should NOT be marked "Not reviewed by any reviewer"
    const unreviewedBadges = element.querySelectorAll('.badge-not-reviewed');
    expect(unreviewedBadges.length).toBe(0);

    // Cell checks in the matrix table
    const tableMissingCells = element.querySelectorAll('td .status-indicator.status-missing');
    expect(tableMissingCells.length).toBe(1);
    expect(tableMissingCells[0].textContent).toContain('✕');
    expect(tableMissingCells[0].textContent).toContain('Missing');

    // And also in the mobile cards view
    const cardMissingItems = element.querySelectorAll('.card-area-item.item-missing');
    expect(cardMissingItems.length).toBe(1);
  });

  it('handles an area missing for every reviewer: prominently marks "Not reviewed by any reviewer"', () => {
    component.coverage = createMockCoverage({
      reviewer1Status: {
        area: 'perf-queries',
        status: 'missing',
      },
      reviewer2Status: {
        area: 'perf-queries',
        status: 'missing',
      },
    });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    // Summary line
    const summaryBadge = element.querySelector('.coverage-summary-badge');
    expect(summaryBadge?.textContent?.trim()).toBe('1 area not reviewed by at least one reviewer');

    // Row highlighting
    const missingRows = element.querySelectorAll('tr.row-missing');
    expect(missingRows.length).toBe(1);

    // Prominent badge
    const unreviewedBadge = element.querySelector('.badge-not-reviewed');
    expect(unreviewedBadge).toBeTruthy();
    expect(unreviewedBadge?.textContent?.trim()).toBe('Not reviewed by any reviewer');
    expect(unreviewedBadge?.getAttribute('role')).toBe('status');
  });

  it('renders not_applicable status with its note and keyboard-reachable details', () => {
    const noteText = 'PR contains only documentation and README updates; no database queries exist.';
    component.coverage = createMockCoverage({
      reviewer1Status: {
        area: 'perf-queries',
        status: 'not_applicable',
        note: noteText,
      },
    });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    // Cell shows not applicable icon and label
    const naIndicator = element.querySelector('.status-indicator.status-not-applicable');
    expect(naIndicator).toBeTruthy();
    expect(naIndicator?.textContent).toContain('⊘');
    expect(naIndicator?.textContent).toContain('Not Applicable');

    // Keyboard-reachable note element
    const noteDetails = element.querySelector('.cell-note') as HTMLDetailsElement;
    expect(noteDetails).toBeTruthy();

    const noteSummary = noteDetails.querySelector('summary.note-summary');
    expect(noteSummary).toBeTruthy();
    expect(noteSummary?.getAttribute('title')).toBe(noteText);
    expect(noteSummary?.getAttribute('aria-label')).toContain(noteText);

    const notePopover = noteDetails.querySelector('.note-popover');
    expect(notePopover?.textContent?.trim()).toBe(noteText);
    expect(notePopover?.getAttribute('role')).toBe('note');

    // Also check responsive cards view renders note
    const cardNote = element.querySelector('.card-area-note');
    expect(cardNote?.textContent).toContain(noteText);
  });

  it('verifies accessibility: table headers are properly associated with their cells', () => {
    component.coverage = createMockCoverage();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const table = element.querySelector('table.coverage-table');
    expect(table).toBeTruthy();

    // Check <caption>
    const caption = table?.querySelector('caption');
    expect(caption).toBeTruthy();

    // Check column headers in <thead> have scope="col"
    const colHeaders = table?.querySelectorAll('thead th');
    expect(colHeaders?.length).toBe(3); // 1 area + 2 reviewers
    colHeaders?.forEach((th) => {
      expect(th.getAttribute('scope')).toBe('col');
    });

    // Check group headers have scope="colgroup"
    const groupHeaders = table?.querySelectorAll('.group-header-row th');
    expect(groupHeaders?.length).toBe(2);
    groupHeaders?.forEach((th) => {
      expect(th.getAttribute('scope')).toBe('colgroup');
    });

    // Check row headers in <tbody> have scope="row"
    const rowHeaders = table?.querySelectorAll('tbody tr:not(.group-header-row) th');
    expect(rowHeaders?.length).toBe(3); // 3 area rows
    rowHeaders?.forEach((th) => {
      expect(th.getAttribute('scope')).toBe('row');
    });

    // Check status legend exists and is accessible
    const legend = element.querySelector('.coverage-legend');
    expect(legend).toBeTruthy();
    expect(legend?.getAttribute('role')).toBe('region');
    expect(legend?.getAttribute('aria-label')).toBe('Coverage status legend');
  });

  it('passes axe-core accessibility audit in both collapsed and expanded states', async () => {
    component.coverage = createMockCoverage({
      reviewer1Status: {
        area: 'perf-queries',
        status: 'not_applicable',
        note: 'No queries in this PR',
      },
      reviewer2Status: {
        area: 'sec-auth',
        status: 'missing',
      },
    });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    // 1. Collapsed audit
    let results = await axe.run(element, {
      rules: { 'color-contrast': { enabled: false } },
    });
    let criticalViolations = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(criticalViolations).toHaveLength(0);

    // 2. Expanded audit
    const details = element.querySelector('details.coverage-details') as HTMLDetailsElement;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();

    results = await axe.run(element, {
      rules: { 'color-contrast': { enabled: false } },
    });
    criticalViolations = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(criticalViolations).toHaveLength(0);
  });
});
