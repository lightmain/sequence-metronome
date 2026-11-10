import { describe, expect, it } from 'vitest';
import {
  applyText,
  exportText,
  fingerprint,
  insertRows,
  parseJson,
  parseText,
  validate,
} from '../src/model';
import type { Song } from '../src/model';
import { commit, dirty, redo, undo } from '../src/storage';
import type { Tab } from '../src/storage';
import { loadWorkspace, persistWorkspace } from '../src/persistence';

function musicSong(): Song {
  const song = parseText('Aligned 133.123456789\n1 4/4 120\n3');
  song.music = {
    audio: {
      id: 'original-audio',
      name: '录音.mp3',
      size: 5000,
      type: 'audio/mpeg',
      lastModified: 1,
    },
    alignment: { firstBeatMs: 133.123456789, referenceBpm: 119.8 },
    countIn: { bars: 2, meter: [3, 4], bpm: 90 },
    volume: 0.7,
  };
  return song;
}

describe('V4 曲目格式、文本编辑和保存', () => {
  it('旧文件保持原格式和内容比较结果，JSON 无需强制迁移', () => {
    const song = parseText('1 4/4 120\n2');
    expect(song.version).toBe(1);
    expect(song.music).toBeUndefined();
    expect(parseJson(JSON.stringify(song))).toEqual(song);
    expect(JSON.parse(fingerprint(song)).version).toBe(1);
    expect(exportText(song)).toBe('1 4/4 120\n2\n');
  });
  it.each([133.123456789, 0, -23.5, 1e-7, 1e21])(
    'TXT 保留首拍精度 %s，不猜测参考 BPM',
    (offset) => {
      const song = musicSong();
      song.music!.alignment!.firstBeatMs = offset;
      const text = exportText(song);
      expect(text.startsWith(`Aligned ${offset}\n`)).toBe(true);
      const parsed = parseText(text);
      expect(parsed.music).toEqual({ alignment: { firstBeatMs: offset } });
      expect(parsed.version).toBe(2);
    },
  );
  it.each([
    ['Aligned NaN\n1', 1],
    ['Aligned Infinity\n1', 1],
    ['Aligned 1e999\n1', 1],
    ['Aligned\n1', 1],
    ['Aligned 1 ms\n1', 1],
    ['Aligned 1\nAligned 2\n1', 2],
    ['1 4/4 120\nAligned 1\n2', 2],
    ['#注释\nAligned 1\n1', 2],
    ['aligned 1\n1', 1],
  ])('无效或重复声明定位原始行：%s', (text, line) => {
    expect(() => parseText(text as string)).toThrow(`第 ${line} 行`);
  });
  it('页面确认相同文本不丢音频关联、参考 BPM 和预备设置，也不新增撤销', () => {
    const song = musicSong();
    const tab: Tab = { id: 'a', song, saved: fingerprint(song), past: [], future: [] };
    expect(commit(tab, applyText(song, exportText(song)))).toBe(tab);
    const changed = applyText(song, exportText(song).replace('4/4 120', '3/8 90'));
    expect(changed.music).toEqual(song.music);
    expect(changed.rows[0]).toMatchObject({ meter: [3, 8], bpm: 90 });
    const removed = applyText(song, '1 4/4 120\n3');
    expect(removed.music?.alignment).toBeUndefined();
    expect(removed.music?.audio).toEqual(song.music?.audio);
    expect(applyText(song, 'Aligned 200\n1 4/4 120\n3').music?.alignment).toEqual({
      firstBeatMs: 200,
      referenceBpm: 119.8,
    });
  });
  it('JSON 保留全部参数且没有音频文件内容，段落编辑保留对齐', () => {
    const song = musicSong();
    expect(parseJson(JSON.stringify(song))).toEqual(song);
    expect(insertRows(song, 0).music).toEqual(song.music);
  });
  it('音乐参数参与星号、撤销、重做、保存及刷新恢复', () => {
    const song = musicSong();
    const tab: Tab = { id: 'a', song, saved: fingerprint(song), past: [], future: [] };
    const changed = commit(tab, { ...song, music: { ...song.music, volume: 0.3 } });
    expect(dirty(changed)).toBe(true);
    expect(dirty(undo(changed))).toBe(false);
    expect(redo(undo(changed)).song.music?.volume).toBe(0.3);
    let raw = '';
    const storage = {
      getItem: () => raw,
      setItem: (_key: string, value: string) => {
        raw = value;
      },
    };
    persistWorkspace(storage, [changed], 'a', 'a');
    const restored = loadWorkspace(storage)!.tabs[0];
    expect(restored.song).toEqual(changed.song);
    expect(dirty(restored)).toBe(false);
    const reordered = JSON.parse(JSON.stringify(restored.song));
    reordered.music.alignment = { referenceBpm: 119.8, firstBeatMs: 133.123456789 };
    expect(fingerprint(reordered)).toBe(fingerprint(restored.song));
  });
  it('音乐参数变化也受多网页冲突检查保护，失败保留草稿', () => {
    const song = musicSong();
    const tab: Tab = { id: 'a', song, saved: fingerprint(song), past: [], future: [] };
    let raw = '';
    const storage = {
      getItem: () => raw,
      setItem: (_key: string, value: string) => {
        raw = value;
      },
    };
    persistWorkspace(storage, [tab], 'a', 'a');
    const changed = commit(tab, { ...song, music: { ...song.music, volume: 0.3 } });
    persistWorkspace(storage, [changed], 'a', 'a');
    const stale = commit(tab, { ...song, music: { ...song.music, volume: 0.2 } });
    expect(() => persistWorkspace(storage, [stale], 'a', 'a')).toThrow('另一个网页');
    expect(dirty(stale)).toBe(true);
  });
  it.each([
    { alignment: { firstBeatMs: null } },
    { alignment: { firstBeatMs: 1, referenceBpm: 0 } },
    { countIn: { bars: -1, meter: [4, 4], bpm: 120 } },
    { countIn: { bars: 1.5, meter: [4, 4], bpm: 120 } },
    { countIn: { bars: 1, meter: [4, 3], bpm: 120 } },
    { countIn: { bars: 1, meter: [4, 4], bpm: 0 } },
    { audio: { id: 'x', name: 'a.mp3', size: 0, type: 'audio/mpeg', lastModified: 1 } },
    { volume: 2 },
    { volume: '0.5' },
    null,
    [],
  ])('拒绝损坏的音乐参数 %j', (music) => {
    expect(() => parseJson(JSON.stringify({ ...musicSong(), music }))).toThrow();
  });
  it('旧版本携带新字段明确报错，避免旧应用忽略音乐参数', () => {
    expect(() => validate({ ...musicSong(), version: 1 })).toThrow('version 2');
  });
  it('尚无音乐参数的新版曲目确认相同文本也保留版本，不产生星号', () => {
    const song: Song = { ...parseText('1 4/4 120\n2'), version: 2 };
    const tab: Tab = { id: 'a', song, saved: fingerprint(song), past: [], future: [] };
    expect(commit(tab, applyText(song, exportText(song)))).toBe(tab);
  });
});
