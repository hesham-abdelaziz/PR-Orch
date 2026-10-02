import { AzureDevOpsService } from './azure-devops.service.js';
import {
  FakeSecretStore,
  SecretValuesService,
} from '../secrets/secret-store.js';

const url = 'https://dev.azure.com/org/project/_git/repo/pullrequest/12';
const source = 'a'.repeat(40),
  target = 'b'.repeat(40);
const metadata = {
  pullRequestId: 12,
  title: 'Review',
  createdBy: { id: 'author', displayName: 'Author' },
  sourceRefName: 'refs/heads/feature',
  targetRefName: 'refs/heads/main',
  repository: { name: 'repo', project: { name: 'project' } },
  lastMergeSourceCommit: { commitId: source },
  lastMergeTargetCommit: { commitId: target },
  creationDate: '2026-09-30T00:00:00Z',
};
function fixtures() {
  return [
    metadata,
    {
      value: [
        {
          id: 1,
          sourceRefCommit: { commitId: source },
          targetRefCommit: { commitId: target },
          updatedDate: '2026-09-30T00:00:00Z',
        },
      ],
    },
    {
      changeEntries: [{ changeTrackingId: 1, item: { path: '/a.ts' } }],
      nextSkip: 0,
      nextTop: 0,
    },
  ];
}
describe('Azure read-only client', () => {
  it('does not report a saved credential as a verified connection before a PR is supplied', async () => {
    const secrets = new SecretValuesService(new FakeSecretStore());
    await secrets.setPat('synthetic-pat-value');
    const network = vi.fn();
    const service = new AzureDevOpsService(secrets, { fetch: network });
    expect(await service.test()).toMatchObject({
      ok: false,
      message: expect.stringMatching(/pull request.*first/i),
    });
    expect(network).not.toHaveBeenCalled();
  });
  it('connection test rechecks the last attempted PR and never accepts a rejected saved PAT', async () => {
    const secrets = new SecretValuesService(new FakeSecretStore());
    await secrets.setPat('synthetic-pat-value');
    const cli = vi.fn();
    let calls = 0;
    const service = new AzureDevOpsService(secrets, {
      cliToken: cli,
      fetch: async () => {
        calls++;
        return new Response(
          'sensitive server diagnostics synthetic-pat-value',
          { status: 401 },
        );
      },
    });
    await expect(service.validatePullRequest(url)).rejects.toThrow(/401/);
    expect(await service.test()).toMatchObject({
      ok: false,
      message: expect.stringMatching(/401/),
    });
    expect(calls).toBe(2);
    expect(cli).not.toHaveBeenCalled();
    expect(JSON.stringify(await service.test())).not.toContain(
      'synthetic-pat-value',
    );
  });
  it('reports verified PR access only after fresh read-only Azure requests succeed', async () => {
    const secrets = new SecretValuesService(new FakeSecretStore());
    await secrets.setPat('synthetic-pat-value');
    const responses = [...fixtures(), ...fixtures()];
    let calls = 0;
    const service = new AzureDevOpsService(secrets, {
      fetch: async () => {
        calls++;
        return Response.json(responses.shift());
      },
    });
    await service.validatePullRequest(url);
    expect(await service.test()).toMatchObject({
      ok: true,
      message: expect.stringMatching(/verified/i),
    });
    expect(calls).toBe(6);
  });
  it('uses saved PAT consistently and returns validated metadata', async () => {
    const secrets = new SecretValuesService(new FakeSecretStore());
    await secrets.setPat('synthetic-pat-value');
    const cli = vi.fn();
    const calls: RequestInit[] = [];
    const responses = fixtures();
    const service = new AzureDevOpsService(secrets, {
      cliToken: cli,
      fetch: async (_input, init) => {
        calls.push(init!);
        return Response.json(responses.shift());
      },
    });
    const pr = await service.validatePullRequest(url);
    expect(pr).toMatchObject({
      changedFiles: 1,
      sourceCommit: source,
      targetCommit: target,
      additions: null,
      deletions: null,
    });
    expect(cli).not.toHaveBeenCalled();
    expect(
      calls.every((call) => call.method === 'GET' && call.redirect === 'error'),
    ).toBe(true);
    expect(
      calls.every((call) =>
        (call.headers as Record<string, string>).Authorization.startsWith(
          'Basic ',
        ),
      ),
    ).toBe(true);
  });
  it('uses existing CLI bearer session and remembers token encodings', async () => {
    const secrets = new SecretValuesService(new FakeSecretStore());
    const token = 'synthetic-cli-token-value';
    const responses = fixtures();
    const service = new AzureDevOpsService(secrets, {
      cliToken: async () => token,
      fetch: async (_input, init) => {
        expect((init!.headers as Record<string, string>).Authorization).toBe(
          `Bearer ${token}`,
        );
        return Response.json(responses.shift());
      },
    });
    await service.validatePullRequest(url);
    expect(await service.getGitCredential()).toEqual({
      value: token,
      scheme: 'Bearer',
    });
    expect(secrets.values()).toContain(
      Buffer.from(':' + token).toString('base64'),
    );
  });
  it.each([401, 403, 404, 500])(
    'maps HTTP %s without leaking diagnostics or falling back',
    async (status) => {
      const secrets = new SecretValuesService(new FakeSecretStore());
      await secrets.setPat('synthetic-pat-value');
      const cli = vi.fn();
      const service = new AzureDevOpsService(secrets, {
        cliToken: cli,
        fetch: async () => new Response('synthetic-pat-value', { status }),
      });
      await expect(service.validatePullRequest(url)).rejects.toThrow(
        /Azure DevOps/,
      );
      expect(cli).not.toHaveBeenCalled();
    },
  );
  it('rejects bad URLs before credentials and bad response identities', async () => {
    const cli = vi.fn();
    const secrets = new SecretValuesService(new FakeSecretStore());
    const service = new AzureDevOpsService(secrets, {
      cliToken: cli,
      fetch: async () => Response.json({ ...metadata, pullRequestId: 13 }),
    });
    await expect(
      service.validatePullRequest(
        'https://evil.test/org/project/_git/repo/pullrequest/12',
      ),
    ).rejects.toThrow();
    expect(cli).not.toHaveBeenCalled();
    cli.mockResolvedValue('synthetic-cli-token');
    await expect(service.validatePullRequest(url)).rejects.toThrow(/response/);
  });
  it('reports actionable missing authentication without echoing CLI errors', async () => {
    const service = new AzureDevOpsService(
      new SecretValuesService(new FakeSecretStore()),
      {
        cliToken: async () => {
          throw new Error('sensitive diagnostics');
        },
      },
    );
    await expect(service.getGitCredential()).rejects.toThrow(/PAT.*Azure CLI/);
    expect(await service.status()).toEqual({
      method: 'unavailable',
      configured: false,
      reason: 'pat_missing_and_azure_cli_unavailable',
    });
  });
  it('redacts credential-bearing metadata and encoded authorization values', async () => {
    const secrets = new SecretValuesService(new FakeSecretStore());
    const token = 'synthetic-pat-value';
    await secrets.setPat(token);
    const responses = fixtures();
    responses[0] = {
      ...metadata,
      title: `Title ${token}`,
      createdBy: {
        id: 'author',
        displayName: Buffer.from(':' + token).toString('base64'),
      },
    };
    const service = new AzureDevOpsService(secrets, {
      fetch: async () => Response.json(responses.shift()),
    });
    const result = JSON.stringify(await service.validatePullRequest(url));
    expect(result).not.toContain(token);
    expect(result).not.toContain(Buffer.from(':' + token).toString('base64'));
    expect(result).toContain('[REDACTED]');
  });
  it('counts paginated latest-iteration changes against the base and rejects non-progressing cursors', async () => {
    const secrets = new SecretValuesService(new FakeSecretStore());
    await secrets.setPat('synthetic-pat-value');
    const responses: unknown[] = fixtures();
    responses[2] = {
      changeEntries: [{ changeTrackingId: 1, item: { path: '/a.ts' } }],
      nextSkip: 1,
      nextTop: 1000,
    };
    responses.push({
      changeEntries: [{ changeTrackingId: 2, item: { path: '/b.ts' } }],
      nextSkip: 0,
      nextTop: 0,
    });
    const urls: string[] = [];
    const service = new AzureDevOpsService(secrets, {
      fetch: async (input) => {
        urls.push(input instanceof Request ? input.url : input.toString());
        return Response.json(responses.shift());
      },
    });
    expect((await service.validatePullRequest(url)).changedFiles).toBe(2);
    expect(urls[3]).toContain('$compareTo=0&$top=1000&$skip=1');
  });
  it("accepts Azure's actual iteration changes response where pagination fields are omitted", async () => {
    const secrets = new SecretValuesService(new FakeSecretStore());
    await secrets.setPat('synthetic-pat-value');
    const responses: unknown[] = [
      metadata,
      {
        value: [
          {
            id: 1,
            sourceRefCommit: { commitId: source },
            targetRefCommit: { commitId: target },
            updatedDate: '2026-09-30T00:00:00Z',
          },
        ],
      },
      {
        changeEntries: [
          {
            changeTrackingId: 1,
            changeId: 1,
            item: { path: '/public/assets/i18n/de.json' },
          },
        ],
      },
    ];
    const service = new AzureDevOpsService(secrets, {
      fetch: async () => Response.json(responses.shift()),
    });
    const pr = await service.validatePullRequest(url);
    expect(pr.changedFiles).toBe(1);
  });
  it('accepts deleted files whose path is only reported as originalPath', async () => {
    const secrets = new SecretValuesService(new FakeSecretStore());
    await secrets.setPat('synthetic-pat-value');
    const responses: unknown[] = fixtures();
    responses[2] = {
      changeEntries: [
        { changeTrackingId: 1, item: { path: '/a.ts' }, changeType: 'edit' },
        {
          changeTrackingId: 2,
          originalPath: '/old.ts',
          item: { originalObjectId: 'C'.repeat(40), path: null },
          changeType: 'delete',
        },
      ],
    };
    const service = new AzureDevOpsService(secrets, {
      fetch: async () => Response.json(responses.shift()),
    });
    expect((await service.validatePullRequest(url)).changedFiles).toBe(2);
  });
  it('rejects change entries with neither an item path nor an original path', async () => {
    const secrets = new SecretValuesService(new FakeSecretStore());
    await secrets.setPat('synthetic-pat-value');
    const responses: unknown[] = fixtures();
    responses[2] = {
      changeEntries: [{ changeTrackingId: 1, item: { path: null } }],
    };
    const service = new AzureDevOpsService(secrets, {
      fetch: async () => Response.json(responses.shift()),
    });
    await expect(service.validatePullRequest(url)).rejects.toMatchObject({
      status: 502,
    });
  });
  it('rejects partial pagination fields on iteration changes', async () => {
    const secrets = new SecretValuesService(new FakeSecretStore());
    await secrets.setPat('synthetic-pat-value');
    const responses: unknown[] = [
      metadata,
      {
        value: [
          {
            id: 1,
            sourceRefCommit: { commitId: source },
            targetRefCommit: { commitId: target },
            updatedDate: '2026-09-30T00:00:00Z',
          },
        ],
      },
      {
        changeEntries: [{ changeTrackingId: 1, item: { path: '/a.ts' } }],
        nextSkip: 10,
      },
    ];
    const service = new AzureDevOpsService(secrets, {
      fetch: async () => Response.json(responses.shift()),
    });
    await expect(service.validatePullRequest(url)).rejects.toThrow(/response/);
  });
  it.each(['revision', 'iteration', 'json', 'oversized'])(
    'rejects invalid upstream %s',
    async (kind) => {
      const secrets = new SecretValuesService(new FakeSecretStore());
      await secrets.setPat('synthetic-pat-value');
      const responses: unknown[] = fixtures();
      if (kind === 'revision')
        responses[0] = {
          ...metadata,
          lastMergeSourceCommit: { commitId: '--upload-pack=evil' },
        };
      if (kind === 'iteration')
        responses[1] = {
          value: [
            {
              id: 1,
              sourceRefCommit: { commitId: target },
              targetRefCommit: { commitId: target },
            },
          ],
        };
      const service = new AzureDevOpsService(secrets, {
        fetch: async () =>
          kind === 'json'
            ? new Response('<html>sign in</html>')
            : kind === 'oversized'
              ? new Response('x'.repeat(2 * 1048576 + 1))
              : Response.json(responses.shift()),
      });
      await expect(service.validatePullRequest(url)).rejects.toThrow(
        /response/,
      );
    },
  );
  it('accepts a target advancing after the source iteration while retaining the PR target revision', async () => {
    const secrets = new SecretValuesService(new FakeSecretStore());
    await secrets.setPat('synthetic-pat-value');
    const responses: unknown[] = fixtures();
    responses[1] = {
      value: [
        {
          id: 1,
          sourceRefCommit: { commitId: source },
          targetRefCommit: { commitId: 'c'.repeat(40) },
          updatedDate: '2026-09-30T00:00:00Z',
        },
      ],
    };
    const service = new AzureDevOpsService(secrets, {
      fetch: async () => Response.json(responses.shift()),
    });
    expect((await service.validatePullRequest(url)).targetCommit).toBe(target);
  });
});
