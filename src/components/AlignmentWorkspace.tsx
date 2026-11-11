import { useEffect, useMemo, useRef, useState } from 'react';
import type { Alignment } from '../model';
import type { MusicPlayer, MusicState, PlayPlan } from '../musicPlayer';
import { regressTaps, lockReferenceBpm } from '../alignment';
import { Dialog } from './Dialog';
import { Icon, NumberField } from './Controls';

function previewWindow(alignment: Alignment, audioDuration: number) {
  const start = alignment.firstBeatMs / 1000;
  const shift = Math.max(0, -start);
  return { shift, first: start + shift, duration: shift + audioDuration };
}

export function AlignmentWorkspace({
  buffer,
  player,
  state,
  initial,
  finish,
  close,
}: {
  buffer: AudioBuffer;
  player: MusicPlayer;
  state: MusicState;
  initial?: Alignment;
  finish: (alignment: Alignment) => void;
  close: () => void;
}) {
  const [step, setStep] = useState(1);
  const [taps, setTaps] = useState<number[]>([]);
  const [manual, setManual] = useState<number>();
  const [draft, setDraft] = useState<Alignment>(initial ?? { firstBeatMs: 0 });
  const [step1Time, setStep1Time] = useState(0);
  const [pulses, setPulses] = useState<number[]>([]);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmWeak, setConfirmWeak] = useState(false);
  const statistics = useMemo(() => (taps.length >= 3 ? regressTaps(taps) : undefined), [taps]);
  const nextPulse = useRef(0);
  const pulseTimers = useRef(new Set<number>());
  const step1Play = useRef<HTMLButtonElement>(null);
  const step2Play = useRef<HTMLButtonElement>(null);
  const previousStep = useRef(step);
  const step1Active = step === 1;
  const step2Active = step === 2;
  const step1Playing = step1Active && state.phase === 'playing';
  const step2Playing = step2Active && state.phase === 'playing';
  const previewing = step2Active && state.phase !== 'stopped';
  const previewDuration = previewWindow(draft, buffer.duration).duration;
  const previewProgress = step2Active
    ? Math.min(100, Math.max(0, (state.time / previewDuration) * 100))
    : 0;
  const firstBeatText = Number(draft.firstBeatMs.toFixed(1));
  const step1Position = step1Active ? state.time : step1Time || taps.at(-1) || 0;
  const step1TimeText = `${step1Position.toFixed(2)} / ${buffer.duration.toFixed(2)} s`;
  const step1Status =
    step === 2
      ? '已完成'
      : state.phase === 'playing'
        ? '正在播放'
        : state.phase === 'paused'
          ? '已暂停'
          : state.phase === 'loading'
            ? '正在加载音频'
            : '未播放';
  const step2Status = step2Active
    ? state.phase === 'playing'
      ? '正在试听'
      : state.phase === 'loading'
        ? '正在加载音频'
        : state.phase === 'paused'
          ? '已暂停'
          : '已停止'
    : '—';
  const rawPlan: PlayPlan = {
    audioStart: 0,
    duration: buffer.duration,
    positionAt: () => null,
    beatsBetween: function* () {},
  };

  useEffect(() => {
    const timers = pulseTimers.current;
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    (step === 1 ? step1Play.current : step2Play.current)?.focus();
  }, [step]);

  function pulse() {
    const id = nextPulse.current++;
    setPulses((previous) => [...previous, id]);
    const timer = window.setTimeout(() => {
      setPulses((previous) => previous.filter((value) => value !== id));
      pulseTimers.current.delete(timer);
    }, 1200);
    pulseTimers.current.add(timer);
  }

  function preview(alignment: Alignment) {
    setDraft(alignment);
    const window = previewWindow(alignment, buffer.duration);
    const interval = 60 / alignment.referenceBpm!;
    const plan: PlayPlan = {
      uniform: true,
      audioStart: window.shift,
      duration: window.duration,
      positionAt: () => null,
      *beatsBetween(from, to) {
        for (let i = Math.max(0, Math.floor((from - window.first) / interval)); ; i++) {
          const time = window.first + i * interval;
          if (time >= to) break;
          if (time >= from)
            yield {
              time,
              phase: 'playing',
              bar: 1,
              localBar: 1,
              beat: 0,
              meter: [1, 4],
              bpm: alignment.referenceBpm!,
            };
        }
      },
    };
    void player.play(buffer, plan, window.first, 'alignment');
  }

  function next() {
    const alignment = lockReferenceBpm(taps, manual);
    setStep1Time(player.state.time);
    setStep(2);
    setPulses([]);
    preview(alignment);
    setConfirmWeak(false);
  }

  function back() {
    player.stop();
    setStep(1);
    setPulses([]);
  }

  function togglePlay() {
    if (state.phase === 'playing') player.pause();
    else if (state.phase === 'paused') void player.resume();
    else if (state.phase !== 'loading') {
      setTaps([]);
      setPulses([]);
      void player.play(buffer, rawPlan, 0, 'alignment');
    }
  }

  function togglePreview() {
    if (!step2Active) return;
    if (state.phase === 'playing' || state.phase === 'loading' || state.phase === 'paused')
      player.stop();
    else preview(draft);
  }

  function tap() {
    if (step !== 1 || player.state.phase !== 'playing') return;
    const time = player.audibleTime();
    setTaps((previous) =>
      !previous.length || time > previous.at(-1)! ? [...previous, time] : previous,
    );
    pulse();
  }

  function seek(time: number) {
    setTaps([]);
    setPulses([]);
    if (state.phase === 'stopped') void player.play(buffer, rawPlan, time);
    else void player.seek(time);
  }

  return (
    <>
      <Dialog
        title="音频对齐"
        className="alignment-workspace"
        close={() => setConfirmClose(true)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
          if (
            (e.target as HTMLElement).closest(
              'textarea,select,input:not([type="range"]),[contenteditable="true"]',
            )
          )
            return;
          if (e.key === ' ' && step === 1) {
            e.preventDefault();
            e.stopPropagation();
            tap();
          }
        }}
        footer={
          <>
            <button onClick={() => setConfirmClose(true)}>取消</button>
            {step === 1 && (
              <button
                className="primary"
                disabled={!statistics}
                onClick={() => (statistics?.recommended ? next() : setConfirmWeak(true))}
              >
                下一步
              </button>
            )}
            {step === 2 && <button onClick={back}>返回上一步</button>}
            <button
              className={step === 2 ? 'primary' : ''}
              disabled={step !== 2}
              onClick={() => {
                player.stop();
                finish(draft);
              }}
            >
              确定
            </button>
          </>
        }
      >
        <div className="alignment-content">
          <div className="workbench-steps">
            <section
              className={`workbench-step ${step1Active ? 'active' : 'inactive'}`}
              inert={!step1Active}
              aria-labelledby="alignment-step-1"
            >
              <header className="workbench-step-heading">
                <span className={`step-number ${step2Active ? 'done' : ''}`}>
                  {step2Active ? '✓' : '1'}
                </span>
                <h3 id="alignment-step-1">手动打拍</h3>
              </header>
              <div className="audio-player">
                <button
                  ref={step1Play}
                  className={`round-button ${step1Playing ? 'pause' : 'play'}`}
                  aria-label={
                    state.phase === 'playing'
                      ? '暂停打拍音频'
                      : state.phase === 'paused'
                        ? '继续打拍音频'
                        : '播放音频'
                  }
                  disabled={!step1Active}
                  onClick={togglePlay}
                >
                  <Icon name={step1Playing ? 'pause' : 'play'} />
                </button>
                <div className="player-main">
                  <div className="player-topline">
                    <div className="status workbench-status">
                      <span
                        className={`status-dot ${step1Playing ? 'running' : step2Active ? 'done' : ''}`}
                      />
                      {step1Status}
                    </div>
                    <span className="time-readout">{step1TimeText}</span>
                  </div>
                  <input
                    aria-label="打拍音频进度"
                    type="range"
                    min={0}
                    max={buffer.duration}
                    step="0.001"
                    disabled={!step1Active || state.phase === 'loading'}
                    value={step1Position}
                    onChange={(e) => seek(+e.target.value)}
                  />
                </div>
              </div>
              <div className="tap-stage" aria-hidden="true">
                {step1Active &&
                  pulses.map((id) => (
                    <span className="tap-wave" key={id}>
                      <span className="tap-wave-line left" />
                      <span className="tap-wave-line right" />
                      <span className="tap-wave-core" />
                    </span>
                  ))}
                <span className="tap-stage-axis" />
              </div>
              <div className="tap-statistics">
                <div className="tap-stat tap-stat-bpm">
                  <span className="stat-label">BPM</span>
                  <strong>{statistics?.bpm.toFixed(3) ?? '—'}</strong>
                </div>
                <div className="tap-stat">
                  <span className="stat-label">打拍</span>
                  <strong data-testid="tap-count">{taps.length}</strong>
                  <span className="stat-unit">次</span>
                </div>
                <div className="tap-stat tap-stat-ci">
                  <span className="stat-label">95% 置信区间</span>
                  <strong>
                    {statistics?.bpmInterval?.map((n) => n.toFixed(3)).join(' – ') ?? '—'}
                  </strong>
                </div>
                <div className="tap-stat">
                  <span className="stat-label">跨度</span>
                  <strong>{statistics?.span.toFixed(2) ?? '—'}</strong>
                  <span className="stat-unit">s</span>
                </div>
                <span
                  className={`alignment-state ${
                    statistics ? (statistics.recommended ? 'ready' : 'pending') : ''
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  {statistics ? (statistics.recommended ? '建议完成' : '精度不足') : '—'}
                </span>
              </div>
              <div className="tap-actions">
                <button
                  className="tap-action"
                  disabled={!step1Active || state.phase !== 'playing'}
                  onClick={tap}
                >
                  打拍 <kbd>Space</kbd>
                </button>
                <button disabled={!taps.length} onClick={() => setTaps((p) => p.slice(0, -1))}>
                  撤销上一拍
                </button>
                <button
                  disabled={!taps.length}
                  onClick={() => {
                    setTaps([]);
                    setPulses([]);
                  }}
                >
                  清空本轮打拍
                </button>
                <label className="reference-field">
                  参考 BPM{' '}
                  <NumberField
                    label="参考 BPM"
                    min={1}
                    disabled={!step1Active}
                    value={manual ?? Math.round(statistics?.bpm ?? 120)}
                    onCommit={setManual}
                  />
                </label>
              </div>
            </section>

            <section
              className={`workbench-step ${step2Active ? 'active' : 'inactive'}`}
              inert={!step2Active}
              aria-labelledby="alignment-step-2"
            >
              <header className="workbench-step-heading">
                <span className="step-number">2</span>
                <h3 id="alignment-step-2">首拍位置与时间微调</h3>
              </header>
              <div className="audio-player">
                <button
                  ref={step2Play}
                  className={`round-button ${previewing ? 'stop' : 'play'}`}
                  aria-label={previewing ? '停止试听' : '试听'}
                  disabled={!step2Active}
                  onClick={togglePreview}
                >
                  <Icon name={previewing ? 'stop' : 'play'} />
                </button>
                <div className="player-main">
                  <div className="player-topline">
                    <div className="status workbench-status">
                      <span className={`status-dot ${step2Playing ? 'running' : ''}`} />
                      {step2Status}
                    </div>
                    <span className="time-readout">
                      {step2Active
                        ? `${state.time.toFixed(2)} / ${previewDuration.toFixed(2)} s`
                        : '—'}
                    </span>
                  </div>
                  <div className="preview-track" aria-hidden="true">
                    <span style={{ width: `${previewProgress}%` }} />
                  </div>
                </div>
              </div>
              <div className="tuning">
                <div className="alignment-values">
                  <div className="first-beat-readout" aria-live="polite">
                    <span className="readout-label">首拍</span>
                    <div className="readout-line">
                      <strong className={`readout-number ${step2Active ? '' : 'placeholder'}`}>
                        {step2Active ? firstBeatText : '—'}
                      </strong>
                      <span className="readout-unit">ms</span>
                    </div>
                  </div>
                  <div className="reference-readout">
                    <span className="readout-label">参考 BPM</span>
                    <strong>{step2Active ? (draft.referenceBpm ?? '—') : '—'}</strong>
                  </div>
                </div>
                <div className="adjustment-groups">
                  <div className="adjust-group">
                    <span className="adjust-label">整拍</span>
                    <div className="segmented">
                      <button
                        disabled={!step2Active}
                        onClick={() =>
                          preview({
                            ...draft,
                            firstBeatMs: draft.firstBeatMs - 60000 / draft.referenceBpm!,
                          })
                        }
                      >
                        −1 拍
                      </button>
                      <button
                        disabled={!step2Active}
                        onClick={() =>
                          preview({
                            ...draft,
                            firstBeatMs: draft.firstBeatMs + 60000 / draft.referenceBpm!,
                          })
                        }
                      >
                        +1 拍
                      </button>
                    </div>
                  </div>
                  <div className="adjust-group">
                    <span className="adjust-label">毫秒</span>
                    <div className="segmented">
                      {[-10, -1, 1, 10].map((ms) => (
                        <button
                          key={ms}
                          disabled={!step2Active}
                          onClick={() => preview({ ...draft, firstBeatMs: draft.firstBeatMs + ms })}
                        >
                          {ms > 0 ? '+' : '−'}
                          {Math.abs(ms)} ms
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </Dialog>
      {confirmClose && (
        <Dialog
          title="取消本次对齐？"
          close={() => setConfirmClose(false)}
          footer={
            <>
              <button onClick={() => setConfirmClose(false)}>继续对齐</button>
              <button
                onClick={() => {
                  player.stop();
                  close();
                }}
              >
                放弃本次修改
              </button>
            </>
          }
        >
          <p>本次对齐结果尚未保存。</p>
        </Dialog>
      )}
      {confirmWeak && (
        <Dialog
          title="精度不足，仍然继续？"
          close={() => setConfirmWeak(false)}
          footer={
            <>
              <button onClick={() => setConfirmWeak(false)}>继续打拍</button>
              <button onClick={next}>仍然继续</button>
            </>
          }
        >
          <p>打拍次数、时间跨度或 BPM 区间尚未达到建议条件。</p>
        </Dialog>
      )}
    </>
  );
}
