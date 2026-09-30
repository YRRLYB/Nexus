import { _electron as electron, test, expect, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDiscoveryServer } from '../fixtures/discovery';

async function expectReadable(page: Page, selector: string) {
  const results = await page.locator(selector).evaluateAll((elements) => {
    const luminance = (rgb: number[]) =>
      rgb
        .map((n) => n / 255)
        .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
        .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
    // Conservative light surface, darker than the translucent panels and forms.
    const background = luminance([230, 235, 244]);
    return elements
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((element) => {
        const style = getComputedStyle(element);
        const foreground = luminance((style.color.match(/[\d.]+/g) || []).slice(0, 3).map(Number));
        return {
          text: element.textContent?.trim().slice(0, 45),
          size: parseFloat(style.fontSize),
          contrast:
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
        };
      });
  });
  expect(results.length).toBeGreaterThan(0);
  for (const result of results) {
    expect(result.size, result.text).toBeGreaterThanOrEqual(15);
    expect(result.contrast, result.text).toBeGreaterThanOrEqual(4.5);
  }
}

test('automatic SSH discovery, project evidence, cache, refresh failure and readable panels', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-discovery-ui-'));
  const fixture = await startDiscoveryServer();
  const env: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, NEXUS_DATA_DIR: dir }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await page.getByRole('button', { name: '添加设备', exact: true }).last().click();
    await expectReadable(page, '.modal > header p, .modal label, .helper');
    await page.getByLabel('设备名称').fill('Project Server');
    await page.getByLabel('IP / 主机名').fill('127.0.0.1');
    await page.getByLabel('SSH 端口').fill(String(fixture.port));
    await page.getByLabel('用户名', { exact: true }).fill('test');
    await page.getByLabel('密码', { exact: true }).fill('fixture-pass');
    await page.getByRole('button', { name: '保存设备' }).click();
    await expect(page.getByRole('button', { name: '查看运行内容' })).toBeVisible();
    expect(fixture.control.requests.length).toBe(7);
    await expectReadable(
      page,
      '.detail-header > span, .detail-status, .metric small, .connection-row label, .connection-row code, .discovery-time',
    );
    await page.getByRole('button', { name: '查看运行内容' }).click();
    const dialog = page.getByRole('dialog', { name: 'Project Server · 运行内容' });
    await expect(dialog.getByRole('heading', { name: 'notes', exact: true })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'nexus-web', exact: true })).toBeVisible();
    await expect(dialog).toContainText('已确认');
    await expect(dialog).toContainText('待确认');
    await expect(dialog).toContainText('TCP 0.0.0.0:3000');
    await page.screenshot({ path: 'test-results/discovery.png' });
    await expectReadable(
      page,
      '.discovery-explanation, .project-card p, .project-card code, .project-kind',
    );
    await dialog.getByRole('tab', { name: /系统定时器/ }).click();
    await expect(dialog).toContainText('权限不足');
    await expect(dialog).toContainText('此项未能读取');
    await dialog.getByRole('tab', { name: /^进程/ }).click();
    await dialog.getByLabel('搜索运行内容').fill('weather');
    await expect(dialog.locator('tbody tr')).toHaveCount(1);
    await dialog.getByLabel('搜索运行内容').fill('');
    await dialog.getByRole('button', { name: '关闭窗口' }).click();
    await page.getByRole('button', { name: '关闭详情' }).click();
    await page.getByRole('button', { name: '设备 Project Server', exact: true }).click();
    await expect(page.getByRole('button', { name: '查看运行内容' })).toBeVisible();
    expect(fixture.control.requests.length).toBe(7);
    await page.getByRole('button', { name: '查看运行内容' }).click();
    fixture.control.fail = true;
    await dialog.getByRole('button', { name: '重新识别' }).click();
    await expect(dialog.getByRole('alert')).toContainText('上次采集结果');
    await expect(dialog.getByRole('heading', { name: 'notes', exact: true })).toBeVisible();
    fixture.control.fail = false;
    await dialog.getByRole('button', { name: '重新识别' }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '重新识别' })).toBeEnabled();
    expect(fixture.control.requests.length).toBe(21);
    await dialog.getByRole('button', { name: '关闭窗口' }).click();
    await page.getByRole('button', { name: '探针与连接' }).click();
    await expectReadable(page, '.modal > header p, .helper, .vault-note small, .vault-note strong');
    await page.screenshot({ path: 'test-results/settings-readable.png' });
  } finally {
    await app.close();
    await fixture.close();
    await rm(dir, { recursive: true, force: true });
  }
});
