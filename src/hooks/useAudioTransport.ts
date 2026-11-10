import { useEffect, useRef, useState } from 'react';
import { AudioEngine, stopped } from '../transport';
import type { Song } from '../model';
import { useEvent } from './useEvent';

export function useAudioTransport(onError: (text: string) => void) {
  const [engine] = useState(() => new AudioEngine());
  const [position, setPosition] = useState(stopped),
    [loading, setLoading] = useState(false);
  const generation = useRef(0),
    report = useEvent(onError);
  const invalidate = useEvent(() => {
    generation.current++;
  });
  const stopPlayback = useEvent(() => {
    generation.current++;
    engine.stop();
    setLoading(false);
  });
  const startPlayback = useEvent(
    async (song: Song, mode: 'direct' | 'prepare' | 'count' | 'simple', bar: number) => {
      const current = ++generation.current;
      setLoading(true);
      try {
        await engine.start(song, mode, bar);
      } catch (error) {
        if (current === generation.current)
          report(error instanceof Error ? error.message : String(error));
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
  );
  const interrupt = useEvent(() => {
    if (document.hidden && (loading || engine.timeline)) {
      stopPlayback();
      report('页面已转入后台，播放已停止，请重新开始。');
    }
  });
  useEffect(() => {
    engine.onPosition = setPosition;
    engine.onError = report;
    document.addEventListener('visibilitychange', interrupt);
    return () => {
      invalidate();
      engine.onPosition = () => {};
      engine.onError = () => {};
      engine.dispose();
      document.removeEventListener('visibilitychange', interrupt);
    };
  }, [engine, report, invalidate, interrupt]);
  return { engine, position, loading, startPlayback, stopPlayback };
}
