import { encodeMp3, encodeWav } from './encodeAudio';

type Request = {
  channels: Float32Array[];
  sampleRate: number;
  format: 'wav' | 'mp3';
};

self.onmessage = (event: MessageEvent<Request>) => {
  try {
    const { channels, sampleRate, format } = event.data;
    const report = (progress: number) => self.postMessage({ progress });
    const blob =
      format === 'wav'
        ? encodeWav(channels, sampleRate, report)
        : encodeMp3(channels, sampleRate, report);
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
