import { describe, expect, it } from 'vitest';

import { buildChildEnvironment } from './environment-policy.js';

const hostileParentEnvironment = {
  PATH: '/usr/bin',
  SystemRoot: 'C:\\Windows',
  TEMP: 'C:\\Temp',
  LANG: 'en_US.UTF-8',
  AZURE_DEVOPS_EXT_PAT: 'azure-pat-secret',
  AZURE_CLIENT_SECRET: 'azure-client-secret',
  SYSTEM_ACCESSTOKEN: 'system-access-token',
  GITHUB_TOKEN: 'github-token-secret',
  MY_PAT: 'plain-pat-secret',
  DB_PASSWORD: 'db-password-secret',
  PR_ORCHESTRATOR_SESSION_SECRET: 'session-secret',
  SESSION_SECRET: 'other-session-secret',
  RANDOM_UNLISTED: 'not-allowlisted',
  ANTHROPIC_API_KEY: 'anthropic-key',
  CLAUDE_CODE_OAUTH_TOKEN: 'claude-oauth',
  OPENAI_API_KEY: 'openai-key',
  CODEX_HOME: 'C:\\Users\\me\\.codex',
  GEMINI_API_KEY: 'gemini-key',
  GOOGLE_API_KEY: 'google-key',
} satisfies Record<string, string>;

describe('buildChildEnvironment', () => {
  it('keeps required system variables and drops everything not allowlisted', () => {
    const environment = buildChildEnvironment({
      parent: hostileParentEnvironment,
      provider: 'claude',
    });

    expect(environment['PATH']).toBe('/usr/bin');
    expect(environment['SystemRoot']).toBe('C:\\Windows');
    expect(environment['TEMP']).toBe('C:\\Temp');
    expect(environment['LANG']).toBe('en_US.UTF-8');
    expect(environment).not.toHaveProperty('RANDOM_UNLISTED');
  });

  it('never forwards Azure, PAT, password, token, or session secrets', () => {
    for (const provider of ['claude', 'codex', 'gemini'] as const) {
      const environment = buildChildEnvironment({
        parent: hostileParentEnvironment,
        provider,
      });
      const serialized = JSON.stringify(environment);

      for (const secret of [
        'azure-pat-secret',
        'azure-client-secret',
        'system-access-token',
        'github-token-secret',
        'plain-pat-secret',
        'db-password-secret',
        'session-secret',
        'other-session-secret',
      ]) {
        expect(serialized).not.toContain(secret);
      }
    }
  });

  it('does not mistake PATH-like names for PAT variables', () => {
    const environment = buildChildEnvironment({
      parent: { Path: 'C:\\Windows\\System32', PATHEXT: '.EXE;.CMD' },
      provider: 'codex',
    });

    expect(environment['Path']).toBe('C:\\Windows\\System32');
    expect(environment['PATHEXT']).toBe('.EXE;.CMD');
  });

  it('forwards only the selected provider auth variables', () => {
    const claude = buildChildEnvironment({
      parent: hostileParentEnvironment,
      provider: 'claude',
    });
    const codex = buildChildEnvironment({
      parent: hostileParentEnvironment,
      provider: 'codex',
    });
    const gemini = buildChildEnvironment({
      parent: hostileParentEnvironment,
      provider: 'gemini',
    });

    expect(claude['ANTHROPIC_API_KEY']).toBe('anthropic-key');
    expect(claude['CLAUDE_CODE_OAUTH_TOKEN']).toBe('claude-oauth');
    expect(claude).not.toHaveProperty('OPENAI_API_KEY');
    expect(claude).not.toHaveProperty('GEMINI_API_KEY');

    expect(codex['OPENAI_API_KEY']).toBe('openai-key');
    expect(codex['CODEX_HOME']).toBe('C:\\Users\\me\\.codex');
    expect(codex).not.toHaveProperty('ANTHROPIC_API_KEY');

    expect(gemini['GEMINI_API_KEY']).toBe('gemini-key');
    expect(gemini['GOOGLE_API_KEY']).toBe('google-key');
    expect(gemini).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('matches names case-insensitively but preserves the original casing', () => {
    const environment = buildChildEnvironment({
      parent: { systemroot: 'C:\\Windows', azure_devops_pat: 'x' },
    });

    expect(environment['systemroot']).toBe('C:\\Windows');
    expect(environment).not.toHaveProperty('azure_devops_pat');
  });

  it('applies explicit overrides but still refuses forbidden names', () => {
    const environment = buildChildEnvironment({
      parent: {},
      overrides: {
        NO_COLOR: '1',
        AZURE_DEVOPS_EXT_PAT: 'leak',
        CUSTOM_PASSWORD: 'leak',
      },
    });

    expect(environment['NO_COLOR']).toBe('1');
    expect(environment).not.toHaveProperty('AZURE_DEVOPS_EXT_PAT');
    expect(environment).not.toHaveProperty('CUSTOM_PASSWORD');
  });

  it('skips undefined parent values', () => {
    const environment = buildChildEnvironment({
      parent: { PATH: undefined, LANG: 'C' },
    });

    expect(environment).not.toHaveProperty('PATH');
    expect(environment['LANG']).toBe('C');
  });
});
