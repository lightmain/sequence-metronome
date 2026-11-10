import { test, expect } from '@playwright/test';

test('两个网页保存冲突不会覆盖较新的保存，失败页保留星号', async ({ page, context }) => {
  await page.goto('./');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('tab', { selected: true })).not.toContainText('*');
  const other = await context.newPage();
  await other.goto('./');
  const firstBpm = page.getByRole('spinbutton', { name: '第 1 行 BPM', exact: true });
  await firstBpm.fill('90');
  await firstBpm.press('Control+s');
  await expect(page.getByRole('tab', { selected: true })).not.toContainText('*');
  const otherBpm = other.getByRole('spinbutton', { name: '第 1 行 BPM', exact: true });
  await otherBpm.fill('100');
  await otherBpm.press('Control+s');
  await expect(other.getByRole('dialog')).toContainText('另一个网页');
  await expect(other.getByRole('tab', { selected: true })).toContainText('*');
  await page.reload();
  await expect(page.getByRole('spinbutton', { name: '第 1 行 BPM', exact: true })).toHaveValue(
    '90',
  );
});

test('浏览器存储空间不足时不清除未保存星号', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    };
  });
  await page.goto('./');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('dialog')).toContainText('保存失败');
  await expect(page.getByRole('tab', { selected: true })).toContainText('*');
});
