import type { AlignmentCore } from './model';
import { critical95 } from './statistics';
import type { Interval } from './statistics';

export type { Interval } from './statistics';
export type TapRegression = {
  count: number;
  span: number;
  period: number;
  intercept: number;
  bpm: number;
  residualVariance: number;
  periodVariance: number;
  interceptVariance: number;
  covariance: number;
  periodInterval: Interval;
  bpmInterval: Interval | null;
  bpmStandardError: number;
  critical: number;
  recommended: boolean;
};

function checkTaps(taps: readonly number[], minimum: number) {
  if (taps.length < minimum) throw Error(`至少需要 ${minimum} 次打拍。`);
  for (const [i, time] of taps.entries()) {
    if (!Number.isFinite(time) || time < 0 || (i > 0 && time <= taps[i - 1]))
      throw Error('打拍时间须为相对原音频开头、严格递增的非负秒数；跳转后请清空本轮。');
  }
}

/** 时间 = 截距 + 连续四分音符序号 × 周期；不自动补漏拍或排除多按。 */
export function regressTaps(taps: readonly number[]): TapRegression {
  checkTaps(taps, 3);
  const count = taps.length;
  const meanIndex = (count - 1) / 2;
  // 先减去第一个时间，减少从音乐中段取样时的抵消误差。
  const origin = taps[0];
  const meanTime = taps.reduce((sum, time) => sum + (time - origin), 0) / count;
  const sxx = (count * (count * count - 1)) / 12;
  const period =
    taps.reduce((sum, time, i) => sum + (i - meanIndex) * (time - origin - meanTime), 0) / sxx;
  const relativeIntercept = meanTime - period * meanIndex;
  const intercept = origin + relativeIntercept;
  const residualVariance =
    taps.reduce((sum, time, i) => sum + (time - origin - relativeIntercept - i * period) ** 2, 0) /
    (count - 2);
  const periodVariance = residualVariance / sxx;
  const interceptVariance = residualVariance * (1 / count + meanIndex ** 2 / sxx);
  const covariance = -meanIndex * periodVariance;
  if (!Number.isFinite(60 / period) || !Number.isFinite(interceptVariance) || period <= 0)
    throw Error('打拍时间范围超出可计算范围。');
  const critical = critical95(count - 2);
  const margin = critical * Math.sqrt(periodVariance);
  const periodInterval: Interval = [period - margin, period + margin];
  const bpmInterval: Interval | null =
    periodInterval[0] > 0 ? [60 / periodInterval[1], 60 / periodInterval[0]] : null;
  const span = taps[count - 1] - origin;
  return {
    count,
    span,
    period,
    intercept,
    bpm: 60 / period,
    residualVariance,
    periodVariance,
    interceptVariance,
    covariance,
    periodInterval,
    bpmInterval,
    bpmStandardError: (60 / period ** 2) * Math.sqrt(periodVariance),
    critical,
    recommended:
      count >= 16 && span >= 8 && bpmInterval !== null && bpmInterval[1] - bpmInterval[0] <= 0.5,
  };
}

/** 原始回归在指定整拍处的时间区间，计入斜率与截距的协方差。 */
export function regressionTimeAt(result: TapRegression, beat: number) {
  if (!Number.isSafeInteger(beat)) throw Error('拍序号须为整数。');
  const time = result.intercept + beat * result.period;
  const variance = Math.max(
    0,
    result.interceptVariance + beat ** 2 * result.periodVariance + 2 * beat * result.covariance,
  );
  const margin = result.critical * Math.sqrt(variance);
  return { time, variance, interval: [time - margin, time + margin] as Interval };
}

/** 默认取整；手动 BPM 保留小数。固定周期后重新拟合偏移，不复用原截距。 */
export function lockReferenceBpm(taps: readonly number[], manualBpm?: number): AlignmentCore {
  const bpm = manualBpm ?? Math.round(regressTaps(taps).bpm);
  checkTaps(taps, 3);
  if (!Number.isFinite(bpm) || bpm <= 0) throw Error('参考 BPM 须为正数。');
  const period = 60 / bpm;
  const offset =
    taps[0] + taps.reduce((sum, time, i) => sum + (time - taps[0] - i * period), 0) / taps.length;
  if (!Number.isFinite(offset * 1000)) throw Error('首拍时间超出可计算范围。');
  return { referenceBpm: bpm, firstBeatMs: offset * 1000 };
}
