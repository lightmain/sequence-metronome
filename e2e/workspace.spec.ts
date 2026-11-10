import { installAudioOutput } from './audio-device';
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await installAudioOutput(page);
  await page.goto('./');
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus)
    console.log('界面错误:', await page.locator('.message-text').allTextContents());
});

test('Ctrl/Shift 选择、外部点击和插入位置', async ({ page }) => {
  const rows = page.locator('.segment-row');
  await rows.nth(0).locator('.length-cell').click();
  await rows
    .nth(2)
    .locator('.length-cell')
    .click({ modifiers: ['Control'] });
  await rows
    .nth(2)
    .locator('.length-cell')
    .click({ modifiers: ['Control'] });
  await expect(page.locator('.segment-row.selected')).toHaveCount(2);
  await rows
    .nth(3)
    .locator('.length-cell')
    .click({ modifiers: ['Control', 'Shift'] });
  await expect(page.locator('.segment-row.selected')).toHaveCount(3);
  await page
    .getByRole('heading', { name: '节拍器', exact: true })
    .click({ modifiers: ['Control'] });
  await expect(page.locator('.segment-row.selected')).toHaveCount(3);
  await page.getByRole('heading', { name: '节拍器', exact: true }).click();
  await expect(page.locator('.segment-row.selected')).toHaveCount(0);
  await page.getByRole('button', { name: '选择第 3 个插入位置', exact: true }).click();
  await expect(page.locator('.insert-gap.chosen')).toHaveCount(1);
  await page
    .getByRole('heading', { name: '节拍器', exact: true })
    .click({ modifiers: ['Control'] });
  await expect(page.locator('.insert-gap.chosen')).toHaveCount(0);
});

test('鼠标框选替换原选择，Ctrl 框选取并集', async ({ page }) => {
  const rows = page.locator('.segment-row');
  await rows.nth(3).locator('.length-cell').click();
  async function drag() {
    const first = await rows.nth(0).boundingBox(),
      last = await rows.nth(2).boundingBox();
    if (!first || !last) throw Error('段落未显示');
    await page.mouse.move(first.x + first.width - 8, first.y + 8);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width - 16, last.y + last.height - 8, { steps: 15 });
    await page.mouse.up();
  }
  await drag();
  await expect(page.locator('.segment-row.selected')).toHaveCount(3);
  await rows.nth(3).locator('.length-cell').click();
  await page.keyboard.down('Control');
  await drag();
  await page.keyboard.up('Control');
  await expect(page.locator('.segment-row.selected')).toHaveCount(4);
});

test('F2、保存、刷新恢复及相同文本不会产生未保存星号', async ({ page }) => {
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: '曲目名称', exact: true }).fill('自动化练习');
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.getByRole('tab', { selected: true })).toContainText('*');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('tab', { selected: true })).not.toContainText('*');
  await page.reload();
  await expect(page.getByRole('tab', { selected: true })).toHaveText('自动化练习');
  await page.keyboard.press('v');
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.getByRole('tab', { selected: true })).not.toContainText('*');
});

test('文本解析错误留在原对话框，输入中快捷键不会启动播放', async ({ page }) => {
  await page.keyboard.press('v');
  await page.getByRole('textbox', { name: '曲目文本', exact: true }).fill('1 4/4 120\n错误行\n2');
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('alert')).toContainText('第 2 行');
  await page.getByRole('textbox', { name: '曲目文本', exact: true }).press('Space');
  await expect(page.locator('.status')).toHaveText('就绪');
});

test('数值输入 Enter 提交、Escape 取消，Ctrl+S 提交并保存', async ({ page }) => {
  const bpm = page.getByRole('spinbutton', { name: '第 1 行 BPM', exact: true });
  await bpm.fill('100');
  await bpm.press('Escape');
  await expect(bpm).toHaveValue('120');
  await bpm.fill('90.5');
  await bpm.press('Control+s');
  await expect(page.getByRole('tab', { selected: true })).not.toContainText('*');
  await page.reload();
  await expect(page.getByRole('spinbutton', { name: '第 1 行 BPM', exact: true })).toHaveValue(
    '90.5',
  );
});

test('普通模式只响应 Space，拍灯固定尺寸且每行最多八个', async ({ page }) => {
  await page.getByRole('button', { name: '普通节拍器', exact: true }).click();
  const numerator = page.getByRole('spinbutton', { name: '普通节拍器拍号分子', exact: true });
  await numerator.fill('9');
  await numerator.press('Enter');
  await expect(page.locator('.beat-light')).toHaveCount(9);
  const bounds = await page.locator('.beat-light').evaluateAll((elements) =>
    elements.map((el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height, top: r.top };
    }),
  );
  expect(bounds.every((b) => b.width === 72 && b.height === 72)).toBe(true);
  expect(bounds[8].top).toBeGreaterThan(bounds[7].top);
  await page.getByRole('heading', { name: '普通节拍器', exact: true }).click();
  await page.keyboard.press('Enter');
  await expect(page.locator('.status')).toHaveText('就绪');
  await page.keyboard.press('Space');
  await expect(page.locator('.status')).toHaveText('正在播放');
  await page.keyboard.press('Backspace');
  await expect(page.locator('.status')).toHaveText('正在播放');
  await page.keyboard.press('Space');
  await expect(page.locator('.status')).toHaveText('就绪');
});

test('项目子路径音效解码与模拟输出，M 确定倒计时后不再变化', async ({ page }) => {
  await page.getByRole('button', { name: '准备模式 Space', exact: true }).click();
  await expect(page.locator('.status')).toHaveText('准备模式');
  await page.keyboard.press('m');
  await expect(page.locator('.status')).toHaveText('即将开始');
  await expect(page.locator('.transport-buttons button')).toHaveCount(1);
  await expect(page.locator('.measure-number')).toHaveText('-2');
  await page.keyboard.press('n');
  await page.keyboard.press('Space');
  await expect(page.locator('.measure-number')).toHaveText('-2');
  await page.keyboard.press('Backspace');
  await expect(page.locator('.status')).toHaveText('就绪');
});

test('文件导入打开新标签，关闭未保存曲目可取消', async ({ page }) => {
  await page.locator('input[type=file][accept*=".txt"]').setInputFiles({
    name: '练习.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('1 3/4 90\n4'),
  });
  await expect(page.getByRole('tab', { selected: true })).toContainText('练习');
  await expect(page.getByRole('spinbutton', { name: '曲目最后小节', exact: true })).toHaveValue(
    '3',
  );
  await page.getByRole('button', { name: '关闭 练习', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('tab', { selected: true })).toContainText('练习');
});

test('音效加载期间取消后可以重新播放，旧请求不改变新状态', async ({ page }) => {
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route('**/sounds/click.wav', async (route) => {
    if (++calls === 1) await blocked;
    try {
      await route.fulfill({ response: await page.request.get(route.request().url()) });
    } catch {
      /* 已被用户取消的请求 */
    }
  });
  await page.keyboard.press('Space');
  await expect(page.locator('.status')).toHaveText('正在加载音效');
  await page.keyboard.press('Backspace');
  await expect(page.locator('.status')).toHaveText('就绪');
  await page.keyboard.press('Enter');
  await expect(page.locator('.status')).toHaveText('正在播放');
  release();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Backspace');
});

test('复制多段在缝隙粘贴、删除、撤销和重做', async ({ page }) => {
  const rows = page.locator('.segment-row');
  await rows.nth(2).locator('.length-cell').click();
  await rows
    .nth(3)
    .locator('.length-cell')
    .click({ modifiers: ['Control'] });
  const content = await page.evaluate(() => {
    const data = new DataTransfer();
    document.dispatchEvent(
      new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }),
    );
    return data.getData('text/plain');
  });
  await page.getByRole('button', { name: '选择第 3 个插入位置', exact: true }).click();
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    document.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, content);
  await expect(rows).toHaveCount(6);
  await page.keyboard.press('Control+z');
  await expect(rows).toHaveCount(4);
  await page.keyboard.press('Control+y');
  await expect(rows).toHaveCount(6);
  await rows.nth(2).locator('.length-cell').click();
  await page.keyboard.press('Delete');
  await expect(rows).toHaveCount(5);
  await page.keyboard.press('Control+z');
  await expect(rows).toHaveCount(6);
});

test('页面隐藏会停止播放，重新可见后不会自行恢复', async ({ page }) => {
  await page.keyboard.press('Enter');
  await expect(page.locator('.status')).toHaveText('正在播放');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.status')).toHaveText('就绪');
  await expect(page.getByRole('dialog')).toContainText('转入后台');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.locator('.status')).toHaveText('就绪');
});
