import { createHash } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { strToU8, unzipSync, zipSync } from 'fflate';
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
  for (let i = 0; i < samples; i++)
    if (i > 1000 && i % 20000 < 500) bytes.writeInt16LE(12000, 44 + i * 2);
  return bytes;
}
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const alignment = (sha: string, start = 250) =>
  `Alignment:{SHA:${sha}, bpm:120, start:${start}, countin:0, countin_bpm:120, countin_time:4/4}`;

function song(title: string, sha: string) {
  return {
    version: 3,
    title,
    endExclusive: 3,
    rows: [{ id: 'row-1', type: 'section', start: 1, meter: [4, 4], bpm: 120 }],
    music: {
      audios: {
        [sha]: { sha256: sha, name: '录音.wav', size: 1, type: 'audio/wav', lastModified: 1 },
      },
      alignments: {
        [sha]: {
          bpm: 120,
          start: 250,
          countin: 0,
          countin_bpm: 120,
          countin_time: '4/4',
        },
      },
      activeSha: sha,
      countIn: { bars: 0, meter: [4, 4], bpm: 120 },
      volume: 0.65,
    },
  };
}

async function importZip(page: Page, name: string, entries: Record<string, Uint8Array>) {
  const zip = zipSync(entries, { level: 0 });
  await page.locator('input[type=file][accept*=".zip"]').setInputFiles({
    name,
    mimeType: 'application/zip',
    buffer: Buffer.from(zip),
  });
}

test.beforeEach(async ({ page }) => {
  await installAudioOutput(page);
  await page.goto('./');
});

test('ZIP 导出只包含 txt、json 和当前音频', async ({ page }) => {
  const current = wav(5);
  const historical = wav(3);
  const currentSha = sha256(current);
  const historicalSha = sha256(historical);
  await page.keyboard.press('v');
  await page
    .getByRole('textbox', { name: '曲目文本', exact: true })
    .fill(`${alignment(currentSha, 250)}\n${alignment(historicalSha, 500)}\n1 4/4 120\n2\n`);
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await page.getByLabel('音频文件', { exact: true }).setInputFiles({
    name: '当前.wav',
    mimeType: 'audio/wav',
    buffer: current,
  });
  await expect(page.getByRole('button', { name: '播放音乐', exact: false })).toBeEnabled();

  await page.locator('summary').filter({ hasText: '导出' }).click();
  const ready = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ZIP .zip', exact: true }).click();
  const download = await ready;
  const stream = await download.createReadStream();
  if (!stream) throw Error('下载内容缺失');
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const entries = unzipSync(new Uint8Array(Buffer.concat(chunks)));
  const names = Object.keys(entries);
  expect(names).toHaveLength(3);
  const base = names.find((name) => name.endsWith('.json'))!.replace(/\.json$/, '');
  expect(entries[`${base}.txt`]).toBeTruthy();
  const json = JSON.parse(new TextDecoder().decode(entries[`${base}.json`]));
  expect(Object.keys(json.music.alignments)).toContain(historicalSha);
  const audioName = names.find((name) => !name.endsWith('.txt') && !name.endsWith('.json'))!;
  expect(audioName).toBe(`${base}.wav`);
  expect(sha256(Buffer.from(entries[audioName]))).toBe(currentSha);
});

test('ZIP 导入优先使用 JSON 并关联匹配音频', async ({ page }) => {
  const base = 'ZIP导入';
  const audio = wav();
  const sha = sha256(audio);
  await importZip(page, `${base}.zip`, {
    [`${base}.json`]: strToU8(JSON.stringify(song('JSON 优先曲目', sha))),
    [`${base}.txt`]: strToU8('无效文本'),
    [`${base}.wav`]: audio,
  });
  const tab = page.getByRole('tab', { selected: true });
  await expect(tab).toContainText('JSON 优先曲目');
  await expect(page.locator('.audio-state')).toHaveText('已对齐');
  await expect(page.getByLabel('当前音频')).toHaveValue(sha);
  await expect(page.getByRole('button', { name: '播放音乐', exact: false })).toBeEnabled();
});

test('ZIP 导入在 JSON 无效时回退 TXT，并按 TXT 的 SHA 关联音频', async ({ page }) => {
  const base = 'TXT回退';
  const audio = wav();
  const sha = sha256(audio);
  await importZip(page, `${base}.zip`, {
    [`${base}.json`]: strToU8('{'),
    [`${base}.txt`]: strToU8(`${alignment(sha)}\n1 4/4 120\n2\n`),
    [`${base}.wav`]: audio,
  });
  const tab = page.getByRole('tab', { selected: true });
  await expect(tab).toContainText(base);
  await expect(page.locator('.audio-state')).toHaveText('已对齐');
  await expect(page.getByLabel('当前音频')).toHaveValue(sha);
});

test('ZIP 名带后缀且内部文件不同名时仍导入无音频序列', async ({ page }) => {
  const base = '原曲';
  const audio = wav();
  await importZip(page, `${base}-noaudio.zip`, {
    [`${base}.json`]: strToU8(JSON.stringify(song('后缀曲目', sha256(audio)))),
    [`${base}.txt`]: strToU8('无效文本'),
  });
  const tab = page.getByRole('tab', { selected: true });
  await expect(tab).toContainText('后缀曲目');
  await expect(page.locator('.audio-state')).toHaveText('未对齐');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('ZIP 名带后缀且音频不同名时不关联该音频', async ({ page }) => {
  const base = '原曲';
  const expected = wav(5);
  const other = wav(3);
  await importZip(page, `${base}-anotheraudio.zip`, {
    [`${base}.json`]: strToU8(JSON.stringify(song('后缀曲目', sha256(expected)))),
    [`${base}.txt`]: strToU8('无效文本'),
    [`${base}.wav`]: other,
  });
  const tab = page.getByRole('tab', { selected: true });
  await expect(tab).toContainText('后缀曲目');
  await expect(page.locator('.audio-state')).toHaveText('未对齐');
  await expect(page.getByRole('button', { name: '播放音乐', exact: false })).toBeDisabled();
});

test('ZIP 序列都读取失败时显示统一错误且不新建标签', async ({ page }) => {
  const base = '无法读取';
  const before = await page.getByRole('tab').count();
  await importZip(page, `${base}.zip`, {
    [`${base}.json`]: strToU8('{'),
    [`${base}.txt`]: strToU8('bad'),
  });
  await expect(page.getByRole('dialog')).toContainText('节拍器序列读取错误');
  expect(await page.getByRole('tab').count()).toBe(before);
});

test('ZIP 音频 SHA 不匹配时不关联音频', async ({ page }) => {
  const base = '音频不匹配';
  const expected = wav(5);
  const other = wav(3);
  await importZip(page, `${base}.zip`, {
    [`${base}.json`]: strToU8(JSON.stringify(song('不匹配曲目', sha256(expected)))),
    [`${base}.wav`]: other,
  });
  const tab = page.getByRole('tab', { selected: true });
  await expect(tab).toContainText('不匹配曲目');
  await expect(page.locator('.audio-state')).toHaveText('未对齐');
  await expect(page.getByRole('button', { name: '播放音乐', exact: false })).toBeDisabled();
});
