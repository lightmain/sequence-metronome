import type { Dispatch, SetStateAction } from 'react';
import type { Meter, Section, Song } from '../model';
import type { AudioEngine, Position } from '../transport';
import { Icon, MeterFields, NumberField } from './Controls';

type Props = {
  playing: boolean;
  mode: 'simple' | 'sequence';
  preparing: boolean;
  position: Position;
  startBar: number;
  countdown: boolean;
  song: Song;
  displayMeter: number[];
  displayBpm: number;
  status: '正在加载音效' | '正在播放' | '准备模式' | '即将开始' | '就绪';
  list: Section[];
  setStartBar: Dispatch<SetStateAction<number>>;
  simple: { meter: Meter; bpm: number };
  setSimple: Dispatch<SetStateAction<{ meter: Meter; bpm: number }>>;
  engine: AudioEngine;
  volume: number;
  setVolume: Dispatch<SetStateAction<number>>;
  stopPlayback: () => void;
  start: (kind: 'direct' | 'prepare' | 'count') => Promise<void>;
};
export function PlaybackPanel({
  playing,
  mode,
  preparing,
  position,
  startBar,
  countdown,
  song,
  displayMeter,
  displayBpm,
  status,
  list,
  setStartBar,
  simple,
  setSimple,
  engine,
  volume,
  setVolume,
  stopPlayback,
  start,
}: Props) {
  return (
    <section className={`player ${playing ? 'is-playing' : ''}`} aria-label="播放控制">
      <div className={`player-display ${mode === 'simple' ? 'simple-display' : ''}`}>
        {mode === 'sequence' && (
          <div className="measure-readout">
            <div className="measure-label">当前小节</div>
            <div className="measure-number">
              {preparing ? '—' : playing ? position.bar : startBar}
              <span>{!preparing && !countdown && `/ ${song.endExclusive - 1}`}</span>
            </div>
          </div>
        )}
        <div className="beat-readout">
          <div className="tempo-readout">
            <span>{displayMeter.join('/')}</span>
            <span>
              ♩ = <strong>{displayBpm}</strong>
            </span>
          </div>
          <div
            className="beat-lights"
            style={{
              gridTemplateColumns: `repeat(${Math.min(8, displayMeter[0])}, var(--beat-size))`,
            }}
            aria-label={`当前第 ${playing ? position.beat + 1 : 0} 拍`}
          >
            {Array.from({ length: displayMeter[0] }, (_, i) => (
              <span
                key={i}
                className={`beat-light ${i === 0 ? 'first' : ''} ${playing && position.beat === i ? 'lit' : ''}`}
              >
                {i + 1}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="player-controls">
        <div className="control-settings">
          <div className="status">
            <span className={`status-dot ${playing ? 'running' : ''}`} />
            {status}
          </div>
          {mode === 'sequence' ? (
            <label className="start-field">
              从第{' '}
              <NumberField
                label="开始小节"
                value={startBar}
                min={1}
                max={Math.max(1, song.endExclusive - 1)}
                integer
                disabled={playing || !list.length}
                onCommit={setStartBar}
              />{' '}
              小节开始
            </label>
          ) : (
            <div className="simple-fields">
              <label>
                速度 <span className="unit">♩ =</span>
                <NumberField
                  label="普通节拍器 BPM"
                  value={simple.bpm}
                  min={20}
                  max={400}
                  onCommit={(bpm) => {
                    setSimple({ ...simple, bpm });
                    engine.changeSimple(simple.meter, bpm);
                  }}
                />
              </label>
              <label>
                拍号{' '}
                <MeterFields
                  label="普通节拍器"
                  meter={simple.meter}
                  onChange={(meter) => {
                    setSimple({ ...simple, meter });
                    engine.changeSimple(meter, simple.bpm);
                  }}
                />
              </label>
            </div>
          )}
          <div className="volume-control">
            <span>音量</span>
            <input
              aria-label="音量"
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(e) => {
                setVolume(+e.target.value);
                engine.setVolume(+e.target.value / 100);
              }}
            />
            <span className="volume-value">{volume}%</span>
          </div>
        </div>
        <div className="transport-buttons">
          {mode === 'simple' ? (
            <button
              className={playing ? 'stop-button' : 'primary'}
              onClick={() => {
                if (playing) {
                  stopPlayback();
                } else void start('direct');
              }}
            >
              <Icon name={playing ? 'stop' : 'play'} />
              {playing ? '停止播放' : '开始播放'} <kbd>Space</kbd>
            </button>
          ) : !playing ? (
            <>
              <button
                className="primary"
                disabled={!list.length}
                onClick={() => void start('direct')}
              >
                <Icon name="play" />
                直接播放 <kbd>↵</kbd>
              </button>
              <button disabled={!list.length} onClick={() => void start('prepare')}>
                准备模式 <kbd>Space</kbd>
              </button>
              <button disabled={!list.length} onClick={() => void start('count')}>
                一小节后开始 <kbd>N</kbd>
              </button>
            </>
          ) : (
            <>
              <button
                className="stop-button"
                onClick={() => {
                  stopPlayback();
                }}
              >
                <Icon name="stop" />
                {position.phase === 'playing' ? '停止播放' : '取消播放'} <kbd>⌫</kbd>
              </button>
              {preparing && (
                <>
                  <button className="primary" onClick={() => engine.enter(0)}>
                    下一小节开始 <kbd>Space</kbd>
                  </button>
                  <button onClick={() => engine.enter(1)}>
                    下下小节开始 <kbd>N</kbd>
                  </button>
                  <button onClick={() => engine.enter(2)}>
                    下下下小节开始 <kbd>M</kbd>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
