import { audibleContextTime } from './audioTime';
import { DEVICE_DELAY_INTERVAL, DEVICE_DELAY_LEAD, DEVICE_DELAY_MAX_BEATS } from './deviceDelay';
import type { AudioEngine } from './transport';

/** 固定间隔点击音；不使用 MusicPlayer，避免改动对齐试听的播放状态。 */
export class DelayClickTrain {
  private context?: AudioContext;
  private startContext = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: AbortController;
  private token = 0;
  onEnd?: () => void;

  async start(engine: AudioEngine) {
    this.stop();
    const token = this.token;
    const pending = new AbortController();
    this.pending = pending;
    const timeout = setTimeout(() => pending.abort(Error('检测节拍加载超时，请重试。')), 10_000);
    try {
      await Promise.race([
        engine.init(pending.signal),
        new Promise<never>((_resolve, reject) => {
          pending.signal.addEventListener('abort', () => reject(pending.signal.reason), {
            once: true,
          });
        }),
      ]);
    } catch (cause) {
      if (token !== this.token) return false;
      if (pending.signal.aborted)
        throw Error('检测节拍加载超时，请检查音频设备后重试。', { cause });
      throw cause;
    } finally {
      clearTimeout(timeout);
      if (this.pending === pending) this.pending = undefined;
    }
    if (token !== this.token) return false;
    const context = engine.context;
    const gain = engine.gain;
    const buffer = engine.buffer;
    if (!context || !gain || !buffer) throw Error('检测节拍未准备好，请重试。');

    this.context = context;
    this.startContext = context.currentTime;
    try {
      for (let index = 0; index < DEVICE_DELAY_MAX_BEATS; index++) {
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        source.onended = () => {
          this.sources.delete(source);
          source.disconnect();
        };
        source.start(this.startContext + DEVICE_DELAY_LEAD + index * DEVICE_DELAY_INTERVAL);
        this.sources.add(source);
      }
      const total = DEVICE_DELAY_LEAD + (DEVICE_DELAY_MAX_BEATS - 1) * DEVICE_DELAY_INTERVAL + 0.2;
      this.timer = setTimeout(() => {
        this.stop();
        this.onEnd?.();
      }, total * 1000);
      return true;
    } catch (cause) {
      this.stop();
      throw cause;
    }
  }

  stop() {
    this.token++;
    this.pending?.abort();
    this.pending = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* 已结束 */
      }
      try {
        source.disconnect();
      } catch {
        /* 已断开 */
      }
    }
    this.sources.clear();
    this.context = undefined;
  }

  audiblePosition(at: number) {
    if (!this.context) return undefined;
    return audibleContextTime(this.context, at) - this.startContext;
  }
}
