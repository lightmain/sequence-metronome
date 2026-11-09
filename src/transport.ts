import { beatSeconds, sections } from './model';
import type { Meter, Section, Song } from './model';
export type Phase = 'stopped' | 'prepare' | 'waiting' | 'playing' | 'simple';
export type Position = { phase: Phase; bar: number; localBar: number; beat: number; meter: Meter; bpm: number; sectionId?: string; remaining?: number };
export type BeatEvent = Position & { time: number };
export const stopped: Position = { phase: 'stopped', bar: 1, localBar: 1, beat: 0, meter: [4, 4], bpm: 120 };

// 只负责音乐状态与时间计算，不依赖浏览器；音频和显示共用生成的事件。
export class Timeline {
  song: Song;
  list: Section[];
  phase: Phase;
  bar: number;
  beat = 0;
  prepBar = 0;
  enterAt: number | null = null;
  nextTime: number;
  meter: Meter;
  bpm: number;
  pendingMeter?: Meter;
  constructor(song: Song, mode: 'direct' | 'prepare' | 'count' | 'simple', public startBar: number, time: number) {
    this.song = song; this.list = sections(song);
    if (!this.list.length) throw Error('曲目中没有可播放段落。');
    if (!Number.isInteger(startBar) || startBar < 1 || startBar >= song.endExclusive) throw Error('开始小节超出曲目范围。');
    this.phase = mode === 'direct' ? 'playing' : mode === 'simple' ? 'simple' : mode === 'count' ? 'waiting' : 'prepare';
    this.bar = startBar; this.nextTime = time;
    this.meter = this.list[0].meter; this.bpm = this.list[0].bpm;
    if (mode === 'count') this.enterAt = 1;
  }
  sectionAt(bar: number) { return this.list.findLast(r => r.start <= bar)!; }
  // 按用户当前听到的准备小节决定边界，避免提前调度造成按键时序偏移。
  requestEntry(extraBars: number, now: number, origin: number) {
    const duration = this.list[0].meter[0] * beatSeconds(this.list[0].meter, this.list[0].bpm);
    const current = Math.max(0, Math.floor((now - origin) / duration));
    this.enterAt = current + 1 + extraBars;
    this.phase = 'waiting';
  }
  take(): BeatEvent | null {
    if (this.phase === 'stopped') return null;
    if ((this.phase === 'waiting' || this.phase === 'prepare') && this.beat === 0 && this.enterAt !== null && this.prepBar >= this.enterAt) this.phase = 'playing';
    const section = this.phase === 'playing' ? this.sectionAt(this.bar) : this.list[0];
    if (this.phase === 'simple') { if (this.beat === 0 && this.pendingMeter) { this.meter = this.pendingMeter; this.pendingMeter = undefined; } }
    else { this.meter = section.meter; this.bpm = section.bpm; }
    const event: BeatEvent = { phase: this.phase, bar: this.bar, localBar: this.bar - section.start + 1, beat: this.beat, meter: [...this.meter], bpm: this.bpm, sectionId: this.phase === 'playing' ? section.id : undefined, time: this.nextTime, remaining: this.enterAt === null ? undefined : this.enterAt - this.prepBar };
    this.nextTime += beatSeconds(this.meter, this.bpm);
    this.beat++;
    if (this.beat >= this.meter[0]) {
      this.beat = 0;
      if (this.phase === 'playing') { this.bar++; if (this.bar >= this.song.endExclusive) this.phase = 'stopped'; }
      else if (this.phase === 'simple') this.bar++;
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
  onPosition: (position: Position) => void = () => {};
  onError: (message: string) => void = () => {};
  async init() {
    this.context ??= new AudioContext({ latencyHint: 'interactive' });
    await this.context.resume();
    if (this.context.state !== 'running') throw Error('浏览器未启用音频，请点击播放按钮重试。');
    if (!this.gain) { this.gain = this.context.createGain(); this.gain.connect(this.context.destination); }
    this.setVolume(this.volume);
    if (!this.buffer) {
      const response = await fetch(`${import.meta.env.BASE_URL}sounds/click.mp3`);
      if (!response.ok) throw Error('节拍音效加载失败，请检查 sounds/click.mp3 文件。');
      this.buffer = await this.context.decodeAudioData(await response.arrayBuffer());
    }
  }
  setVolume(value: number) { this.volume = value; if (this.context && this.gain) this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.01); }
  async start(song: Song, mode: 'direct' | 'prepare' | 'count' | 'simple', start: number) {
    this.stop(); const token = this.token;
    await this.init();
    if (token !== this.token) return;
    const context = this.context!;
    this.origin = context.currentTime + 0.07;
    this.timeline = new Timeline(song, mode, start, this.origin);
    this.onPosition(this.lastPosition = { ...stopped, phase: this.timeline.phase, meter: this.timeline.meter, bpm: this.timeline.bpm, bar: start });
    this.pump();
    this.timer = setInterval(() => this.pump(), 15);
    this.animate();
  }
  stop() {
    this.token++;
    clearInterval(this.timer); cancelAnimationFrame(this.frame);
    for (const item of this.scheduled) { try { item.source.stop(); } catch { /* 已结束 */ } }
    this.timeline = undefined; this.scheduled = []; this.events = [];
    this.onPosition(this.lastPosition = { ...stopped });
  }
  enter(extra: number) {
    const timeline = this.timeline, context = this.context;
    if (!timeline || !context || !['prepare', 'waiting', 'playing'].includes(timeline.phase)) return;
    // 以听到的状态为准；预排事件可能已经越过准备边界。
    const pending = this.scheduled.filter(s => s.event.time > context.currentTime);
    if (pending.length) {
      const first = pending[0].event;
      for (const item of pending) { try { item.source.stop(); } catch { /* 已结束 */ } }
      const prepDuration = timeline.list[0].meter[0] * beatSeconds(timeline.list[0].meter, timeline.list[0].bpm);
      timeline.prepBar = Math.max(0, Math.round((first.time - this.origin - first.beat * beatSeconds(timeline.list[0].meter, timeline.list[0].bpm)) / prepDuration));
      timeline.beat = first.beat; timeline.nextTime = first.time; timeline.bar = timeline.startBar;
      this.scheduled = this.scheduled.filter(s => s.event.time <= context.currentTime);
      this.events = this.events.filter(e => e.time <= context.currentTime);
    }
    timeline.requestEntry(extra, context.currentTime, this.origin);
    const duration = timeline.list[0].meter[0] * beatSeconds(timeline.list[0].meter, timeline.list[0].bpm);
    const currentPrep = Math.max(0, Math.floor((context.currentTime - this.origin) / duration));
    this.onPosition(this.lastPosition = { ...this.lastPosition, phase: 'waiting', remaining: timeline.enterAt! - currentPrep });
    this.pump();
  }
  changeSimple(meter: Meter, bpm: number) {
    if (this.timeline?.phase === 'simple') { this.timeline.bpm = bpm; this.timeline.pendingMeter = meter; }
  }
  pump() {
    const context = this.context, timeline = this.timeline;
    if (!context || !timeline) return;
    if (context.state !== 'running') { this.stop(); this.onError('音频被浏览器或设备中断，请重新开始播放。'); return; }
    if (timeline.nextTime < context.currentTime - 0.15) { this.stop(); this.onError('页面运行被中断，已停止播放，请重新开始。'); return; }
    while (timeline.phase !== 'stopped' && timeline.nextTime < context.currentTime + 0.065) {
      const event = timeline.take(); if (!event) break;
      const source = context.createBufferSource(), accent = context.createGain();
      source.buffer = this.buffer!;
      source.playbackRate.value = event.beat === 0 ? 1.35 : 1;
      accent.gain.value = event.beat === 0 ? 1 : 0.6;
      source.connect(accent); accent.connect(this.gain!); source.start(event.time);
      source.onended = () => { source.disconnect(); accent.disconnect(); this.scheduled = this.scheduled.filter(s => s.source !== source); };
      this.scheduled.push({ source, event }); this.events.push(event);
    }
  }
  animate = () => {
    const context = this.context, timeline = this.timeline;
    if (!context || !timeline) return;
    const stamp = context.getOutputTimestamp?.();
    const audibleTime = stamp && stamp.performanceTime !== undefined && stamp.contextTime !== undefined && stamp.performanceTime > 0 ? Math.min(context.currentTime, stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000) : context.currentTime - (context.outputLatency || 0);
    let latest: BeatEvent | undefined;
    while (this.events[0] && this.events[0].time <= audibleTime) latest = this.events.shift();
    if (latest) this.onPosition(this.lastPosition = latest);
    if (timeline.phase === 'stopped' && audibleTime >= timeline.nextTime) { this.stop(); return; }
    this.frame = requestAnimationFrame(this.animate);
  };
}
