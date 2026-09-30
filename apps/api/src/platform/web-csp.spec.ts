import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webContentSecurityPolicy } from './web-csp.js';

it('hashes the script text after browser HTML newline normalization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'web-csp-'));
  const path = join(directory, 'index.html');
  try {
    await writeFile(
      path,
      '<script>console.log("csp-fixture");\r\n</script><script src="app.js"></script><script type="application/json">{"value":1}</script>',
    );
    const policy = await webContentSecurityPolicy(directory);
    expect(policy).toContain(
      "'sha256-RJyCyTAs59Ao4QK8sNdlGpz0TB1m85UTJM9+VooPpk8='",
    );
    expect((policy.match(/sha256-/g) ?? []).length).toBe(1);
  } finally {
    await unlink(path);
    await rmdir(directory);
  }
});
