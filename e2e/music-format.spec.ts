import { test, expect } from '@playwright/test';

test('V4 JSON 导入、文本编辑、保存刷新和文件导出保留音乐参数', async ({ page }) => {
  await page.goto('./');
  const music = {
    audio: { id: 'test-audio', name: '录音.mp3', type: 'audio/mpeg', size: 1000, lastModified: 1 },
    alignment: { firstBeatMs: 133.123456789, referenceBpm: 119.8 },
    countIn: { bars: 2, meter: [4, 4], bpm: 120 },
    volume: 0.6,
  };
  const song = {
    version: 2,
    title: 'V4 格式验证',
    endExclusive: 3,
    rows: [{ id: 'first', type: 'section', start: 1, meter: [4, 4], bpm: 120 }],
    music,
  };
  await page.locator('input[type=file][accept*=".txt"]').setInputFiles({
    name: '曲目.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(song)),
  });
  const tab = page.getByRole('tab', { selected: true });
  await expect(tab).toContainText('V4 格式验证');
  await page.keyboard.press('Control+s');
  await expect(tab).not.toContainText('*');
  await page.keyboard.press('v');
  await expect(page.getByRole('textbox', { name: '曲目文本', exact: true })).toHaveValue(
    'Aligned 133.123456789\n1 4/4 120\n3\n',
  );
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(tab).not.toContainText('*');
  const bpm = page.getByRole('spinbutton', { name: '第 1 行 BPM', exact: true });
  await bpm.fill('90');
  await bpm.press('Control+s');
  await expect(tab).not.toContainText('*');
  await page.reload();
  await expect(bpm).toHaveValue('90');
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('metronome.workspace.v1')!),
  );
  expect(saved.version).toBe(3);
  expect(
    saved.library.find((s: { song: { title: string } }) => s.song.title === 'V4 格式验证').song
      .music,
  ).toEqual(music);

  for (const format of ['json', 'txt']) {
    await page.locator('summary').filter({ hasText: '导出' }).click();
    const ready = page.waitForEvent('download');
    await page
      .getByRole('button', { name: format === 'json' ? 'JSON .json' : '文本 .txt', exact: true })
      .click();
    const download = await ready;
    const stream = await download.createReadStream();
    if (!stream) throw Error('下载文件不可读');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const content = Buffer.concat(chunks).toString('utf8');
    if (format === 'json') expect(JSON.parse(content).music).toEqual(music);
    else expect(content).toBe('Aligned 133.123456789\n1 4/4 90\n3\n');
    // 导出菜单在选择后仍打开。
    await page.locator('summary').filter({ hasText: '导出' }).click();
  }
});

test('重复 Aligned 声明保留文本草稿并显示准确行号', async ({ page }) => {
  await page.goto('./');
  await page.keyboard.press('v');
  const input = page.getByRole('textbox', { name: '曲目文本', exact: true });
  const text = 'Aligned 133\nAligned 200\n1 4/4 120\n2';
  await input.fill(text);
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('第 2 行');
  await expect(input).toHaveValue(text);
});
