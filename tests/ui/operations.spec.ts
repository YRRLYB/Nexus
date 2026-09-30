import { _electron as electron, test, expect } from '@playwright/test';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFileServer } from '../fixtures/files';

test('embedded sessions, confirmed deployment, hidden credentials, failure and transfer queue', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-operations-ui-'));
  const downloads = join(directory, 'downloads');
  await mkdir(downloads);
  const fixture = await startFileServer({ operations: true });
  const environment = Object.fromEntries(
    Object.entries({ ...process.env, NEXUS_DATA_DIR: directory }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete environment.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env: environment });
  try {
    await app.evaluate(({ dialog }, destination) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] });
    }, downloads);
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('button', { name: '添加设备', exact: true }).last().click();
    await page.getByLabel('设备名称').fill('Test Server');
    await page.getByLabel('IP / 主机名').fill('127.0.0.1');
    await page.getByLabel('SSH 端口').fill(String(fixture.port));
    await page.getByLabel('用户名', { exact: true }).fill('user');
    await page.getByLabel('密码', { exact: true }).fill('preview-fixture-pass');
    await page.getByRole('button', { name: '保存设备' }).click();
    await page.getByRole('button', { name: 'SSH 连接', exact: true }).click();
    const terminal = page.getByRole('dialog', { name: 'SSH 终端' });
    await expect(terminal.locator('.terminal-screen')).toContainText('fixture shell');
    await terminal.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('echo nexus');
    await page.keyboard.press('Enter');
    await expect(terminal.locator('.terminal-screen')).toContainText('echo nexus');
    await page.keyboard.press('Escape');
    await expect(terminal).toBeVisible();
    await page.screenshot({ path: 'test-results/terminal.png' });
    await terminal.getByRole('button', { name: '关闭窗口' }).click();
    expect(
      (await page.evaluate(() => window.nexus.sessions())).filter((item) => item.kind === 'shell'),
    ).toHaveLength(1);
    await page.getByRole('button', { name: 'SSH 会话', exact: true }).click();
    await expect(terminal.locator('.terminal-screen')).toContainText('echo nexus');
    await terminal.getByRole('button', { name: '新会话', exact: true }).click();
    await expect(terminal.getByRole('tab')).toHaveCount(2);
    await terminal
      .getByRole('button', { name: '关闭会话 Test Server', exact: true })
      .last()
      .click();
    await expect(terminal.getByRole('tab')).toHaveCount(1);
    await terminal.getByRole('button', { name: '关闭窗口' }).click();

    await page.getByRole('button', { name: '部署软件', exact: true }).click();
    const deployment = page.getByRole('dialog', { name: '部署软件 · Test Server' });
    await deployment.getByRole('button', { name: 'ServerStatus 探针', exact: true }).click();
    await deployment.getByLabel('探针上报地址').fill('https://status.example.com/report');
    await deployment.getByLabel('探针组 ID').fill('fixture');
    await deployment.getByRole('button', { name: '检查环境并加载脚本' }).click();
    await expect(deployment).toContainText('debian 12');
    const install = deployment.getByRole('button', { name: '在服务器安装 ServerStatus 探针' });
    await expect(install).toBeDisabled();
    await deployment.getByText('查看将要执行的脚本', { exact: true }).click();
    await expect(deployment.locator('.installer-source')).toContainText('VERSION=1.8.1');
    await deployment.getByText('查看将要执行的脚本', { exact: true }).click();
    await deployment.getByRole('checkbox').check();
    await install.click();
    await expect(deployment.locator('.terminal-screen')).toContainText('Group password');
    await deployment.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('fixture-group-secret');
    await page.keyboard.press('Enter');
    await expect(deployment.locator('.session-status')).toContainText('已完成');
    await expect(deployment).not.toContainText('fixture-group-secret');
    expect(fixture.commands.join('\n')).not.toContain('fixture-group-secret');
    expect(
      fixture.commands.some(
        (command) => command.includes('systemctl is-active') && command.includes('installer.sh'),
      ),
    ).toBe(true);
    await page.screenshot({ path: 'test-results/deployment.png' });
    await deployment.getByRole('button', { name: '关闭窗口' }).click();
    await page.getByRole('button', { name: '部署软件', exact: true }).click();
    await expect(deployment.locator('.session-status')).toContainText('已完成');
    fixture.setInstalled('docker');
    await deployment.getByRole('button', { name: 'Docker', exact: true }).click();
    await deployment.getByRole('button', { name: '检查环境并加载脚本' }).click();
    await expect(deployment.getByRole('alert')).toContainText('已安装');
    await expect(deployment.getByRole('button', { name: '在服务器安装 Docker' })).toHaveCount(0);
    fixture.setInstalled('');
    fixture.failInstallation();
    await deployment.getByRole('button', { name: 'ServerStatus 探针', exact: true }).click();
    await deployment.getByLabel('探针上报地址').fill('https://status.example.com/report');
    await deployment.getByLabel('探针组 ID').fill('fixture');
    await deployment.getByRole('button', { name: '检查环境并加载脚本' }).click();
    await deployment.getByRole('checkbox').check();
    await install.click();
    await expect(deployment.locator('.terminal-screen')).toContainText('Group password');
    await deployment.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('fixture-group-secret');
    await page.keyboard.press('Enter');
    await expect(deployment.locator('.session-status')).toContainText('失败');
    await deployment.getByRole('button', { name: '关闭窗口' }).click();

    await page.getByRole('button', { name: '文件', exact: true }).click();
    const files = page.getByRole('dialog', { name: '文件 · Test Server' });
    await files.getByLabel('下载 hello.md', { exact: true }).click();
    await expect(files.locator('.transfer-queue')).toContainText('已完成');
    expect(await readFile(join(downloads, 'hello.md'), 'utf8')).toContain('你好 Nexus');
    await files.getByRole('button', { name: '关闭窗口' }).click();
    await page.getByRole('button', { name: '文件', exact: true }).click();
    await expect(files.locator('.transfer-queue')).toContainText('hello.md');
    await expect(files.locator('.transfer-queue')).toContainText('已完成');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
