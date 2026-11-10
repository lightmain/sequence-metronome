import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ReactNode } from 'react';
import { clone, copyRows, denominators, exampleSong, exportText, fingerprint, insertRows, newSong, parseJson, parseText, removeRows, sectionEnd, sections, uid, validate } from './model';
import type { ClipRow, Meter, Row, Section, Song } from './model';
import { commit, dirty, loadLibrary, loadWorkspace, persistWorkspace, redo, undo } from './storage';
import type { SavedEntry, Tab } from './storage';
import { selectRows } from './selection';
import { AudioEngine, stopped } from './transport';
import type { Position } from './transport';

type Modal = { type: 'text'; text: string } | { type: 'rename'; text: string; tabId: string } | { type: 'close'; tabId: string } | { type: 'message'; title: string; text: string } | { type: 'library'; entries: SavedEntry[] };
const initial = (() => {
  try { const saved = loadWorkspace(localStorage); if (saved?.tabs.length) return { ...saved, error: '' }; }
  catch { const tab = makeTab(exampleSong()); return { tabs: [tab], active: tab.id, error: '本地曲目读取失败，原保存数据未覆盖。你可以先导出当前曲目，再检查浏览器存储设置。' }; }
  const tab = makeTab(exampleSong()); return { tabs: [tab], active: tab.id, error: '' };
})();
function makeTab(song: Song): Tab { return { id: uid(), song, past: [], future: [] }; }
function isEditing(target: EventTarget | null) { return target instanceof HTMLElement && !!target.closest('textarea,select,[contenteditable="true"],input:not([type="checkbox"]):not([type="range"]):not([type="button"]):not([type="radio"])'); }
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    play: <path d="m8 5 11 7-11 7Z"/>, stop: <rect x="6" y="6" width="12" height="12" rx="1"/>,
    plus: <path d="M12 5v14M5 12h14"/>, save: <><path d="M5 3h12l4 4v14H3V3Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></>,
    undo: <><path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14"/></>, redo: <><path d="m16 4 5 5-5 5M21 9H11a7 7 0 0 0 0 14"/></>,
    text: <><path d="M4 5h16M12 5v15M8 20h8"/></>, download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/></>, copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>, note: <><path d="M4 4h16v12H9l-5 4Z"/><path d="M8 8h8M8 12h5"/></>,
    paste: <><path d="M9 5H5v16h14V5h-4"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M8 12h8M8 16h6"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill={name === 'play' || name === 'stop' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function NumberField({ value, onCommit, label, min, max, disabled, integer = false }: { value: number; onCommit: (v: number) => void; label: string; min?: number; max?: number; disabled?: boolean; integer?: boolean }) {
  const [draft, setDraft] = useState(String(value));
  const cancelled = useRef(false);
  useEffect(() => setDraft(String(value)), [value]);
  function apply() {
    if (cancelled.current) { cancelled.current = false; setDraft(String(value)); return; }
    const number = Number(draft);
    if (!draft.trim() || !Number.isFinite(number) || (integer && !Number.isInteger(number)) || (min !== undefined && number < min) || (max !== undefined && number > max)) {
      setDraft(String(value));
      window.dispatchEvent(new CustomEvent('field-error', { detail: `${label}须${integer ? '为整数且' : ''}在 ${min ?? '无限制'}–${max ?? '无限制'} 之间。` }));
      return;
    }
    try { onCommit(number); } finally { setDraft(String(value)); }
  }
  return <input type="number" aria-label={label} min={min} max={max} step={integer ? 1 : 'any'} value={draft} disabled={disabled} onChange={e => setDraft(e.target.value)} onBlur={apply} onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); e.currentTarget.blur(); } if (e.key === 'Escape') { cancelled.current = true; setDraft(String(value)); e.currentTarget.blur(); } }} />;
}
function MeterFields({ meter, onChange, disabled = false, label = '' }: { meter: Meter; onChange: (v: Meter) => void; disabled?: boolean; label?: string }) {
  return <div className="meter-fields"><NumberField value={meter[0]} label={`${label}拍号分子`} min={1} max={32} integer disabled={disabled} onCommit={v => onChange([v, meter[1]])}/><span>/</span><select aria-label={`${label}拍号分母`} value={meter[1]} disabled={disabled} onChange={e => onChange([meter[0], +e.target.value])}>{denominators.map(v => <option key={v}>{v}</option>)}</select></div>;
}
function Dialog({ title, children, footer, close }: { title: string; children: ReactNode; footer: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const focusBefore = useRef<Element | null>(document.activeElement);
  useEffect(() => {
    ref.current?.showModal();
    const field = ref.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea');
    field?.focus(); if (field instanceof HTMLInputElement) field.select();
    return () => { ref.current?.close(); if (focusBefore.current instanceof HTMLElement) focusBefore.current.focus(); };
  }, []);
  return <dialog ref={ref} aria-label={title} onCancel={e => { e.preventDefault(); close(); }} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') e.preventDefault(); e.stopPropagation(); }}><div className="dialog-heading"><h2>{title}</h2><button aria-label="关闭对话框" onClick={close} className="icon-button">×</button></div><div className="dialog-body">{children}</div><div className="dialog-footer">{footer}</div></dialog>;
}

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>(initial.tabs), [active, setActive] = useState(initial.active);
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  const activeRef = useRef(active); activeRef.current = active;
  const [mode, setMode] = useState<'sequence' | 'simple'>('sequence');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null), clip = useRef<ClipRow[]>([]);
  const [pasteAt, setPasteAt] = useState<number | null>(null);
  const [modal, setModal] = useState<Modal | null>(initial.error ? { type: 'message', title: '读取失败', text: initial.error } : null);
  const [parseError, setParseError] = useState('');
  const [position, setPosition] = useState<Position>(stopped), [loading, setLoading] = useState(false);
  const [startBar, setStartBar] = useState(1), [follow, setFollow] = useState(true);
  const [simple, setSimple] = useState({ meter: [4, 4] as Meter, bpm: 120 });
  const [volume, setVolume] = useState(65), [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const engine = useRef(new AudioEngine()).current;
  const editorRef = useRef<HTMLElement>(null), scrollRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; initial: Set<string>; moved: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const tab = tabs.find(t => t.id === active) ?? tabs[0], song = tab.song;
  const list = sections(song), playing = position.phase !== 'stopped' || loading;
  const sequenceLocked = playing && mode === 'sequence';
  const selectedIndices = song.rows.flatMap((r, i) => selection.has(r.id) ? [i] : []);
  const insertion = pasteAt ?? (selectedIndices.length ? Math.max(...selectedIndices) + 1 : song.rows.length);
  const currentSection = position.sectionId ? list.find(r => r.id === position.sectionId) : list.findLast(r => r.start <= startBar) ?? list[0];
  const displayMeter = playing ? position.meter : mode === 'simple' ? simple.meter : currentSection?.meter ?? [4, 4];
  const displayBpm = playing ? position.bpm : mode === 'simple' ? simple.bpm : currentSection?.bpm ?? 120;

  function setAll(next: Tab[]) { tabsRef.current = next; setTabs(next); }
  function message(title: string, text: string) { setModal({ type: 'message', title, text }); }
  function toast(text: string) { setNotice(text); clearTimeout(noticeTimer.current); noticeTimer.current = setTimeout(() => setNotice(''), 2500); }
  function updateSong(change: (song: Song) => Song) {
    if (sequenceLocked) return;
    try {
      setAll(tabsRef.current.map(t => t.id === activeRef.current ? commit(t, change(clone(t.song))) : t));
    } catch (error) { message('修改失败', errorText(error)); }
  }
  function modifyRow(id: string, change: Partial<Section> | { text: string }) { updateSong(s => { s.rows = s.rows.map(r => r.id === id ? { ...r, ...change } as Row : r); return validate(s); }); }
  function add(at = insertion, content?: ClipRow[]) { if (sequenceLocked) return; updateSong(s => insertRows(s, at, content)); setPasteAt(null); setSelection(new Set()); }
  function remove() { if (sequenceLocked || !selection.size) return; updateSong(s => removeRows(s, selection)); setSelection(new Set()); setPasteAt(null); }
  function history(direction: 'undo' | 'redo') { if (sequenceLocked) return; setAll(tabsRef.current.map(t => t.id === activeRef.current ? (direction === 'undo' ? undo(t) : redo(t)) : t)); setSelection(new Set()); setPasteAt(null); }
  function save(id = activeRef.current): boolean {
    try {
      const current = tabsRef.current;
      persistWorkspace(localStorage, current, activeRef.current, id);
      setAll(current.map(t => t.id === id ? { ...t, saved: fingerprint(t.song) } : t)); toast('已保存到此浏览器'); return true;
    } catch (error) { message('保存失败', '浏览器无法保存曲目，修改仍然保留。请导出文件备份。\n' + errorText(error)); return false; }
  }
  function switchTab(id: string) {
    if (id === activeRef.current) return;
    engine.stop(); setLoading(false); activeRef.current = id; setActive(id); setSelection(new Set()); setPasteAt(null); setStartBar(1);
    try { persistWorkspace(localStorage, tabsRef.current, id); } catch { /* 保存按钮会展示存储错误 */ }
  }
  function addTab(song = newSong(`未命名曲目 ${tabsRef.current.length + 1}`)) {
    const next = makeTab(song); setAll([...tabsRef.current, next]); switchTab(next.id);
  }
  function openLibrary() {
    try { setModal({ type: 'library', entries: loadLibrary(localStorage) }); }
    catch (error) { message('读取失败', errorText(error)); }
  }
  function openSaved(entry: SavedEntry) {
    if (!tabsRef.current.some(t => t.id === entry.id)) setAll([...tabsRef.current, { id: entry.id, song: clone(entry.song), saved: fingerprint(entry.song), past: [], future: [] }]);
    switchTab(entry.id); setModal(null);
  }
  function closeTab(id: string) {
    const target = tabsRef.current.find(t => t.id === id);
    if (target && dirty(target)) { setModal({ type: 'close', tabId: id }); return; }
    finishClose(id);
  }
  function finishClose(id: string) {
    let next = tabsRef.current.filter(t => t.id !== id);
    if (!next.length) next = [makeTab(newSong())];
    try { persistWorkspace(localStorage, next, activeRef.current === id ? next[0].id : activeRef.current); }
    catch (error) { message('关闭失败', '无法更新本地保存，曲目仍保持打开。\n' + errorText(error)); return; }
    setAll(next); if (activeRef.current === id) switchTab(next[0].id); setModal(null);
  }
  function rename(id = activeRef.current) {
    if (sequenceLocked) return;
    const target = tabsRef.current.find(t => t.id === id)!; setModal({ type: 'rename', tabId: id, text: target.song.title });
  }
  function textEditor() { if (!sequenceLocked) { setParseError(''); setModal({ type: 'text', text: exportText(tabsRef.current.find(t => t.id === activeRef.current)!.song) }); } }
  function acceptText() {
    if (modal?.type !== 'text') return;
    try { const parsed = parseText(modal.text, song.title); updateSong(() => parsed); setModal(null); setParseError(''); }
    catch (error) { setParseError(errorText(error)); }
  }
  function exportFile(format: 'txt' | 'json') {
    const blob = new Blob([format === 'txt' ? exportText(song) : JSON.stringify(song, null, 2) + '\n'], { type: format === 'txt' ? 'text/plain;charset=utf-8' : 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `${song.title.replace(/[<>:"/\\|?*]/g, '_') || '曲目'}.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(file?: File) {
    if (!file) return;
    try { const text = await file.text(); addTab(file.name.toLowerCase().endsWith('.json') ? parseJson(text) : parseText(text, file.name.replace(/\.[^.]+$/, ''))); toast('已导入为新曲目'); }
    catch (error) { message('解析失败', errorText(error)); }
  }
  function clipboardText() {
    clip.current = copyRows(song, selection);
    return JSON.stringify({ format: 'metronome-rows-v1', rows: clip.current });
  }
  function pasteText(text: string) {
    if (sequenceLocked) return;
    try {
      let rows: ClipRow[];
      try {
        const parsed = JSON.parse(text);
        if (parsed.format !== 'metronome-rows-v1' || !Array.isArray(parsed.rows)) throw Error();
        rows = parsed.rows;
      } catch { const parsed = parseText(text); rows = copyRows(parsed, new Set(parsed.rows.map(r => r.id))); }
      if (rows.length) { add(insertion, rows); toast('已粘贴段落'); }
    } catch (error) { message('解析失败', errorText(error)); }
  }
  async function toolbarCopy() {
    if (!selection.size) return;
    const text = clipboardText();
    try { await navigator.clipboard.writeText(text); } catch { /* 内部剪贴板仍支持跨标签复制 */ }
    toast(`已复制 ${selection.size} 行`);
  }
  async function toolbarPaste() {
    try { const text = await navigator.clipboard.readText(); if (text) { pasteText(text); return; } } catch { /* 回退内部剪贴板 */ }
    if (clip.current.length) add(insertion, clip.current); else toast('请先复制段落，或在插入位置按 Ctrl+V');
  }
  async function start(kind: 'direct' | 'prepare' | 'count') {
    if (loading) return;
    if (mode === 'sequence' && !list.length) return;
    setLoading(true);
    try {
      const playable = mode === 'simple' ? { ...newSong(), rows: [{ id: 'simple', type: 'section' as const, start: 1, meter: simple.meter, bpm: simple.bpm }] } : clone(song);
      await engine.start(playable, mode === 'simple' ? 'simple' : kind, mode === 'simple' ? 1 : startBar);
    } catch (error) { engine.stop(); message('播放失败', errorText(error)); }
    finally { setLoading(false); }
  }
  function selectRow(id: string, shift: boolean, additive: boolean) {
    setPasteAt(null);
    setSelection(previous => selectRows(song.rows.map(r => r.id), previous, id, anchor.current, shift, additive));
    if (!shift || !song.rows.some(r => r.id === anchor.current)) anchor.current = id;
  }

  useEffect(() => {
    engine.onPosition = setPosition;
    engine.onError = text => message('播放中断', text);
    return () => { engine.stop(); clearTimeout(noticeTimer.current); };
  }, [engine]);
  useEffect(() => {
    const container = scrollRef.current;
    const row = position.sectionId ? document.getElementById('row-' + position.sectionId) : null;
    if (!follow || !row || !container) return;
    const bounds = container.getBoundingClientRect(), item = row.getBoundingClientRect();
    if (item.top < bounds.top + 46) container.scrollTop -= bounds.top + 46 - item.top;
    else if (item.bottom > bounds.bottom) container.scrollTop += item.bottom - bounds.bottom;
  }, [position.sectionId, follow]);
  useEffect(() => {
    function outside(e: PointerEvent) {
      if (e.target instanceof Node && !editorRef.current?.contains(e.target)) {
        setPasteAt(null);
        if (!e.ctrlKey && !e.metaKey) { setSelection(new Set()); anchor.current = null; }
      }
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  useEffect(() => { setStartBar(prev => Math.max(1, Math.min(prev, song.endExclusive - 1))); }, [song.endExclusive]);
  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) { if (tabsRef.current.some(dirty)) { e.preventDefault(); e.returnValue = ''; } }
    function invalid(e: Event) { message('输入无效', (e as CustomEvent<string>).detail); }
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('field-error', invalid);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('field-error', invalid); };
  }, []);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.isComposing || e.repeat) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (modal) { toast('请先确认或关闭对话框，再保存曲目'); return; }
        flushSync(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }); save(); return;
      }
      if (modal) return;
      if (isEditing(e.target)) return;
      if (e.key === 'F2') { e.preventDefault(); rename(); return; }
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z') { e.preventDefault(); history(e.shiftKey ? 'redo' : 'undo'); }
        if (e.key.toLowerCase() === 'y') { e.preventDefault(); history('redo'); }
        if (e.key.toLowerCase() === 'a' && mode === 'sequence') { e.preventDefault(); setSelection(new Set(song.rows.map(r => r.id))); }
        return;
      }
      if (mode === 'simple') {
        if (e.key === ' ') { e.preventDefault(); if (playing) { engine.stop(); setLoading(false); } else void start('direct'); }
        return;
      }
      if (e.key.toLowerCase() === 'v' && !playing) { e.preventDefault(); textEditor(); }
      else if (e.key === 'Backspace') { e.preventDefault(); engine.stop(); setLoading(false); }
      else if (e.key === 'Delete') { e.preventDefault(); remove(); }
      else if (e.key === 'Enter' && !playing) { e.preventDefault(); void start('direct'); }
      else if (e.key === ' ' || ['n','m'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        if (position.phase === 'prepare') engine.enter(e.key === ' ' ? 0 : e.key.toLowerCase() === 'n' ? 1 : 2);
        else if (!playing && e.key.toLowerCase() !== 'm') void start(e.key === ' ' ? 'prepare' : 'count');
      }
    }
    function copy(e: ClipboardEvent) { if (modal || isEditing(e.target) || !selection.size || mode !== 'sequence') return; e.preventDefault(); e.clipboardData?.setData('text/plain', clipboardText()); toast(`已复制 ${selection.size} 行`); }
    function paste(e: ClipboardEvent) { if (modal || isEditing(e.target) || mode !== 'sequence' || sequenceLocked) return; e.preventDefault(); pasteText(e.clipboardData?.getData('text/plain') ?? ''); }
    document.addEventListener('keydown', key); document.addEventListener('copy', copy); document.addEventListener('paste', paste);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('copy', copy); document.removeEventListener('paste', paste); };
  });
  useEffect(() => {
    function move(e: PointerEvent) {
      const d = drag.current; if (!d) return;
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 6) return;
      d.moved = true;
      setPasteAt(null);
      const rect = { x: Math.min(d.x, e.clientX), y: Math.min(d.y, e.clientY), width: Math.abs(e.clientX - d.x), height: Math.abs(e.clientY - d.y) };
      setMarquee(rect);
      const next = new Set(d.initial);
      scrollRef.current?.querySelectorAll<HTMLElement>('[data-row-id]').forEach(el => {
        const box = el.getBoundingClientRect();
        if (box.bottom >= rect.y && box.top <= rect.y + rect.height && box.right >= rect.x && box.left <= rect.x + rect.width) next.add(el.dataset.rowId!);
      });
      setSelection(next);
    }
    function up() { setMarquee(null); if (drag.current?.moved) setTimeout(() => { drag.current = null; }, 0); else drag.current = null; }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  const preparing = position.phase === 'prepare';
  const countdown = position.phase === 'countdown';
  const status = loading ? '正在加载音效' : position.phase === 'playing' || position.phase === 'simple' ? '正在播放' : preparing ? '准备模式' : countdown ? '即将开始' : '就绪';
  function gap(index: number) {
    return <div key={`gap-${index}`} className={`insert-gap ${pasteAt === index ? 'chosen' : ''}`}><button disabled={sequenceLocked} onClick={() => { setPasteAt(index); setSelection(new Set()); anchor.current = null; }} aria-label={`选择第 ${index + 1} 个插入位置`}><span>＋</span><span className="gap-label">在此新增或粘贴</span></button></div>;
  }

  return <div className="app-shell">
    <header className="app-header"><div className="brand"><span className="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M11 5h10l6 23H5Z"/><path d="m12 22 9-17M9 22h14M16 13v4"/><circle cx="12" cy="22" r="2"/></svg></span><h1>节拍器</h1></div><nav aria-label="节拍器模式"><button className={mode === 'simple' ? 'active' : ''} onClick={() => { engine.stop(); setLoading(false); setMode('simple'); }}>普通节拍器</button><button className={mode === 'sequence' ? 'active' : ''} onClick={() => { engine.stop(); setLoading(false); setMode('sequence'); }}>序列节拍器</button></nav></header>
    {mode === 'sequence' && <div className="tabs-bar" role="tablist" aria-label="曲目标签">{tabs.map(t => <div key={t.id} className={`song-tab ${t.id === active ? 'active' : ''}`}><button role="tab" aria-selected={t.id === active} onClick={() => switchTab(t.id)} onDoubleClick={() => { switchTab(t.id); rename(t.id); }}><span>{t.song.title}</span>{dirty(t) && <span className="dirty" aria-label="未保存">*</span>}</button><button className="tab-close" aria-label={`关闭 ${t.song.title}`} onClick={() => closeTab(t.id)}>×</button></div>)}<button className="new-tab" aria-label="新建曲目" onClick={() => addTab()}><Icon name="plus"/></button></div>}
    <main>
      <div className="section-heading">{mode === 'simple' ? <h2>普通节拍器</h2> : <div className="document-actions"><button disabled={sequenceLocked} onClick={openLibrary}><Icon name="clock"/>打开</button><button onClick={() => save()}><Icon name="save"/>保存 <kbd>Ctrl S</kbd></button><button disabled={sequenceLocked} onClick={() => fileInput.current?.click()}><Icon name="upload"/>导入</button><details className="export-menu"><summary><Icon name="download"/>导出 <svg className="chevron" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg></summary><div><button onClick={() => exportFile('txt')}>文本 .txt</button><button onClick={() => exportFile('json')}>JSON .json</button></div></details></div>}</div>
      <section className={`player ${playing ? 'is-playing' : ''}`} aria-label="播放控制">
        <div className={`player-display ${mode === 'simple' ? 'simple-display' : ''}`}>
          {mode === 'sequence' && <div className="measure-readout"><div className="measure-label">当前小节</div><div className="measure-number">{preparing ? '—' : playing ? position.bar : startBar}<span>{!preparing && !countdown && `/ ${song.endExclusive - 1}`}</span></div></div>}
          <div className="beat-readout"><div className="tempo-readout"><span>{displayMeter.join('/')}</span><span>♩ = <strong>{displayBpm}</strong></span></div><div className="beat-lights" style={{ gridTemplateColumns: `repeat(${Math.min(8, displayMeter[0])}, 72px)` }} aria-label={`当前第 ${playing ? position.beat + 1 : 0} 拍`}>{Array.from({ length: displayMeter[0] }, (_, i) => <span key={i} className={`beat-light ${i === 0 ? 'first' : ''} ${playing && position.beat === i ? 'lit' : ''}`}>{i + 1}</span>)}</div></div>
        </div>
        <div className="player-controls"><div className="control-settings"><div className="status"><span className={`status-dot ${playing ? 'running' : ''}`}/>{status}</div>
          {mode === 'sequence' ? <label className="start-field">从第 <NumberField label="开始小节" value={startBar} min={1} max={Math.max(1, song.endExclusive - 1)} integer disabled={playing || !list.length} onCommit={setStartBar}/> 小节开始</label> : <div className="simple-fields"><label>速度 <span className="unit">♩ =</span><NumberField label="普通节拍器 BPM" value={simple.bpm} min={20} max={400} onCommit={bpm => { setSimple({ ...simple, bpm }); engine.changeSimple(simple.meter, bpm); }}/></label><label>拍号 <MeterFields label="普通节拍器" meter={simple.meter} onChange={meter => { setSimple({ ...simple, meter }); engine.changeSimple(meter, simple.bpm); }}/></label></div>}
          <div className="volume-control"><span>音量</span><input aria-label="音量" type="range" min="0" max="100" value={volume} onChange={e => { setVolume(+e.target.value); engine.setVolume(+e.target.value / 100); }}/><span className="volume-value">{volume}%</span></div>
        </div><div className="transport-buttons">{mode === 'simple' ? <button className={playing ? 'stop-button' : 'primary'} onClick={() => { if (playing) { engine.stop(); setLoading(false); } else void start('direct'); }}><Icon name={playing ? 'stop' : 'play'}/>{playing ? '停止播放' : '开始播放'} <kbd>Space</kbd></button> : !playing ? <><button className="primary" disabled={!list.length} onClick={() => void start('direct')}><Icon name="play"/>直接播放 <kbd>↵</kbd></button><button disabled={!list.length} onClick={() => void start('prepare')}>准备模式 <kbd>Space</kbd></button><button disabled={!list.length} onClick={() => void start('count')}>一小节后开始 <kbd>N</kbd></button></> : <><button className="stop-button" onClick={() => { engine.stop(); setLoading(false); }}><Icon name="stop"/>{position.phase === 'playing' ? '停止播放' : '取消播放'} <kbd>⌫</kbd></button>{preparing && <><button className="primary" onClick={() => engine.enter(0)}>下一小节开始 <kbd>Space</kbd></button><button onClick={() => engine.enter(1)}>下下小节开始 <kbd>N</kbd></button><button onClick={() => engine.enter(2)}>下下下小节开始 <kbd>M</kbd></button></>}</>}</div></div>
      </section>
      {mode === 'sequence' && <section ref={editorRef} className="editor" aria-label="段落编辑器"><div className="editor-heading"><h3>段落列表</h3><label className="follow"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)}/>列表滚动跟随播放</label></div><div className="editor-toolbar"><div><button disabled={sequenceLocked} onClick={() => add()}><Icon name="plus"/>新增段落</button><button disabled={sequenceLocked} onClick={() => add(insertion, [{ type: 'comment', text: '段落注释' }])}><Icon name="note"/>新增注释</button><span className="toolbar-divider"/><button className="icon-button" aria-label="撤销" disabled={sequenceLocked || !tab.past.length} onClick={() => history('undo')}><Icon name="undo"/></button><button className="icon-button" aria-label="重做" disabled={sequenceLocked || !tab.future.length} onClick={() => history('redo')}><Icon name="redo"/></button></div><button disabled={sequenceLocked} onClick={textEditor}><Icon name="text"/>文本编辑 <kbd>V</kbd></button></div>
        <div ref={scrollRef} className="table-scroll" onClick={e => { if (drag.current?.moved || (e.target as HTMLElement).closest('[data-row-id],button,input,select,textarea')) return; setPasteAt(null); if (!e.ctrlKey && !e.metaKey) { setSelection(new Set()); anchor.current = null; } }} onPointerDown={e => {
          if (e.button !== 0 || (e.target as HTMLElement).closest('input,button,select,textarea,a,summary')) return;
          e.preventDefault(); if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          setPasteAt(null);
          drag.current = { x: e.clientX, y: e.clientY, moved: false, initial: e.ctrlKey || e.metaKey ? new Set(selection) : new Set() };
        }}><div className="table-head" aria-hidden="true"><span>起始小节</span><span>结束小节</span><span>拍号</span><span>速度 <small>♩ = BPM</small></span><span>小节数</span></div><div className="table-body">{song.rows.flatMap((row, index) => [gap(index), <div id={`row-${row.id}`} data-row-id={row.id} key={row.id} role="row" aria-selected={selection.has(row.id)} aria-label={`第 ${index + 1} 行`} className={`segment-row ${row.type === 'comment' ? 'comment-row' : ''} ${selection.has(row.id) ? 'selected' : ''} ${position.sectionId === row.id ? 'current' : ''}`} onClick={e => { if (drag.current?.moved || (e.target as HTMLElement).closest('input,select,button,textarea')) return; selectRow(row.id, e.shiftKey, e.ctrlKey || e.metaKey); }}>
          {row.type === 'comment' ? <div className="comment-content"><span>#</span><input aria-label={`第 ${index + 1} 行注释`} disabled={sequenceLocked} value={row.text} onChange={e => modifyRow(row.id, { text: e.target.value })}/></div> : <><div className="start-cell">{row.id === list[0]?.id ? <span className="fixed-start">1</span> : <NumberField label={`第 ${index + 1} 行起始小节`} value={row.start} min={list[list.findIndex(r => r.id === row.id) - 1].start + 1} max={sectionEnd(song, row.id)} integer disabled={sequenceLocked} onCommit={start => modifyRow(row.id, { start })}/>}</div><div className="end-cell">{row.id === list.at(-1)?.id ? <NumberField label="曲目最后小节" value={song.endExclusive - 1} min={row.start} max={Number.MAX_SAFE_INTEGER - 1} integer disabled={sequenceLocked} onCommit={end => updateSong(s => ({ ...s, endExclusive: end + 1 }))}/> : <span>{sectionEnd(song, row.id)}</span>}</div><MeterFields label={`第 ${index + 1} 行`} meter={row.meter} disabled={sequenceLocked} onChange={meter => modifyRow(row.id, { meter })}/><div className="bpm-cell"><NumberField label={`第 ${index + 1} 行 BPM`} value={row.bpm} min={20} max={400} disabled={sequenceLocked} onCommit={bpm => modifyRow(row.id, { bpm })}/></div><span className="length-cell">{position.phase === 'playing' && position.sectionId === row.id ? <><strong>{position.localBar}</strong><span>/ {sectionEnd(song, row.id) - row.start + 1}</span></> : sectionEnd(song, row.id) - row.start + 1}</span></>}
        </div>])}{gap(song.rows.length)}{!list.length && <div className="empty-state">还没有演奏段落。</div>}</div></div>
        <div className="selection-toolbar"><button disabled={!selection.size} onClick={() => void toolbarCopy()}><Icon name="copy"/>复制 <kbd>Ctrl C</kbd></button><button disabled={sequenceLocked} onClick={() => void toolbarPaste()}><Icon name="paste"/>粘贴 <kbd>Ctrl V</kbd></button><button disabled={sequenceLocked || !selection.size} className="delete-action" onClick={() => remove()}><Icon name="trash"/>删除 <kbd>Del</kbd></button></div>
      </section>}
    </main>
    <input ref={fileInput} type="file" accept=".txt,.json,text/plain,application/json" hidden onChange={e => { void importFile(e.target.files?.[0]); e.currentTarget.value = ''; }}/>
    {notice && <div className="toast" role="status">{notice}</div>}{marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}/ >}

    {modal && <Dialog title={modal.type === 'text' ? '编辑曲目文本' : modal.type === 'rename' ? '重命名曲目' : modal.type === 'close' ? '保存修改？' : modal.type === 'library' ? '打开已保存曲目' : modal.title} close={() => setModal(null)} footer={modal.type === 'text' ? <><button onClick={() => setModal(null)}>取消</button><button className="primary" onClick={acceptText}>确定</button></> : modal.type === 'rename' ? <><button onClick={() => setModal(null)}>取消</button><button className="primary" disabled={!modal.text.trim()} onClick={() => { setAll(tabsRef.current.map(t => t.id === modal.tabId ? commit(t, { ...t.song, title: modal.text.trim() }) : t)); setModal(null); }}>确定</button></> : modal.type === 'close' ? <><button onClick={() => setModal(null)}>取消</button><button onClick={() => finishClose(modal.tabId)}>不保存</button><button className="primary" onClick={() => { if (save(modal.tabId)) finishClose(modal.tabId); }}>保存</button></> : <button className="primary" onClick={() => setModal(null)}>确定</button>}>
      {modal.type === 'text' ? <><div className="format-help"><strong>每段一行：起始小节 拍号 BPM</strong><span>例如：<code>1 4/4 120</code>。<code>#</code> 开头为注释，最后独立数字为最后实际小节 + 1。第一段从 1 开始，</span></div><textarea autoFocus spellCheck={false} aria-label="曲目文本" className="text-editor" value={modal.text} onChange={e => { setModal({ ...modal, text: e.target.value }); setParseError(''); }}/>{parseError && <pre className="parse-error" role="alert">{parseError}</pre>}</> : modal.type === 'rename' ? <label className="rename-label">曲目名称<input autoFocus maxLength={100} value={modal.text} onFocus={e => e.target.select()} onChange={e => setModal({ ...modal, text: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && modal.text.trim() && !e.nativeEvent.isComposing) { setAll(tabsRef.current.map(t => t.id === modal.tabId ? commit(t, { ...t.song, title: modal.text.trim() }) : t)); setModal(null); } }}/></label> : modal.type === 'library' ? <div className="saved-list">{modal.entries.length ? modal.entries.map(entry => <button key={entry.id} onClick={() => openSaved(entry)}><span>{entry.song.title}</span><small>{sections(entry.song).length} 段 · {entry.song.endExclusive - 1} 小节</small></button>) : <p>还没有保存的曲目。使用 Ctrl+S 保存后会显示在这里。</p>}</div> : modal.type === 'close' ? <p>“{tabs.find(t => t.id === modal.tabId)?.song.title}”有未保存的修改。</p> : <p className="message-text">{modal.type === 'message' ? modal.text : ''}</p>}
    </Dialog>}

  </div>;
}
