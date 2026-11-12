import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioReference, CountIn, Music, Song } from '../model';
import { clone, fingerprint, meterText } from '../model';
import { MusicTimeline } from '../musicTimeline';
import type { useMusic } from '../hooks/useMusic';
import type { AudioEngine } from '../transport';
import { NumberField, MeterFields, Icon } from './Controls';
import { synthesize } from '../synthesis';
import { formatAudioTime } from '../time';

export function MusicPanel({
  song,
  music,
  engine,
  volume,
  change,
  addAudio,
  selectAudio,
  removeAudio,
  align,
  begin,
  locked,
  error,
}: {
  song: Song;
  music: ReturnType<typeof useMusic>;
  engine: AudioEngine;
  volume: number;
  change: (music: Music) => void;
  addAudio: (audio: AudioReference) => void;
  selectAudio: (sha?: string) => void;
  removeAudio: (sha: string) => void;
  align: () => void;
  begin: () => void;
  locked: boolean;
  error: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [selecting, setSelecting] = useState(false);
  const [format, setFormat] = useState<'wav' | 'mp3'>('wav');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ key: string; blob: Blob }>();
  const task = useRef<AbortController | undefined>(undefined);
  const { player, state, buffer, fileState } = music;
  const parameters = song.music ?? { audios: {}, alignments: {} };
  const audios = Object.entries(parameters.audios ?? {});
  const activeAudio = parameters.activeSha ? parameters.audios?.[parameters.activeSha] : undefined;
  const activeAlignment = parameters.activeSha
    ? parameters.alignments?.[parameters.activeSha]
    : undefined;
  const timeline = useMemo(() => new MusicTimeline(song, buffer?.duration ?? 0), [song, buffer]);
  const key = fingerprint(song) + ':' + volume + ':' + format;
  const validResult = result?.key === key ? result : undefined;
  const keyRef = useRef(key);
  keyRef.current = key;
  useEffect(() => {
    task.current?.abort();
    if (player.purpose === 'synthesis') player.stop();
    setGenerating(false);
    setResult(undefined);
    return () => {
      task.current?.abort();
    };
  }, [key, player]);
  async function choose(file?: File) {
    if (!file) return;
    setSelecting(true);
    begin();
    player.stop();
    try {
      addAudio(await music.stage(file));
    } catch (e) {
      error(e instanceof Error ? e.message : String(e));
    } finally {
      setSelecting(false);
    }
  }
  function updateCountIn(next: CountIn) {
    const sha = parameters.activeSha;
    const alignment = sha ? parameters.alignments?.[sha] : undefined;
    change({
      ...parameters,
      countIn: next,
      alignments:
        sha && alignment
          ? {
              ...parameters.alignments,
              [sha]: {
                ...alignment,
                countin: next.bars,
                countin_bpm: next.bpm,
                countin_time: meterText(next.meter),
              },
            }
          : parameters.alignments,
    });
  }
  async function generate() {
    if (!buffer || !activeAlignment) return;
    begin();
    player.stop();
    const controller = new AbortController();
    task.current = controller;
    const snapshotKey = key;
    setGenerating(true);
    setResult(undefined);
    try {
      await engine.init(controller.signal);
      controller.signal.throwIfAborted();
      const blob = await synthesize(
        clone(song),
        buffer,
        engine.buffer!,
        parameters.volume ?? 0.65,
        volume / 100,
        format,
        controller.signal,
      );
      if (!controller.signal.aborted && snapshotKey === keyRef.current)
        setResult({ key: snapshotKey, blob });
    } catch (e) {
      if (!controller.signal.aborted) error(e instanceof Error ? e.message : String(e));
    } finally {
      if (task.current === controller) setGenerating(false);
    }
  }
  async function preview() {
    if (!validResult) return;
    begin();
    player.stop();
    const generation = player.generation;
    const snapshotKey = key;
    try {
      const decoded = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(
        await validResult.blob.arrayBuffer(),
      );
      if (snapshotKey !== keyRef.current || player.generation !== generation) return;
      player.setVolumes(1, 0);
      await player.play(
        decoded,
        {
          audioStart: 0,
          duration: decoded.duration,
          positionAt: () => null,
          beatsBetween: function* () {},
        },
        0,
        'synthesis',
      );
    } catch (e) {
      error(String(e));
    }
  }
  const reading = selecting || fileState === 'loading';
  const audioState = reading
    ? '正在读取音频'
    : fileState === 'missing'
      ? '音频文件缺失'
      : activeAlignment
        ? '已对齐'
        : '未对齐';
  const audioStateClass = reading
    ? 'loading'
    : fileState === 'missing'
      ? 'missing'
      : activeAlignment
        ? 'aligned'
        : 'unaligned';
  const audioVolume = Math.round((parameters.volume ?? 0.65) * 100);
  const transportStatus =
    state.phase === 'playing'
      ? '正在播放音乐'
      : state.phase === 'paused'
        ? '音乐已暂停'
        : state.phase === 'loading'
          ? '正在加载音频'
          : '未播放';
  const playLabel =
    state.phase === 'playing'
      ? '暂停音乐'
      : state.phase === 'paused'
        ? '继续音乐'
        : state.phase === 'loading'
          ? '正在加载音频'
          : '播放音乐';
  return (
    <section className="music-panel" aria-label="曲目音频">
      <header className="music-panel-heading">
        <div className="music-panel-title">
          <h3>原音频</h3>
          <span className={`audio-state ${audioStateClass}`} role="status" aria-live="polite">
            <span className="audio-state-dot" />
            {audioState}
          </span>
          {audios.length ? (
            <label className="audio-select">
              当前音频
              <select
                aria-label="当前音频"
                value={parameters.activeSha ?? ''}
                disabled={selecting || locked}
                onChange={(e) => selectAudio(e.target.value || undefined)}
              >
                {!parameters.activeSha && <option value="">未选择</option>}
                {audios.map(([sha, audio]) => (
                  <option key={sha} value={sha}>
                    {audio.name} · {sha.slice(0, 8)} ·{' '}
                    {parameters.alignments?.[sha] ? '已对齐' : '未对齐'}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="audio-name">未关联音频</span>
          )}
          {activeAlignment && (
            <span className="alignment-summary">
              参考 BPM {activeAlignment.bpm} · 首拍 {Number(activeAlignment.start.toFixed(1))} ms
            </span>
          )}
        </div>
        <div className="music-file-actions">
          <button
            className={audios.length ? '' : 'music-accent'}
            disabled={selecting || locked}
            onClick={() => input.current?.click()}
          >
            {audios.length ? '添加音频' : '关联音频'}
          </button>
          {activeAudio && (
            <button disabled={selecting || locked} onClick={() => removeAudio(activeAudio.sha256)}>
              移除当前
            </button>
          )}
          <button
            className="music-align"
            disabled={!buffer || !activeAudio || selecting || locked}
            onClick={align}
          >
            {activeAlignment ? '重新对齐' : '对齐'}
          </button>
        </div>
      </header>
      <div className="music-player">
        <button
          className={`round-button ${state.phase === 'playing' ? 'pause' : 'play'}`}
          aria-label={playLabel}
          disabled={!buffer || selecting || state.phase === 'loading'}
          onClick={() => {
            if (state.phase === 'playing') player.pause();
            else if (state.phase === 'paused') void player.resume();
            else if (buffer) {
              begin();
              player.setVolumes(parameters.volume ?? 0.65, volume / 100);
              void player.play(buffer, timeline);
            }
          }}
        >
          <Icon name={state.phase === 'playing' ? 'pause' : 'play'} />
        </button>
        <button
          className="round-button stop music-stop"
          aria-label="停止音乐"
          disabled={state.phase === 'stopped'}
          onClick={() => player.stop()}
        >
          <Icon name="stop" />
        </button>
        <div className="music-progress">
          <div className="music-progress-labels">
            <span className="music-status">
              <span className={`music-status-dot ${state.phase === 'playing' ? 'running' : ''}`} />
              {transportStatus}
            </span>
            <span className="music-time">{formatAudioTime(state.time, timeline.duration, 1)}</span>
          </div>
          <input
            aria-label="音乐进度"
            type="range"
            min={0}
            max={timeline.duration || 1}
            step="0.001"
            disabled={!buffer || state.phase === 'loading'}
            value={state.time}
            onChange={(e) => {
              if (!buffer) return;
              const time = +e.target.value;
              if (state.phase === 'stopped') {
                begin();
                player.setVolumes(parameters.volume ?? 0.65, volume / 100);
                void player.play(buffer, timeline, time);
              } else void player.seek(time);
            }}
          />
        </div>
        <label className="music-volume">
          <span>音频音量</span>
          <input
            aria-label="音频音量"
            type="range"
            min={0}
            max={100}
            value={audioVolume}
            onChange={(e) => change({ ...parameters, volume: +e.target.value / 100 })}
          />
          <span className="volume-value">{audioVolume}%</span>
        </label>
      </div>
      <div className="music-settings">
        <div className="setting-group">
          <span className="setting-title">预备节拍</span>
          <div className="setting-fields">
            <label>
              小节{' '}
              <NumberField
                label="预备小节数"
                integer
                min={0}
                value={timeline.countIn.bars}
                disabled={locked}
                onCommit={(bars) => updateCountIn({ ...timeline.countIn, bars })}
              />
            </label>
            <label>
              拍号{' '}
              <MeterFields
                label="预备节拍"
                disabled={locked}
                meter={timeline.countIn.meter}
                onChange={(meter) => updateCountIn({ ...timeline.countIn, meter })}
              />
            </label>
            <label>
              ♩ ={' '}
              <NumberField
                label="预备节拍 BPM"
                min={20}
                max={400}
                disabled={locked}
                value={timeline.countIn.bpm}
                onCommit={(bpm) => updateCountIn({ ...timeline.countIn, bpm })}
              />
            </label>
          </div>
        </div>
        <div className="setting-group synth-group">
          <span className="setting-title">合成</span>
          <div className="setting-fields">
            <label>
              格式{' '}
              <select
                aria-label="合成格式"
                value={format}
                onChange={(e) => setFormat(e.target.value as 'wav' | 'mp3')}
              >
                <option value="wav">WAV</option>
                <option value="mp3">MP3</option>
              </select>
            </label>
            <button
              disabled={!buffer || !activeAlignment || generating || selecting}
              onClick={() => void generate()}
            >
              生成合成音频
            </button>
            {generating && (
              <button
                onClick={() => {
                  task.current?.abort();
                  setGenerating(false);
                }}
              >
                取消生成
              </button>
            )}
            <button disabled={!validResult} onClick={() => void preview()}>
              试听合成结果
            </button>
            <button
              disabled={!validResult}
              onClick={() => {
                if (!validResult) return;
                const url = URL.createObjectURL(validResult.blob),
                  anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = `${song.title.replace(/[<>:"/\\|?*]/g, '_')}.${format}`;
                anchor.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              下载合成音频
            </button>
          </div>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        aria-label="音频文件"
        hidden
        accept=".wav,.mp3,audio/*"
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.currentTarget.value = '';
        }}
      />
    </section>
  );
}
