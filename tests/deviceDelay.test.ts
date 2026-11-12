import { describe, expect, it } from 'vitest';
import {
  DEVICE_DELAY_LEAD,
  applyDeviceDelay,
  formatDelayInterval,
  formatDelayMs,
  summarizeDelay,
} from '../src/deviceDelay';
import {
  DEVICE_DELAY_KEY,
  clearDeviceDelay,
  createDeviceDelay,
  readDeviceDelay,
  writeDeviceDelay,
} from '../src/deviceDelayStorage';
import type { DelaySummary } from '../src/deviceDelay';
import { meanConfidenceInterval } from '../src/statistics';

const at = (index: number, delayMs = 0) => DEVICE_DELAY_LEAD + index * 0.5 + delayMs / 1000;

function summary(delayMs: number): DelaySummary {
  return {
    count: 20,
    retained: 18,
    rejected: 0,
    delayMs,
    intervalMs: [delayMs - 4, delayMs + 4],
    halfWidthMs: 4,
    medianMs: delayMs,
    status: 'ready',
  };
}

class MemoryStorage {
  values = new Map<string, string>();
  failRead = false;
  failWrite = false;
  failRemove = false;
  getItem(key: string) {
    if (this.failRead) throw Error('read failed');
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrite) throw Error('write failed');
    this.values.set(key, value);
  }
  removeItem(key: string) {
    if (this.failRemove) throw Error('remove failed');
    this.values.delete(key);
  }
}

describe('设备延迟统计', () => {
  it('恒定偏移得到无宽度的区间并推荐应用', () => {
    const result = summarizeDelay(Array.from({ length: 16 }, (_, i) => at(i, 32)));
    expect(result.count).toBe(16);
    expect(result.retained).toBe(14);
    expect(result.rejected).toBe(0);
    expect(result.delayMs).toBeCloseTo(32, 10);
    expect(result.intervalMs![0]).toBeCloseTo(32, 10);
    expect(result.intervalMs![1]).toBeCloseTo(32, 10);
    expect(result.halfWidthMs).toBe(0);
    expect(result.medianMs).toBeCloseTo(32, 10);
    expect(result.status).toBe('ready');
  });

  it('负偏移和每两拍打一次都能计算', () => {
    const result = summarizeDelay(Array.from({ length: 16 }, (_, i) => at(i * 2, -8)));
    expect(result.count).toBe(16);
    expect(result.delayMs).toBeCloseTo(-8, 10);
    expect(result.status).toBe('ready');
  });

  it('少于 8 个有效样本时只报告样本不足', () => {
    const result = summarizeDelay(Array.from({ length: 7 }, (_, i) => at(i, 40)));
    expect(result.status).toBe('insufficient');
    expect(result.count).toBe(7);
    expect(result.delayMs).toBeNull();
  });

  it('样本数达到 8 但未达推荐条件时为精度不足', () => {
    const result = summarizeDelay(Array.from({ length: 10 }, (_, i) => at(i, 40)));
    expect(result.status).toBe('weak');
    expect(result.count).toBe(10);
  });

  it('剔除两拍之间的打拍、负拍号和超出最大拍数的位置', () => {
    const result = summarizeDelay([0.02, at(0, 40), DEVICE_DELAY_LEAD + 0.25, at(40, 40)]);
    expect(result.count).toBe(1);
    expect(result.rejected).toBe(3);
  });

  it('同一拍重复触发只保留最接近的一次', () => {
    const result = summarizeDelay([
      at(0, 60),
      at(0, 10),
      ...Array.from({ length: 7 }, (_, i) => at(i + 1, 10)),
    ]);
    expect(result.count).toBe(8);
    expect(result.rejected).toBe(1);
    expect(result.delayMs).toBeCloseTo(10, 10);
  });

  it('截尾去掉两端的极端值', () => {
    const taps = [...Array.from({ length: 9 }, (_, i) => at(i, 0)), at(9, 180)];
    const result = summarizeDelay(taps);
    expect(result.count).toBe(10);
    expect(result.retained).toBe(8);
    expect(result.delayMs).toBeCloseTo(0, 10);
  });

  it('超过支持范围的检测结果被拒绝', () => {
    const result = summarizeDelay(Array.from({ length: 16 }, (_, i) => at(i, 220)));
    expect(result.status).toBe('invalid');
    expect(result.reason).toBe('range');
    expect(result.delayMs).toBeCloseTo(220, 10);
  });

  it('均值与中位数相差过大时判为不稳定', () => {
    const taps = [
      ...Array.from({ length: 12 }, (_, i) => at(i, 0)),
      at(12, 180),
      at(13, 180),
      at(14, 180),
      at(15, 180),
    ];
    const result = summarizeDelay(taps);
    expect(result.status).toBe('invalid');
    expect(result.reason).toBe('unstable');
  });

  it('非有限打拍被拒绝，空输入不抛错', () => {
    expect(summarizeDelay([Number.NaN]).rejected).toBe(1);
    expect(summarizeDelay([])).toMatchObject({ count: 0, status: 'insufficient' });
  });

  it('均值的 95% 区间与已知 t 分位数一致', () => {
    const result = meanConfidenceInterval([0, 0.1, 0.2]);
    expect(result.mean).toBeCloseTo(0.1, 12);
    expect(result.standardDeviation).toBeCloseTo(0.1, 12);
    expect(result.standardError).toBeCloseTo(0.1 / Math.sqrt(3), 12);
    const margin = 4.3026527297 * result.standardError;
    expect(result.interval[0]).toBeCloseTo(0.1 - margin, 12);
    expect(result.interval[1]).toBeCloseTo(0.1 + margin, 12);
    expect(() => meanConfidenceInterval([0])).toThrow();
    expect(() => meanConfidenceInterval([0, Infinity])).toThrow();
  });
});

describe('设备延迟应用', () => {
  it('正延迟使首拍提前，负延迟使首拍延后，BPM 不变', () => {
    expect(applyDeviceDelay({ firstBeatMs: 250, referenceBpm: 120 }, 32)).toEqual({
      firstBeatMs: 218,
      referenceBpm: 120,
    });
    expect(applyDeviceDelay({ firstBeatMs: 250, referenceBpm: 120 }, -8)).toEqual({
      firstBeatMs: 258,
      referenceBpm: 120,
    });
    expect(applyDeviceDelay({ firstBeatMs: 250, referenceBpm: 120 }, 0)).toEqual({
      firstBeatMs: 250,
      referenceBpm: 120,
    });
  });

  it('拒绝非有限值和超出范围的值', () => {
    for (const value of [Number.NaN, Infinity, -Infinity, 200.1, -200.1])
      expect(() => applyDeviceDelay({ firstBeatMs: 250, referenceBpm: 120 }, value)).toThrow();
  });

  it('格式化带符号毫秒和区间', () => {
    expect(formatDelayMs(32.4)).toBe('+32');
    expect(formatDelayMs(-8)).toBe('−8');
    expect(formatDelayMs(0)).toBe('0');
    expect(formatDelayMs(null)).toBe('—');
    expect(formatDelayInterval([24, 40])).toBe('+24 – +40');
    expect(formatDelayInterval(null)).toBe('—');
  });
});

describe('设备延迟本地存储', () => {
  it('保存、读取和清除', () => {
    const storage = new MemoryStorage();
    const value = createDeviceDelay(summary(32));
    expect(value.delayMs).toBe(32);
    writeDeviceDelay(storage, value);
    expect(storage.values.has(DEVICE_DELAY_KEY)).toBe(true);
    expect(readDeviceDelay(storage)).toMatchObject({ version: 1, delayMs: 32, taps: 20 });
    clearDeviceDelay(storage);
    expect(readDeviceDelay(storage)).toBeUndefined();
  });

  it('忽略损坏、版本不符、非整数和超范围的值', () => {
    for (const raw of [
      '{',
      JSON.stringify({ version: 2, delayMs: 32 }),
      JSON.stringify({ version: 1, delayMs: 32.5 }),
      JSON.stringify({ version: 1, delayMs: 201 }),
      JSON.stringify({ version: 1, delayMs: '32' }),
    ]) {
      const storage = new MemoryStorage();
      storage.values.set(DEVICE_DELAY_KEY, raw);
      expect(readDeviceDelay(storage)).toBeUndefined();
    }
  });

  it('保存值 0 仍然有效', () => {
    const storage = new MemoryStorage();
    storage.values.set(DEVICE_DELAY_KEY, JSON.stringify({ version: 1, delayMs: 0 }));
    expect(readDeviceDelay(storage)).toEqual({ version: 1, delayMs: 0 });
  });

  it('忽略损坏的可选元数据但保留有效延迟', () => {
    const storage = new MemoryStorage();
    storage.values.set(
      DEVICE_DELAY_KEY,
      JSON.stringify({ version: 1, delayMs: 12, taps: -1, ci95Ms: ['x'], bpm: 0 }),
    );
    expect(readDeviceDelay(storage)).toEqual({ version: 1, delayMs: 12 });
  });

  it('存储访问异常向外传播', () => {
    const storage = new MemoryStorage();
    storage.failRead = true;
    expect(() => readDeviceDelay(storage)).toThrow('read failed');
    storage.failRead = false;
    storage.failWrite = true;
    expect(() => writeDeviceDelay(storage, createDeviceDelay(summary(0)))).toThrow('write failed');
    storage.failWrite = false;
    storage.failRemove = true;
    expect(() => clearDeviceDelay(storage)).toThrow('remove failed');
  });

  it('拒绝无法保存的检测结果', () => {
    expect(() => createDeviceDelay({ ...summary(0), delayMs: null })).toThrow();
    expect(() => createDeviceDelay({ ...summary(0), delayMs: Number.NaN })).toThrow();
    expect(() => createDeviceDelay({ ...summary(0), delayMs: 200.4 })).toThrow();
  });
});
