export type AudibleClock = {
  currentTime: number;
  outputLatency?: number;
  getOutputTimestamp?: () => { contextTime?: number; performanceTime?: number } | undefined;
};

// 估算某一时刻已经真正播出的音频上下文时间；浏览器没有时间戳时退回 outputLatency。
export function audibleContextTime(context: AudibleClock, at = performance.now()) {
  const stamp = context.getOutputTimestamp?.();
  const audible =
    stamp &&
    stamp.performanceTime !== undefined &&
    stamp.performanceTime > 0 &&
    stamp.contextTime !== undefined
      ? Math.min(context.currentTime, stamp.contextTime + (at - stamp.performanceTime) / 1000)
      : context.currentTime - (context.outputLatency || 0);
  return audible;
}

// 键盘/指针事件优先使用事件发生时间，避免处理函数排队带来的偏移。
export function tapEventTime(stamp: number, now = performance.now()) {
  return Number.isFinite(stamp) && stamp > 0 && Math.abs(stamp - now) < 10_000 ? stamp : now;
}
