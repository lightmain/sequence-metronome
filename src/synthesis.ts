import { MusicTimeline } from './musicTimeline';
import type { Song } from './model';

export type SynthesisPhase = 'schedule' | 'render' | 'measure' | 'encode';
export type SynthesisProgress = { phase: SynthesisPhase; value?: number };
export type SynthesisProgressHandler = (progress: SynthesisProgress) => void;

export async function synthesize(
  song: Song,
  audio: AudioBuffer,
  click: AudioBuffer,
  musicVolume: number,
  beatVolume: number,
  format: 'wav' | 'mp3',
  signal: AbortSignal,
  onProgress?: SynthesisProgressHandler,
): Promise<Blob> {
  onProgress?.({ phase: 'schedule' });
  const timeline = new MusicTimeline(song, audio.duration);
  const sampleRate = 44100;
  const context = new OfflineAudioContext(
    Math.min(2, audio.numberOfChannels),
    Math.ceil(timeline.duration * sampleRate),
    sampleRate,
  );
  const music = context.createBufferSource();
  const musicGain = context.createGain();
  music.buffer = audio;
  musicGain.gain.value = musicVolume;
  music.connect(musicGain).connect(context.destination);
  music.start(timeline.audioStart);
  let count = 0;
  for (const event of timeline.beatsBetween(0, timeline.duration)) {
    signal.throwIfAborted();
    const source = context.createBufferSource(),
      gain = context.createGain();
    source.buffer = click;
    source.playbackRate.value = event.beat === 0 ? 1.35 : 1;
    gain.gain.value = beatVolume * (event.beat === 0 ? 1 : 0.6);
    source.connect(gain).connect(context.destination);
    source.start(event.time);
    if (++count % 256 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  signal.throwIfAborted();
  onProgress?.({ phase: 'render' });
  const rendered = await context.startRendering();
  signal.throwIfAborted();
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, c) =>
    rendered.getChannelData(c),
  );
  const totalChunks = Math.max(
    1,
    channels.reduce((sum, channel) => sum + Math.ceil(channel.length / 262144), 0),
  );
  let scanned = 0;
  let peak = 1;
  onProgress?.({ phase: 'measure', value: 0 });
  for (const channel of channels)
    for (let start = 0; start < channel.length; start += 262144) {
      signal.throwIfAborted();
      for (let i = start; i < Math.min(channel.length, start + 262144); i++)
        peak = Math.max(peak, Math.abs(channel[i]));
      onProgress?.({ phase: 'measure', value: ++scanned / totalChunks });
      await new Promise((r) => setTimeout(r, 0));
    }
  const encodedChannels = channels.map((channel) => {
    const samples = new Float32Array(channel.length);
    const attenuation = format === 'mp3' ? Math.max(1, peak / 0.95) : peak;
    for (let i = 0; i < samples.length; i++) samples[i] = channel[i] / attenuation;
    return samples;
  });
  onProgress?.({ phase: 'encode', value: 0 });
  return new Promise<Blob>((resolve, reject) => {
    const worker = new Worker(new URL('./encode.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => {
      worker.terminate();
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      finish();
      reject(signal.reason);
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    worker.onmessage = (event) => {
      if (typeof event.data.progress === 'number') {
        onProgress?.({ phase: 'encode', value: event.data.progress });
        return;
      }
      finish();
      if (event.data.error) reject(Error(event.data.error));
      else resolve(event.data.blob);
    };
    worker.onerror = () => {
      finish();
      reject(Error('音频编码失败。'));
    };
    worker.postMessage(
      { channels: encodedChannels, sampleRate, format },
      encodedChannels.map((c) => c.buffer),
    );
  });
}
