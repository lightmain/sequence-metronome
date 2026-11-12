import { describe, expect, it } from 'vitest';
import { encodeMp3, encodeWav } from '../src/encodeAudio';

describe('音频文件编码', () => {
  it('WAV 头部、通道交错和有符号样本正确', async () => {
    const blob = encodeWav([new Float32Array([-1, 0, 1]), new Float32Array([1, 0.5, -0.5])], 44100);
    const data = await blob.arrayBuffer();
    const view = new DataView(data);
    expect(blob.type).toBe('audio/wav');
    expect(new TextDecoder().decode(data.slice(0, 4))).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(48);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(40, true)).toBe(12);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(50, true)).toBe(16384);
  });
  it('编码进度单调递增并最终完成', () => {
    const wavProgress: number[] = [];
    encodeWav([new Float32Array([-1, 0, 1])], 44100, (value) => wavProgress.push(value));
    expect(wavProgress.length).toBeGreaterThan(0);
    expect(wavProgress.at(-1)).toBe(1);
    expect(
      wavProgress.every(
        (value, index) =>
          value >= 0 && value <= 1 && (index === 0 || value >= wavProgress[index - 1]),
      ),
    ).toBe(true);

    const channels = [Float32Array.from({ length: 44100 }, () => 0.1)];
    const mp3Progress: number[] = [];
    encodeMp3(channels, 44100, (value) => mp3Progress.push(value));
    expect(mp3Progress.length).toBeGreaterThan(0);
    expect(mp3Progress.at(-1)).toBe(1);
    expect(
      mp3Progress.every(
        (value, index) =>
          value >= 0 && value <= 1 && (index === 0 || value >= mp3Progress[index - 1]),
      ),
    ).toBe(true);
  });
  it.each([1, 2])('MP3 %i 通道编码包含延迟和填充元数据', async (count) => {
    const channels = Array.from({ length: count }, () =>
      Float32Array.from(
        { length: 44100 },
        (_, i) => 0.3 * Math.sin((i * 2 * Math.PI * 440) / 44100),
      ),
    );
    const blob = encodeMp3(channels, 44100);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const xing = 4 + (count === 1 ? 17 : 32);
    expect(blob.type).toBe('audio/mpeg');
    expect(new TextDecoder().decode(bytes.subarray(xing, xing + 4))).toBe('Info');
    const frames = new DataView(bytes.buffer).getUint32(xing + 8);
    const at = xing + 16 + 21;
    const delay = bytes[at] * 16 + (bytes[at + 1] >> 4);
    const padding = (bytes[at + 1] & 15) * 256 + bytes[at + 2];
    expect(frames * 1152 - delay - padding).toBe(44100);
    expect(delay).toBe(576);
    expect(blob.size).toBeGreaterThan(20000);
  });
});
