import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseText } from '../src/model';
import { AudioEngine } from '../src/transport';
class Source {
  buffer: unknown;
  playbackRate = { value: 1 };
  onended?: () => void;
  start = vi.fn(); stop = vi.fn(); disconnect = vi.fn(); connect = vi.fn();
}
class Context {
  currentTime = 0; state = 'running'; destination = {}; outputLatency = 0;
  sources: Source[] = [];
  resume = vi.fn(async () => {});
  decodeAudioData = vi.fn(async () => ({}));
  createGain() { return { gain: { value: 1, setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }; }
  createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
}
beforeEach(() => {
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok:true, arrayBuffer: async () => new ArrayBuffer(1) })));
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); });
const sample = () => parseText('1 4/4 400\n2 2/4 120\n3');
describe('音频事件安排与取消', () => {
  it('预加载音效，首拍重音，停止时取消已安排声音', async () => {
    const engine = new AudioEngine(); await engine.start(sample(),'direct',1);
    const context = engine.context as unknown as Context;
    context.currentTime=.02; engine.pump();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start).toHaveBeenCalledWith(.07);
    expect(context.sources[0].playbackRate.value).toBe(1.35);
    engine.stop(); expect(context.sources[0].stop).toHaveBeenCalled(); expect(engine.events).toHaveLength(0);
  });
  it.each([0,1])('在提前安排的准备边界前修改进入指令（额外小节 %s）', async extra => {
    const engine = new AudioEngine(); await engine.start(sample(),'prepare',2);
    const context=engine.context as unknown as Context;
    for(let t=.02;t<=.65;t+=.01) { context.currentTime=t; engine.pump(); }
    context.currentTime=.64;
    const oldFuture=context.sources.at(-1)!;
    engine.enter(extra);
    expect(oldFuture.stop).toHaveBeenCalled();
    for(let t=.65;t<1.3;t+=.01) { context.currentTime=t; engine.pump(); }
    const formal=engine.events.find(e=>e.phase==='playing')!;
    expect(formal.time).toBeCloseTo(extra ? 1.27 : .67,10);
    expect(formal.bar).toBe(2); engine.stop();
  });
  it('音效加载期间停止，不会在加载完成后自行开始', async () => {
    let resume: (()=>void) | undefined;
    vi.stubGlobal('fetch', () => new Promise(resolve => { resume=()=>resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}); }));
    const engine=new AudioEngine(); const starting=engine.start(sample(),'direct',1);
    await Promise.resolve(); await Promise.resolve();
    engine.stop(); resume!(); await starting; expect(engine.timeline).toBeUndefined();
  });
  it('音频设备中断时停止并报告', async () => {
    const engine=new AudioEngine(), onError=vi.fn(); engine.onError=onError;
    await engine.start(sample(),'prepare',1);
    (engine.context as unknown as Context).state='suspended'; engine.pump();
    expect(engine.timeline).toBeUndefined(); expect(onError).toHaveBeenCalled();
  });
});
