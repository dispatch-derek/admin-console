import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeTmpDbPath(prefix: string): { dir: string; dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `admin-console-relay-e2e-${prefix}-`));
  return {
    dir,
    dbPath: join(dir, 'console.db'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
