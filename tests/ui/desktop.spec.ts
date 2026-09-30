import { _electron as electron, test, expect } from '@playwright/test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
test('desktop CRUD, vault, drag persistence, details and restart persistence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-ui-'));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, NEXUS_DATA_DIR: dir }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: ['.'], env });
  try {
    let page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await expect(page.getByRole('heading', { name: '从你的第一台设备开始' })).toBeVisible();
    await page.getByRole('button', { name: '添加设备', exact: true }).last().click();
    await page.getByLabel('设备名称').fill('UI Test Server');
    await page.getByLabel('IP / 主机名').fill('127.0.0.1');
    await page.getByLabel('密码', { exact: true }).fill('ui-secret-password-123');
    await page.getByLabel('标签').fill('test, local');
    await page.getByRole('button', { name: '保存设备' }).click();
    const card = page.getByRole('button', { name: '设备 UI Test Server', exact: true });
    await expect(card).toBeVisible();
    await expect(page.getByRole('heading', { name: 'UI Test Server', exact: true })).toHaveCount(2);
    const before = await card.boundingBox();
    if (!before) throw new Error('Missing card');
    await page.mouse.move(before.x + 100, before.y + 15);
    await page.mouse.down();
    await page.mouse.move(before.x + 190, before.y + 80, { steps: 12 });
    await page.mouse.up();
    await expect
      .poll(async () => (await page.evaluate(() => window.nexus.bootstrap())).devices[0].position.x)
      .toBeGreaterThan(100);
    const saved = await page.evaluate(() => window.nexus.bootstrap());
    expect(saved.devices[0].hasCredential).toBe(true);
    expect(
      (await readFile(join(dir, 'nexus.sqlite'))).includes(Buffer.from('ui-secret-password-123')),
    ).toBe(false);
    await page.getByTitle('编辑连接').click();
    await page.getByLabel('设备名称').fill('Renamed Server');
    await page.getByRole('button', { name: '保存设备' }).click();
    await expect(
      page.getByRole('button', { name: '设备 Renamed Server', exact: true }),
    ).toBeVisible();
    await page.locator('.detail-scroll').evaluate((el) => el.scrollTo({ top: 0 }));
    await page.screenshot({ path: 'test-results/desktop.png' });
    expect(errors).toEqual([]);
    await app.close();
    app = await electron.launch({ args: ['.'], env });
    page = await app.firstWindow();
    await expect(
      page.getByRole('button', { name: '设备 Renamed Server', exact: true }),
    ).toBeVisible();
    const reopened = await page.evaluate(() => window.nexus.bootstrap());
    expect(reopened.devices[0].position).toEqual(saved.devices[0].position);
    expect(reopened.devices[0].hasCredential).toBe(true);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await page.getByRole('button', { name: '设备 Renamed Server', exact: true }).click();
    await page.getByRole('button', { name: '移除设备' }).click();
    await expect(page.getByRole('heading', { name: '从你的第一台设备开始' })).toBeVisible();
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('probe settings, node import, filtering and connection failure state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-probe-ui-'));
  let code = 200;
  const server = createServer((_req, res) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        updated: Math.floor(Date.now() / 1000),
        servers: [
          'Tokyo VPS',
          'Singapore VPS',
          'Home NAS',
          'Bot Server',
          'Web Server',
          'Minecraft',
        ].map((name, i) => ({
          name: `fixture-${i}`,
          alias: name,
          latest_ts: Math.floor(Date.now() / 1000),
          online4: i !== 3,
          online6: false,
          cpu: 18 + i * 4,
          memory_total: 8388608,
          memory_used: 3523215,
          hdd_total: 81920,
          hdd_used: 24576,
          uptime: '12 天',
          labels: `os=${['ubuntu', 'debian', 'linux', 'windows', 'arch', 'ubuntu'][i]}`,
          location: ['jp', 'cn', 'hk', 'us', 'de', 'sg'][i],
          network_rx: 1048576,
          network_tx: 327680,
        })),
      }),
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, NEXUS_DATA_DIR: dir }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '探针与连接' }).click();
    await page
      .getByLabel('数据接口')
      .fill(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
    await page.getByRole('button', { name: '保存并连接' }).click();
    await expect(page.locator('.import-row')).toHaveCount(6);
    for (const checkbox of await page.locator('.import-row input').all()) await checkbox.check();
    await page.getByRole('button', { name: '导入所选设备' }).click();
    await expect(page.locator('.import-row input:disabled')).toHaveCount(6);
    await page.getByRole('button', { name: '关闭窗口' }).click();
    await expect(page.locator('.device-card')).toHaveCount(6);
    await expect(page.locator('.sidebar')).toHaveCount(0);
    await expect(page.locator('.page-heading')).toHaveCount(0);
    await expect(page.getByLabel('搜索设备')).toHaveCount(0);
    await page.getByRole('button', { name: '查找设备', exact: true }).click();
    await page.getByLabel('搜索设备').fill('Tokyo');
    await expect(page.locator('.device-card')).toHaveCount(1);
    await page.getByLabel('搜索设备').fill('');
    await page.getByRole('button', { name: '关闭搜索' }).click();
    await expect(page.locator('.device-card .system-icon[data-os="ubuntu"]')).toHaveCount(2);
    await expect(page.locator('.device-card .system-icon[data-os="windows"]')).toHaveCount(1);
    await expect(page.getByRole('img', { name: '所在地：中国', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: '所在地：日本', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: '所在地：香港', exact: true })).toBeVisible();
    await page.mouse.move(50, 55);
    await page.screenshot({ path: 'test-results/space.png' });
    await page.getByRole('button', { name: '设备 Tokyo VPS', exact: true }).click();
    await expect(page.locator('.detail-panel')).toContainText('12 天');
    await expect(page.locator('.detail-panel')).toContainText('42%');
    await page.screenshot({ path: 'test-results/workspace.png', animations: 'disabled' });
    await page.getByRole('button', { name: '文件', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('填写 SSH 地址');
    await expect(page.locator('.file-panes')).toBeVisible();
    await page.getByRole('button', { name: '关闭窗口' }).click();
    code = 503;
    await page.getByRole('button', { name: '刷新探针' }).click();
    await expect(page.locator('.connection-warning')).toContainText('503');
    await expect(page.locator('.device-card .status-pill').first()).toContainText('状态未知');
  } finally {
    await app.close();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('infinite canvas, OS icons, fullscreen and saved desktop appearance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-space-ui-'));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, NEXUS_DATA_DIR: dir }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: ['.'], env });
  try {
    let page = await app.firstWindow();
    await page.getByRole('button', { name: '添加设备', exact: true }).last().click();
    await page.getByLabel('设备名称').fill('Windows Desktop');
    await page.getByLabel('设备类型').selectOption('windows');
    await page.getByLabel('所在地', { exact: true }).selectOption('hk');
    await page.getByRole('button', { name: '保存设备' }).click();
    const device = page.getByRole('button', { name: '设备 Windows Desktop', exact: true });
    await expect(device.getByRole('img', { name: 'Windows 系统图标' })).toBeVisible();
    await expect(device.getByRole('img', { name: '所在地：香港' })).toBeVisible();
    await page.getByRole('button', { name: '关闭详情' }).click();
    const initial = await device.boundingBox();
    expect(initial!.width).toBeLessThan(150);
    // Pan the world without changing the server's coordinates.
    const position = (await page.evaluate(() => window.nexus.bootstrap())).devices[0].position;
    await page.mouse.move(600, 110);
    await page.mouse.down();
    await page.mouse.move(380, 170, { steps: 8 });
    await page.mouse.up();
    const afterPan = await device.boundingBox();
    expect(Math.round(afterPan!.x - initial!.x)).toBe(-220);
    expect((await page.evaluate(() => window.nexus.bootstrap())).devices[0].position).toEqual(
      position,
    );
    // Zoom around the pointer; persisted device coordinates stay unchanged.
    await page.mouse.move(afterPan!.x + 60, afterPan!.y + 40);
    await page.mouse.wheel(0, -150);
    await expect
      .poll(async () => (await device.boundingBox())!.width)
      .toBeGreaterThan(initial!.width);
    expect((await page.evaluate(() => window.nexus.bootstrap())).devices[0].position).toEqual(
      position,
    );
    // Negative world coordinates are valid and rendered after framing.
    await page.evaluate(async () => {
      const d = (await window.nexus.bootstrap()).devices[0];
      await window.nexus.moveDevice(d.id, { x: -8000, y: -9000 });
    });
    await page.reload();
    await expect(device).toHaveCount(1);
    await page.getByRole('button', { name: '桌面外观', exact: true }).click();
    await page.getByTitle('定位全部设备').click();
    await page.getByRole('button', { name: '背景 暮色' }).click();
    await page.getByLabel('自动隐藏程序坞').check();
    await page.getByRole('button', { name: '关闭外观' }).click();
    await page.mouse.move(50, 70);
    await expect(page.locator('.desktop-tools')).toHaveClass(/tools-hidden/);
    await page.getByRole('button', { name: '显示工具栏' }).click();
    await expect(page.getByRole('button', { name: '沉浸桌面', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '沉浸桌面', exact: true }).click();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()),
      )
      .toBe(true);
    await expect(page.locator('.desktop-shell')).toHaveClass(/is-fullscreen/);
    await page.keyboard.press('F11');
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()),
      )
      .toBe(false);
    await expect(page.locator('.desktop-shell')).toHaveClass(/wallpaper-dusk/);
    await expect.poll(() => page.evaluate(() => !!localStorage.getItem('nexus.camera'))).toBe(true);
    const savedCamera = await page.evaluate(() => localStorage.getItem('nexus.camera'));
    await app.close();
    app = await electron.launch({ args: ['.'], env });
    page = await app.firstWindow();
    await expect(page.locator('.desktop-shell')).toHaveClass(/wallpaper-dusk/);
    expect(await page.evaluate(() => localStorage.getItem('nexus.camera'))).toBe(savedCamera);
    expect((await page.evaluate(() => window.nexus.bootstrap())).devices[0].position).toEqual({
      x: -8000,
      y: -9000,
    });
    await expect(
      page.getByRole('button', { name: '设备 Windows Desktop', exact: true }),
    ).toBeInViewport();
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
