// Synthetic, obviously fake credential shapes. None of these is a real secret.
export const SYNTHETIC_SECRETS = {
  openAi: 'sk-FAKE0000000000000000000000TEST',
  github: 'ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKE00000000',
  githubFineGrained: 'github_pat_FAKE0000000000000000000000_FAKEFAKEFAKE',
  google: 'AIzaFAKEFAKEFAKEFAKEFAKEFAKE000',
  aws: 'AKIAFAKEFAKEFAKE0000',
  slack: 'xoxb-000000000000-FAKEFAKEFAKE',
  azurePat: 'abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.ZmFrZXNpZ25hdHVyZQ',
  bearer: 'Bearer FAKE0token0value0000001234',
  urlCredential: 'https://builder:FakePassw0rd@dev.azure.com/acme',
  privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIFAKEFAKEFAKE\n-----END RSA PRIVATE KEY-----',
  assignment: 'const apiKey = "Fake-Api-Key-Value-0001";',
} as const;

/** A value only the test knows, standing in for a PAT supplied as a known secret. */
export const SYNTHETIC_KNOWN_SECRET = 'synthetic-known-pat-value-0001';
