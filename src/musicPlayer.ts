import type { AudioEngine, Position, BeatEvent } from './transport';
import { audibleContextTime } from './audioTime';

export type PlayPlan = {
  uniform?: boolean;
  duration: number;
  audioStart: number;
  positionAt: (time: number) => Position | null;
  beatsBetween: (from: number, to: number) => Iterable<BeatEvent>;
};
export type MusicState = {
  phase: 'stopped' | 'loading' | 'playing' | 'paused';
  time: number;
  position: Position | null;
};
export const idleMusic: MusicState = { phase: 'stopped', time: 0, position: null };

export class MusicPlayer {
  purpose: 'music' | 'alignment' | 'synthesis' = 'music';
  state: MusicState = { ...idleMusic };
  onState: (state: MusicState) => void = () => {};
  onError: (error: string) => void = () => {};
  private token = 0;
  private frame = 0;
  private timer?: ReturnType<typeof setInterval>;
  private origin = 0;
  private startTime = 0;
  private scheduledTo = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private musicGain?: GainNode;
  private beatGain?: GainNode;
  private plan?: PlayPlan;
  private buffer?: AudioBuffer;
  private musicVolume = 0.65;
  private beatVolume = 0.65;
  private pending?: AbortController;
  constructor(private engine: AudioEngine) {}
  get generation() {
    return this.token;
  }
  private emit(state: MusicState) {
    this.state = state;
    this.onState(state);
  }
  setVolumes(music: number, beat: number) {
    this.musicVolume = music;
    this.beatVolume = beat;
    const now = this.engine.context?.currentTime ?? 0;
    this.musicGain?.gain.setTargetAtTime(music, now, 0.01);
    this.beatGain?.gain.setTargetAtTime(beat, now, 0.01);
  }
  audibleTime(at = performance.now()) {
    const context = this.engine.context;
    if (!context || this.state.phase !== 'playing') return this.state.time;
    return Math.max(
      this.startTime,
      Math.min(this.plan!.duration, audibleContextTime(context, at) - this.origin),
    );
  }
  async play(
    buffer: AudioBuffer,
    plan: PlayPlan,
    from = 0,
    purpose: 'music' | 'alignment' | 'synthesis' = 'music',
  ) {
    this.stop();
    this.purpose = purpose;
    this.buffer = buffer;
    this.plan = plan;
    const token = this.token;
    const time = Math.max(0, Math.min(plan.duration, from));
    this.emit({ phase: 'loading', time, position: plan.positionAt(time) });
    const pending = new AbortController();
    this.pending = pending;
    const timeout = setTimeout(() => pending.abort(Error('音频启动超时，请重试。')), 10000);
    try {
      await Promise.race([
        this.engine.init(pending.signal),
        new Promise<never>((_, reject) => {
          pending.signal.addEventListener('abort', () => reject(pending.signal.reason), {
            once: true,
          });
        }),
      ]);
      if (token !== this.token) return;
      const context = this.engine.context!;
      this.musicGain = context.createGain();
      this.beatGain = context.createGain();
      this.musicGain.connect(context.destination);
      this.beatGain.connect(context.destination);
      this.setVolumes(this.musicVolume, this.beatVolume);
      this.origin = context.currentTime + 0.07 - time;
      this.startTime = time;
      this.scheduledTo = time;
      if (time < plan.audioStart + buffer.duration) {
        const source = this.source(buffer, this.musicGain);
        source.start(
          this.origin + Math.max(time, plan.audioStart),
          Math.max(0, time - plan.audioStart),
        );
      }
      this.emit({ phase: 'playing', time, position: plan.positionAt(time) });
      this.pump();
      this.timer = setInterval(() => this.pump(), 15);
      this.animate();
    } catch (error) {
      if (token === this.token) {
        this.stop();
        this.onError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  private source(buffer: AudioBuffer, destination: AudioNode) {
    const source = this.engine.context!.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    this.sources.add(source);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
    };
    return source;
  }
  private clear() {
    this.token++;
    this.pending?.abort();
    this.pending = undefined;
    clearInterval(this.timer);
    cancelAnimationFrame(this.frame);
    for (const source of [...this.sources]) {
      try {
        source.stop();
      } catch {
        /* 已结束 */
      }
      source.disconnect();
    }
    this.sources.clear();
    this.musicGain?.disconnect();
    this.beatGain?.disconnect();
    this.musicGain = this.beatGain = undefined;
  }
  pause() {
    if (this.state.phase !== 'playing' && this.state.phase !== 'loading') return;
    const time = this.audibleTime();
    this.clear();
    this.emit({ phase: 'paused', time, position: this.plan?.positionAt(time) ?? null });
  }
  resume() {
    if (this.buffer && this.plan)
      return this.play(this.buffer, this.plan, this.state.time, this.purpose);
  }
  seek(time: number) {
    if (!this.plan || !this.buffer) return;
    time = Math.max(0, Math.min(this.plan.duration, time));
    if (this.state.phase === 'playing')
      return this.play(this.buffer, this.plan, time, this.purpose);
    this.clear();
    this.emit({ phase: 'paused', time, position: this.plan.positionAt(time) });
  }
  stop() {
    this.clear();
    this.buffer = undefined;
    this.plan = undefined;
    this.emit({ ...idleMusic });
  }
  private pump() {
    const context = this.engine.context;
    if (!context || !this.plan || this.state.phase !== 'playing') return;
    const now = context.currentTime - this.origin;
    if (context.state !== 'running' || now - this.scheduledTo > 0.2) {
      this.stop();
      this.onError('音频播放被中断，请重新开始。');
      return;
    }
    const to = Math.min(this.plan.duration, Math.max(this.scheduledTo, now + 0.1));
    for (const event of this.plan.beatsBetween(this.scheduledTo, to)) {
      const accent = context.createGain();
      accent.gain.value = this.plan.uniform ? 1 : event.beat === 0 ? 1 : 0.6;
      accent.connect(this.beatGain!);
      const source = this.source(this.engine.buffer!, accent);
      source.playbackRate.value = this.plan.uniform ? 1 : event.beat === 0 ? 1.35 : 1;
      const ended = source.onended;
      source.onended = (e) => {
        ended?.call(source, e);
        accent.disconnect();
      };
      source.start(this.origin + event.time);
    }
    this.scheduledTo = to;
  }
  private animate = () => {
    if (!this.plan || this.state.phase !== 'playing') return;
    const time = this.audibleTime();
    if (time >= this.plan.duration) {
      this.stop();
      return;
    }
    this.emit({ phase: 'playing', time, position: this.plan.positionAt(time) });
    this.frame = requestAnimationFrame(this.animate);
  };
}
