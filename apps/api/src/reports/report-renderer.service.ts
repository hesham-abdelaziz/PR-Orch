import { Injectable } from '@nestjs/common';
import type {
  ModelSelection,
  ReviewFinding,
  ReviewJob,
  Severity,
  VerifiedReport,
  VerifierDecision,
} from '@pr-orchestrator/contracts';

import { codeSpan, sanitizeBlock, sanitizeInline } from './markdown-safety.js';

export interface RenderReportInput {
  readonly job: ReviewJob;
  readonly report: VerifiedReport;
  /** Every candidate finding reviewers produced, for the audit trail. */
  readonly candidates: readonly ReviewFinding[];
  readonly durationMs: number;
}

export interface RenderReportOptions {
  readonly auditStyle?: 'details' | 'heading';
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const RUN_STATE_LABEL: Record<string, string> = {
  queued: 'queued',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  timed_out: 'timed out',
  cancelled: 'cancelled',
};

const label = (selection: ModelSelection): string =>
  sanitizeInline(`${selection.provider}/${selection.model}`);

/** Renders the canonical Markdown report from validated structured data only. */
@Injectable()
export class ReportRenderer {
  render(input: RenderReportInput, options: RenderReportOptions = {}): string {
    const { job, report } = input;
    const findings = sortFindings(report.findings);
    const lines: string[] = [];

    lines.push(`# Pull request review: ${sanitizeInline(job.pullRequest.title)}`, '');
    lines.push(`Overall risk: ${report.overallRisk}`, '');
    lines.push(
      'This report is the result of a static code inspection: reviewers read the pull request diff and repository files and did not build, test or run the code. It lists what was found in the files inspected; it does not certify the absence of other defects. See Coverage for exclusions.',
      '',
    );

    this.overview(lines, input);
    this.models(lines, job);
    this.guidance(lines, job);
    this.warnings(lines, job, report);

    lines.push('## Summary', '', sanitizeBlock(report.executiveSummary), '');
    this.verification(lines, report);
    this.findingsSection(lines, findings, report.decisions);
    this.coverage(lines, report);
    this.audit(lines, input, options.auditStyle ?? 'details');

    return `${lines.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd()}\n`;
  }

  private overview(lines: string[], { job, durationMs }: RenderReportInput): void {
    const pr = job.pullRequest;

    lines.push(
      '## Overview',
      '',
      `- Repository: ${sanitizeInline(`${pr.organization}/${pr.project}/${pr.repository}`)}`,
      `- Pull request: #${pr.pullRequestId} ${codeSpan(pr.url)}`,
      `- Author: ${sanitizeInline(pr.author.displayName)}`,
      `- Source: ${codeSpan(pr.sourceBranch)} at ${codeSpan(pr.sourceCommit.slice(0, 12))}`,
      `- Target: ${codeSpan(pr.targetBranch)} at ${codeSpan(pr.targetCommit.slice(0, 12))}`,
      `- Changes: ${pr.changedFiles} files, +${pr.additions} / -${pr.deletions}`,
      `- Review started: ${sanitizeInline(job.createdAt)}`,
      `- Review duration: ${formatDuration(durationMs)}`,
      '',
    );
  }

  private models(lines: string[], job: ReviewJob): void {
    lines.push('## Models', '', `- Main verifier: ${label(job.main)}`);

    for (const reviewer of job.reviewers) {
      const state = RUN_STATE_LABEL[reviewer.state] ?? reviewer.state;
      const note = reviewer.warning ? ` (${sanitizeInline(reviewer.warning)})` : '';
      lines.push(`- Reviewer ${label(reviewer.selection)}: ${state}${note}`);
    }

    lines.push('');
  }

  private guidance(lines: string[], job: ReviewJob): void {
    lines.push('## Guidance', '');

    if (job.standards === null) {
      lines.push(
        'No project standards file was used for this review. Reviewers applied general framework and library guidance instead.',
        '',
      );

      return;
    }

    const standards = job.standards;
    lines.push(
      `Project standards: ${sanitizeInline(standards.filename)}`,
      `- SHA-256: ${codeSpan(standards.sha256)}`,
      `- Size: ${standards.sizeBytes} bytes`,
      `- Uploaded: ${sanitizeInline(standards.uploadedAt)}`,
      '',
    );
  }

  private warnings(lines: string[], job: ReviewJob, report: VerifiedReport): void {
    const unique = [...new Set([...job.warnings, ...report.warnings])];
    if (unique.length === 0) return;

    lines.push('## Warnings', '', ...unique.map((warning) => `- ${sanitizeInline(warning)}`), '');
  }

  private verification(lines: string[], report: VerifiedReport): void {
    lines.push(
      '## Verification',
      '',
      `- Verified findings: ${report.findings.length}`,
      `- Rejected claims: ${report.rejectedCount}`,
      `- Merged claims: ${report.mergedCount}`,
      '',
      'Overall risk is the highest severity among verified findings, or clean when there are none.',
      '',
    );
  }

  private findingsSection(
    lines: string[],
    findings: readonly ReviewFinding[],
    decisions: readonly VerifierDecision[],
  ): void {
    lines.push('## Findings', '');

    if (findings.length === 0) {
      lines.push('No verified findings.');
      const rejected = decisions
        .filter((decision) => decision.verdict === 'rejected')
        .reduce((total, decision) => total + decision.candidateIds.length, 0);

      if (rejected > 0 && rejected === totalClaims(decisions)) {
        lines.push(
          '',
          `All ${rejected} candidate ${rejected === 1 ? 'claim was' : 'claims were'} rejected by the verifier; the reasons are recorded in the audit section below.`,
        );
      }

      lines.push('');

      return;
    }

    findings.forEach((finding, index) => {
      const decision = decisions.find((candidate) => candidate.finding?.id === finding.id);
      lines.push(
        `### ${index + 1}. [${finding.severity.toUpperCase()}] ${sanitizeInline(finding.title)}`,
        '',
        `- Location: ${codeSpan(formatLocation(finding))}${finding.location.description ? ` — ${sanitizeInline(finding.location.description)}` : ''}`,
        `- Reported by: ${finding.origins.map(label).join(', ')}`,
      );

      if (decision) {
        lines.push(`- Verifier decision: ${decision.verdict} — ${sanitizeInline(decision.rationale)}`);
      }

      if (finding.reference) lines.push(`- Reference: ${sanitizeInline(finding.reference)}`);

      lines.push(
        '',
        '**Evidence**',
        '',
        sanitizeBlock(finding.evidence),
        '',
        '**Impact**',
        '',
        sanitizeBlock(finding.impact),
        '',
        '**Suggested fix**',
        '',
        sanitizeBlock(finding.suggestedFix),
        '',
      );
    });
  }

  private coverage(lines: string[], report: VerifiedReport): void {
    lines.push('## Coverage', '');

    if (report.exclusions.length === 0) {
      lines.push('No files were excluded from detailed inspection.', '');

      return;
    }

    lines.push(
      'These files were excluded from detailed inspection:',
      '',
      ...[...report.exclusions]
        .sort((left, right) => compare(left.path, right.path))
        .map((exclusion) => `- ${codeSpan(exclusion.path)} — ${sanitizeInline(exclusion.reason)}`),
      '',
    );
  }

  private audit(
    lines: string[],
    { report, candidates }: RenderReportInput,
    style: 'details' | 'heading',
  ): void {
    if (report.decisions.length === 0) return;

    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const body: string[] = [];

    for (const decision of report.decisions) {
      body.push(`- ${decision.verdict}: ${sanitizeInline(decision.rationale)}`);

      for (const candidateId of decision.candidateIds) {
        const candidate = byId.get(candidateId);
        body.push(
          candidate
            ? `  - ${sanitizeInline(candidate.title)} (${codeSpan(formatLocation(candidate))}; reported by ${candidate.origins.map(label).join(', ')})`
            : `  - candidate ${codeSpan(candidateId)}`,
        );
      }
    }

    if (style === 'heading') {
      lines.push('## Audit trail', '', ...body, '');

      return;
    }

    lines.push(
      '<details>',
      `<summary>Audit trail (${report.decisions.length} verifier decisions)</summary>`,
      '',
      ...body,
      '',
      '</details>',
      '',
    );
  }
}

function totalClaims(decisions: readonly VerifierDecision[]): number {
  return decisions.reduce((total, decision) => total + decision.candidateIds.length, 0);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortFindings(findings: readonly ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort(
    (left, right) =>
      SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
      compare(left.filePath, right.filePath) ||
      left.location.startLine - right.location.startLine ||
      compare(left.title, right.title) ||
      compare(left.id, right.id),
  );
}

function formatLocation(finding: ReviewFinding): string {
  const { startLine, endLine } = finding.location;

  return endLine !== undefined && endLine !== startLine
    ? `${finding.filePath}:${startLine}-${endLine}`
    : `${finding.filePath}:${startLine}`;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds} s`;

  return `${seconds} s`;
}
