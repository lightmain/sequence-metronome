import { fingerprint, validate } from './model';
import type { Song } from './model';
export type Tab = { id: string; song: Song; saved?: string; past: Song[]; future: Song[] };
export const STORAGE_KEY = 'metronome.workspace.v1';
export type SavedEntry = { id: string; song: Song };
export function loadLibrary(storage: Pick<Storage, 'getItem'>): SavedEntry[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const data = JSON.parse(raw);
  const entries = data.library ?? data.tabs;
  if (data.version !== 1 || !Array.isArray(entries)) throw Error('本地曲目库格式不正确。');
  const ids = new Set<string>();
  return entries.map(item => {
    if (!item || typeof item.id !== 'string' || ids.has(item.id)) throw Error('本地曲目库标识无效。');
    ids.add(item.id); return { id: item.id, song: validate(item.song) };
  });
}
export function loadWorkspace(storage: Pick<Storage, 'getItem'>): { tabs: Tab[]; active: string } | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const data = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.tabs) || typeof data.active !== 'string') throw Error('本地保存格式不正确。');
  const ids = new Set<string>();
  const tabs: Tab[] = data.tabs.map((item: {id: string; song: Song}) => {
    if (!item || typeof item.id !== 'string' || ids.has(item.id)) throw Error('本地曲目标识无效。');
    ids.add(item.id);
    const song = validate(item.song);
    return { id: item.id, song, saved: fingerprint(song), past: [], future: [] };
  });
  return { tabs, active: ids.has(data.active) ? data.active : tabs[0]?.id ?? '' };
}
// 其他标签只写入已保存版本，避免 Ctrl+S 无意保存其他曲目的草稿。
export function persistWorkspace(storage: Pick<Storage, 'getItem' | 'setItem'>, tabs: Tab[], active: string, savingId?: string) {
  const persisted = tabs.flatMap(tab => {
    const content = tab.id === savingId ? fingerprint(tab.song) : tab.saved;
    return content ? [{ id: tab.id, song: JSON.parse(content) as Song }] : [];
  });
  const library = new Map(loadLibrary(storage).map(entry => [entry.id, entry]));
  for (const entry of persisted) library.set(entry.id, entry);
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, active, tabs: persisted, library: [...library.values()] }));
}
const contentFingerprint = (song: Song) => JSON.stringify({ ...song, rows: song.rows.map(({ id: _id, ...content }) => content) });
export const dirty = (tab: Tab) => !tab.saved || contentFingerprint(tab.song) !== contentFingerprint(JSON.parse(tab.saved));
export function commit(tab: Tab, song: Song): Tab {
  validate(song);
  if (contentFingerprint(tab.song) === contentFingerprint(song)) return tab;
  return { ...tab, song, past: [...tab.past.slice(-199), tab.song], future: [] };
}
export function undo(tab: Tab): Tab {
  const song = tab.past.at(-1);
  return song ? { ...tab, song, past: tab.past.slice(0, -1), future: [tab.song, ...tab.future] } : tab;
}
export function redo(tab: Tab): Tab {
  const song = tab.future[0];
  return song ? { ...tab, song, past: [...tab.past, tab.song], future: tab.future.slice(1) } : tab;
}
