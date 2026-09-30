import { TestBed } from '@angular/core/testing';
import { ReviewJobSchema } from '@pr-orchestrator/contracts';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('resolves the shared review job contract', () => {
    expect(ReviewJobSchema).toBeDefined();
  });
});
