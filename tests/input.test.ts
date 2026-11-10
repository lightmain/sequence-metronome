import { describe, expect, it } from 'vitest';
import {
  MAX_IMPORT_BYTES,
  MAX_ROWS,
  copyRows,
  exportText,
  parseClipboard,
  parseJson,
  parseText,
} from '../src/model';

describe('外部输入校验', () => {
  it('剪贴板保留音乐内容，丢弃外部行标识和额外字段', () => {
    const rows = parseClipboard(
      JSON.stringify({
        format: 'metronome-rows-v1',
        rows: [
          { type: 'section', length: 2, meter: [3, 8], bpm: 90.5, id: 'injected', extra: true },
        ],
      }),
    );
    expect(rows).toEqual([{ type: 'section', length: 2, meter: [3, 8], bpm: 90.5 }]);
  });
  it.each([
    { type: 'section', length: -1, meter: [4, 4], bpm: 120 },
    { type: 'section', length: 1, meter: [33, 4], bpm: 120 },
    { type: 'section', length: 1, meter: [4, 4], bpm: '120' },
    { type: 'comment', text: 7 },
  ])('拒绝无效剪贴板参数 %j', (row) => {
    expect(() =>
      parseClipboard(JSON.stringify({ format: 'metronome-rows-v1', rows: [row] })),
    ).toThrow();
  });
  it('可读文本仍可以作为段落粘贴', () => {
    const song = parseText('1 4/4 120\n#注释\n3 3/8 90\n5');
    expect(parseClipboard(exportText(song))).toEqual(
      copyRows(song, new Set(song.rows.map((r) => r.id))),
    );
  });
  it('文本、JSON 和剪贴板统一拒绝超大输入', () => {
    const huge = ' '.repeat(MAX_IMPORT_BYTES + 1);
    for (const parse of [parseText, parseJson, parseClipboard])
      expect(() => parse(huge)).toThrow('2 MiB');
  });
  it('限制过多行，较长正常曲目仍可往返解析', () => {
    const text = Array.from({ length: 1000 }, (_, i) => `${i + 1} 4/4 120`).join('\n') + '\n1001';
    const song = parseText(text);
    expect(song.rows).toHaveLength(1000);
    expect(exportText(song).trim()).toBe(text);
    expect(() =>
      parseText(
        Array(MAX_ROWS + 1)
          .fill('#注释')
          .join('\n') + '\n1',
      ),
    ).toThrow('最多');
  });
});
