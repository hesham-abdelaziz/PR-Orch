import {
  PullRequestSummarySchema,
  type PullRequestSummary,
  type AzureAuthStatus,
} from '@pr-orchestrator/contracts';
import { HttpException } from '@nestjs/common';
import type { SecretValuesService } from '../secrets/secret-store.js';
import { parseAzurePrUrl } from './azure-pr-url.parser.js';
import { readAzureCliToken, resolveAzureCli } from './azure-cli-token.js';
import { redactSecrets } from '../providers/redact-secrets.js';

export interface GitCredential {
  value: string;
  scheme: 'Basic' | 'Bearer';
}
export interface AzureOptions {
  fetch?: typeof fetch;
  cliToken?: () => Promise<string>;
  cliExecutablePath?: () => Promise<string>;
}
const responseError = () =>
  new HttpException('Invalid Azure DevOps response', 502);
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw responseError();
  return input as Record<string, unknown>;
}
function text(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw responseError();
  return input;
}
function commit(input: unknown): string {
  const value = text(record(input).commitId);
  if (!/^[a-f0-9]{40}$/i.test(value)) throw responseError();
  return value;
}
function date(input: unknown): string {
  const value = text(input);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))
    throw responseError();
  return new Date(value).toISOString();
}
function branch(input: unknown): string {
  const value = text(input);
  // eslint-disable-next-line no-control-regex -- Git ref trust boundary.
  if (
    !value.startsWith('refs/heads/') ||
    value.length <= 11 ||
    /[\x00-\x20\x7f~^:?*[\\]|\.\.|@\{|\/\/|[./]$/.test(value)
  )
    throw responseError();
  return value;
}

export class AzureDevOpsService {
  private lastAttemptedPrUrl: string | undefined;
  constructor(
    private readonly secrets: SecretValuesService,
    private readonly options: AzureOptions = {},
  ) {}
  async getGitCredential(): Promise<GitCredential> {
    const pat = await this.secrets.getPat();
    if (pat) return { value: pat, scheme: 'Basic' };
    try {
      const value = await (this.options.cliToken ?? readAzureCliToken)();
      if (!value || value.length > 16384 || /\s/.test(value))
        throw new Error('Invalid token');
      this.secrets.rememberCredential(value);
      return { value, scheme: 'Bearer' };
    } catch {
      throw new HttpException(
        'Configure an Azure DevOps PAT with Code read permission, or authenticate Azure CLI outside the dashboard using az login',
        422,
      );
    }
  }
  async status(): Promise<AzureAuthStatus> {
    if (await this.secrets.getPat()) return { method: 'pat', configured: true };
    try {
      await this.getGitCredential();
      const executablePath = await (
        this.options.cliExecutablePath ??
        (async () => (await resolveAzureCli()).executable)
      )();
      return { method: 'azure_cli', configured: true, executablePath };
    } catch {
      return {
        method: 'unavailable',
        configured: false,
        reason: 'pat_missing_and_azure_cli_unavailable',
      };
    }
  }
  async test(): Promise<{ ok: boolean; message: string }> {
    if (!this.lastAttemptedPrUrl)
      return {
        ok: false,
        message:
          'Validate a pull request first so the connection test can check the correct organization and repository. A saved credential alone does not verify Azure access.',
      };
    try {
      await this.validatePullRequest(this.lastAttemptedPrUrl);
      return {
        ok: true,
        message:
          'Azure DevOps read access verified for the last attempted pull request.',
      };
    } catch (error) {
      return {
        ok: false,
        message: redactSecrets(
          error instanceof HttpException
            ? error.message
            : 'Azure DevOps connection could not be verified. Retry pull request validation.',
          this.secrets.values(),
        ),
      };
    }
  }
  async validatePullRequest(url: string): Promise<PullRequestSummary> {
    let identity: ReturnType<typeof parseAzurePrUrl>;
    try {
      identity = parseAzurePrUrl(url);
    } catch {
      throw new HttpException('Use a canonical HTTPS Azure DevOps PR URL', 400);
    }
    this.lastAttemptedPrUrl = url;
    const credential = await this.getGitCredential();
    const base = `https://dev.azure.com/${encodeURIComponent(identity.organization)}/${encodeURIComponent(identity.project)}/_apis/git/repositories/${encodeURIComponent(identity.repository)}/pullRequests/${identity.pullRequestId}`;
    const headers = {
      Authorization:
        credential.scheme === 'Basic'
          ? `Basic ${Buffer.from(':' + credential.value).toString('base64')}`
          : `Bearer ${credential.value}`,
      Accept: 'application/json',
    };
    const get = async (suffix: string): Promise<Record<string, unknown>> => {
      let response: Response;
      try {
        response = await (this.options.fetch ?? fetch)(base + suffix, {
          method: 'GET',
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw new HttpException(
          'Azure DevOps request failed or timed out',
          502,
        );
      }
      if (!response.ok)
        throw new HttpException(
          response.status === 401
            ? credential.scheme === 'Basic'
              ? "Azure DevOps rejected the saved PAT (HTTP 401). Check token expiration/revocation, the organization in the PR URL, and the token owner's repository access. Code Read scope alone does not verify access."
              : 'Azure DevOps rejected the Azure CLI credential (HTTP 401). Sign into the correct account with az login outside the dashboard, then retry.'
            : response.status === 403
              ? 'Azure DevOps access denied; Code read permission and repository access are required'
              : response.status === 404
                ? 'Azure DevOps pull request or repository was not found'
                : 'Azure DevOps service request failed',
          response.status === 401
            ? 422
            : [403, 404].includes(response.status)
              ? response.status
              : 502,
        );
      // Bound streaming bodies before JSON parsing; do not echo server diagnostics.
      const reader = response.body?.getReader();
      if (!reader) throw responseError();
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 2 * 1048576) {
            await reader.cancel();
            throw responseError();
          }
          chunks.push(part.value);
        }
        return record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        throw responseError();
      }
    };
    const metadata = await get('?api-version=7.1');
    if (metadata.pullRequestId !== identity.pullRequestId)
      throw responseError();
    const repository = record(metadata.repository);
    if (
      text(repository.name).toLowerCase() !==
        identity.repository.toLowerCase() ||
      text(record(repository.project).name).toLowerCase() !==
        identity.project.toLowerCase()
    )
      throw responseError();
    const source = commit(metadata.lastMergeSourceCommit),
      target = commit(metadata.lastMergeTargetCommit);
    const iterations = (await get('/iterations?api-version=7.1')).value;
    if (
      !Array.isArray(iterations) ||
      !iterations.length ||
      iterations.length > 10000
    )
      throw responseError();
    const parsedIterations = iterations.map(record);
    if (
      parsedIterations.some(
        (iteration) =>
          !Number.isSafeInteger(iteration.id) || Number(iteration.id) <= 0,
      )
    )
      throw responseError();
    const latest = parsedIterations.sort(
      (a, b) => Number(b.id) - Number(a.id),
    )[0]!;
    if (commit(latest.sourceRefCommit) !== source) throw responseError();
    // Iteration target is a snapshot; lastMergeTargetCommit can advance independently.
    commit(latest.targetRefCommit);
    const files = new Set<number>();
    let skip = 0;
    for (let page = 0; ; page++) {
      if (page >= 10)
        throw new HttpException(
          'Azure DevOps changed-file limit exceeded (10,000 files)',
          422,
        );
      const changes = await get(
        `/iterations/${String(latest.id)}/changes?api-version=7.1&$compareTo=0&$top=1000&$skip=${skip}`,
      );
      if (
        !Array.isArray(changes.changeEntries) ||
        changes.changeEntries.length > 1000
      )
        throw responseError();
      for (const item of changes.changeEntries) {
        const change = record(item);
        if (
          !Number.isSafeInteger(change.changeTrackingId) ||
          Number(change.changeTrackingId) <= 0
        )
          throw responseError();
        text(record(change.item).path);
        files.add(Number(change.changeTrackingId));
      }
      if (
        (changes.nextSkip == null && changes.nextTop == null) ||
        (changes.nextSkip === 0 && changes.nextTop === 0)
      )
        break;
      if (
        !Number.isSafeInteger(changes.nextSkip) ||
        Number(changes.nextSkip) <= skip ||
        !Number.isSafeInteger(changes.nextTop) ||
        Number(changes.nextTop) <= 0
      )
        throw responseError();
      skip = Number(changes.nextSkip);
    }
    const author = record(metadata.createdBy);
    const safe = (value: string) => redactSecrets(value, this.secrets.values());
    try {
      const summary = PullRequestSummarySchema.parse({
        ...identity,
        url,
        title: text(metadata.title),
        author: { id: text(author.id), displayName: text(author.displayName) },
        sourceBranch: branch(metadata.sourceRefName),
        targetBranch: branch(metadata.targetRefName),
        sourceCommit: source,
        targetCommit: target,
        changedFiles: files.size,
        additions: 0,
        deletions: 0,
        updatedAt: date(
          latest.updatedDate ?? latest.createdDate ?? metadata.creationDate,
        ),
      });
      return PullRequestSummarySchema.parse(
        Object.fromEntries(
          Object.entries(summary).map(([key, value]) => [
            key,
            typeof value === 'string'
              ? safe(value)
              : key === 'author'
                ? {
                    id: safe(summary.author.id),
                    displayName: safe(summary.author.displayName),
                  }
                : value,
          ]),
        ),
      );
    } catch {
      throw responseError();
    }
  }
}
