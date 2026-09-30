import { Component, Input, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

function escapeRawHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const parser = new Marked({
  renderer: {
    html(_token) {
      // Discard raw HTML tokens at parse time
      return '';
    },
  },
});

@Component({
  selector: 'app-safe-markdown',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="safe-markdown-body" [innerHTML]="safeHtml"></div>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .safe-markdown-body {
      font-size: 13px;
      line-height: 1.6;
      color: $text-primary;
      word-wrap: break-word;

      h1, h2, h3, h4, h5, h6 {
        color: $text-primary;
        margin-top: 20px;
        margin-bottom: 10px;
        font-weight: 600;
        line-height: 1.3;
      }

      h1 { font-size: 18px; border-bottom: 1px solid $border-subtle; padding-bottom: 6px; }
      h2 { font-size: 15px; }
      h3 { font-size: 13px; }

      p {
        margin-bottom: 12px;
      }

      ul, ol {
        margin-bottom: 12px;
        padding-left: 20px;

        li {
          margin-bottom: 4px;
        }
      }

      a {
        color: $accent-primary;
        text-decoration: none;
        &:hover { text-decoration: underline; }
      }

      blockquote {
        border-left: 3px solid $accent-primary;
        margin: 12px 0;
        padding: 4px 12px;
        color: $text-secondary;
        background-color: rgba(56, 189, 248, 0.05);
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin: 14px 0;
        font-size: 12px;

        th, td {
          border: 1px solid $border-subtle;
          padding: 8px 12px;
          text-align: left;
        }

        th {
          background-color: $bg-surface-2;
          color: $text-secondary;
          font-weight: 600;
        }

        tr:nth-child(even) {
          background-color: $bg-surface-1;
        }
      }

      pre {
        background-color: $bg-surface-1;
        border: 1px solid $border-subtle;
        border-radius: 6px;
        padding: 12px 16px;
        overflow-x: auto;
        margin: 14px 0;

        code {
          font-family: $font-mono;
          font-size: 11px;
          line-height: 1.5;
          color: $text-primary;
          background: transparent;
          padding: 0;
          border: none;
        }
      }

      code {
        font-family: $font-mono;
        font-size: 11px;
        background-color: $bg-surface-2;
        padding: 2px 5px;
        border-radius: 3px;
        color: $accent-primary;
      }
    }
  `],
})
export class SafeMarkdownComponent implements OnChanges {
  private _markdown = '';

  @Input()
  get markdown(): string {
    return this._markdown;
  }
  set markdown(val: string) {
    this._markdown = val;
    this.render();
  }

  private readonly sanitizer = inject(DomSanitizer);

  safeHtml: SafeHtml | string = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['markdown']) {
      this.render();
    }
  }

  private render(): void {
    if (!this._markdown) {
      this.safeHtml = '';
      return;
    }

    try {
      const dirtyHtml = parser.parse(this._markdown, { async: false }) as string;
      const cleanHtml = DOMPurify.sanitize(dirtyHtml, {
        ALLOWED_TAGS: [
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li',
          'code', 'pre', 'strong', 'em', 'del', 'blockquote', 'table',
          'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 'span', 'div',
        ],
        ALLOWED_ATTR: ['href', 'title', 'class', 'target', 'rel', 'id'],
        ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
      });

      this.safeHtml = this.sanitizer.bypassSecurityTrustHtml(cleanHtml);
    } catch {
      // The error path renders content as escaped text, never trusted raw HTML
      this.safeHtml = escapeRawHtml(this._markdown);
    }
  }
}
