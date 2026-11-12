import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { installAudioOutput } from './audio-device';

function wav(seconds = 5) {
  const samples = seconds * 44100;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(36 + samples * 2, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(44100, 24);
  bytes.writeUInt32LE(88200, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  return bytes;
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function attach(page: Page) {
  const bytes = wav();
  await page
    .getByLabel('音频文件', { exact: true })
    .setInputFiles({ name: '录音.wav', mimeType: 'audio/wav', buffer: bytes });
  await expect(page.getByRole('button', { name: '播放音乐', exact: false })).toBeEnabled();
  return { bytes, sha: sha256(bytes) };
}

async function openWorkspace(page: Page) {
  await page.getByRole('button', { name: '对齐', exact: true }).click();
  const workspace = page.getByRole('dialog', { name: '音频对齐', exact: true });
  await expect(workspace).toBeVisible();
  return workspace;
}

type TestAudio = { origin: number; starts: number[] };
const testAudio = (page: Page) =>
  page.evaluate(() => {
    const audio = (window as unknown as { __testAudio?: TestAudio }).__testAudio;
    return audio ? { origin: audio.origin, starts: [...audio.starts] } : null;
  });

async function tapAt(page: Page, target: number) {
  await page.evaluate(
    (at) =>
      new Promise<void>((resolve) => {
        const fire = () => {
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }),
          );
          window.dispatchEvent(
            new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }),
          );
          resolve();
        };
        const wait = at - performance.now();
        if (wait <= 0) fire();
        else setTimeout(fire, wait);
      }),
    target,
  );
}

test('设备延迟检测展开、打拍、应用、持久化和清除', async ({ page }) => {
  await installAudioOutput(page);
  await page.goto('./');
  await attach(page);
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('tab', { selected: true })).not.toContainText('*');
  const workspace = await openWorkspace(page);

  const entry = workspace.getByRole('button', { name: /设备延迟检测/ });
  await expect(entry).toContainText('未检测');
  await entry.click();

  const panel = workspace.locator('#device-delay-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: '设备延迟检测' })).toBeVisible();
  const step = workspace.locator('section[aria-labelledby="alignment-step-1"]');
  const panelBox = await panel.boundingBox();
  const stepBox = await step.boundingBox();
  if (!panelBox || !stepBox) throw Error('检测区或第一步不可见');
  expect(Math.abs(panelBox.width - stepBox.width)).toBeLessThan(1);
  await expect(workspace.getByRole('button', { name: '播放检测节拍' })).toBeFocused();
  expect(await step.evaluate((element) => (element as HTMLElement).inert)).toBe(true);

  const before = (await testAudio(page))?.starts.length ?? 0;
  await panel.getByRole('button', { name: '播放检测节拍' }).click();
  await expect(panel.getByRole('button', { name: '停止检测节拍' })).toBeVisible();
  await expect
    .poll(async () => (await testAudio(page))?.starts.length ?? 0, { timeout: 5000 })
    .toBeGreaterThanOrEqual(before + 32);

  const audio = await testAudio(page);
  if (!audio) throw Error('测试音频上下文未创建');
  const first = audio.starts[before];
  for (let index = 0; index < 20; index++)
    await tapAt(page, audio.origin + (first + index * 0.5) * 1000);

  await expect
    .poll(async () => Number(await panel.getByTestId('device-delay-count').innerText()))
    .toBeGreaterThanOrEqual(8);
  await panel.getByRole('button', { name: '停止检测节拍' }).click();
  await expect(panel.getByTestId('device-delay-status')).not.toHaveText('检测中');

  await panel.getByRole('button', { name: '应用', exact: true }).click();
  const weak = page.getByRole('dialog', { name: '精度不足，仍然应用？', exact: true });
  await expect(async () => {
    if (await weak.count()) await weak.getByRole('button', { name: '仍然应用' }).click();
    await expect(panel).toHaveCount(0);
  }).toPass({ timeout: 5000 });

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('metronome.device.v1') ?? 'null'),
  );
  expect(stored.version).toBe(1);
  expect(Number.isInteger(stored.delayMs)).toBe(true);
  expect(Math.abs(stored.delayMs)).toBeLessThanOrEqual(200);
  const formatted = `${stored.delayMs > 0 ? '+' : stored.delayMs < 0 ? '−' : ''}${Math.abs(stored.delayMs)} ms`;
  await expect(entry).toContainText(formatted);
  const workspaceRaw = await page.evaluate(
    () => localStorage.getItem('metronome.workspace.v2') ?? '',
  );
  expect(workspaceRaw).not.toContain('metronome.device');
  expect(workspaceRaw).not.toContain('delayMs');

  await workspace.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '放弃本次修改' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '播放音乐', exact: false })).toBeEnabled();
  const reopened = await openWorkspace(page);
  await expect(reopened.getByRole('button', { name: /设备延迟检测/ })).toContainText(formatted);

  await reopened.getByRole('button', { name: /设备延迟检测/ }).click();
  await reopened.getByRole('button', { name: '清除', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('metronome.device.v1'))).toBeNull();
  await reopened.getByRole('button', { name: '收起', exact: true }).click();
  await expect(reopened.getByRole('button', { name: /设备延迟检测/ })).toContainText('未检测');
});

test('第二步禁用入口，返回第一步后恢复', async ({ page }) => {
  await installAudioOutput(page);
  await page.goto('./');
  await attach(page);
  const workspace = await openWorkspace(page);
  await workspace.getByRole('button', { name: '播放音频', exact: true }).click();
  await expect(workspace.locator('.workbench-status').first()).toHaveText('正在播放');
  for (let index = 0; index < 3; index++) {
    await page.waitForTimeout(150);
    await page.keyboard.press('Space');
  }
  await workspace.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '仍然继续' }).click();
  await expect(workspace.getByRole('button', { name: /设备延迟检测/ })).toBeDisabled();
  await workspace.getByRole('button', { name: '返回上一步' }).click();
  await expect(workspace.getByRole('button', { name: /设备延迟检测/ })).toBeEnabled();
});

test('检测区按 Esc 先收起，再按 Esc 才询问是否取消对齐', async ({ page }) => {
  await installAudioOutput(page);
  await page.goto('./');
  await attach(page);
  const workspace = await openWorkspace(page);
  await workspace.getByRole('button', { name: /设备延迟检测/ }).click();
  await expect(workspace.locator('#device-delay-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(workspace.locator('#device-delay-panel')).toHaveCount(0);
  await expect(workspace).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '取消本次对齐？', exact: true })).toBeVisible();
});
