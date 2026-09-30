import { describe, expect, it } from 'vitest';

import { SYNTHETIC_SECRETS } from '../../../../tests/fixtures/fake-clis/synthetic-secrets.js';
import { collectSecretValues, redactSecrets } from './redact-secrets.js';

describe('redactSecrets', () => {
  it.each(Object.entries(SYNTHETIC_SECRETS))('removes a %s credential', (_name, secret) => {
    const redacted = redactSecrets(`found ${secret} in the code`);

    expect(redacted).toContain('[REDACTED]');
    expect(redacted).not.toContain(secret);
  });

  it('keeps the non-secret parts around a credential', () => {
    expect(redactSecrets('https://builder:FakePassw0rd@dev.azure.com/acme')).toBe('https://[REDACTED]@dev.azure.com/acme');
    expect(redactSecrets('const apiKey = "Fake-Api-Key-Value-0001";')).toBe('const apiKey = "[REDACTED]";');
    expect(redactSecrets('Authorization: Bearer FAKE0token0value0000001234')).toBe('Authorization: [REDACTED]');
  });

  it('removes exact known secret values', () => {
    expect(redactSecrets('pat=synthetic-known-value-0001!', ['synthetic-known-value-0001'])).toBe('pat=[REDACTED]!');
  });

  it.each([
    'const token = getToken();',
    'headers.Authorization = `Bearer ${token}`;',
    'The API uses Bearer authentication for every request.',
    'this.taskQueueProcessorHandler.dispatch(message)',
    'const disk-usage-threshold-percentage = 90',
    'function resolve_configuration_values_for_the_current_environment() {}',
    'commit 4f2a9c1e0b7d3a6f8e5c2b1a0d9f8e7c6b5a4d3c',
    'sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'const password = process.env.DB_PASSWORD;',
    'const secret = "${SECRET_FROM_ENV}";',
    'if (user.password.length < 12) throw new Error("Password too short");',
    'git clone https://dev.azure.com/acme/shop/_git/web',
    'const url = `https://${user}:${pass}@${host}`;',
  ])('leaves ordinary technical text unchanged: %s', (text) => {
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('collectSecretValues', () => {
  it('collects values of secret-looking variables, longest first', () => {
    expect(collectSecretValues({ PATH: '/usr/bin', MY_TOKEN: 'short-token-1', AZURE_DEVOPS_EXT_PAT: 'a-much-longer-value-2' })).toEqual([
      'a-much-longer-value-2',
      'short-token-1',
    ]);
  });
});
