import { encodeMp3, encodeWav } from './encodeAudio';
self.onmessage = (
  event: MessageEvent<{ channels: Float32Array[]; sampleRate: number; format: 'wav' | 'mp3' }>,
) => {
  try {
    const { channels, sampleRate, format } = event.data;
    self.postMessage({
      blob: format === 'wav' ? encodeWav(channels, sampleRate) : encodeMp3(channels, sampleRate),
    });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
