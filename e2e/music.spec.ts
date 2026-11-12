import { createHash } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { installAudioOutput } from './audio-device';

function wav(seconds = 12, channels = 1) {
  const samples = seconds * 44100;
  const bytes = Buffer.alloc(44 + samples * 2 * channels);
  bytes.write('RIFF');
  bytes.writeUInt32LE(36 + samples * 2 * channels, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(44100, 24);
  bytes.writeUInt32LE(88200 * channels, 28);
  bytes.writeUInt16LE(2 * channels, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2 * channels, 40);
  for (let i = 0; i < samples; i++) {
    const time = i / 44100;
    const audible = time >= 0.25 && (time - 0.25) % 0.5 < 0.02;
    for (let c = 0; c < channels; c++)
      bytes.writeInt16LE(
        audible ? Math.round(15000 * Math.sin((i * 2 * Math.PI * 440) / 44100)) : 0,
        44 + (i * channels + c) * 2,
      );
  }
  return bytes;
}
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const alignmentLine = (sha: string, bpm = 120, start = 250, countin = 0, countinTime = '4/4') =>
  `Alignment:{SHA:${sha}, bpm:${bpm}, start:${start}, countin:${countin}, countin_bpm:${bpm}, countin_time:${countinTime}}`;

async function upload(page: Page, bytes: Buffer, name = '录音.wav') {
  await page
    .getByLabel('音频文件', { exact: true })
    .setInputFiles({ name, mimeType: 'audio/wav', buffer: bytes });
  await expect(page.getByRole('button', { name: '播放音乐', exact: false })).toBeEnabled();
}
async function attach(page: Page, seconds = 12, name = '录音.wav') {
  const bytes = wav(seconds);
  const sha = sha256(bytes);
  await upload(page, bytes, name);
  return { bytes, sha };
}
async function alignedSong(
  page: Page,
  bpm = 120,
  seconds = 5,
  countin = 0,
  countinTime = '4/4',
  start = 250,
) {
  const bytes = wav(seconds);
  const sha = sha256(bytes);
  await page.keyboard.press('v');
  await page
    .getByRole('textbox', { name: '曲目文本', exact: true })
    .fill(`${alignmentLine(sha, bpm, start, countin, countinTime)}\n1 4/4 120\n3 3/8 60\n5`);
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await upload(page, bytes);
  return { bytes, sha };
}
async function slider(page: Page, label: string, value: number) {
  await page.getByLabel(label, { exact: true }).evaluate((element, next) => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      String(next),
    );
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
const state = (page: Page) => page.locator('.audio-state');
test.beforeEach(async ({ page }) => {
  await installAudioOutput(page);
  await page.goto('./');
});

test('多音频 SHA 关联、切换、保存与刷新恢复', async ({ page }) => {
  const { sha, bytes } = await alignedSong(page, 100, 5, 2, '3/4');
  await expect(state(page)).toHaveText('已对齐');
  await expect(page.getByRole('spinbutton', { name: '第 1 行 BPM' })).toHaveValue('100');
  await expect(page.getByRole('spinbutton', { name: '预备小节数' })).toHaveValue('2');
  await expect(page.getByRole('spinbutton', { name: '预备节拍拍号分子' })).toHaveValue('3');
  await expect(page.getByRole('combobox', { name: '预备节拍拍号分母' })).toHaveValue('4');
  await expect(page.getByRole('spinbutton', { name: '预备节拍 BPM' })).toHaveValue('100');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('tab', { selected: true })).not.toContainText('*');
  await page.reload();
  await expect(page.getByRole('button', { name: '播放音乐', exact: false })).toBeEnabled();
  await expect(state(page)).toHaveText('已对齐');
  await expect(page.getByLabel('当前音频')).toHaveValue(sha);

  const other = await attach(page, 3, '另一份.wav');
  await expect(state(page)).toHaveText('未对齐');
  await expect(page.getByLabel('当前音频')).toHaveValue(other.sha);
  await expect(page.getByRole('tab', { selected: true })).toContainText('*');
  await page.getByLabel('当前音频').selectOption(sha);
  await expect(state(page)).toHaveText('已对齐');
  await expect(page.getByRole('spinbutton', { name: '第 1 行 BPM' })).toHaveValue('100');
  await expect(page.getByRole('spinbutton', { name: '预备小节数' })).toHaveValue('2');
  await expect(page.getByRole('spinbutton', { name: '预备节拍拍号分子' })).toHaveValue('3');
  await expect(page.getByRole('spinbutton', { name: '预备节拍 BPM' })).toHaveValue('100');

  await page.getByRole('button', { name: '移除当前' }).click();
  await expect(state(page)).toHaveText('未对齐');
  await upload(page, bytes);
  await expect(state(page)).toHaveText('已对齐');
  await expect(page.getByRole('spinbutton', { name: '第 1 行 BPM' })).toHaveValue('100');
  await expect(page.getByRole('spinbutton', { name: '预备小节数' })).toHaveValue('2');

  const countInBpm = page.getByRole('spinbutton', { name: '预备节拍 BPM' });
  await countInBpm.fill('95');
  await countInBpm.press('Enter');
  await page.waitForTimeout(200);
  await expect(page.getByRole('tab', { selected: true })).toContainText('*');
  await page.keyboard.press('Control+s');
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('metronome.workspace.v2')!),
  );
  const stored = saved.library.find((item: { id: string }) => item.id === saved.active).song;
  expect(Object.keys(stored.music.audios)).toHaveLength(2);
  expect(stored.music.countIn.bpm).toBe(95);
  expect(stored.music.alignments[sha].countin_bpm).toBe(95);
  expect(stored.music.alignments[sha].bpm).toBe(100);
});

test('切换带对齐的音频恢复各自预备节拍并更新第一段 BPM', async ({ page }) => {
  const bytesA = wav(5);
  const bytesB = wav(3);
  const a = sha256(bytesA);
  const b = sha256(bytesB);
  await page.keyboard.press('v');
  await page
    .getByRole('textbox', { name: '曲目文本', exact: true })
    .fill(
      `${alignmentLine(a, 100, 250, 2, '3/4')}\n${alignmentLine(b, 150, 500, 1, '6/8')}\n1 4/4 120\n3 3/8 60\n5`,
    );
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await upload(page, bytesA);
  await expect(page.getByRole('spinbutton', { name: '第 1 行 BPM' })).toHaveValue('100');
  await expect(page.getByRole('spinbutton', { name: '预备小节数' })).toHaveValue('2');
  await expect(page.getByRole('spinbutton', { name: '预备节拍拍号分子' })).toHaveValue('3');
  await expect(page.getByRole('spinbutton', { name: '预备节拍 BPM' })).toHaveValue('100');

  await upload(page, bytesB, '第二份.wav');
  await expect(page.getByLabel('当前音频')).toHaveValue(b);
  await expect(page.getByRole('spinbutton', { name: '第 1 行 BPM' })).toHaveValue('150');
  await expect(page.getByRole('spinbutton', { name: '预备小节数' })).toHaveValue('1');
  await expect(page.getByRole('spinbutton', { name: '预备节拍拍号分子' })).toHaveValue('6');
  await expect(page.getByRole('combobox', { name: '预备节拍拍号分母' })).toHaveValue('8');
  await expect(page.getByRole('spinbutton', { name: '预备节拍 BPM' })).toHaveValue('150');

  await page.getByLabel('当前音频').selectOption(a);
  await expect(page.getByRole('spinbutton', { name: '第 1 行 BPM' })).toHaveValue('100');
  await expect(page.getByRole('spinbutton', { name: '预备小节数' })).toHaveValue('2');
  await expect(page.getByRole('spinbutton', { name: '预备节拍 BPM' })).toHaveValue('100');
});

test('同步播放器暂停、继续、跳转、曲尾及纯节拍器互斥', async ({ page }) => {
  await alignedSong(page);
  await page.getByRole('button', { name: '播放音乐', exact: false }).click();
  await expect(page.locator('.status')).toHaveText('正在播放音乐');
  await expect(page.locator('.segment-row.current')).toHaveCount(1);
  await page.keyboard.press('Space');
  await expect(page.locator('.status')).toHaveText('音乐已暂停');
  await slider(page, '音乐进度', 4.5);
  await expect(page.locator('.measure-number')).toContainText('3');
  await page.keyboard.press('Space');
  await expect(page.locator('.status')).toHaveText('正在播放音乐');
  await page.getByRole('button', { name: '直接播放', exact: false }).click();
  await expect(page.getByRole('button', { name: '播放音乐', exact: false })).toBeEnabled();
  await expect(page.locator('.status')).toHaveText('正在播放');
  await page.keyboard.press('Backspace');
  await expect(page.locator('.status')).toHaveText('就绪');
});

test('对齐完成写入当前 SHA、预备节拍和第一段 BPM，取消保留旧结果', async ({ page }) => {
  await attach(page);
  await page.getByRole('button', { name: '对齐', exact: true }).click();
  const workspace = page.getByRole('dialog', { name: '音频对齐', exact: true });
  await workspace.getByRole('button', { name: '播放音频', exact: true }).click();
  await expect(workspace.locator('.workbench-status').first()).toHaveText('正在播放');
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(150);
    await page.keyboard.press('Space');
  }
  await expect(workspace.getByTestId('tap-count')).toHaveText('4');
  await workspace.getByRole('button', { name: '撤销上一拍' }).click();
  await expect(workspace.getByTestId('tap-count')).toHaveText('3');
  await expect(workspace.getByTestId('interval-width')).not.toHaveText('—');
  await expect(workspace.getByRole('button', { name: '下一步' })).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '精度不足，仍然继续？' })).toBeVisible();
  await page.getByRole('button', { name: '仍然继续' }).click();
  await workspace.getByRole('button', { name: '+1 ms', exact: true }).click();
  await workspace.getByRole('button', { name: '确定', exact: true }).click();
  await expect(workspace).toHaveCount(0);
  await expect(state(page)).toHaveText('已对齐');
  const summary = await page.locator('.alignment-summary').innerText();
  const bpm = /参考 BPM ([\d.]+)/.exec(summary)![1];
  await expect(page.getByRole('spinbutton', { name: '第 1 行 BPM' })).toHaveValue(bpm);
  await expect(page.getByRole('spinbutton', { name: '预备节拍 BPM' })).toHaveValue(bpm);
  const before = await page.getByLabel('曲目音频').innerText();
  await page.getByRole('button', { name: '重新对齐' }).click();
  await workspace.getByRole('button', { name: '播放音频' }).click();
  await page.keyboard.press('Space');
  await slider(page, '打拍音频进度', 4);
  await expect(workspace.getByTestId('tap-count')).toHaveText('0');
  await workspace.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '取消本次对齐？', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '放弃本次修改' }).click();
  expect(await page.getByLabel('曲目音频').innerText()).toBe(before);
});

test('减少动态偏好下打拍仍显示扩散竖线', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await attach(page);
  await page.getByRole('button', { name: '对齐', exact: true }).click();
  const workspace = page.getByRole('dialog', { name: '音频对齐', exact: true });
  await workspace.getByRole('button', { name: '播放音频', exact: true }).click();
  await expect(workspace.locator('.workbench-status').first()).toHaveText('正在播放');
  await page.keyboard.press('Space');
  const line = workspace.locator('.tap-wave-line').first();
  await expect(line).toBeVisible();
  await expect
    .poll(() => line.evaluate((element) => element.getAnimations().length))
    .toBeGreaterThan(0);
});

test('长音频时间显示为分:秒', async ({ page }) => {
  await attach(page, 90);
  await expect(page.locator('.music-time')).toHaveText('0:00 / 1:30');
  await page.getByRole('button', { name: '对齐', exact: true }).click();
  const workspace = page.getByRole('dialog', { name: '音频对齐', exact: true });
  await workspace.getByRole('button', { name: '播放音频', exact: true }).click();
  await expect(workspace.locator('.workbench-status').first()).toHaveText('正在播放');
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(150);
    await page.keyboard.press('Space');
  }
  await expect(workspace.locator('.time-readout').first()).toHaveText(/^\d+:\d{2} \/ 1:30$/);
  await workspace.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '仍然继续' }).click();
  await expect(workspace.getByRole('button', { name: '停止试听', exact: true })).toBeVisible();
  await expect(workspace.locator('.time-readout').nth(1)).toHaveText(/^\d+:\d{2} \/ 1:30$/);
});

test('WAV 和 MP3 合成、实际解码、下载、过期结果与新增音频', async ({ page }) => {
  await alignedSong(page);
  await slider(page, '音量', 0);
  for (const format of ['wav', 'mp3']) {
    await page.getByLabel('合成格式', { exact: true }).selectOption(format);
    await page.getByRole('button', { name: '生成合成音频' }).click();
    await expect(page.getByRole('button', { name: '下载合成音频' })).toBeEnabled({
      timeout: 30000,
    });
    const ready = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载合成音频' }).click();
    const download = await ready;
    const stream = await download.createReadStream();
    if (!stream) throw Error('下载内容缺失');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const decoded = await page.evaluate(async (encoded) => {
      const data = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      const buffer = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data.buffer);
      const samples = buffer.getChannelData(0);
      let first = -1;
      for (let i = 0; i < samples.length; i++)
        if (Math.abs(samples[i]) > 0.05) {
          first = i / buffer.sampleRate;
          break;
        }
      return { duration: buffer.duration, first };
    }, bytes.toString('base64'));
    expect(decoded.duration).toBeCloseTo(7.25, 2);
    expect(decoded.first).toBeCloseTo(0.25, 2);
    await page.getByRole('button', { name: '试听合成结果' }).click();
    await expect(page.locator('.status')).toHaveText('正在播放音乐');
    await page.keyboard.press('Backspace');
    if (format === 'mp3') {
      await page
        .getByLabel('音频文件', { exact: true })
        .setInputFiles({ name: '合成.mp3', mimeType: 'audio/mpeg', buffer: bytes });
      await expect(page.getByRole('button', { name: '播放音乐', exact: false })).toBeEnabled();
    }
  }
  await expect(page.getByRole('button', { name: '下载合成音频' })).toBeDisabled();
});

test('音频数据库写入中断时曲目参数不保存，星号和文件仍可重试', async ({ page }) => {
  await attach(page, 2);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    let failed = false;
    IDBObjectStore.prototype.put = function (...args) {
      const request = original.apply(this, args);
      if (!failed) {
        failed = true;
        this.transaction.abort();
      }
      return request;
    };
  });
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('dialog')).toContainText('保存失败');
  await expect(page.getByRole('tab', { selected: true })).toContainText('*');
  expect(await page.evaluate(() => localStorage.getItem('metronome.workspace.v2'))).toBeNull();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('tab', { selected: true })).not.toContainText('*');
  await page.reload();
  await expect(page.getByRole('button', { name: '播放音乐', exact: false })).toBeEnabled();
});

test('预备节拍与前补静音在播放器及合成文件中使用相同时间范围', async ({ page }) => {
  await alignedSong(page);
  const bars = page.getByRole('spinbutton', { name: '预备小节数', exact: true });
  await bars.fill('2');
  await bars.press('Enter');
  await expect(page.getByLabel('音乐进度')).toHaveAttribute('max', '11.5');
  await page.getByRole('button', { name: '生成合成音频' }).click();
  await expect(page.getByRole('button', { name: '下载合成音频' })).toBeEnabled();
  const ready = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载合成音频' }).click();
  const download = await ready,
    stream = await download.createReadStream();
  if (!stream) throw Error('下载内容缺失');
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  const duration = await page.evaluate(async (encoded) => {
    const data = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data.buffer);
    const samples = decoded.getChannelData(0);
    for (let i = 0; i < 0.5 * 44100; i++) if (samples[i] !== 0) throw Error('预备第一拍前出现声音');
    let peak = 0;
    for (const value of samples) peak = Math.max(peak, Math.abs(value));
    if (peak > 1) throw Error('合成削波');
    return decoded.duration;
  }, bytes.toString('base64'));
  expect(duration).toBe(11.5);
  await page.getByRole('button', { name: '播放音乐', exact: false }).click();
  await expect(page.locator('.segment-row.current')).toHaveCount(0);
  await page.keyboard.press('Space');
  await slider(page, '音乐进度', 4.5);
  await expect(page.locator('.segment-row.current')).toHaveCount(1);
  await expect(page.locator('.measure-number')).toContainText('1');
  await page.keyboard.press('Backspace');
  await slider(page, '音频音量', 20);
  await expect(page.getByRole('button', { name: '下载合成音频' })).toBeDisabled();
});

test('长音频规模实测', async ({ page }) => {
  test.skip(process.env.V4_SCALE_TEST !== '1', '按需运行三分钟双声道音频规模实测。');
  test.setTimeout(120000);
  const bytes = wav(180, 2);
  const sha = sha256(bytes);
  await page.keyboard.press('v');
  await page
    .getByRole('textbox', { name: '曲目文本', exact: true })
    .fill(`${alignmentLine(sha)}\n1 4/4 120\n2`);
  await page.getByRole('button', { name: '确定', exact: true }).click();
  const loadStart = Date.now();
  await upload(page, bytes, '三分钟.wav');
  const loaded = Date.now() - loadStart;
  await page.getByRole('button', { name: '生成合成音频' }).click();
  await page.getByRole('button', { name: '取消生成' }).click();
  await expect(page.getByRole('button', { name: '生成合成音频' })).toBeEnabled();
  const timings: Record<string, number> = {};
  for (const format of ['wav', 'mp3']) {
    await page.getByLabel('合成格式', { exact: true }).selectOption(format);
    const start = Date.now();
    await page.getByRole('button', { name: '生成合成音频' }).click();
    await expect(page.getByRole('button', { name: '下载合成音频' })).toBeEnabled({
      timeout: 60000,
    });
    timings[format] = Date.now() - start;
  }
  console.log(
    'V5 规模实测',
    JSON.stringify({
      seconds: 180,
      channels: 2,
      bytes: bytes.length,
      loadMs: loaded,
      encodeMs: timings,
    }),
  );
});

test('未对齐音频不驱动列表，切换模式停止声音', async ({ page }) => {
  await attach(page, 2);
  await page.getByRole('button', { name: '播放音乐', exact: false }).click();
  await expect(page.locator('.status')).toHaveText('正在播放音乐');
  await expect(page.locator('.segment-row.current')).toHaveCount(0);
  await expect(page.locator('.beat-light.lit')).toHaveCount(0);
  await page.getByRole('button', { name: '普通节拍器', exact: true }).click();
  await expect(page.locator('.status')).toHaveText('就绪');
  await page.getByRole('button', { name: '序列节拍器', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止音乐', exact: false })).toBeDisabled();
});

test('JSON 缺失音频禁用播放，关联同 SHA 文件恢复对齐', async ({ page }) => {
  const bytes = wav(2);
  const sha = sha256(bytes);
  const song = {
    version: 3,
    title: '缺失音频',
    endExclusive: 2,
    rows: [{ id: 'a', type: 'section', start: 1, meter: [4, 4], bpm: 120 }],
    music: {
      audios: {
        [sha]: {
          sha256: sha,
          name: '原音频.wav',
          size: bytes.length,
          type: 'audio/wav',
          lastModified: 1,
        },
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
    },
  };
  await page.locator('input[type=file][accept*=".txt"]').setInputFiles({
    name: '缺失.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(song)),
  });
  await expect(state(page)).toHaveText('音频文件缺失');
  await expect(page.getByRole('button', { name: '播放音乐', exact: false })).toBeDisabled();
  await page
    .getByLabel('音频文件', { exact: true })
    .setInputFiles({ name: '原音频.wav', mimeType: 'audio/wav', buffer: bytes });
  await expect(page.getByRole('button', { name: '播放音乐', exact: false })).toBeEnabled();
  await expect(state(page)).toHaveText('已对齐');
  await expect(page.locator('.alignment-summary')).toContainText('参考 BPM 120 · 首拍 250 ms');
});
