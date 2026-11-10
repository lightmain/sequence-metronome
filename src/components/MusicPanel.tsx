import { useEffect, useMemo, useRef, useState } from 'react';
import type { Music, Song } from '../model';
import { clone, fingerprint } from '../model';
import { MusicTimeline } from '../musicTimeline';
import type { useMusic } from '../hooks/useMusic';
import type { AudioEngine } from '../transport';
import { NumberField, MeterFields } from './Controls';
import { synthesize } from '../synthesis';

export function MusicPanel({
  song,
  music,
  engine,
  volume,
  change,
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
  align: () => void;
  begin: () => void;
  locked: boolean;
  error: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const replacing = useRef(false);
  const [selecting, setSelecting] = useState(false);
  const [format, setFormat] = useState<'wav' | 'mp3'>('wav');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ key: string; blob: Blob }>();
  const task = useRef<AbortController | undefined>(undefined);
  const { player, state, buffer, fileState } = music;
  const parameters = song.music ?? {};
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
      const audio = await music.stage(file, replacing.current ? undefined : parameters.audio);
      change({
        ...parameters,
        audio,
        alignment: replacing.current ? undefined : parameters.alignment,
      });
    } catch (e) {
      error(e instanceof Error ? e.message : String(e));
    } finally {
      setSelecting(false);
    }
  }
  async function generate() {
    if (!buffer || !parameters.alignment) return;
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
  return (
    <section className="music-panel" aria-label="曲目音频">
      <div className="music-actions">
        <button
          disabled={selecting || locked}
          onClick={() => {
            replacing.current = false;
            input.current?.click();
          }}
        >
          {parameters.audio ? '关联原音频' : '关联音频'}
        </button>
        {parameters.audio && (
          <button
            disabled={selecting || locked}
            onClick={() => {
              replacing.current = true;
              input.current?.click();
            }}
          >
            替换音频
          </button>
        )}
        <span className="audio-name">{parameters.audio?.name ?? '未关联音频'}</span>
        <span>
          {selecting || fileState === 'loading'
            ? '正在读取音频'
            : fileState === 'missing'
              ? '音频文件缺失'
              : parameters.alignment
                ? '已对齐'
                : '未对齐'}
        </span>
        <button disabled={!buffer || selecting || locked} onClick={align}>
          {parameters.alignment ? '重新对齐' : '对齐'}
        </button>
        {parameters.alignment && (
          <span>
            参考 BPM {parameters.alignment.referenceBpm ?? '—'} · 首拍{' '}
            {parameters.alignment.firstBeatMs} ms
          </span>
        )}
        <label className="music-volume">
          音频音量
          <input
            aria-label="音频音量"
            type="range"
            min={0}
            max={100}
            value={Math.round((parameters.volume ?? 0.65) * 100)}
            onChange={(e) => change({ ...parameters, volume: +e.target.value / 100 })}
          />
        </label>
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
      <div className="music-transport">
        <button
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
          {state.phase === 'playing'
            ? '暂停音乐'
            : state.phase === 'paused'
              ? '继续音乐'
              : '播放音乐'}{' '}
          <kbd>Space</kbd>
        </button>
        <button disabled={state.phase === 'stopped'} onClick={() => player.stop()}>
          停止音乐 <kbd>⌫</kbd>
        </button>
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
        <span>
          {state.time.toFixed(1)} / {timeline.duration.toFixed(1)} s
        </span>
      </div>
      <div className="music-actions">
        <label>
          预备小节数{' '}
          <NumberField
            label="预备小节数"
            integer
            min={0}
            value={timeline.countIn.bars}
            disabled={locked}
            onCommit={(bars) => change({ ...parameters, countIn: { ...timeline.countIn, bars } })}
          />
        </label>
        <label>
          拍号{' '}
          <MeterFields
            label="预备节拍"
            disabled={locked}
            meter={timeline.countIn.meter}
            onChange={(meter) => change({ ...parameters, countIn: { ...timeline.countIn, meter } })}
          />
        </label>
        <label>
          BPM{' '}
          <NumberField
            label="预备节拍 BPM"
            min={20}
            max={400}
            disabled={locked}
            value={timeline.countIn.bpm}
            onCommit={(bpm) => change({ ...parameters, countIn: { ...timeline.countIn, bpm } })}
          />
        </label>
        <label>
          合成格式{' '}
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
          disabled={!buffer || !parameters.alignment || generating || selecting}
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
    </section>
  );
}
