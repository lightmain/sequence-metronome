import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseText } from '../src/model';
import { AudioEngine } from '../src/transport';
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
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  decodeAudioData = vi.fn(async () => ({}));
  createGain() {
    return { gain: { value: 1, setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  }
  createBufferSource() {
    const source = new Source();
    this.sources.push(source);
    return source;
  }
}
beforeEach(() => {
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })),
  );
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const sample = () => parseText('1 4/4 400\n2 2/4 120\n3');
describe('音频事件安排与取消', () => {
  it('极短小节进入倒计时后也不能再次改变进入时机', async () => {
    const engine = new AudioEngine();
    await engine.start(parseText('1 1/32 400\n2'), 'count', 1);
    const context = engine.context as unknown as Context;
    context.currentTime = 0.04;
    engine.pump();
    expect(engine.timeline!.phase).toBe('stopped');
    engine.enter(1);
    expect(engine.lastPosition.phase).toBe('countdown');
    expect(engine.timeline!.enterAt).toBe(1);
    context.currentTime = 0.05;
    engine.pump();
    expect(engine.events.find((e) => e.phase === 'playing')?.time).toBeCloseTo(0.08875, 10);
    engine.stop();
  });
  it('预加载音效，首拍重音，停止时取消已安排声音', async () => {
    const engine = new AudioEngine();
    await engine.start(sample(), 'direct', 1);
    const context = engine.context as unknown as Context;
    context.currentTime = 0.02;
    engine.pump();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start).toHaveBeenCalledWith(0.07);
    expect(context.sources[0].playbackRate.value).toBe(1.35);
    engine.stop();
    expect(context.sources[0].stop).toHaveBeenCalled();
    expect(engine.events).toHaveLength(0);
  });
  it.each([0, 1, 2])('在提前安排的准备边界前确定进入指令（额外小节 %s）', async (extra) => {
    const engine = new AudioEngine();
    await engine.start(sample(), 'prepare', 2);
    const context = engine.context as unknown as Context;
    for (let t = 0.02; t <= 0.65; t += 0.01) {
      context.currentTime = t;
      engine.pump();
    }
    context.currentTime = 0.64;
    const oldFuture = context.sources.at(-1)!;
    engine.enter(extra);
    expect(oldFuture.stop).toHaveBeenCalled();
    for (let t = 0.65; t < 1.9; t += 0.01) {
      context.currentTime = t;
      engine.pump();
    }
    const formal = engine.events.find((e) => e.phase === 'playing')!;
    expect(formal.time).toBeCloseTo(0.67 + extra * 0.6, 10);
    expect(formal.bar).toBe(2);
    engine.stop();
  });
  it('完整倒计时小节升高音调，正式播放恢复原音调', async () => {
    const engine = new AudioEngine();
    await engine.start(sample(), 'count', 1);
    const context = engine.context as unknown as Context;
    for (let t = 0.02; t < 0.7; t += 0.01) {
      context.currentTime = t;
      engine.pump();
    }
    const first = context.sources[0];
    expect(first.playbackRate.value).toBeCloseTo(1.35 * 1.25);
    const formal = engine.scheduled.find((s) => s.event.phase === 'playing' && s.event.beat === 0)!;
    expect(formal.source.playbackRate.value).toBe(1.35);
    const time = engine.timeline!.enterAt;
    engine.enter(2);
    expect(engine.timeline!.enterAt).toBe(time);
    engine.stop();
  });
  it('音效加载期间停止，不会在加载完成后自行开始', async () => {
    let resume: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise((resolve) => {
          resume = () => resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
        }),
    );
    const engine = new AudioEngine();
    const starting = engine.start(sample(), 'direct', 1);
    await Promise.resolve();
    await Promise.resolve();
    engine.stop();
    resume!();
    await starting;
    expect(engine.timeline).toBeUndefined();
  });
  it('音频设备中断时停止并报告', async () => {
    const engine = new AudioEngine(),
      onError = vi.fn();
    engine.onError = onError;
    await engine.start(sample(), 'prepare', 1);
    (engine.context as unknown as Context).state = 'suspended';
    engine.pump();
    expect(engine.timeline).toBeUndefined();
    expect(onError).toHaveBeenCalled();
  });
  it('旧加载请求晚到的错误不影响已经开始的新播放', async () => {
    let rejectOld: (error: Error) => void = () => {};
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectOld = reject;
          }),
      )
      .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
    vi.stubGlobal('fetch', fetcher);
    const engine = new AudioEngine();
    const first = engine.start(sample(), 'prepare', 1);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const second = engine.start(sample(), 'direct', 2);
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    rejectOld(Error('旧请求失败'));
    await Promise.resolve();
    expect(engine.timeline!.startBar).toBe(2);
    expect(engine.lastPosition.phase).toBe('playing');
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    engine.stop();
  });
  it('启动超时能报告错误，取消不会等待永不返回的加载请求', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const engine = new AudioEngine();
    const timed = expect(engine.start(sample(), 'direct', 1)).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(10_000);
    await timed;
    const starting = engine.start(sample(), 'direct', 1);
    engine.stop();
    expect(await starting).toBe(false);
  });
  it('反复播放停止释放节点与定时器，销毁时关闭音频上下文', async () => {
    vi.useFakeTimers();
    const engine = new AudioEngine();
    for (let i = 0; i < 50; i++) {
      await engine.start(sample(), 'direct', 1);
      const context = engine.context as unknown as Context;
      context.currentTime += 0.02;
      engine.pump();
      engine.stop();
      expect(engine.scheduled).toHaveLength(0);
      expect(engine.events).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    }
    const context = engine.context as unknown as Context;
    engine.dispose();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(engine.context).toBeUndefined();
  });
});
