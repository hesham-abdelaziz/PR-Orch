import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import type { DataSource } from 'typeorm';
import { StandardsMetadataSchema, type StandardsMetadata } from '@pr-orchestrator/contracts';

export class StandardsService {
  constructor(private readonly source: DataSource, private readonly root: string) {}
  async replace(filename: string, content: string): Promise<StandardsMetadata> {
    // eslint-disable-next-line no-control-regex -- Uploaded filenames must not contain control characters.
    if (!/^[^\\/:\x00-\x1f]{1,250}\.(md|txt)$/i.test(filename) || filename === '..') throw new Error('Standards must be a Markdown or text filename');
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.length > 1048576 || content.includes('\0') || new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== content) throw new Error('Standards must be UTF-8 text of at most 1 MiB');
    const metadata = StandardsMetadataSchema.parse({ versionId: randomUUID(), filename, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length, uploadedAt: new Date().toISOString() });
    const directory = join(this.root, 'standards'); await mkdir(directory, { recursive: true });
    const storagePath = join(directory, `${metadata.sha256}.txt`); const temporary = join(directory, `${randomUUID()}.tmp`);
    try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, storagePath); }
    finally { await rm(temporary, { force: true }); }
    const native = (this.source.driver as unknown as { databaseConnection: Database }).databaseConnection;
    native.transaction(() => {
      native.prepare('UPDATE standards_versions SET active=0 WHERE active=1').run();
      native.prepare('INSERT INTO standards_versions (id,filename,sha256,size_bytes,storage_path,uploaded_at,active) VALUES (?,?,?,?,?,?,1)').run(metadata.versionId, metadata.filename, metadata.sha256, metadata.sizeBytes, storagePath, metadata.uploadedAt);
    }).immediate();
    return metadata;
  }
  private async active() { return (await this.source.query('SELECT * FROM standards_versions WHERE active=1'))[0] as Record<string, string | number> | undefined; }
  private metadata(row: Record<string, string | number>) { return StandardsMetadataSchema.parse({ versionId: row.id, filename: row.filename, sha256: row.sha256, sizeBytes: row.size_bytes, uploadedAt: row.uploaded_at }); }
  async readActive(): Promise<StandardsMetadata | null> { const row = await this.active(); return row ? this.metadata(row) : null; }
  async readContent(): Promise<string> { const row = await this.active(); return row ? readFile(String(row.storage_path), 'utf8') : ''; }
  async snapshotForReview(_id: string) { const row = await this.active(); return row ? { metadata: this.metadata(row), storagePath: String(row.storage_path) } : null; }
}
