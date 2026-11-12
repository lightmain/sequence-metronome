import type { DelaySummary } from './deviceDelay';
import { DEVICE_DELAY_BPM, DEVICE_DELAY_MAX_ABS_MS } from './deviceDelay';

export const DEVICE_DELAY_KEY = 'metronome.device.v1';

export type DeviceDelay = {
  version: 1;
  delayMs: number;
  taps?: number;
  ci95Ms?: [number, number];
  bpm?: number;
  measuredAt?: string;
};

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;
type Remover = Pick<Storage, 'removeItem'>;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function readDeviceDelay(storage: Reader): DeviceDelay | undefined {
  const raw = storage.getItem(DEVICE_DELAY_KEY);
  if (!raw) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    !record(data) ||
    data.version !== 1 ||
    !finite(data.delayMs) ||
    !Number.isInteger(data.delayMs) ||
    Math.abs(data.delayMs) > DEVICE_DELAY_MAX_ABS_MS
  )
    return undefined;
  const value: DeviceDelay = { version: 1, delayMs: data.delayMs };
  if (finite(data.taps) && Number.isInteger(data.taps) && data.taps >= 0) value.taps = data.taps;
  if (
    Array.isArray(data.ci95Ms) &&
    data.ci95Ms.length === 2 &&
    finite(data.ci95Ms[0]) &&
    finite(data.ci95Ms[1])
  )
    value.ci95Ms = [data.ci95Ms[0], data.ci95Ms[1]];
  if (finite(data.bpm) && data.bpm > 0) value.bpm = data.bpm;
  if (typeof data.measuredAt === 'string') value.measuredAt = data.measuredAt;
  return value;
}

export function createDeviceDelay(summary: DelaySummary): DeviceDelay {
  if (summary.delayMs === null || !Number.isFinite(summary.delayMs))
    throw Error('设备延迟值无效。');
  if (Math.abs(summary.delayMs) > DEVICE_DELAY_MAX_ABS_MS) throw Error('设备延迟值超出范围。');
  const delayMs = Math.round(summary.delayMs);
  return {
    version: 1,
    delayMs,
    taps: summary.count,
    ci95Ms: summary.intervalMs
      ? [Math.round(summary.intervalMs[0]), Math.round(summary.intervalMs[1])]
      : undefined,
    bpm: DEVICE_DELAY_BPM,
    measuredAt: new Date().toISOString(),
  };
}

export function writeDeviceDelay(storage: Writer, value: DeviceDelay) {
  storage.setItem(DEVICE_DELAY_KEY, JSON.stringify(value));
}

export function clearDeviceDelay(storage: Remover) {
  storage.removeItem(DEVICE_DELAY_KEY);
}
