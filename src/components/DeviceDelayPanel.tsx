import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioEngine } from '../transport';
import type { DelaySummary } from '../deviceDelay';
import {
  DEVICE_DELAY_TARGET_TAPS,
  formatDelayInterval,
  formatDelayMs,
  summarizeDelay,
} from '../deviceDelay';
import type { DeviceDelay } from '../deviceDelayStorage';
import { DelayClickTrain } from '../deviceDelayPlayer';
import { tapEventTime } from '../audioTime';
import { useEvent } from '../hooks/useEvent';
import { Icon } from './Controls';

export function DeviceDelayPanel({
  engine,
  stored,
  onApply,
  onClear,
  onCollapse,
  error,
}: {
  engine: AudioEngine;
  stored?: DeviceDelay;
  onApply: (summary: DelaySummary) => void;
  onClear: () => void;
  onCollapse: () => void;
  error: (text: string) => void;
}) {
  const [taps, setTaps] = useState<number[]>([]);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [finished, setFinished] = useState(false);
  const [spaceBlocked, setSpaceBlocked] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const train = useRef<DelayClickTrain | undefined>(undefined);
  const playButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const summary = useMemo(() => summarizeDelay(taps), [taps]);

  const tap = useEvent((at: number) => {
    if (!running) return;
    const position = train.current?.audiblePosition(at);
    if (position === undefined || !Number.isFinite(position)) return;
    setTaps((previous) => [...previous, position]);
  });

  const tapWithEvent = useEvent((event: { timeStamp: number }) => {
    tap(tapEventTime(event.timeStamp));
  });

  useEffect(() => {
    playButton.current?.focus();
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      train.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!running || summary.count < DEVICE_DELAY_TARGET_TAPS) return;
    train.current?.stop();
    setRunning(false);
    setFinished(true);
    setSpaceBlocked(true);
  }, [running, summary.count]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.key !== ' ' ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input,textarea,select,[contenteditable="true"]')
      )
        return;
      const control = target instanceof HTMLElement ? target.closest('button') : null;
      if (
        control &&
        !control.classList.contains('device-delay-tap') &&
        !control.classList.contains('round-button')
      )
        return;
      if (running) {
        event.preventDefault();
        event.stopPropagation();
        tap(tapEventTime(event.timeStamp));
      } else if (starting || spaceBlocked) {
        // 检测结束后的 Space 仍可能落在播放按钮上；阻止它触发一次新的检测。
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [running, starting, spaceBlocked, tap]);

  async function begin() {
    if (starting || running) return;
    const next = new DelayClickTrain();
    next.onEnd = () => {
      if (!mounted.current) return;
      setRunning(false);
      setFinished(true);
      setSpaceBlocked(true);
    };
    train.current = next;
    setTaps([]);
    setHasRun(true);
    setFinished(false);
    setSpaceBlocked(false);
    setStarting(true);
    try {
      const started = await next.start(engine);
      if (started && mounted.current) setRunning(true);
    } catch (cause) {
      next.stop();
      if (!mounted.current) return;
      setRunning(false);
      error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) setStarting(false);
    }
  }

  function toggle() {
    if (running) {
      train.current?.stop();
      setRunning(false);
      setFinished(true);
      setSpaceBlocked(true);
      return;
    }
    if (starting) {
      train.current?.stop();
      setStarting(false);
      return;
    }
    void begin();
  }

  function collapse() {
    train.current?.stop();
    setRunning(false);
    onCollapse();
  }

  function apply() {
    setSpaceBlocked(false);
    onApply(summary);
  }

  function clear() {
    onClear();
    setSpaceBlocked(false);
  }

  const status = starting
    ? '检测中'
    : !hasRun
      ? '未开始'
      : running
        ? '检测中'
        : summary.status === 'insufficient'
          ? '样本不足'
          : summary.status === 'invalid'
            ? '结果异常'
            : summary.status === 'ready'
              ? '可用'
              : '精度不足';
  const statusClass =
    !starting && !running && summary.status === 'ready'
      ? 'ready'
      : !starting && !running && summary.status === 'invalid'
        ? 'pending'
        : '';
  const canApply =
    !running && !starting && (summary.status === 'ready' || summary.status === 'weak');
  const restart = finished && !running && !starting;

  return (
    <section
      id="device-delay-panel"
      className="workbench-step active device-delay-panel"
      aria-labelledby="device-delay-title"
    >
      <header className="workbench-step-heading device-delay-heading">
        <h3 id="device-delay-title">设备延迟检测</h3>
        {stored && (
          <span className="device-delay-saved">已保存 {formatDelayMs(stored.delayMs)} ms</span>
        )}
        <button className="device-delay-collapse" onClick={collapse}>
          收起
        </button>
      </header>
      <div className="device-delay-controls">
        <button
          ref={playButton}
          className={`round-button ${running ? 'stop' : 'play'}`}
          aria-label={
            running
              ? '停止检测节拍'
              : starting
                ? '正在加载检测节拍'
                : restart
                  ? '重新开始检测'
                  : '播放检测节拍'
          }
          aria-busy={starting}
          onClick={toggle}
        >
          <Icon name={running ? 'stop' : restart ? 'restart' : 'play'} />
        </button>
        <button
          className="device-delay-tap"
          disabled={!running}
          onClick={(event) => tapWithEvent(event)}
        >
          打拍 <kbd>Space</kbd>
        </button>
        <span
          className={`alignment-state ${statusClass}`}
          data-testid="device-delay-status"
          role="status"
          aria-live="polite"
        >
          {status}
        </span>
      </div>
      <div className="device-delay-stats">
        <div className="tap-stat device-delay-value">
          <span className="stat-label">延迟</span>
          <strong data-testid="device-delay-value">{formatDelayMs(summary.delayMs)}</strong>
          {summary.delayMs !== null && <span className="stat-unit">ms</span>}
        </div>
        <div className="tap-stat tap-stat-ci">
          <span className="stat-label">95% 区间</span>
          <strong>{formatDelayInterval(summary.intervalMs)}</strong>
          {summary.intervalMs !== null && <span className="stat-unit">ms</span>}
        </div>
        <div className="tap-stat">
          <span className="stat-label">有效打拍</span>
          <strong data-testid="device-delay-count">{summary.count}</strong>
          <span className="stat-unit">次</span>
        </div>
      </div>
      <div className="device-delay-actions">
        <button className="primary" disabled={!canApply} onClick={apply}>
          应用
        </button>
        {stored && <button onClick={clear}>清除</button>}
      </div>
    </section>
  );
}
