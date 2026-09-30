import { _electron as electron, test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFileServer } from '../fixtures/files';

test('Windows guidance, device policies and real SFTP image/text preview', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-preview-ui-'));
  const fixture = await startFileServer();
  const environment = Object.fromEntries(
    Object.entries({ ...process.env, NEXUS_DATA_DIR: directory }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete environment.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env: environment });
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('button', { name: '探针与连接' }).click();
    await expect(page.getByRole('heading', { name: 'Windows 可以使用 SSH' })).toBeVisible();
    await expect(page.locator('.ssh-guide')).toContainText('OpenSSH Client');
    await page.getByRole('button', { name: '关闭窗口' }).click();
    await page.getByRole('button', { name: '添加设备', exact: true }).last().click();
    await page.getByLabel('设备名称').fill('Preview Windows');
    await page.getByLabel('设备类型').selectOption('windows');
    await expect(page.getByLabel('用户名', { exact: true })).toHaveValue('user');
    await page.getByLabel('IP / 主机名').fill('127.0.0.1');
    await page.getByLabel('SSH 端口').fill(String(fixture.port));
    await page.getByLabel('密码', { exact: true }).fill('preview-fixture-pass');
    await page.getByRole('button', { name: '保存设备' }).click();
    await expect(page.locator('.detail-panel')).toContainText('Windows 也支持 SSH');
    await expect(page.getByRole('button', { name: '复制 Docker 安装命令' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '重启', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '文件', exact: true }).click();
    const files = page.getByRole('dialog', { name: '文件 · Preview Windows' });
    await files.getByLabel('预览 hello.md', { exact: true }).click();
    const text = page.getByRole('dialog', { name: '预览 · hello.md' });
    await expect(text).toContainText('# 你好 Nexus');
    await expect(text).toContainText('<script>');
    expect(await page.evaluate(() => 'previewUnsafe' in globalThis)).toBe(false);
    await page.screenshot({ path: 'test-results/preview-text.png' });
    await page.keyboard.press('Escape');
    await expect(text).toHaveCount(0);
    await expect(files).toBeVisible();
    await files.getByLabel('预览 image.png', { exact: true }).click();
    const image = page.getByRole('dialog', { name: '预览 · image.png' });
    await expect(image.locator('img')).toBeVisible();
    await expect
      .poll(() =>
        image.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth),
      )
      .toBe(1);
    await image.getByRole('button', { name: '关闭窗口' }).click();
    await files.getByLabel('预览 logo.png', { exact: true }).click();
    const logo = page.getByRole('dialog', { name: '预览 · logo.png' });
    await expect
      .poll(() => logo.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBe(256);
    await page.screenshot({ path: 'test-results/preview.png' });
    await logo.getByRole('button', { name: '关闭窗口' }).click();
    await files.getByLabel('预览 large.log', { exact: true }).click();
    const large = page.getByRole('dialog', { name: '预览 · large.log' });
    await expect(large).toContainText('仅显示开头 256 KB');
    await large.getByRole('button', { name: '关闭窗口' }).click();
    await files.getByLabel('预览 binary.bin', { exact: true }).click();
    await expect(files.getByRole('alert')).toContainText('二进制');
    await files.getByRole('button', { name: '关闭窗口' }).click();
    await page.getByTitle('编辑连接').click();
    await page.getByLabel('设备类型').selectOption('linux-vps');
    await page.getByRole('button', { name: '保存设备' }).click();
    await page.getByRole('button', { name: '部署软件', exact: true }).click();
    const deployment = page.getByRole('dialog', { name: '部署软件 · Preview Windows' });
    await expect(deployment.getByRole('button', { name: '宝塔面板', exact: true })).toBeVisible();
    await expect(
      deployment.getByRole('button', { name: 'ServerStatus 探针', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
