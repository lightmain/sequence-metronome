import { describe, expect, it } from 'vitest';
import { formatAudioTime } from '../src/time';

describe('音频时间显示', () => {
  it('总时长不足 60 秒时保留秒和小数', () => {
    expect(formatAudioTime(12.34, 59.99, 2)).toBe('12.34 / 59.99 s');
    expect(formatAudioTime(0, 30, 1)).toBe('0.0 / 30.0 s');
  });
  it('总时长达到 60 秒时统一显示分:秒', () => {
    expect(formatAudioTime(0, 60, 1)).toBe('0:00 / 1:00');
    expect(formatAudioTime(5, 65, 2)).toBe('0:05 / 1:05');
    expect(formatAudioTime(65.9, 125.2, 1)).toBe('1:05 / 2:05');
  });
  it('分钟不进位到秒，秒数补零', () => {
    expect(formatAudioTime(59.9, 3599.9, 2)).toBe('0:59 / 59:59');
    expect(formatAudioTime(3600, 3600, 1)).toBe('60:00 / 60:00');
  });
});
