import { fingerprint, validate } from './model';
import type { Song } from './model';
export {
  STORAGE_KEY,
  loadWorkspace,
  loadLibrary,
  persistWorkspace,
  withStorageLock,
} from './persistence';
export type { SavedEntry } from './persistence';
export type Tab = { id: string; song: Song; saved?: string; past: Song[]; future: Song[] };
const contentFingerprint = (song: Song) =>
  fingerprint({ ...song, rows: song.rows.map((row) => ({ ...row, id: '' })) });
export const dirty = (tab: Tab) =>
  !tab.saved || contentFingerprint(tab.song) !== contentFingerprint(JSON.parse(tab.saved));
export function commit(tab: Tab, song: Song): Tab {
  validate(song);
  if (contentFingerprint(tab.song) === contentFingerprint(song)) return tab;
  return { ...tab, song, past: [...tab.past.slice(-199), tab.song], future: [] };
}
export function undo(tab: Tab): Tab {
  const song = tab.past.at(-1);
  return song
    ? { ...tab, song, past: tab.past.slice(0, -1), future: [tab.song, ...tab.future] }
    : tab;
}
export function redo(tab: Tab): Tab {
  const song = tab.future[0];
  return song ? { ...tab, song, past: [...tab.past, tab.song], future: tab.future.slice(1) } : tab;
}
