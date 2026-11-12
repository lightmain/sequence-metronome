import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/transport';
import { MusicPlayer } from '../src/musicPlayer';
import { MusicTimeline } from '../src/musicTimeline';
import { parseText, validate } from '../src/model';
import type { Song } from '../src/model';

const SHA = 'a'.repeat(64);
function attach(song: Song, start = 0) {
  song.version = 3;
  song.music = {
    audios: {
      [SHA]: {
        sha256: SHA,
        name: '录音.mp3',
        size: 1,
        type: 'audio/mpeg',
        lastModified: 1,
      },
    },
    alignments: {
      [SHA]: {
        bpm: 120,
        start,
        countin: 0,
        countin_bpm: 120,
        countin_time: '4/4',
      },
    },
    activeSha: SHA,
  };
  return validate(song);
}

class Source {
  buffer: unknown;
  playbackRate = { value: 1 };
  onended?: () => void;
  start = vi.fn();
  stop = vi.fn();
  disconnect = vi.fn();
  connect = vi.fn();
}
class Context {
  currentTime = 0;
  state = 'running';
  destination = {};
  outputLatency = 0;
  sources: Source[] = [];
  createGain() {
    return { gain: { value: 1, setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  }
  createBufferSource() {
    const source = new Source();
    this.sources.push(source);
    return source;
  }
}
let frame: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup() {
  const engine = new AudioEngine(),
    context = new Context();
  engine.context = context as unknown as AudioContext;
  engine.buffer = { duration: 0.05 } as AudioBuffer;
  vi.spyOn(engine, 'init').mockResolvedValue();
  const player = new MusicPlayer(engine);
  const buffer = { duration: 1 } as AudioBuffer;
  const timeline = new MusicTimeline(attach(parseText('1 4/4 120\n3')), 1);
  return { engine, context, player, buffer, timeline };
}
function advance(context: Context, seconds: number) {
  for (let i = 0; i < seconds * 100; i++) {
    context.currentTime += 0.01;
    vi.advanceTimersByTime(10);
    frame();
  }
}
describe('音乐播放时钟和声音生命周期', () => {
  it('暂停取消音乐和提前安排的节拍，继续沿用听到的位置', async () => {
    const { player, context, buffer, timeline } = setup();
    await player.play(buffer, timeline);
    expect(context.sources[0].start).toHaveBeenCalledWith(0.07, 0);
    advance(context, 0.3);
    player.pause();
    const paused = player.state.time;
    expect(paused).toBeCloseTo(0.23, 8);
    expect(context.sources.every((s) => s.stop.mock.calls.length > 0)).toBe(true);
    context.currentTime += 3;
    expect(player.audibleTime()).toBe(paused);
    await player.resume();
    expect(
      context.sources.findLast((s) => s.buffer === buffer)!.start.mock.calls[0][1],
    ).toBeCloseTo(paused, 8);
    player.stop();
  });
  it('跳到原音频末尾以后只调度剩余节拍，旧来源全部取消', async () => {
    const { player, context, buffer, timeline } = setup();
    await player.play(buffer, timeline);
    const old = [...context.sources];
    await player.seek(2);
    expect(old.every((s) => s.stop.mock.calls.length > 0)).toBe(true);
    expect(context.sources.filter((s) => s.buffer === buffer)).toHaveLength(1);
    expect(player.state.position).toMatchObject({ bar: 2, beat: 0 });
    player.stop();
  });
  it('列表先结束时原音频继续，清除高亮并停止节拍', async () => {
    const { player, context, buffer } = setup();
    const timeline = new MusicTimeline(attach(parseText('1 1/4 120\n2')), 2);
    await player.play({ ...buffer, duration: 2 } as AudioBuffer, timeline);
    advance(context, 0.8);
    expect(player.state.phase).toBe('playing');
    expect(player.state.position).toBeNull();
    expect(context.sources).toHaveLength(2);
    advance(context, 1.3);
    expect(player.state.phase).toBe('stopped');
  });
  it('取消正在加载的播放后，迟到的初始化不能安排声音或报告错误', async () => {
    const { player, engine, context, buffer, timeline } = setup();
    let resolve!: () => void;
    vi.mocked(engine.init).mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    player.onError = vi.fn();
    const pending = player.play(buffer, timeline);
    player.stop();
    resolve();
    await pending;
    expect(context.sources).toHaveLength(0);
    expect(player.onError).not.toHaveBeenCalled();
    expect(player.state.phase).toBe('stopped');
  });
  it('试听各拍音效一致，跳转和继续保留试听场景', async () => {
    const { player, context, buffer, timeline } = setup();
    await player.play(
      buffer,
      {
        ...timeline,
        duration: 4,
        audioStart: 0,
        positionAt: (t) => timeline.positionAt(t),
        beatsBetween: (a, b) => timeline.beatsBetween(a, b),
        uniform: true,
      },
      0,
      'alignment',
    );
    advance(context, 0.8);
    expect(
      context.sources.filter((s) => s.buffer !== buffer).every((s) => s.playbackRate.value === 1),
    ).toBe(true);
    await player.seek(1);
    player.pause();
    await player.resume();
    expect(player.purpose).toBe('alignment');
    player.stop();
  });
  it('调度中断会停止全部声音并报告错误', async () => {
    const { player, context, buffer, timeline } = setup();
    player.onError = vi.fn();
    await player.play(buffer, timeline);
    context.currentTime += 1;
    vi.advanceTimersByTime(15);
    expect(player.state.phase).toBe('stopped');
    expect(player.onError).toHaveBeenCalledWith(expect.stringContaining('中断'));
    expect(context.sources.every((s) => s.stop.mock.calls.length > 0)).toBe(true);
  });
});
