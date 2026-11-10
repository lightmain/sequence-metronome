import { useMemo, useState } from 'react';
import type { Alignment } from '../model';
import type { MusicPlayer, MusicState, PlayPlan } from '../musicPlayer';
import { regressTaps, lockReferenceBpm } from '../alignment';
import { Dialog } from './Dialog';
import { NumberField } from './Controls';

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
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmWeak, setConfirmWeak] = useState(false);
  const statistics = useMemo(() => (taps.length >= 3 ? regressTaps(taps) : undefined), [taps]);
  const rawPlan: PlayPlan = {
    audioStart: 0,
    duration: buffer.duration,
    positionAt: () => null,
    beatsBetween: function* () {},
  };
  function preview(alignment: Alignment) {
    setDraft(alignment);
    const start = alignment.firstBeatMs / 1000;
    const interval = 60 / alignment.referenceBpm!;
    const shift = Math.max(0, -start);
    const first = start + shift;
    const plan: PlayPlan = {
      uniform: true,
      audioStart: shift,
      duration: shift + buffer.duration,
      positionAt: () => null,
      *beatsBetween(from, to) {
        for (let i = Math.max(0, Math.floor((from - first) / interval)); ; i++) {
          const time = first + i * interval;
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
    void player.play(buffer, plan, first, 'alignment');
  }
  function next() {
    const alignment = lockReferenceBpm(taps, manual);
    setStep(2);
    preview(alignment);
    setConfirmWeak(false);
  }
  function tap() {
    if (step !== 1 || player.state.phase !== 'playing') return;
    const time = player.audibleTime();
    setTaps((previous) =>
      !previous.length || time > previous.at(-1)! ? [...previous, time] : previous,
    );
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
            {step === 1 ? (
              <button
                className="primary"
                disabled={!statistics}
                onClick={() => (statistics?.recommended ? next() : setConfirmWeak(true))}
              >
                下一步
              </button>
            ) : (
              <>
                <button
                  onClick={() => {
                    player.stop();
                    setStep(1);
                  }}
                >
                  重新打拍
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    player.stop();
                    finish(draft);
                  }}
                >
                  确认完成
                </button>
              </>
            )}
          </>
        }
      >
        <div className="alignment-content">
          <h3>{step === 1 ? '1. 手动打拍' : '2. 首拍位置与时间微调'}</h3>
          {step === 1 ? (
            <>
              <div className="music-transport">
                <button
                  onClick={() => {
                    if (state.phase === 'playing') player.pause();
                    else if (state.phase === 'paused') void player.resume();
                    else {
                      setTaps([]);
                      void player.play(buffer, rawPlan, 0, 'alignment');
                    }
                  }}
                >
                  {state.phase === 'playing'
                    ? '暂停'
                    : state.phase === 'paused'
                      ? '继续'
                      : '播放音频'}
                </button>
                <input
                  aria-label="打拍音频进度"
                  type="range"
                  min={0}
                  max={buffer.duration}
                  step="0.001"
                  value={state.time}
                  onChange={(e) => {
                    const time = +e.target.value;
                    setTaps([]);
                    if (state.phase === 'stopped') void player.play(buffer, rawPlan, time);
                    else void player.seek(time);
                  }}
                />
                <span>
                  {state.time.toFixed(2)} / {buffer.duration.toFixed(2)} s
                </span>
              </div>
              <div className="tap-statistics" aria-live="polite">
                <span>打拍 {taps.length} 次</span>
                <span>BPM {statistics?.bpm.toFixed(3) ?? '—'}</span>
                <span>
                  95% 置信区间{' '}
                  {statistics?.bpmInterval?.map((n) => n.toFixed(3)).join(' – ') ?? '—'}
                </span>
                <span className={statistics?.recommended ? 'alignment-ready' : ''}>
                  {statistics?.recommended ? '建议完成' : '精度不足'}
                </span>
              </div>
              <div className="music-actions">
                <button onClick={tap} disabled={state.phase !== 'playing'}>
                  打拍 <kbd>Space</kbd>
                </button>
                <button disabled={!taps.length} onClick={() => setTaps((p) => p.slice(0, -1))}>
                  撤销上一拍
                </button>
                <button disabled={!taps.length} onClick={() => setTaps([])}>
                  清空本轮打拍
                </button>
                <label>
                  参考 BPM{' '}
                  <NumberField
                    label="参考 BPM"
                    min={1}
                    value={manual ?? Math.round(statistics?.bpm ?? 120)}
                    onCommit={setManual}
                  />
                </label>
              </div>
            </>
          ) : (
            <>
              <div className="alignment-values">
                <span>参考 BPM {draft.referenceBpm}</span>
                <span>首拍 {Number(draft.firstBeatMs.toFixed(6))} ms</span>
              </div>
              <div className="music-actions">
                {[-1, 1].map((direction) => (
                  <button
                    key={direction}
                    onClick={() =>
                      preview({
                        ...draft,
                        firstBeatMs: draft.firstBeatMs + (direction * 60000) / draft.referenceBpm!,
                      })
                    }
                  >
                    {direction < 0 ? '向前一拍' : '向后一拍'}
                  </button>
                ))}
                {[-10, -1, 1, 10].map((ms) => (
                  <button
                    key={ms}
                    onClick={() => preview({ ...draft, firstBeatMs: draft.firstBeatMs + ms })}
                  >
                    {ms > 0 ? '+' : '−'}
                    {Math.abs(ms)} ms
                  </button>
                ))}
                <button onClick={() => preview(draft)}>试听</button>
                <button onClick={() => player.stop()}>停止试听</button>
              </div>
            </>
          )}
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
