import { describe, expect, it } from 'vitest';
import {
  beatSeconds,
  clone,
  copyRows,
  exampleSong,
  exportText,
  insertRows,
  parseJson,
  parseText,
  removeRows,
  sections,
  validate,
} from '../src/model';
import type { ClipRow, Song } from '../src/model';
const starts = (s: Song) => sections(s).map((r) => r.start);
describe('段落编号规则', () => {
  it('在单小节之前插入，只递推到能吸收变化的段落', () => {
    const song = exampleSong(),
      next = insertRows(song, 2);
    expect(starts(next)).toEqual([1, 63, 64, 65]);
    expect(next.endExclusive).toBe(130);
    expect(starts(song)).toEqual([1, 63, 64]);
    expect(sections(next)[1].meter).toEqual([4, 4]);
  });
  it('开头插入继承后段设置，末尾插入延长一小节', () => {
    const song = exampleSong();
    sections(song)[0].bpm = 90;
    const next = insertRows(song, 0);
    expect(starts(next)).toEqual([1, 2, 63, 64]);
    expect(sections(next)[0].bpm).toBe(90);
    expect(next.endExclusive).toBe(130);
    const appended = insertRows(song, song.rows.length);
    expect(starts(appended)).toEqual([1, 63, 64, 130]);
    expect(appended.endExclusive).toBe(131);
  });
  it('递推穿过连续单小节且只在必要时延长曲尾', () => {
    const song = parseText('1 3/4 90\n2 2/4 100\n3 4/4 120\n4');
    const next = insertRows(song, 0);
    expect(starts(next)).toEqual([1, 2, 3, 4]);
    expect(next.endExclusive).toBe(5);
  });
  it('删除让后一段向前覆盖，不移动远处边界', () => {
    const song = exampleSong(),
      list = sections(song);
    const next = removeRows(song, new Set([list[1].id]));
    expect(starts(next)).toEqual([1, 63]);
    expect(next.endExclusive).toBe(130);
    expect(sections(next)[1].meter).toEqual([4, 4]);
    expect(starts(removeRows(song, new Set([list[0].id])))).toEqual([1, 64]);
  });
  it('连续、不连续多段删除和曲尾删除', () => {
    const song = parseText('1 4/4 120\n10 3/4 100\n20 2/4 90\n30 5/4 80\n40');
    const list = sections(song);
    expect(starts(removeRows(song, new Set([list[0].id, list[1].id])))).toEqual([1, 30]);
    expect(starts(removeRows(song, new Set([list[0].id, list[2].id])))).toEqual([1, 20]);
    expect(removeRows(song, new Set([list[3].id])).endExclusive).toBe(30);
  });
  it('转注释保留行位置且与删除具有相同的小节效果', () => {
    const song = exampleSong(),
      row = sections(song)[1];
    const next = removeRows(song, new Set([row.id]), true);
    expect(next.rows[2].type).toBe('comment');
    expect(starts(next)).toEqual([1, 63]);
    expect(next.endExclusive).toBe(130);
  });
  it('清空后可导出导入并重新插入默认第一段', () => {
    const song = exampleSong(),
      empty = removeRows(song, new Set(song.rows.map((r) => r.id)));
    expect(empty.endExclusive).toBe(1);
    expect(parseText(exportText(empty)).rows).toEqual([]);
    const next = insertRows(empty, 0);
    expect(starts(next)).toEqual([1]);
    expect(next.endExclusive).toBe(2);
    expect(sections(next)[0].meter).toEqual([4, 4]);
  });
  it('多段复制保留长度，粘贴局部推进并生成新标识', () => {
    const copied = parseText('1 3/8 87.5\n#注释\n3 5/4 100\n4');
    const clips = copyRows(copied, new Set(copied.rows.map((r) => r.id)));
    const target = exampleSong(),
      next = insertRows(target, 2, clips);
    expect(starts(next)).toEqual([1, 63, 65, 66, 67]);
    expect(next.endExclusive).toBe(130);
    expect(new Set(next.rows.map((r) => r.id)).size).toBe(next.rows.length);
    expect(next.rows[3].type).toBe('comment');
  });
  it('拒绝损坏的剪贴板参数', () => {
    expect(() =>
      insertRows(exampleSong(), 0, [{ type: 'section', length: -1, meter: [4, 4], bpm: 120 }]),
    ).toThrow();
    expect(() =>
      insertRows(exampleSong(), 0, [{ type: 'section', length: 1, meter: [0, 4], bpm: 120 }]),
    ).toThrow();
    expect(() =>
      insertRows(exampleSong(), 0, [{ type: 'garbage' }] as unknown as ClipRow[]),
    ).toThrow();
  });
  it('小节范围边界不允许重叠', () => {
    const song = exampleSong();
    sections(song)[1].start = 64;
    expect(() => validate(song)).toThrow();
  });
});
describe('格式与音乐时值', () => {
  it('四分音符 BPM 正确换算八分及二分音符', () => {
    expect(beatSeconds([8, 8], 120)).toBe(0.25);
    expect(beatSeconds([4, 4], 120)).toBe(0.5);
    expect(beatSeconds([2, 2], 120)).toBe(1);
  });
  it('文本支持 BOM、CRLF、空白、注释、小数与往返', () => {
    const input =
      '\uFEFF#开头\r\n1\t4/4 120.5\r\n\r\n#段落注释\r\n63 2/4 120\r\n64 4/4 120\r\n130\r\n#结尾';
    const parsed = parseText(input);
    expect(starts(parsed)).toEqual([1, 63, 64]);
    expect(parsed.rows.at(-1)?.type).toBe('comment');
    expect(exportText(parseText(exportText(parsed)))).toBe(exportText(parsed));
    expect(parseJson(JSON.stringify(parsed))).toEqual(parsed);
  });
  it.each([
    '2 4/4 120\n3',
    '1 4/4 19\n2',
    '1 4/3 120\n2',
    '1 33/4 120\n2',
    '1 4/4 120',
    '1 4/4 120\n1',
    '1 4/4 120\n2\n3',
    '1 4/4 120\n2\n3 4/4 120',
    '1-4/4-120\n2',
  ])('错误文本给出解析失败：%s', (text) => expect(() => parseText(text)).toThrow());
  it('报错给出准确行号且不修改原对象', () => {
    const song = exampleSong(),
      original = clone(song);
    expect(() => parseText('1 4/4 120\n#注释\n坏行\n130')).toThrow('第 3 行');
    expect(song).toEqual(original);
  });
  it('JSON 校验类型、版本和重复行标识', () => {
    expect(() => parseJson('{bad')).toThrow('JSON');
    expect(() => parseJson('null')).toThrow();
    const song = exampleSong();
    song.rows[1].id = song.rows[0].id;
    expect(() => parseJson(JSON.stringify(song))).toThrow('重复');
    expect(() => parseJson('{"version":2}')).toThrow();
  });
});
