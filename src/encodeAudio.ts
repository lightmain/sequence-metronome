import { Mp3Encoder } from '@breezystack/lamejs';

export function encodeWav(channels: Float32Array[], sampleRate: number) {
  const frames = channels[0].length;
  const size = frames * channels.length * 2;
  if (size > 0xffffffff - 36) throw Error('WAV 文件超过格式支持的大小。');
  const data = new ArrayBuffer(44 + size);
  const view = new DataView(data);
  const text = (offset: number, value: string) =>
    [...value].forEach((s, i) => view.setUint8(offset + i, s.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + size, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels.length * 2, true);
  view.setUint16(32, channels.length * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, size, true);
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < channels.length; c++)
      view.setInt16(44 + (i * channels.length + c) * 2, pcm16(channels[c][i]), true);
  return new Blob([data], { type: 'audio/wav' });
}
function pcm16(value: number) {
  return Math.round(Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767));
}

/** 44.1 kHz MPEG-1，附加 Xing/LAME 延迟和尾部填充信息，供解码器恢复原时间范围。 */
export function encodeMp3(channels: Float32Array[], sampleRate: number) {
  if (sampleRate !== 44100) throw Error('MP3 编码采样率须为 44100 Hz。');
  const encoder = new Mp3Encoder(channels.length, sampleRate, 192);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; offset < channels[0].length; offset += 1152) {
    const converted = channels.map((c) =>
      Int16Array.from(c.subarray(offset, offset + 1152), pcm16),
    );
    const chunk = encoder.encodeBuffer(converted[0], converted[1]);
    if (chunk.length) chunks.push(new Uint8Array(chunk));
  }
  chunks.push(new Uint8Array(encoder.flush()));
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const audio = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.length;
  }
  let frames = 0;
  for (let at = 0; at < audio.length;) {
    if (audio[at] !== 255 || (audio[at + 1] & 0xfe) !== 0xfa) throw Error('MP3 帧格式不正确。');
    const rates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
    const bytes =
      Math.floor((144000 * rates[audio[at + 2] >> 4]) / sampleRate) + ((audio[at + 2] >> 1) & 1);
    if (!bytes) throw Error('MP3 帧长度不正确。');
    at += bytes;
    frames++;
  }
  const firstSize = Math.floor((144000 * 192) / sampleRate);
  const info = new Uint8Array(firstSize);
  info.set(audio.subarray(0, 4));
  info[2] &= 0xfd;
  const xing = 4 + (channels.length === 1 ? 17 : 32);
  info.set(new TextEncoder().encode('Info'), xing);
  const view = new DataView(info.buffer);
  view.setUint32(xing + 4, 3);
  view.setUint32(xing + 8, frames);
  view.setUint32(xing + 12, length + info.length);
  const lame = xing + 16;
  info.set(new TextEncoder().encode('LAME3.100'), lame);
  const delay = 576;
  const padding = frames * 1152 - channels[0].length - delay;
  if (padding < 0 || padding > 4095) throw Error('MP3 尾部填充计算失败。');
  info[lame + 21] = delay >> 4;
  info[lame + 22] = ((delay & 15) << 4) | (padding >> 8);
  info[lame + 23] = padding & 255;
  return new Blob([info, audio], { type: 'audio/mpeg' });
}
