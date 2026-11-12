import type { AlignmentCore } from './model';
import { meanConfidenceInterval } from './statistics';
import type { Interval } from './statistics';

export const DEVICE_DELAY_BPM = 120;
export const DEVICE_DELAY_INTERVAL = 60 / DEVICE_DELAY_BPM;
export const DEVICE_DELAY_LEAD = 0.5;
export const DEVICE_DELAY_MAX_BEATS = 32;
export const DEVICE_DELAY_TARGET_TAPS = 24;
export const DEVICE_DELAY_MIN_TAPS = 8;
export const DEVICE_DELAY_RECOMMENDED_TAPS = 16;
export const DEVICE_DELAY_MAX_ABS_MS = 200;
export const DEVICE_DELAY_MAX_CI_HALF_WIDTH_MS = 10;
// 单次打拍最多偏离最近节拍 240 ms；超过 200 ms 的检测结果仍会判为超范围。
const MAX_TAP_ERROR = 0.24;

export type DelayStatus = 'insufficient' | 'weak' | 'ready' | 'invalid';
export type DelaySummary = {
  count: number;
  retained: number;
  rejected: number;
  delayMs: number | null;
  intervalMs: Interval | null;
  halfWidthMs: number | null;
  medianMs: number | null;
  status: DelayStatus;
  reason?: 'range' | 'unstable';
};

const empty = (count: number, rejected: number): DelaySummary => ({
  count,
  retained: 0,
  rejected,
  delayMs: null,
  intervalMs: null,
  halfWidthMs: null,
  medianMs: null,
  status: 'insufficient',
});

/**
 * 把打拍位置按最近的检测节拍归并，剔除落在两拍之间或超出范围的样本；
 * 同一拍重复触发时只保留最接近节拍的一次。
 */
export function summarizeDelay(taps: readonly number[]): DelaySummary {
  const byBeat = new Map<number, number>();
  let rejected = 0;
  for (const tap of taps) {
    if (!Number.isFinite(tap)) {
      rejected++;
      continue;
    }
    const index = Math.round((tap - DEVICE_DELAY_LEAD) / DEVICE_DELAY_INTERVAL);
    if (index < 0 || index >= DEVICE_DELAY_MAX_BEATS) {
      rejected++;
      continue;
    }
    const residual = tap - (DEVICE_DELAY_LEAD + index * DEVICE_DELAY_INTERVAL);
    if (Math.abs(residual) > MAX_TAP_ERROR) {
      rejected++;
      continue;
    }
    const previous = byBeat.get(index);
    if (previous !== undefined) rejected++;
    if (previous === undefined || Math.abs(residual) < Math.abs(previous))
      byBeat.set(index, residual);
  }

  const residuals = [...byBeat.values()].sort((a, b) => a - b);
  const count = residuals.length;
  if (count < DEVICE_DELAY_MIN_TAPS) return empty(count, rejected);

  const trim = Math.floor(count * 0.1);
  const retained = residuals.slice(trim, count - trim);
  const { mean, interval } = meanConfidenceInterval(retained);
  const median =
    retained.length % 2
      ? retained[(retained.length - 1) / 2]
      : (retained[retained.length / 2 - 1] + retained[retained.length / 2]) / 2;
  const delayMs = mean * 1000;
  const intervalMs: Interval = [interval[0] * 1000, interval[1] * 1000];
  const halfWidthMs = ((interval[1] - interval[0]) / 2) * 1000;
  const medianMs = median * 1000;

  if (Math.abs(delayMs) > DEVICE_DELAY_MAX_ABS_MS)
    return {
      count,
      retained: retained.length,
      rejected,
      delayMs,
      intervalMs,
      halfWidthMs,
      medianMs,
      status: 'invalid',
      reason: 'range',
    };
  if (Math.abs(medianMs - delayMs) > 20)
    return {
      count,
      retained: retained.length,
      rejected,
      delayMs,
      intervalMs,
      halfWidthMs,
      medianMs,
      status: 'invalid',
      reason: 'unstable',
    };

  return {
    count,
    retained: retained.length,
    rejected,
    delayMs,
    intervalMs,
    halfWidthMs,
    medianMs,
    status:
      count >= DEVICE_DELAY_RECOMMENDED_TAPS && halfWidthMs <= DEVICE_DELAY_MAX_CI_HALF_WIDTH_MS
        ? 'ready'
        : 'weak',
  };
}

/** 只平移首拍，不改变参考 BPM；检测值不进入后续播放或保存逻辑。 */
export function applyDeviceDelay(core: AlignmentCore, delayMs: number): AlignmentCore {
  if (!Number.isFinite(delayMs) || Math.abs(delayMs) > DEVICE_DELAY_MAX_ABS_MS)
    throw Error('设备延迟值无效。');
  const firstBeatMs = core.firstBeatMs - delayMs;
  if (!Number.isFinite(firstBeatMs)) throw Error('首拍时间超出可计算范围。');
  return { ...core, firstBeatMs };
}

export function formatDelayMs(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : rounded < 0 ? `−${Math.abs(rounded)}` : '0';
}

export function formatDelayInterval(interval: Interval | null) {
  return interval ? `${formatDelayMs(interval[0])} – ${formatDelayMs(interval[1])}` : '—';
}
