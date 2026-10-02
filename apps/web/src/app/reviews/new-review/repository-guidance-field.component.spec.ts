import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RepositoryGuidanceFieldComponent } from './repository-guidance-field.component';
import axe from 'axe-core';

describe('RepositoryGuidanceFieldComponent', () => {
  let fixture: ComponentFixture<RepositoryGuidanceFieldComponent>;
  let component: RepositoryGuidanceFieldComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RepositoryGuidanceFieldComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(RepositoryGuidanceFieldComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders picker label, hint and explanation in initial state', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Repository Guidance (Optional)');
    expect(el.textContent).toContain("Used by all models for this review's selected repository.");
    expect(el.textContent).toContain('Attach Guidance File (.md / .txt)');

    const fileInput = el.querySelector<HTMLInputElement>('#guidance-file-input');
    expect(fileInput).toBeTruthy();
    expect(fileInput?.getAttribute('accept')).toBe('.md,.txt,text/markdown,text/plain');
    expect(fileInput?.getAttribute('aria-label')).toBe('Repository guidance file');
  });

  it('emits fileSelected when a file is picked from input', () => {
    const emitSpy = vi.spyOn(component.fileSelected, 'emit');
    const file = new File(['# Guidelines'], 'Claude.md', { type: 'text/markdown' });

    const event = {
      target: {
        files: [file],
        value: 'C:\\fakepath\\Claude.md',
      },
    } as unknown as Event;

    component.onFileChange(event);
    expect(emitSpy).toHaveBeenCalledWith(file);
    expect((event.target as HTMLInputElement).value).toBe('');
  });

  it('renders attached file box with filename, size, and remove button', () => {
    fixture.componentRef.setInput('guidance', {
      filename: 'Claude.md',
      content: '# Guidelines',
    });
    fixture.componentRef.setInput('fileSize', 1024);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Claude.md');
    expect(el.textContent).toContain('1.0 KB');

    const removeBtn = el.querySelector<HTMLButtonElement>('#remove-guidance-btn');
    expect(removeBtn).toBeTruthy();
    expect(removeBtn?.getAttribute('aria-label')).toBe('Remove repository guidance file');

    const removeSpy = vi.spyOn(component.remove, 'emit');
    removeBtn?.click();
    expect(removeSpy).toHaveBeenCalled();
  });

  it('renders error banner with concise error text and clear button', () => {
    fixture.componentRef.setInput('error', 'Guidance exceeds 64 KiB of UTF-8');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const banner = el.querySelector('.error-banner');
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toContain('Guidance exceeds 64 KiB of UTF-8');

    const clearBtn = el.querySelector<HTMLButtonElement>('.btn-clear-error');
    expect(clearBtn).toBeTruthy();
    const removeSpy = vi.spyOn(component.remove, 'emit');
    clearBtn?.click();
    expect(removeSpy).toHaveBeenCalled();
  });

  it('renders reading indicator while file is being read', () => {
    fixture.componentRef.setInput('reading', true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const indicator = el.querySelector('.status-indicator');
    expect(indicator).toBeTruthy();
    expect(indicator?.textContent).toContain('Reading guidance file...');

    const label = el.querySelector('.btn-picker');
    expect(label?.classList.contains('disabled')).toBe(true);
  });

  it('passes axe accessibility audit in all states', async () => {
    // 1. Initial empty state
    let results = await axe.run(fixture.nativeElement);
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);

    // 2. Attached state
    fixture.componentRef.setInput('guidance', { filename: 'Claude.md', content: '# Rules' });
    fixture.componentRef.setInput('fileSize', 120);
    fixture.detectChanges();
    results = await axe.run(fixture.nativeElement);
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);

    // 3. Error state
    fixture.componentRef.setInput('guidance', null);
    fixture.componentRef.setInput('error', 'File is not valid UTF-8');
    fixture.detectChanges();
    results = await axe.run(fixture.nativeElement);
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
});
