import { describe, expect, it } from 'vitest';
import { lockReferenceBpm, regressTaps, regressionTimeAt } from '../src/alignment';

const taps = (count = 33, bpm = 120, offset = 40) =>
  Array.from({ length: count }, (_, i) => offset + (i * 60) / bpm);

describe('四分音符打拍回归', () => {
  it('从音乐中段拟合已知速度和偏移，整拍移动使用协方差', () => {
    const result = regressTaps(taps());
    expect(result.bpm).toBe(120);
    expect(result.intercept).toBe(40);
    expect(result.bpmInterval).toEqual([120, 120]);
    expect(result.recommended).toBe(true);
    expect(regressionTimeAt(result, -80).time).toBe(0);
  });

  it('已知误差给出正确的残差方差、斜率方差和截距协方差', () => {
    const result = regressTaps([2.01, 2.48, 3.02, 3.49, 4]);
    expect(result.period).toBeCloseTo(0.499, 12);
    expect(result.intercept).toBeCloseTo(2.002, 12);
    expect(result.residualVariance).toBeCloseTo(0.00033, 12);
    expect(result.periodVariance).toBeCloseTo(0.000033, 12);
    expect(result.interceptVariance).toBeCloseTo(0.000198, 12);
    expect(result.covariance).toBeCloseTo(-0.000066, 12);
    expect(result.critical).toBeCloseTo(3.1824463053, 9);
    expect(regressionTimeAt(result, 2).variance).toBeCloseTo(0.000066, 12);
    expect(result.bpmInterval![0]).toBeCloseTo(60 / result.periodInterval[1], 12);
    expect(result.bpmInterval![1]).toBeCloseTo(60 / result.periodInterval[0], 12);
    const propagatedWidth = 2 * result.critical * result.bpmStandardError;
    expect(result.bpmInterval![1] - result.bpmInterval![0]).toBeGreaterThan(propagatedWidth);
  });

  it('绿灯同时检查次数、跨度和区间宽度', () => {
    expect(regressTaps(taps(15, 60)).recommended).toBe(false);
    expect(regressTaps(taps(16)).recommended).toBe(false);
    expect(regressTaps(taps(17)).recommended).toBe(true);
    const noisy = taps(33).map((t, i) => t + (i % 2 ? 0.15 : -0.15));
    expect(regressTaps(noisy).recommended).toBe(false);
  });

  it('固定迟按只移动截距，增加样本不会消除迟按', () => {
    for (const count of [17, 101]) {
      const a = regressTaps(taps(count));
      const b = regressTaps(taps(count).map((t) => t + 0.12));
      expect(b.bpm).toBeCloseTo(a.bpm, 10);
      expect(b.intercept - a.intercept).toBeCloseTo(0.12, 10);
    }
  });

  it('漏拍和多按仍按连续序号拟合，不自动修复', () => {
    const original = taps();
    const missed = original.filter((_, i) => i !== 16);
    const extra = [...original.slice(0, 16), 47.75, ...original.slice(16)];
    expect(regressTaps(missed).bpm).toBeLessThan(120);
    expect(regressTaps(extra).bpm).toBeGreaterThan(120);
  });

  it('默认取整、手动保留小数，锁定周期后重新拟合偏移', () => {
    const input = taps(33, 120.4);
    const locked = lockReferenceBpm(input);
    expect(locked.referenceBpm).toBe(120);
    const expected = input.reduce((sum, t, i) => sum + t - i * 0.5, 0) / input.length;
    expect(locked.firstBeatMs).toBeCloseTo(expected * 1000, 8);
    expect(locked.firstBeatMs).not.toBeCloseTo(40000, 1);
    expect(lockReferenceBpm(input, 120.4)).toEqual({ referenceBpm: 120.4, firstBeatMs: 40000 });
  });

  it('较大自由度的临界值与已知 Student t 分位数一致', () => {
    expect(regressTaps(taps(33)).critical).toBeCloseTo(2.0395134464, 6);
    expect(regressTaps(taps(122)).critical).toBeCloseTo(1.9799304051, 7);
  });

  it.each(
    [[], [0, 1], [0, 1, 1], [0, 2, 1], [-1, 0, 1], [0, 1, Infinity], [0, 1, NaN]].map((input) => ({
      input,
    })),
  )('拒绝无效打拍 $input', ({ input }) => expect(() => regressTaps(input)).toThrow());
  it('拒绝无效手动参考速度及非整数拍移动', () => {
    for (const bpm of [0, -1, NaN, Infinity]) expect(() => lockReferenceBpm(taps(), bpm)).toThrow();
    expect(() => regressionTimeAt(regressTaps(taps()), 1.5)).toThrow();
  });
  it('斜率区间跨零时不计算倒数 BPM 区间，也不亮绿灯', () => {
    const result = regressTaps([0, 0.001, 100]);
    expect(result.periodInterval[0]).toBeLessThan(0);
    expect(result.bpmInterval).toBeNull();
    expect(result.recommended).toBe(false);
  });
  it('极端有限输入的计算溢出会报告错误', () => {
    expect(() => regressTaps([0, 1e308, 1.7e308])).toThrow('可计算范围');
    expect(() => lockReferenceBpm([0, 1, 2], Number.MIN_VALUE)).toThrow('可计算范围');
  });
});
