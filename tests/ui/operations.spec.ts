import { _electron as electron, test, expect } from '@playwright/test';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
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
  let previousClipboard: string | undefined;
  try {
    const page = await app.firstWindow();
    previousClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
    await app.evaluate(({ dialog }, destination) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] });
    }, downloads);
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
    await app.evaluate(({ clipboard }) => clipboard.writeText('pasted-from-clipboard'));
    await page.keyboard.press('Control+Shift+V');
    await expect(terminal.locator('.terminal-screen')).toContainText('pasted-from-clipboard');
    expect(fixture.shellInput.join('')).toContain('\x1b[200~pasted-from-clipboard\x1b[201~');
    expect(fixture.shellInput.join('').match(/pasted-from-clipboard/g)).toHaveLength(1);
    await page.keyboard.press('Control+c');
    await expect.poll(() => fixture.shellInput.join('')).toContain('\x03');
    await terminal.getByLabel('搜索终端内容').fill('fixture shell');
    await terminal.getByRole('button', { name: '下一处', exact: true }).click();
    await expect(terminal).toContainText('已定位匹配');
    await terminal.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('Control+Shift+c');
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('fixture shell');
    await terminal.locator('.terminal-screen').click({ button: 'right' });
    await expect(terminal.getByRole('menuitem', { name: '复制选中内容' })).toBeVisible();
    await terminal.getByRole('menuitem', { name: '粘贴', exact: true }).click();
    await expect
      .poll(() => fixture.shellInput.join(''))
      .toContain('\x1b[200~fixture shell\x1b[201~');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    ).toBe(false);
    await page.evaluate(async () => {
      const session = (await window.nexus.sessions()).find((item) => item.kind === 'shell')!;
      await window.nexus.writeSession(session.id, 'background-session\r');
    });
    await expect.poll(() => fixture.shellInput.join('')).toContain('background-session');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    await expect(terminal.locator('.terminal-screen')).toContainText('background-session');
    await terminal.locator('.xterm-helper-textarea').focus();
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
    await app.evaluate(({ net }) => {
      const original = net.fetch.bind(net);
      net.fetch = async (url, options) => {
        if (String(url) === 'https://raw.githubusercontent.com/MHSanaei/3x-ui/v3.9.0/install.sh')
          return new Response('#!/bin/bash\necho controlled 3x-ui installer\n');
        return original(url, options);
      };
    });
    await deployment.getByRole('button', { name: '3x-ui 面板', exact: true }).click();
    await deployment.getByRole('button', { name: '检查环境并加载脚本' }).click();
    await expect(deployment).toContainText('MHSanaei/3x-ui/v3.9.0/install.sh');
    await deployment.getByRole('checkbox').check();
    await deployment.getByRole('button', { name: '在服务器安装 3x-ui 面板' }).click();
    await deployment.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('fixture-panel-input');
    await page.keyboard.press('Enter');
    await expect(deployment.locator('.session-status')).toContainText('已完成');
    expect(
      fixture.commands.some(
        (command) => command.includes('x-ui.service') && command.includes('v3.9.0'),
      ),
    ).toBe(true);
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
    await files.getByLabel('筛选远程文件').fill('hello');
    await expect(files.getByLabel('下载 image.png', { exact: true })).toHaveCount(0);
    await files.getByLabel('下载 hello.md', { exact: true }).click();
    await expect(files.locator('.transfer-queue')).toContainText('已完成');
    expect(await readFile(join(downloads, 'hello.md'), 'utf8')).toContain('你好 Nexus');
    await writeFile(join(downloads, 'hello.md'), 'old local file');
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await files.getByLabel('下载 hello.md', { exact: true }).click();
    await expect(files.locator('.transfer-queue')).toContainText('跳过 1 项');
    expect(await readFile(join(downloads, 'hello.md'), 'utf8')).toBe('old local file');
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false });
    });
    await files.getByLabel('下载 hello.md', { exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.nexus.transfers()).filter((task) => task.state === 'complete').length,
        ),
      )
      .toBe(3);
    expect(await readFile(join(downloads, 'hello (1).md'), 'utf8')).toContain('你好 Nexus');
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await files.getByLabel('下载 hello.md', { exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.nexus.transfers()).filter((task) => task.state === 'complete').length,
        ),
      )
      .toBe(4);
    expect(await readFile(join(downloads, 'hello.md'), 'utf8')).toContain('你好 Nexus');
    await files.getByRole('button', { name: '关闭窗口' }).click();
    await page.getByRole('button', { name: '文件', exact: true }).click();
    await expect(files.locator('.transfer-queue')).toContainText('hello.md');
    await expect(files.locator('.transfer-queue')).toContainText('已完成');
    await files.getByRole('button', { name: '清空已结束任务' }).click();
    await expect(files.locator('.transfer-queue')).toHaveCount(0);
    await files.getByLabel('筛选远程文件').fill('');
    fixture.pauseTransfers();
    await files.getByLabel('下载 large.log', { exact: true }).click();
    await expect.poll(() => fixture.pendingReads()).toBeGreaterThan(0);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    ).toBe(false);
    fixture.resumeTransfers();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.nexus.transfers()).find((task) => task.name === 'large.log')?.state,
        ),
      )
      .toBe('complete');
    expect((await readFile(join(downloads, 'large.log'))).length).toBe(300 * 1024);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    expect(errors).toEqual([]);
  } finally {
    if (previousClipboard !== undefined)
      await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), previousClipboard);
    await app.close();
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('tray close preference saves without a probe URL and disabled preference exits the app', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-tray-ui-'));
  const environment = Object.fromEntries(
    Object.entries({ ...process.env, NEXUS_DATA_DIR: directory }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete environment.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env: environment });
  let closed = false;
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '探针与连接' }).click();
    const preference = page.getByRole('checkbox', { name: '关闭主窗口时最小化到托盘' });
    await expect(preference).toBeChecked();
    await page.getByLabel('数据接口', { exact: true }).fill('');
    await preference.uncheck();
    await expect
      .poll(() => page.evaluate(async () => (await window.nexus.bootstrap()).settings.closeToTray))
      .toBe(false);
    const exited = new Promise<number | null>((resolve) =>
      app.process().once('exit', (code) => resolve(code)),
    );
    await app.evaluate(({ BrowserWindow }) => {
      setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 30);
    });
    const exitCode = await exited;
    closed = true;
    expect(exitCode).toBe(0);
  } finally {
    if (!closed) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
