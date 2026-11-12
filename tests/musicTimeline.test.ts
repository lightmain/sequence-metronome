import { describe, expect, it } from 'vitest';
import { parseText, validate } from '../src/model';
import type { CountIn, Song } from '../src/model';
import { MusicTimeline } from '../src/musicTimeline';

const A = 'a'.repeat(64);
const audio = {
  sha256: A,
  name: '录音.mp3',
  size: 5000,
  type: 'audio/mpeg',
  lastModified: 1,
};
function attach(song: Song, start = 1000, countIn?: CountIn) {
  song.version = 3;
  song.music = {
    audios: { [A]: audio },
    alignments: {
      [A]: {
        bpm: 120,
        start,
        countin: countIn?.bars ?? 0,
        countin_bpm: countIn?.bpm ?? 120,
        countin_time: countIn ? `${countIn.meter[0]}/${countIn.meter[1]}` : '4/4',
      },
    },
    activeSha: A,
    ...(countIn ? { countIn } : {}),
  };
  return validate(song);
}
const aligned = () => attach(parseText('1 4/4 120\n3 3/8 60\n5'));

describe('音频播放与合成的共同时间计算', () => {
  it('未对齐时仅有原音频，不产生节拍或高亮', () => {
    const timeline = new MusicTimeline(parseText('1 4/4 120\n3'), 8);
    expect(timeline.duration).toBe(8);
    expect(timeline.audioStart).toBe(0);
    expect(timeline.positionAt(1)).toBeNull();
    expect([...timeline.beatsBetween(0, 8)]).toEqual([]);
  });
  it('无预备拍不增加前置时间，段落各自使用拍号和 BPM', () => {
    const song = aligned();
    song.music!.alignments[A]!.bpm = 333;
    const timeline = new MusicTimeline(song, 20);
    expect(timeline.shift).toBe(0);
    expect(timeline.firstBeat).toBe(1);
    expect(timeline.formalEnd).toBe(8);
    expect(timeline.duration).toBe(20);
    expect(timeline.positionAt(0.99)).toBeNull();
    expect(timeline.positionAt(1)).toMatchObject({ bar: 1, beat: 0, bpm: 120 });
    expect(timeline.positionAt(4.99)).toMatchObject({ bar: 2, beat: 3 });
    expect(timeline.positionAt(5)).toMatchObject({
      bar: 3,
      localBar: 1,
      beat: 0,
      meter: [3, 8],
      bpm: 60,
    });
    expect(timeline.positionAt(8)).toBeNull();
    expect([...timeline.beatsBetween(7, 20)].map((e) => e.time)).toEqual([7, 7.5]);
  });
  it('音频先结束，完整范围继续覆盖剩余节拍', () => {
    const timeline = new MusicTimeline(aligned(), 2);
    expect(timeline.audioEnd).toBe(2);
    expect(timeline.duration).toBe(8);
    expect(timeline.positionAt(7.5)?.bar).toBe(4);
  });
  it('预备两小节时前补 3.5 秒，保留原音频全部范围且不累计偏移', () => {
    const countIn = { bars: 2, meter: [4, 4] as [number, number], bpm: 120 };
    const song = attach(parseText('1 4/4 120\n3 3/8 60\n5'), 1000, countIn);
    const before = structuredClone(song);
    for (let i = 0; i < 3; i++) {
      const timeline = new MusicTimeline(song, 20);
      expect(timeline.shift).toBe(3.5);
      expect(timeline.preparationStart).toBe(0.5);
      expect(timeline.firstBeat).toBe(4.5);
      expect(timeline.audioEnd).toBe(23.5);
      expect(timeline.duration).toBe(23.5);
      expect(timeline.positionAt(0)).toBeNull();
      expect(timeline.positionAt(0.5)).toMatchObject({ phase: 'countdown', remaining: 2 });
      expect(timeline.positionAt(4.5)).toMatchObject({ phase: 'playing', bar: 1 });
      expect([...timeline.beatsBetween(0, 4.5)]).toHaveLength(8);
    }
    expect(song).toEqual(before);
  });
  it('足够长的前奏不需前补，预备节拍可与前奏重叠', () => {
    const song = attach(parseText('1 4/4 120\n3 3/8 60\n5'), 5000, {
      bars: 1,
      meter: [4, 4],
      bpm: 120,
    });
    const timeline = new MusicTimeline(song, 20);
    expect(timeline.shift).toBe(0);
    expect(timeline.preparationStart).toBe(3);
    expect(timeline.audioStart).toBe(0);
  });
  it('跳转窗口包含起点、不包含终点，跨段落无重复或漏拍', () => {
    const timeline = new MusicTimeline(aligned(), 20);
    expect([...timeline.beatsBetween(4.5, 5)].map((e) => e.time)).toEqual([4.5]);
    expect([...timeline.beatsBetween(5, 6)].map((e) => e.time)).toEqual([5, 5.5]);
    expect([...timeline.beatsBetween(5.01, 6)].map((e) => e.time)).toEqual([5.5]);
    expect([...timeline.beatsBetween(5, 5)]).toHaveLength(0);
    expect([...timeline.beatsBetween(5 + 1e-10, 6)].map((e) => e.time)).toEqual([5.5]);
  });
  it('默认预备参数继承第一演奏段；0 小节没有固定 0.5 秒间隙', () => {
    const song = attach(parseText('1 7/8 80\n2'), 0);
    const timeline = new MusicTimeline(song, 1);
    expect(timeline.countIn).toEqual({ bars: 0, meter: [7, 8], bpm: 80 });
    expect([...timeline.beatsBetween(0, 1)][0].time).toBe(0);
    expect(timeline.shift).toBe(0);
  });
  it('空列表仍保留原音频，过大曲目只存段落无需生成全部拍', () => {
    const empty = attach(parseText('1'), 0);
    expect(new MusicTimeline(empty, 2).duration).toBe(2);
    const large = attach(parseText('1 4/4 120\n1000000000'), 0);
    const timeline = new MusicTimeline(large, 1);
    expect([...timeline.beatsBetween(100, 101)]).toHaveLength(2);
  });
  it('拒绝无效时长与跳转参数', () => {
    for (const value of [-1, Infinity, NaN])
      expect(() => new MusicTimeline(aligned(), value)).toThrow();
    const timeline = new MusicTimeline(aligned(), 2);
    expect(() => timeline.positionAt(NaN)).toThrow();
    expect(() => [...timeline.beatsBetween(2, 1)]).toThrow();
  });
});
