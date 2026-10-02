import { basename, isAbsolute, join, relative, resolve, sep, matchesGlob } from 'node:path';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { DEFAULT_SETTINGS, PullRequestSummarySchema, type Settings, type PullRequestSummary } from '@pr-orchestrator/contracts';
import type { PrepareWorkspaceInput, PreparedWorkspace } from '../reviews/review-ports.js';
import type { SecretValuesService } from '../secrets/secret-store.js';
import { repositoryUrl, parseAzurePrUrl } from '../azure-devops/azure-pr-url.parser.js';
import { GitProcessService } from './git-process.service.js';
import { AzureDevOpsService, type GitCredential } from '../azure-devops/azure-devops.service.js';

export class WorkspaceService {
  private readonly git: GitProcessService;
  constructor(private readonly root: string, gitExecutable: string, private readonly secrets: SecretValuesService, private readonly remote: (pr: PullRequestSummary) => string = repositoryUrl, private readonly getSettings: () => Promise<Settings> = async () => ({ ...structuredClone(DEFAULT_SETTINGS), excludedGlobs: [...DEFAULT_SETTINGS.excludedGlobs], defaultReviewers: [], workspaceRoot: root }), private readonly getCredential: () => Promise<GitCredential> = () => new AzureDevOpsService(secrets).getGitCredential()) {
    if (!isAbsolute(root)) throw new Error('Workspace root must be absolute');
    this.git = new GitProcessService(gitExecutable, () => secrets.values());
  }
  async prepare(input: PrepareWorkspaceInput, signal: AbortSignal): Promise<PreparedWorkspace & { pullRequest: PullRequestSummary }> {
    const pr = PullRequestSummarySchema.parse(input.pullRequest); parseAzurePrUrl(pr.url);
    const settings = await this.getSettings();
    await mkdir(this.root, { recursive: true });
    const rootPath = await mkdtemp(join(this.root, 'job-')); const workspaceId = basename(rootPath); const checkoutPath = join(rootPath, 'checkout');
    try {
      await mkdir(checkoutPath); const run = (args: string[], credential?: GitCredential, maxBytes?: number) => this.git.run(args, checkoutPath, signal, credential, maxBytes);
      const remote = this.remote(pr);
      await run(['init']);
      await run(['remote', 'add', 'origin', remote]); await run(['remote', 'set-url', '--push', 'origin', 'DISABLED']);
      const credential = remote.startsWith('https:') ? await this.getCredential() : undefined;
      // A file-based test fixture needs no auth; production URLs are canonical Azure HTTPS.
      await run(['fetch', '--no-tags', '--depth=1', 'origin', pr.sourceCommit], credential ?? undefined);
      await run(['fetch', '--no-tags', '--depth=1', 'origin', pr.targetCommit], credential ?? undefined);
      // Never use the target tip as the PR baseline: it can contain unrelated changes.
      // Bound history acquisition and retain GitProcessService's cancellation, timeout,
      // credential isolation and output limits for every operation.
      let commonAncestorCommit: string | undefined;
      for (const depth of [1, 32, 128, 512, 2048, 8192]) {
        if (depth > 1) await run(['fetch', '--no-tags', `--depth=${depth}`, 'origin', pr.sourceCommit, pr.targetCommit], credential ?? undefined);
        let ancestors: string[];
        try { ancestors = (await run(['merge-base', '--all', pr.targetCommit, pr.sourceCommit])).trim().split('\n').filter(Boolean); }
        catch (error) {
          // Exit 1 without stderr means no merge base in the available history.
          // Cancellation, timeout, transport and resource errors must propagate.
          if (!(error instanceof Error) || error.message !== 'Git failed') throw error;
          continue;
        }
        if (ancestors.length !== 1) continue;
        const candidate = ancestors[0]!;
        let shallow: string[] = [];
        try { shallow = (await readFile(join(checkoutPath, '.git', 'shallow'), 'utf8')).trim().split('\n'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        // A truncated path outside the candidate's ancestry could hide another
        // merge base. Only accept the candidate when all such paths are complete.
        const beyondBase = new Set((await run(['rev-list', pr.sourceCommit, pr.targetCommit, '--not', candidate])).trim().split('\n'));
        if (shallow.some(commit => beyondBase.has(commit))) continue;
        commonAncestorCommit = candidate; break;
      }
      if (!commonAncestorCommit) throw new Error('Cannot establish a reliable common ancestor for the pinned source and target revisions after bounded history fetching (maximum depth 8192). Verify related branches and remote history availability, or use revisions with reachable ancestry.');
      await run(['-c', 'core.autocrlf=false', 'checkout', '--detach', pr.sourceCommit]);
      const comparison = ['--no-ext-diff', '--no-textconv', commonAncestorCommit, pr.sourceCommit, '--'];
      const diff = await run(['diff', ...comparison], undefined, settings.limits.hardDiffBytes);
      if (Buffer.byteLength(diff) > settings.limits.hardDiffBytes) throw new Error('PR exceeds diff hard limit');
      const changed = (await run(['diff', '--name-only', '-z', ...comparison])).split('\0').filter(Boolean);
      if (changed.length > settings.limits.hardChangedFiles) throw new Error('PR exceeds changed-file hard limit');
      const numstat = (await run(['diff', '--numstat', '-z', ...comparison])).split('\0');
      let additions = 0; let deletions = 0;
      for (let index = 0; index < numstat.length; index++) {
        const entry = numstat[index]!;
        if (!entry) continue;
        const firstTab = entry.indexOf('\t'); const secondTab = entry.indexOf('\t', firstTab + 1);
        if (firstTab < 0 || secondTab < 0) throw new Error('Invalid Git numstat output');
        const added = entry.slice(0, firstTab); const deleted = entry.slice(firstTab + 1, secondTab);
        // Renames have an empty path in the header, then two NUL-delimited paths.
        if (entry.length === secondTab + 1) index += 2;
        if (added === '-' && deleted === '-') continue;
        if (!/^\d+$/.test(added) || !/^\d+$/.test(deleted)) throw new Error('Invalid Git numstat counts');
        additions += Number(added); deletions += Number(deleted);
        if (!Number.isSafeInteger(additions) || !Number.isSafeInteger(deletions)) throw new Error('Git numstat counts exceed safe integer range');
      }
      const pullRequest = PullRequestSummarySchema.parse({ ...pr, additions, deletions });
      const exclusions: PreparedWorkspace['exclusions'] = []; const warnings: string[] = [];
      if (changed.length !== pr.changedFiles) warnings.push(`Pinned merge-base diff contains ${changed.length} paths; Azure iteration metadata reports ${pr.changedFiles} tracked changes. Counts can differ for iteration target snapshots or rename tracking; inspect metadata before treating this as a defect.`);
      for (const path of changed) {
        const local = resolve(checkoutPath, path); const rel = relative(checkoutPath, local);
        if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Git returned an invalid path');
        try {
          const info = await lstat(local);
          let reason: string | null = null;
          if (!info.isFile() || info.isSymbolicLink()) reason = 'Not a regular inspectable file';
          else if (info.size > settings.limits.hardInspectableFileBytes) throw new Error('Inspectable file exceeds hard size limit');
          else if (/^(dist|build|coverage)\//.test(path) || /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.min\./.test(path) || settings.excludedGlobs.some(glob => matchesGlob(path, glob))) reason = 'Generated, lock, minified, or configured exclusion';
          else if ((await readFile(local)).includes(0)) reason = 'Binary file';
          if (reason) exclusions.push({ path: path.replaceAll('\\', '/'), reason });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') exclusions.push({ path, reason: 'Deleted file' }); else throw error;
        }
      }
      if (changed.length > settings.limits.warningChangedFiles || Buffer.byteLength(diff) > settings.limits.warningDiffBytes) warnings.push('Large PR: review coverage may be limited');
      if (!input.standards) warnings.push('Standards file is missing. Review uses detected framework and library best practices.');
      const technologies: Record<string, unknown> = {};
      try { const manifest = JSON.parse(await readFile(join(checkoutPath, 'package.json'), 'utf8')); technologies.dependencies = manifest.dependencies ?? {}; technologies.devDependencies = manifest.devDependencies ?? {}; } catch { /* no JavaScript manifest */ }
      const diffPath = join(rootPath, 'diff.patch'); const metadataPath = join(rootPath, 'metadata.json'); const technologyManifestPath = join(rootPath, 'technology.json');
      await writeFile(diffPath, diff); await writeFile(metadataPath, JSON.stringify({ pullRequest, sourceCommit: pr.sourceCommit, targetCommit: pr.targetCommit, commonAncestorCommit, comparisonMode: 'merge-base-to-source', changedFiles: changed, exclusions, warnings })); await writeFile(technologyManifestPath, JSON.stringify(technologies));
      let standardsPath: string | null = null;
      if (input.standards) { standardsPath = join(rootPath, 'standards.txt'); await writeFile(standardsPath, await readFile(input.standards.storagePath)); }
      return { workspaceId, rootPath, checkoutPath, sourceCommit: pr.sourceCommit, targetCommit: pr.targetCommit, pullRequest, diffPath, metadataPath, technologyManifestPath, standardsPath, exclusions, warnings };
    } catch (error) { await this.cleanup(workspaceId); throw error; }
  }
  async cleanup(id: string): Promise<void> {
    if (!/^job-[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid workspace identity');
    const target = resolve(this.root, id);
    if (!target.startsWith(resolve(this.root) + sep)) throw new Error('Invalid cleanup target');
    try {
      const [actualRoot, actualTarget] = await Promise.all([realpath(this.root), realpath(target)]);
      const rel = relative(actualRoot, actualTarget);
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Workspace resolves outside configured root');
      await rm(target, { recursive: true, force: true });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
