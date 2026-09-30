import { secrets } from 'just-secrets';
import { collectSecretValues } from '../providers/redact-secrets.js';

export interface SecretStore {
  get(key: 'azure-devops-pat'): Promise<string | null>;
  set(key: 'azure-devops-pat', value: string): Promise<void>;
  delete(key: 'azure-devops-pat'): Promise<void>;
}
export class WindowsCredentialStore implements SecretStore {
  get(key: 'azure-devops-pat') { return secrets.get({ service: 'pr-review-orchestrator', name: key }); }
  set(key: 'azure-devops-pat', value: string) { return secrets.set({ service: 'pr-review-orchestrator', name: key, value }); }
  async delete(key: 'azure-devops-pat') { await secrets.delete({ service: 'pr-review-orchestrator', name: key }); }
}
export class FakeSecretStore implements SecretStore {
  private value: string | null = null;
  async get(_key: 'azure-devops-pat') { return this.value; }
  async set(_key: 'azure-devops-pat', value: string) { this.value = value; }
  async delete(_key: 'azure-devops-pat') { this.value = null; }
}
/** Retains rotated values until shutdown so late outputs from running reviews are redacted. */
export class SecretValuesService {
  private readonly known = new Set<string>();
  constructor(private readonly store: SecretStore) {}
  async initialize() { await this.getPat(); }
  async getPat() { const value = await this.store.get('azure-devops-pat'); if (value) this.remember(value); return value; }
  private remember(value: string) {
    if (!this.known.has(value) && this.known.size >= 128) throw new Error('Restart the dashboard before further credential rotations');
    this.known.add(value);
  }
  async setPat(value: string) {
    if (!value.trim() || value.length > 2560) throw new Error('Invalid PAT');
    await this.getPat(); this.remember(value); await this.store.set('azure-devops-pat', value);
  }
  async deletePat() { await this.getPat(); await this.store.delete('azure-devops-pat'); }
  values(): readonly string[] { return [...this.known, ...collectSecretValues(process.env)]; }
}
