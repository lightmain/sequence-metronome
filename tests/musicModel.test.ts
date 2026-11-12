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
import type { Alignment, AudioReference, Song } from '../src/model';
import { commit } from '../src/storage';
import type { Tab } from '../src/storage';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const audio = (sha256: string, name = '录音.mp3'): AudioReference => ({
  sha256,
  name,
  size: 5000,
  type: 'audio/mpeg',
  lastModified: 1,
});

const alignment = (overrides: Partial<Alignment> = {}): Alignment => ({
  bpm: 120,
  start: 250,
  countin: 2,
  countin_bpm: 120,
  countin_time: '4/4',
  ...overrides,
});

function musicSong(): Song {
  const song = parseText('1 4/4 120\n3');
  song.version = 3;
  song.music = {
    audios: { [A]: audio(A) },
    alignments: { [A]: alignment() },
    activeSha: A,
    countIn: { bars: 2, meter: [4, 4], bpm: 120 },
    volume: 0.7,
  };
  return validate(song);
}

const line = (sha: string, a: Alignment) =>
  `Alignment:{SHA:${sha}, bpm:${a.bpm}, start:${a.start}, countin:${a.countin}, countin_bpm:${a.countin_bpm}, countin_time:${a.countin_time}}`;

describe('V5 音频哈希与对齐映射格式', () => {
  it('无音乐参数的曲目仍使用 version 1 并保持文本格式', () => {
    const song = parseText('1 4/4 120\n2');
    expect(song.version).toBe(1);
    expect(song.music).toBeUndefined();
    expect(parseJson(JSON.stringify(song))).toEqual(song);
    expect(exportText(song)).toBe('1 4/4 120\n2\n');
  });
  it('TXT 按 SHA 排序并完整往返六个字段', () => {
    const song = musicSong();
    song.music!.alignments[B] = alignment({
      bpm: 98.5,
      start: -12.5,
      countin: 0,
      countin_bpm: 98.5,
      countin_time: '6/8',
    });
    const text = exportText(song);
    expect(text.split('\n').slice(0, 2)).toEqual([
      line(A, alignment()),
      line(
        B,
        alignment({ bpm: 98.5, start: -12.5, countin: 0, countin_bpm: 98.5, countin_time: '6/8' }),
      ),
    ]);
    const parsed = parseText(text);
    expect(parsed.version).toBe(3);
    expect(parsed.music?.alignments).toEqual(song.music?.alignments);
    expect(parsed.music?.audios).toEqual({});
    expect(parsed.music?.countIn).toBeUndefined();
  });
  it('TXT 逗号后的空格可有可无', () => {
    const compact = `Alignment:{SHA:${A},bpm:120,start:250,countin:2,countin_bpm:120,countin_time:4/4}\n1`;
    expect(parseText(compact).music?.alignments[A]).toEqual(alignment());
  });
  it.each([
    [
      `Alignment:{SHA:${A}, bpm:120, start:250, countin:2, countin_bpm:120}\n1`,
      '缺少 countin_time',
    ],
    [
      `Alignment:{SHA:${A}, bpm:120, start:250, countin:2, countin_bpm:120, countin_time:4/4, extra:1}\n1`,
      '未知字段',
    ],
    [
      `Alignment:{SHA:${A.slice(1)}, bpm:120, start:250, countin:2, countin_bpm:120, countin_time:4/4}\n1`,
      '64 位',
    ],
    [
      `Alignment:{SHA:${A}, bpm:0, start:250, countin:2, countin_bpm:120, countin_time:4/4}\n1`,
      '须为正数',
    ],
    [
      `Alignment:{SHA:${A}, bpm:120, start:250, countin:2, countin_bpm:120, countin_time:4/3}\n1`,
      '分母',
    ],
    [
      `Alignment:{SHA:${A}, bpm:120, start:250, countin:2, countin_bpm:120, countin_time:4/4}\n${line(A, alignment())}\n1`,
      '重复',
    ],
    ['Aligned 250\n1', '不再支持'],
    [`1 4/4 120\n${line(A, alignment())}\n2`, '文本开头'],
  ])('拒绝无效或错位的对齐声明：%s', (text, message) => {
    expect(() => parseText(text)).toThrow(message);
  });
  it('页面文本编辑保留音频集合、预备设置和音量，只替换对齐映射', () => {
    const song = musicSong();
    const unchanged: Tab = {
      id: 'a',
      song,
      saved: fingerprint(song),
      past: [],
      future: [],
    };
    expect(commit(unchanged, applyText(song, exportText(song)))).toBe(unchanged);
    const replaced = applyText(song, `${line(B, alignment({ bpm: 90 }))}\n1 3/4 90\n3`);
    expect(replaced.music?.audios).toEqual(song.music?.audios);
    expect(replaced.music?.activeSha).toBe(A);
    expect(replaced.music?.countIn).toEqual(song.music?.countIn);
    expect(replaced.music?.volume).toBe(0.7);
    expect(replaced.music?.alignments).toEqual({ [B]: alignment({ bpm: 90 }) });
    expect(applyText(song, '1 4/4 120\n3').music?.alignments).toEqual({});
  });
  it('JSON 保留音频元数据、对齐映射和当前音频', () => {
    const song = musicSong();
    expect(parseJson(JSON.stringify(song))).toEqual(song);
    expect(insertRows(song, 0).music).toEqual(song.music);
    const ordered = musicSong();
    ordered.music!.audios[B] = audio(B, '另一份.mp3');
    ordered.music!.alignments[B] = alignment({ bpm: 90 });
    const reordered = JSON.parse(JSON.stringify(ordered));
    reordered.music.audios = { [B]: audio(B, '另一份.mp3'), [A]: audio(A) };
    reordered.music.alignments = {
      [B]: alignment({ bpm: 90 }),
      [A]: { ...alignment() },
    };
    expect(fingerprint(reordered)).toBe(fingerprint(ordered));
  });
  it.each([
    { version: 2, music: undefined },
    { music: { audios: {}, alignments: { [A]: alignment({ countin_time: '4/3' }) } } },
    { music: { audios: {}, alignments: { [A]: alignment({ countin: -1 }) } } },
    { music: { audios: {}, alignments: {}, activeSha: A } },
    { music: { audios: { [A]: { ...audio(A), sha256: B } }, alignments: {} } },
    {
      music: {
        audios: {},
        alignments: {
          [A]: { bpm: 120, start: 250, countin: 2, countin_bpm: 120 },
        },
      },
    },
  ])('拒绝损坏的 V5 音乐参数 %j', (music) => {
    expect(() => parseJson(JSON.stringify({ ...musicSong(), ...music }))).toThrow();
  });
  it('version 1 不能携带音乐参数', () => {
    expect(() => validate({ ...musicSong(), version: 1 })).toThrow('version 3');
  });
});
