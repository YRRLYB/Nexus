import { _electron as electron } from '@playwright/test';
import { listPackage, extractFile } from '@electron/asar';
import { readFile, readdir, stat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const archive = resolve('release/win-unpacked/resources/app.asar');
const files = listPackage(archive);
assert(
  !files.some((path) =>
    /(?:research|defaults\.private\.env|serverstatus-agent-private|Nexus_项目方案)/i.test(path),
  ),
  'Private research files must not ship',
);
assert(
  extractFile(archive, 'dist-electron/main.cjs').equals(await readFile('dist-electron/main.cjs')),
  'Packaged main process must match current build',
);
assert(
  extractFile(archive, 'dist-electron/preload.cjs').equals(
    await readFile('dist-electron/preload.cjs'),
  ),
  'Packaged preload must match current build',
);
for (const file of await readdir('dist', { recursive: true })) {
  const path = join('dist', file);
  if (!(await stat(path)).isFile()) continue;
  assert(
    extractFile(archive, path).equals(await readFile(path)),
    `Packaged renderer must match current build: ${path}`,
  );
}
const dataDir = await mkdtemp(join(tmpdir(), 'nexus-packaged-'));
const env = { ...process.env, NEXUS_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: resolve('release/win-unpacked/Nexus.exe'),
  args: [],
  env,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('main', { name: '设备桌面' }).waitFor();
  const info = await page.evaluate(() => window.nexus.bootstrap());
  assert.equal(info.version, JSON.parse(await readFile('package.json', 'utf8')).version);
  assert.equal(info.dataPath, dataDir);
  assert.equal(info.vaultAvailable, true);
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  const probe = await page.evaluate(() => window.nexus.pollProbe());
  assert.deepEqual(errors, []);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/packaged-startup.png' });
  console.log(
    JSON.stringify(
      {
        packaged: true,
        version: info.version,
        vaultAvailable: info.vaultAvailable,
        privateFilesExcluded: true,
        currentBuildVerified: true,
        probeNodes: probe.nodes.length,
        probeError: probe.error || null,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
}
