import { useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../transport';
import type { AudioReference, Song } from '../model';
import { audioReference, readAudio, writeAudio, cleanAudio } from '../audioFiles';
import { MusicPlayer, idleMusic } from '../musicPlayer';
import { useEvent } from './useEvent';
import { STORAGE_KEY } from '../persistence';

export function useMusic(engine: AudioEngine, song: Song, onError: (message: string) => void) {
  const [player] = useState(() => new MusicPlayer(engine));
  const [state, setState] = useState(idleMusic);
  const [buffer, setBuffer] = useState<AudioBuffer>();
  const [fileState, setFileState] = useState<'none' | 'loading' | 'ready' | 'missing'>('none');
  const files = useRef(new Map<string, Blob>());
  const report = useEvent(onError);
  const id = song.music?.audio?.id;
  const stop = useEvent(() => player.stop());
  useEffect(() => {
    player.onState = setState;
    player.onError = report;
    const interrupt = () => {
      if (document.hidden && player.state.phase !== 'stopped') {
        player.stop();
        report('页面已转入后台，音频播放已停止。');
      }
    };
    document.addEventListener('visibilitychange', interrupt);
    return () => {
      player.onState = () => {};
      player.stop();
      document.removeEventListener('visibilitychange', interrupt);
    };
  }, [player, report]);
  useEffect(() => {
    let cancelled = false;
    stop();
    setBuffer(undefined);
    setFileState(id ? 'loading' : 'none');
    if (id)
      void (async () => {
        try {
          const blob = files.current.get(id) ?? (await readAudio(id));
          if (cancelled) return;
          if (!blob) {
            setFileState('missing');
            return;
          }
          const decoded = await decodeFile(blob);
          if (cancelled) return;
          setBuffer(decoded);
          setFileState('ready');
        } catch (error) {
          if (!cancelled) {
            setFileState('missing');
            report(String(error));
          }
        }
      })();
    return () => {
      cancelled = true;
    };
  }, [id, stop, report]);
  const stage = useEvent(async (file: File, existing?: AudioReference) => {
    if (
      existing &&
      (existing.name !== file.name ||
        existing.size !== file.size ||
        existing.lastModified !== file.lastModified)
    )
      throw Error('所选文件与原音频识别信息不一致，请选择原文件，或使用“替换音频”。');
    await decodeFile(file);
    const ref = audioReference(file);
    files.current.set(ref.id, file);
    return ref;
  });
  const saveFiles = useEvent(async (snapshot: Song) => {
    const ref = snapshot.music?.audio;
    if (!ref) return;
    const blob = files.current.get(ref.id);
    if (blob) await writeAudio(ref.id, blob);
    // 导入参数时允许原音频缺失；已经选择的文件必须先完成数据库事务。
  });
  const cleanup = useEvent(async (songs: Song[]) => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) await cleanAudio([JSON.parse(raw), ...songs]);
  });
  const retain = useEvent((songs: Song[]) => {
    const ids = new Set(songs.flatMap((s) => (s.music?.audio ? [s.music.audio.id] : [])));
    for (const id of files.current.keys()) if (!ids.has(id)) files.current.delete(id);
  });
  return { player, state, buffer, fileState, stage, saveFiles, cleanup, retain, stop };
}

async function decodeFile(blob: Blob) {
  if (!blob.size) throw Error('音频文件为空。');
  const context = new OfflineAudioContext(2, 1, 44100);
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (!buffer.length || !Number.isFinite(buffer.duration)) throw Error('音频时长无效。');
    return buffer;
  } catch (error) {
    throw Error('无法解码该音频，请选择有效的 WAV 或 MP3 文件。', { cause: error });
  }
}
