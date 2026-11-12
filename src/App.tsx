import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Icon } from './components/Controls';
import { WorkspaceDialog } from './components/WorkspaceDialog';
import type { Modal } from './components/WorkspaceDialog';
import { SongTabs } from './components/SongTabs';
import { PlaybackPanel } from './components/PlaybackPanel';
import { SegmentEditor } from './components/SegmentEditor';
import { MusicPanel } from './components/MusicPanel';
import { AlignmentWorkspace } from './components/AlignmentWorkspace';
import { useMusic } from './hooks/useMusic';
import { stopped } from './transport';
import type {
  ClipRow,
  Alignment,
  AlignmentCore,
  AudioReference,
  Meter,
  Music,
  Row,
  Section,
  Song,
} from './model';
import {
  clone,
  activeAlignment,
  applyText,
  copyRows,
  effectiveCountIn,
  exampleSong,
  exportText,
  fingerprint,
  insertRows,
  meterText,
  newSong,
  parseJson,
  parseClipboard,
  MAX_IMPORT_BYTES,
  parseMeterText,
  parseText,
  removeRows,
  sections,
  uid,
  validate,
} from './model';
import { useRowSelection } from './hooks/useRowSelection';
import { useEvent } from './hooks/useEvent';
import type { SavedEntry, Tab } from './storage';
import {
  commit,
  dirty,
  clearLegacyStorage,
  loadLibrary,
  loadWorkspace,
  persistWorkspace,
  withStorageLock,
  redo,
  undo,
} from './storage';
import { clearLegacyAudio } from './audioFiles';
import { useAudioTransport } from './hooks/useAudioTransport';

function createInitialWorkspace() {
  try {
    clearLegacyStorage(localStorage);
    const saved = loadWorkspace(localStorage);
    if (saved?.tabs.length) return { ...saved, error: saved.warnings.join('\n') };
    if (saved?.warnings.length) {
      const tab = makeTab(exampleSong());
      return { tabs: [tab], active: tab.id, error: saved.warnings.join('\n') };
    }
  } catch {
    const tab = makeTab(exampleSong());
    return {
      tabs: [tab],
      active: tab.id,
      error: '本地曲目读取失败，原保存数据未覆盖。你可以先导出当前曲目，再检查浏览器存储设置。',
    };
  }
  const tab = makeTab(exampleSong());
  return { tabs: [tab], active: tab.id, error: '' };
}
function makeTab(song: Song): Tab {
  return { id: uid(), song, past: [], future: [] };
}
function activateAudio(song: Song, sha: string | undefined) {
  if (!song.music) return song;
  song.music.activeSha = sha;
  const alignment = sha ? song.music.alignments[sha] : undefined;
  if (alignment) {
    song.music.countIn = {
      bars: alignment.countin,
      meter: parseMeterText(alignment.countin_time),
      bpm: alignment.countin_bpm,
    };
    const first = sections(song)[0];
    if (first) first.bpm = alignment.bpm;
  }
  return song;
}
function isEditing(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    !!target.closest(
      'textarea,select,[contenteditable="true"],input:not([type="checkbox"]):not([type="range"]):not([type="button"]):not([type="radio"])',
    )
  );
}
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [initial] = useState(createInitialWorkspace);
  const [tabs, setTabs] = useState<Tab[]>(initial.tabs),
    [active, setActive] = useState(initial.active);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(active);
  activeRef.current = active;
  const [mode, setMode] = useState<'sequence' | 'simple'>('sequence');
  const clip = useRef<ClipRow[]>([]);
  const [modal, setModal] = useState<Modal | null>(
    initial.error ? { type: 'message', title: '读取失败', text: initial.error } : null,
  );
  const [parseError, setParseError] = useState('');
  const {
    engine,
    position: purePosition,
    loading,
    startPlayback,
    stopPlayback: stopPure,
  } = useAudioTransport((text) => message('播放失败', text));
  const [startBar, setStartBar] = useState(1),
    [follow, setFollow] = useState(true);
  const [simple, setSimple] = useState({ meter: [4, 4] as Meter, bpm: 120 });
  const [volume, setVolume] = useState(65),
    [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0],
    song = tab.song;
  const music = useMusic(engine, song, (text) => message('音频操作失败', text));
  const currentAlignment = activeAlignment(song);
  const retainAudio = music.retain;
  const [aligning, setAligning] = useState(false);
  useEffect(() => {
    clearLegacyAudio();
  }, []);
  const audioActive = music.state.phase !== 'stopped';
  const position = audioActive
    ? (music.state.position ?? { ...stopped, bar: 0, beat: -1 })
    : purePosition;
  const stopPlayback = useEvent(() => {
    stopPure();
    music.stop();
  });
  const {
    selection,
    setSelection,
    pasteAt,
    setPasteAt,
    anchor,
    editorRef,
    scrollRef,
    drag,
    marquee,
    selectRow,
  } = useRowSelection(song.rows);
  const list = useMemo(() => sections(song), [song]),
    playing = purePosition.phase !== 'stopped' || loading || audioActive;
  const sequenceLocked = playing && mode === 'sequence';
  const dirtyTabs = useMemo(() => new Map(tabs.map((t) => [t.id, dirty(t)])), [tabs]);
  const editorPosition = useMemo(
    () => ({ phase: position.phase, sectionId: position.sectionId, localBar: position.localBar }),
    [position.phase, position.sectionId, position.localBar],
  );
  const selectedIndices = useMemo(
    () => song.rows.flatMap((r, i) => (selection.has(r.id) ? [i] : [])),
    [song.rows, selection],
  );
  const insertion =
    pasteAt ?? (selectedIndices.length ? Math.max(...selectedIndices) + 1 : song.rows.length);
  const currentSection = position.sectionId
    ? list.find((r) => r.id === position.sectionId)
    : (list.findLast((r) => r.start <= startBar) ?? list[0]);
  const displayMeter = playing
    ? position.meter
    : mode === 'simple'
      ? simple.meter
      : (currentSection?.meter ?? [4, 4]);
  const displayBpm = playing
    ? position.bpm
    : mode === 'simple'
      ? simple.bpm
      : (currentSection?.bpm ?? 120);

  const setAll = useEvent(function setAll(next: Tab[]) {
    tabsRef.current = next;
    setTabs(next);
  });
  const message = useEvent(function message(title: string, text: string) {
    setModal({ type: 'message', title, text });
  });
  const toast = useEvent(function toast(text: string) {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 2500);
  });
  const updateSong = useEvent(function updateSong(change: (song: Song) => Song, force = false) {
    if (sequenceLocked && !force) return;
    try {
      setAll(
        tabsRef.current.map((t) =>
          t.id === activeRef.current ? commit(t, change(clone(t.song))) : t,
        ),
      );
    } catch (error) {
      message('修改失败', errorText(error));
    }
  });
  const changeMusic = useEvent((parameters: Music, id = activeRef.current) => {
    try {
      setAll(
        tabsRef.current.map((t) =>
          t.id === id ? commit(t, { ...t.song, version: 3, music: parameters }) : t,
        ),
      );
    } catch (error) {
      message('修改失败', errorText(error));
    }
  });
  const addAudio = useEvent((audio: AudioReference) => {
    updateSong((s) => {
      if (!s.music) s.music = { audios: {}, alignments: {} };
      s.version = 3;
      s.music.audios = { ...s.music.audios, [audio.sha256]: audio };
      activateAudio(s, audio.sha256);
      return validate(s);
    });
  });
  const selectAudio = useEvent((sha: string | undefined) => {
    updateSong((s) => {
      if (!s.music) return s;
      return validate(activateAudio(s, sha));
    });
  });
  const removeAudio = useEvent((sha: string) => {
    updateSong((s) => {
      if (!s.music) return s;
      const previousActive = s.music.activeSha;
      const audios = { ...s.music.audios };
      delete audios[sha];
      const activeSha = previousActive === sha ? Object.keys(audios)[0] : previousActive;
      s.music = { ...s.music, audios, activeSha };
      if (activeSha !== previousActive && activeSha) activateAudio(s, activeSha);
      return validate(s);
    });
  });
  const finishAlignment = useEvent((core: AlignmentCore) => {
    const sha = song.music?.activeSha;
    if (!sha) return;
    const countIn = { ...effectiveCountIn(song), bpm: core.referenceBpm };
    const alignment: Alignment = {
      bpm: core.referenceBpm,
      start: core.firstBeatMs,
      countin: countIn.bars,
      countin_bpm: countIn.bpm,
      countin_time: meterText(countIn.meter),
    };
    updateSong((s) => {
      if (!s.music) throw Error('当前曲目没有音频。');
      s.version = 3;
      s.music = {
        ...s.music,
        countIn,
        alignments: { ...s.music.alignments, [sha]: alignment },
      };
      const first = sections(s)[0];
      if (first) first.bpm = core.referenceBpm;
      return validate(s);
    }, true);
    setAligning(false);
  });
  const modifyRow = useEvent(function modifyRow(
    id: string,
    change: Partial<Section> | { text: string },
  ) {
    updateSong((s) => {
      s.rows = s.rows.map((r) => (r.id === id ? ({ ...r, ...change } as Row) : r));
      return validate(s);
    });
  });
  const add = useEvent(function add(at: number = insertion, content?: ClipRow[]) {
    if (sequenceLocked) return;
    updateSong((s) => insertRows(s, at, content));
    setPasteAt(null);
    setSelection(new Set());
  });
  const remove = useEvent(function remove() {
    if (sequenceLocked || !selection.size) return;
    updateSong((s) => removeRows(s, selection));
    setSelection(new Set());
    setPasteAt(null);
  });
  const history = useEvent(function history(direction: 'undo' | 'redo') {
    if (sequenceLocked) return;
    setAll(
      tabsRef.current.map((t) =>
        t.id === activeRef.current ? (direction === 'undo' ? undo(t) : redo(t)) : t,
      ),
    );
    setSelection(new Set());
    setPasteAt(null);
  });
  const save = useEvent(async function save(id: string = activeRef.current): Promise<boolean> {
    try {
      await withStorageLock(async () => {
        const current = tabsRef.current;
        const snapshot = current.find((t) => t.id === id);
        if (!snapshot) return;
        await music.saveFiles(snapshot.song);
        persistWorkspace(localStorage, current, activeRef.current, id);
        setAll(
          tabsRef.current.map((t) =>
            t.id === id ? { ...t, saved: fingerprint(snapshot.song) } : t,
          ),
        );
      });
      void music
        .cleanup(tabsRef.current.flatMap((t) => [t.song, ...t.past, ...t.future]))
        .catch(() => {
          /* 清理失败不撤销已完成的保存，后续保存会重试。 */
        });
      toast('已保存到此浏览器');
      return true;
    } catch (error) {
      message(
        '保存失败',
        '浏览器无法保存曲目，修改仍然保留。请导出文件备份。\n' + errorText(error),
      );
      return false;
    }
  });
  const switchTab = useEvent(function switchTab(id: string) {
    if (id === activeRef.current) return;
    stopPlayback();
    setAligning(false);
    activeRef.current = id;
    setActive(id);
    setSelection(new Set());
    setPasteAt(null);
    setStartBar(1);
    void withStorageLock(() =>
      persistWorkspace(localStorage, tabsRef.current, activeRef.current),
    ).catch((error) => message('保存失败', errorText(error)));
  });
  const addTab = useEvent(function addTab(
    song: Song = newSong(`未命名曲目 ${tabsRef.current.length + 1}`),
  ) {
    const next = makeTab(song);
    setAll([...tabsRef.current, next]);
    switchTab(next.id);
  });
  const openLibrary = useEvent(function openLibrary() {
    try {
      setModal({ type: 'library', entries: loadLibrary(localStorage) });
    } catch (error) {
      message('读取失败', errorText(error));
    }
  });
  const openSaved = useEvent(function openSaved(entry: SavedEntry) {
    if (!tabsRef.current.some((t) => t.id === entry.id))
      setAll([
        ...tabsRef.current,
        {
          id: entry.id,
          song: clone(entry.song),
          saved: fingerprint(entry.song),
          past: [],
          future: [],
        },
      ]);
    switchTab(entry.id);
    setModal(null);
  });
  const closeTab = useEvent(function closeTab(id: string) {
    const target = tabsRef.current.find((t) => t.id === id);
    if (target && dirty(target)) {
      setModal({ type: 'close', tabId: id });
      return;
    }
    finishClose(id);
  });
  const finishClose = useEvent(async function finishClose(id: string) {
    try {
      await withStorageLock(() => {
        let next = tabsRef.current.filter((t) => t.id !== id);
        if (!next.length) next = [makeTab(newSong())];
        const closingActive = activeRef.current === id;
        persistWorkspace(localStorage, next, closingActive ? next[0].id : activeRef.current);
        setAll(next);
        if (closingActive) switchTab(next[0].id);
        setModal(null);
      });
    } catch (error) {
      message('关闭失败', '无法更新本地保存，曲目仍保持打开。\n' + errorText(error));
    }
  });

  const renameSong = useEvent((id: string, title: string) => {
    setAll(tabsRef.current.map((t) => (t.id === id ? commit(t, { ...t.song, title }) : t)));
    setModal(null);
  });
  const rename = useEvent(function rename(id: string = activeRef.current) {
    if (sequenceLocked) return;
    const target = tabsRef.current.find((t) => t.id === id)!;
    setModal({ type: 'rename', tabId: id, text: target.song.title });
  });
  const textEditor = useEvent(function textEditor() {
    if (!sequenceLocked) {
      setParseError('');
      setModal({
        type: 'text',
        text: exportText(tabsRef.current.find((t) => t.id === activeRef.current)!.song),
      });
    }
  });
  const acceptText = useEvent(function acceptText() {
    if (modal?.type !== 'text') return;
    try {
      const parsed = applyText(song, modal.text);
      updateSong(() => parsed);
      setModal(null);
      setParseError('');
    } catch (error) {
      setParseError(errorText(error));
    }
  });
  const exportFile = useEvent(function exportFile(format: 'txt' | 'json') {
    const blob = new Blob(
      [format === 'txt' ? exportText(song) : JSON.stringify(song, null, 2) + '\n'],
      { type: format === 'txt' ? 'text/plain;charset=utf-8' : 'application/json;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `${song.title.replace(/[<>:"/\\|?*]/g, '_') || '曲目'}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const importFile = useEvent(async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw Error('文件不能超过 2 MiB。');
      const text = await file.text();
      addTab(
        file.name.toLowerCase().endsWith('.json')
          ? parseJson(text)
          : parseText(text, file.name.replace(/\.[^.]+$/, '')),
      );
      toast('已导入为新曲目');
    } catch (error) {
      message('解析失败', errorText(error));
    }
  });
  const clipboardText = useEvent(function clipboardText() {
    clip.current = copyRows(song, selection);
    return JSON.stringify({ format: 'metronome-rows-v1', rows: clip.current });
  });
  const pasteText = useEvent(function pasteText(text: string) {
    if (sequenceLocked) return;
    try {
      const rows = parseClipboard(text);
      if (rows.length) {
        add(insertion, rows);
        toast('已粘贴段落');
      }
    } catch (error) {
      message('解析失败', errorText(error));
    }
  });
  const toolbarCopy = useEvent(async function toolbarCopy() {
    if (!selection.size) return;
    const text = clipboardText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* 内部剪贴板仍支持跨标签复制 */
    }
    toast(`已复制 ${selection.size} 行`);
  });
  const toolbarPaste = useEvent(async function toolbarPaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        pasteText(text);
        return;
      }
    } catch {
      /* 回退内部剪贴板 */
    }
    if (clip.current.length) add(insertion, clip.current);
    else toast('请先复制段落，或在插入位置按 Ctrl+V');
  });
  const start = useEvent(async function start(kind: 'direct' | 'prepare' | 'count') {
    if (loading || (mode === 'sequence' && !list.length)) return;
    music.stop();
    const playable =
      mode === 'simple'
        ? {
            ...newSong(),
            rows: [
              {
                id: 'simple',
                type: 'section' as const,
                start: 1,
                meter: simple.meter,
                bpm: simple.bpm,
              },
            ],
          }
        : clone(song);
    await startPlayback(
      playable,
      mode === 'simple' ? 'simple' : kind,
      mode === 'simple' ? 1 : startBar,
    );
  });
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  useEffect(() => {
    retainAudio(tabs.flatMap((t) => [t.song, ...t.past, ...t.future]));
  }, [tabs, retainAudio]);
  useEffect(() => {
    if (music.player.purpose !== 'synthesis')
      music.player.setVolumes(song.music?.volume ?? 0.65, volume / 100);
  }, [volume, song.music?.volume, music.player]);
  useEffect(() => {
    const container = scrollRef.current;
    const row = position.sectionId ? document.getElementById('row-' + position.sectionId) : null;
    if (!follow || !row || !container) return;
    const bounds = container.getBoundingClientRect(),
      item = row.getBoundingClientRect();
    if (item.top < bounds.top + 46) container.scrollTop -= bounds.top + 46 - item.top;
    else if (item.bottom > bounds.bottom) container.scrollTop += item.bottom - bounds.bottom;
  }, [position.sectionId, follow, scrollRef]);
  useEffect(() => {
    setStartBar((prev) => Math.max(1, Math.min(prev, song.endExclusive - 1)));
  }, [song.endExclusive]);
  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (tabsRef.current.some(dirty)) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    function invalid(e: Event) {
      message('输入无效', (e as CustomEvent<string>).detail);
    }
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('field-error', invalid);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('field-error', invalid);
    };
  }, [message]);
  const key = useEvent((e: KeyboardEvent) => {
    if (e.isComposing || e.repeat) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (modal || aligning) {
        toast('请先确认或关闭对话框，再保存曲目');
        return;
      }
      flushSync(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      save();
      return;
    }
    if (modal || aligning) return;
    if (isEditing(e.target)) return;
    if (audioActive && !e.ctrlKey && !e.metaKey && (e.key === ' ' || e.key === 'Backspace')) {
      e.preventDefault();
      if (e.key === 'Backspace') music.stop();
      else if (music.state.phase === 'playing' || music.state.phase === 'loading')
        music.player.pause();
      else void music.player.resume();
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      rename();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        history(e.shiftKey ? 'redo' : 'undo');
      }
      if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        history('redo');
      }
      if (e.key.toLowerCase() === 'a' && mode === 'sequence') {
        e.preventDefault();
        setSelection(new Set(song.rows.map((r) => r.id)));
      }
      return;
    }
    if (mode === 'simple') {
      if (e.key === ' ') {
        e.preventDefault();
        if (playing) {
          stopPlayback();
        } else void start('direct');
      }
      return;
    }
    if (e.key.toLowerCase() === 'v' && !playing) {
      e.preventDefault();
      textEditor();
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      stopPlayback();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      remove();
    } else if (e.key === 'Enter' && !playing) {
      e.preventDefault();
      void start('direct');
    } else if (e.key === ' ' || ['n', 'm'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      if (position.phase === 'prepare')
        engine.enter(e.key === ' ' ? 0 : e.key.toLowerCase() === 'n' ? 1 : 2);
      else if (!playing && e.key.toLowerCase() !== 'm')
        void start(e.key === ' ' ? 'prepare' : 'count');
    }
  });
  const copy = useEvent((e: ClipboardEvent) => {
    if (modal || aligning || isEditing(e.target) || !selection.size || mode !== 'sequence') return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', clipboardText());
    toast(`已复制 ${selection.size} 行`);
  });
  const paste = useEvent((e: ClipboardEvent) => {
    if (modal || aligning || isEditing(e.target) || mode !== 'sequence' || sequenceLocked) return;
    e.preventDefault();
    pasteText(e.clipboardData?.getData('text/plain') ?? '');
  });
  useEffect(() => {
    document.addEventListener('keydown', key);
    document.addEventListener('copy', copy);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('copy', copy);
      document.removeEventListener('paste', paste);
    };
  }, [key, copy, paste]);

  const preparing = position.phase === 'prepare';
  const countdown = position.phase === 'countdown';
  const status = audioActive
    ? music.state.phase === 'paused'
      ? '音乐已暂停'
      : music.state.phase === 'loading'
        ? '正在加载音频'
        : '正在播放音乐'
    : loading
      ? '正在加载音效'
      : position.phase === 'playing' || position.phase === 'simple'
        ? '正在播放'
        : preparing
          ? '准备模式'
          : countdown
            ? '即将开始'
            : '就绪';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <path d="M11 5h10l6 23H5Z" />
              <path d="m12 22 9-17M9 22h14M16 13v4" />
              <circle cx="12" cy="22" r="2" />
            </svg>
          </span>
          <h1>节拍器</h1>
        </div>
        <nav aria-label="节拍器模式">
          <button
            className={mode === 'simple' ? 'active' : ''}
            onClick={() => {
              stopPlayback();
              setMode('simple');
            }}
          >
            普通节拍器
          </button>
          <button
            className={mode === 'sequence' ? 'active' : ''}
            onClick={() => {
              stopPlayback();
              setMode('sequence');
            }}
          >
            序列节拍器
          </button>
        </nav>
      </header>
      {mode === 'sequence' && (
        <SongTabs
          tabs={tabs}
          active={active}
          dirtyTabs={dirtyTabs}
          switchTab={switchTab}
          rename={rename}
          closeTab={closeTab}
          addTab={addTab}
        />
      )}
      <main>
        <div className="section-heading">
          {mode === 'simple' ? (
            <h2>普通节拍器</h2>
          ) : (
            <div className="document-actions">
              <button disabled={sequenceLocked} onClick={openLibrary}>
                <Icon name="clock" />
                打开
              </button>
              <button onClick={() => save()}>
                <Icon name="save" />
                保存 <kbd>Ctrl S</kbd>
              </button>
              <button disabled={sequenceLocked} onClick={() => fileInput.current?.click()}>
                <Icon name="upload" />
                导入
              </button>
              <details className="export-menu">
                <summary>
                  <Icon name="download" />
                  导出{' '}
                  <svg
                    className="chevron"
                    width="18"
                    height="18"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <path d="m5 7 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                </summary>
                <div>
                  <button onClick={() => exportFile('txt')}>文本 .txt</button>
                  <button onClick={() => exportFile('json')}>JSON .json</button>
                </div>
              </details>
            </div>
          )}
        </div>
        <PlaybackPanel
          playing={playing}
          mode={mode}
          preparing={preparing}
          position={position}
          startBar={startBar}
          countdown={countdown}
          song={song}
          displayMeter={displayMeter}
          displayBpm={displayBpm}
          status={status}
          audioActive={audioActive}
          list={list}
          setStartBar={setStartBar}
          simple={simple}
          setSimple={setSimple}
          engine={engine}
          volume={volume}
          setVolume={setVolume}
          stopPlayback={stopPlayback}
          start={start}
        />
        {mode === 'sequence' && (
          <MusicPanel
            key={active}
            song={song}
            music={music}
            engine={engine}
            volume={volume}
            change={(parameters) => changeMusic(parameters, tab.id)}
            addAudio={addAudio}
            selectAudio={selectAudio}
            removeAudio={removeAudio}
            locked={sequenceLocked}
            error={(text) => message('音频操作失败', text)}
            begin={stopPure}
            align={() => {
              stopPlayback();
              music.player.setVolumes(song.music?.volume ?? 0.65, volume / 100);
              setAligning(true);
            }}
          />
        )}
        {mode === 'sequence' && (
          <SegmentEditor
            editorRef={editorRef}
            follow={follow}
            setFollow={setFollow}
            sequenceLocked={sequenceLocked}
            add={add}
            insertion={insertion}
            tab={tab}
            history={history}
            textEditor={textEditor}
            scrollRef={scrollRef}
            drag={drag}
            setPasteAt={setPasteAt}
            setSelection={setSelection}
            anchor={anchor}
            selection={selection}
            song={song}
            pasteAt={pasteAt}
            position={editorPosition}
            selectRow={selectRow}
            modifyRow={modifyRow}
            list={list}
            updateSong={updateSong}
            toolbarCopy={toolbarCopy}
            toolbarPaste={toolbarPaste}
            remove={remove}
          />
        )}
      </main>
      <input
        ref={fileInput}
        type="file"
        accept=".txt,.json,text/plain,application/json"
        hidden
        onChange={(e) => {
          void importFile(e.target.files?.[0]);
          e.currentTarget.value = '';
        }}
      />
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {marquee && (
        <div
          className="marquee"
          style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
        />
      )}

      {modal && (
        <WorkspaceDialog
          modal={modal}
          tabs={tabs}
          parseError={parseError}
          setModal={setModal}
          setParseError={setParseError}
          acceptText={acceptText}
          save={save}
          finishClose={finishClose}
          renameSong={renameSong}
          openSaved={openSaved}
        />
      )}
      {aligning && music.buffer && (
        <AlignmentWorkspace
          buffer={music.buffer}
          player={music.player}
          engine={engine}
          state={music.state}
          initial={
            currentAlignment
              ? { firstBeatMs: currentAlignment.start, referenceBpm: currentAlignment.bpm }
              : undefined
          }
          close={() => setAligning(false)}
          finish={finishAlignment}
          error={(text) => message('设备延迟检测失败', text)}
        />
      )}
    </div>
  );
}
