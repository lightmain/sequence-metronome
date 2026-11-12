import { beatSeconds, sections } from './model';
import type { Meter, Section, Song } from './model';
import { audibleContextTime } from './audioTime';
export type Phase = 'stopped' | 'prepare' | 'countdown' | 'playing' | 'simple';
export type Position = {
  phase: Phase;
  bar: number;
  localBar: number;
  beat: number;
  meter: Meter;
  bpm: number;
  sectionId?: string;
  remaining?: number;
  fullCountIn?: boolean;
  prepBar?: number;
};
export type BeatEvent = Position & { time: number };
export const stopped: Position = {
  phase: 'stopped',
  bar: 1,
  localBar: 1,
  beat: 0,
  meter: [4, 4],
  bpm: 120,
};

// 只负责音乐状态与时间计算，不依赖浏览器；音频和显示共用生成的事件。
export class Timeline {
  song: Song;
  list: Section[];
  phase: Phase;
  bar: number;
  beat = 0;
  prepBar = 0;
  enterAt: number | null = null;
  fullPrepFrom = Infinity;
  nextTime: number;
  meter: Meter;
  bpm: number;
  pendingMeter?: Meter;
  constructor(
    song: Song,
    mode: 'direct' | 'prepare' | 'count' | 'simple',
    public startBar: number,
    time: number,
  ) {
    this.song = song;
    this.list = sections(song);
    if (!this.list.length) throw Error('曲目中没有可播放段落。');
    if (!Number.isInteger(startBar) || startBar < 1 || startBar >= song.endExclusive)
      throw Error('开始小节超出曲目范围。');
    this.phase =
      mode === 'direct'
        ? 'playing'
        : mode === 'simple'
          ? 'simple'
          : mode === 'count'
            ? 'countdown'
            : 'prepare';
    this.bar = startBar;
    this.nextTime = time;
    this.meter = this.list[0].meter;
    this.bpm = this.list[0].bpm;
    if (mode === 'count') {
      this.enterAt = 1;
      this.fullPrepFrom = 0;
    }
  }
  sectionAt(bar: number) {
    return this.list.findLast((r) => r.start <= bar)!;
  }
  // 按用户当前听到的准备小节决定边界，避免提前调度造成按键时序偏移。
  requestEntry(extraBars: number, now: number, origin: number) {
    if (this.enterAt !== null) return false;
    const duration = this.list[0].meter[0] * beatSeconds(this.list[0].meter, this.list[0].bpm);
    const current = Math.max(0, Math.floor((now - origin) / duration));
    this.enterAt = current + 1 + extraBars;
    this.fullPrepFrom = current + 1;
    this.phase = 'countdown';
    return true;
  }
  take(): BeatEvent | null {
    if (this.phase === 'stopped') return null;
    if (
      this.phase === 'countdown' &&
      this.beat === 0 &&
      this.enterAt !== null &&
      this.prepBar >= this.enterAt
    )
      this.phase = 'playing';
    const section = this.phase === 'playing' ? this.sectionAt(this.bar) : this.list[0];
    if (this.phase === 'simple') {
      if (this.beat === 0 && this.pendingMeter) {
        this.meter = this.pendingMeter;
        this.pendingMeter = undefined;
      }
    } else {
      this.meter = section.meter;
      this.bpm = section.bpm;
    }
    const countdown = this.phase === 'countdown';
    const event: BeatEvent = {
      phase: this.phase,
      bar: countdown ? this.prepBar - this.enterAt! + 1 : this.bar,
      localBar: this.bar - section.start + 1,
      beat: this.beat,
      meter: [...this.meter],
      bpm: this.bpm,
      sectionId: this.phase === 'playing' ? section.id : undefined,
      time: this.nextTime,
      remaining: countdown ? this.enterAt! - this.prepBar : undefined,
      fullCountIn: countdown && this.prepBar >= this.fullPrepFrom,
      prepBar: this.prepBar,
    };
    this.nextTime += beatSeconds(this.meter, this.bpm);
    this.beat++;
    if (this.beat >= this.meter[0]) {
      this.beat = 0;
      if (this.phase === 'playing') {
        this.bar++;
        if (this.bar >= this.song.endExclusive) this.phase = 'stopped';
      } else if (this.phase === 'simple') this.bar++;
      else this.prepBar++;
    }
    return event;
  }
}

type Scheduled = { source: AudioBufferSourceNode; event: BeatEvent };
export class AudioEngine {
  context?: AudioContext;
  buffer?: AudioBuffer;
  gain?: GainNode;
  timeline?: Timeline;
  origin = 0;
  timer?: ReturnType<typeof setInterval>;
  frame = 0;
  scheduled: Scheduled[] = [];
  events: BeatEvent[] = [];
  volume = 0.65;
  lastPosition: Position = { ...stopped };
  token = 0;
  private pending?: AbortController;
  onPosition: (position: Position) => void = () => {};
  onError: (message: string) => void = () => {};
  async init(signal?: AbortSignal) {
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.gain = undefined;
    }
    await this.context.resume();
    if (this.context.state !== 'running') throw Error('浏览器未启用音频，请点击播放按钮重试。');
    if (!this.gain) {
      this.gain = this.context.createGain();
      this.gain.connect(this.context.destination);
    }
    this.setVolume(this.volume);
    if (!this.buffer) {
      const response = await fetch(`${import.meta.env.BASE_URL}sounds/click.wav`, { signal });
      if (!response.ok) throw Error('节拍音效加载失败，请检查 sounds/click.wav 文件。');
      const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      if (!signal?.aborted) this.buffer = buffer;
    }
  }
  setVolume(value: number) {
    this.volume = value;
    if (this.context && this.gain)
      this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.01);
  }
  async start(song: Song, mode: 'direct' | 'prepare' | 'count' | 'simple', start: number) {
    this.stop();
    const token = this.token;
    const pending = new AbortController();
    this.pending = pending;
    const timeout = setTimeout(
      () => pending.abort(new Error('音频启动超时，请检查网络或音频设备后重试。')),
      10_000,
    );
    try {
      await Promise.race([
        this.init(pending.signal),
        new Promise<never>((_resolve, reject) => {
          pending.signal.addEventListener('abort', () => reject(pending.signal.reason), {
            once: true,
          });
        }),
      ]);
    } catch (error) {
      if (token !== this.token) return false;
      this.stop();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (token !== this.token) return false;
    const context = this.context!;
    this.origin = context.currentTime + 0.07;
    this.timeline = new Timeline(song, mode, start, this.origin);
    this.onPosition(
      (this.lastPosition = {
        ...stopped,
        phase: this.timeline.phase,
        meter: this.timeline.meter,
        bpm: this.timeline.bpm,
        bar: mode === 'count' ? 0 : start,
        fullCountIn: mode === 'count',
      }),
    );
    this.pump();
    this.timer = setInterval(() => this.pump(), 15);
    this.animate();
    return true;
  }
  stop() {
    this.token++;
    this.pending?.abort();
    this.pending = undefined;
    clearInterval(this.timer);
    cancelAnimationFrame(this.frame);
    for (const item of this.scheduled) {
      try {
        item.source.stop();
      } catch {
        /* 已结束 */
      }
    }
    this.timeline = undefined;
    this.scheduled = [];
    this.events = [];
    this.onPosition((this.lastPosition = { ...stopped }));
  }
  dispose() {
    this.stop();
    this.gain?.disconnect();
    this.gain = undefined;
    const context = this.context;
    this.context = undefined;
    this.buffer = undefined;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
  enter(extra: number) {
    const timeline = this.timeline,
      context = this.context;
    // 提前调度可能已将内部时间线推进到曲尾；是否仍在准备以显示的播放位置判断。
    if (!timeline || !context || this.lastPosition.phase !== 'prepare' || timeline.enterAt !== null)
      return;
    // 以听到的状态为准；预排事件可能已经越过准备边界。
    const pending = this.scheduled.filter((s) => s.event.time > context.currentTime);
    if (pending.length) {
      const first = pending[0].event;
      for (const item of pending) {
        try {
          item.source.stop();
        } catch {
          /* 已结束 */
        }
      }
      timeline.prepBar = first.prepBar ?? 0;
      timeline.beat = first.beat;
      timeline.nextTime = first.time;
      timeline.bar = timeline.startBar;
      this.scheduled = this.scheduled.filter((s) => s.event.time <= context.currentTime);
      this.events = this.events.filter((e) => e.time <= context.currentTime);
    }
    timeline.requestEntry(extra, context.currentTime, this.origin);
    const duration =
      timeline.list[0].meter[0] * beatSeconds(timeline.list[0].meter, timeline.list[0].bpm);
    const currentPrep = Math.max(0, Math.floor((context.currentTime - this.origin) / duration));
    this.onPosition(
      (this.lastPosition = {
        ...this.lastPosition,
        phase: 'countdown',
        bar: currentPrep - timeline.enterAt! + 1,
        remaining: timeline.enterAt! - currentPrep,
        fullCountIn: false,
      }),
    );
    this.pump();
  }
  changeSimple(meter: Meter, bpm: number) {
    if (this.timeline?.phase === 'simple') {
      this.timeline.bpm = bpm;
      this.timeline.pendingMeter = meter;
    }
  }
  pump() {
    const context = this.context,
      timeline = this.timeline;
    if (!context || !timeline) return;
    if (context.state !== 'running') {
      this.stop();
      this.onError('音频被浏览器或设备中断，请重新开始播放。');
      return;
    }
    if (timeline.phase !== 'stopped' && timeline.nextTime < context.currentTime - 0.15) {
      this.stop();
      this.onError('页面运行被中断，已停止播放，请重新开始。');
      return;
    }
    while (timeline.phase !== 'stopped' && timeline.nextTime < context.currentTime + 0.065) {
      const event = timeline.take();
      if (!event) break;
      const source = context.createBufferSource(),
        accent = context.createGain();
      source.buffer = this.buffer!;
      source.playbackRate.value = (event.beat === 0 ? 1.35 : 1) * (event.fullCountIn ? 1.25 : 1);
      accent.gain.value = event.beat === 0 ? 1 : 0.6;
      source.connect(accent);
      accent.connect(this.gain!);
      source.start(event.time);
      source.onended = () => {
        source.disconnect();
        accent.disconnect();
        this.scheduled = this.scheduled.filter((s) => s.source !== source);
      };
      this.scheduled.push({ source, event });
      this.events.push(event);
    }
  }
  animate = () => {
    const context = this.context,
      timeline = this.timeline;
    if (!context || !timeline) return;
    const audibleTime = audibleContextTime(context);
    let latest: BeatEvent | undefined;
    while (this.events[0] && this.events[0].time <= audibleTime) latest = this.events.shift();
    if (latest) this.onPosition((this.lastPosition = latest));
    if (timeline.phase === 'stopped' && audibleTime >= timeline.nextTime) {
      this.stop();
      return;
    }
    this.frame = requestAnimationFrame(this.animate);
  };
}
