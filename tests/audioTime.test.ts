import { describe, expect, it } from 'vitest';
import { audibleContextTime, tapEventTime } from '../src/audioTime';

describe('可听时间估计', () => {
  it('没有输出时间戳时退回 outputLatency', () => {
    expect(audibleContextTime({ currentTime: 1, outputLatency: 0.05 })).toBeCloseTo(0.95, 12);
  });

  it('使用输出时间戳和性能时间外推', () => {
    const context = {
      currentTime: 1,
      getOutputTimestamp: () => ({ contextTime: 0.9, performanceTime: 1000 }),
    };
    expect(audibleContextTime(context, 1050)).toBeCloseTo(0.95, 12);
  });

  it('外推结果不超过当前上下文时间', () => {
    const context = {
      currentTime: 1.1,
      getOutputTimestamp: () => ({ contextTime: 1.2, performanceTime: 1000 }),
    };
    expect(audibleContextTime(context, 1100)).toBe(1.1);
  });

  it('performanceTime 为 0 时按缺失时间戳处理', () => {
    const context = {
      currentTime: 1,
      outputLatency: 0.02,
      getOutputTimestamp: () => ({ contextTime: 0.8, performanceTime: 0 }),
    };
    expect(audibleContextTime(context, 1000)).toBeCloseTo(0.98, 12);
  });
});

describe('事件时间', () => {
  it('使用与 performance.now 同一时基的事件时间', () => {
    expect(tapEventTime(1000, 1010)).toBe(1000);
  });

  it('拒绝明显异常的事件时间并退回当前时间', () => {
    expect(tapEventTime(0, 1000)).toBe(1000);
    expect(tapEventTime(1_700_000_000_000, 1000)).toBe(1000);
    expect(tapEventTime(Number.NaN, 1000)).toBe(1000);
  });
});
