import { fingerprint, validate } from './model';
import type { Song } from './model';
import type { Tab } from './storage';
export type SavedEntry = { id: string; song: Song };
export const STORAGE_KEY = 'metronome.workspace.v1';
type Document = {
  version: 2;
  active: string;
  tabs: string[];
  library: SavedEntry[];
  previousSave?: SavedEntry;
  quarantined: unknown[];
  warnings: string[];
};
type Reader = Pick<Storage, 'getItem'>;
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
function entry(v: unknown): SavedEntry {
  if (!record(v) || typeof v.id !== 'string' || !v.id) throw Error('曲目标识无效。');
  return { id: v.id, song: validate(v.song as Song) };
}
function readDocument(storage: Reader): Document | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw Error('本地保存内容损坏，原始数据仍保留，未覆盖。', { cause: error });
  }
  if (
    !record(data) ||
    ![1, 2].includes(data.version as number) ||
    !Array.isArray(data.tabs) ||
    typeof data.active !== 'string'
  )
    throw Error('本地保存版本或结构不正确，原始数据未覆盖。');
  const candidates = data.library ?? data.tabs;
  if (!Array.isArray(candidates)) throw Error('本地曲目库格式不正确。');
  const quarantined = Array.isArray(data.quarantined) ? [...data.quarantined] : [],
    warnings: string[] = [];
  let previousSave: SavedEntry | undefined;
  try {
    if (data.previousSave) previousSave = entry(data.previousSave);
  } catch {
    /* 损坏副本不替代有效内容 */
  }
  const library: SavedEntry[] = [],
    ids = new Set<string>();
  for (const candidate of candidates) {
    try {
      const item = entry(candidate);
      if (ids.has(item.id)) throw Error('曲目标识重复。');
      ids.add(item.id);
      library.push(item);
    } catch (error) {
      quarantined.push(candidate);
      const id = record(candidate) ? candidate.id : undefined;
      if (previousSave && previousSave.id === id && !ids.has(previousSave.id)) {
        library.push(previousSave);
        ids.add(previousSave.id);
        warnings.push('一首损坏曲目已恢复到上次保存前的版本，损坏内容仍保留。');
      } else
        warnings.push(
          '一首无效曲目已隔离，其他曲目仍可使用。' + (error instanceof Error ? error.message : ''),
        );
    }
  }
  const tabs =
    data.version === 1
      ? data.tabs.flatMap((item) => (record(item) && typeof item.id === 'string' ? [item.id] : []))
      : data.tabs.filter((id): id is string => typeof id === 'string');
  return {
    version: 2,
    active: data.active,
    tabs: [...new Set(tabs)].filter((id) => ids.has(id)),
    library,
    previousSave,
    quarantined,
    warnings,
  };
}
export function loadLibrary(storage: Reader): SavedEntry[] {
  return readDocument(storage)?.library ?? [];
}
export function loadWorkspace(storage: Reader) {
  const data = readDocument(storage);
  if (!data) return null;
  const library = new Map(data.library.map((item) => [item.id, item]));
  const tabs: Tab[] = data.tabs.flatMap((id) => {
    const saved = library.get(id);
    return saved
      ? [{ id, song: saved.song, saved: fingerprint(saved.song), past: [], future: [] }]
      : [];
  });
  return {
    tabs,
    active: tabs.some((t) => t.id === data.active) ? data.active : (tabs[0]?.id ?? ''),
    warnings: data.warnings,
  };
}
export function persistWorkspace(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  tabs: Tab[],
  active: string,
  savingId?: string,
) {
  const current = readDocument(storage),
    library = new Map((current?.library ?? []).map((item) => [item.id, item]));
  let previousSave = current?.previousSave;
  // 只保存明确指定的曲目；其他打开标签不能用旧快照覆盖曲目库。
  for (const tab of tabs) {
    if (tab.id === savingId) {
      const disk = library.get(tab.id);
      if (disk && fingerprint(disk.song) !== tab.saved)
        throw Error(
          '这首曲目已在另一个网页中保存。请先导出当前修改，再关闭此标签并通过“打开”读取最新版本。',
        );
      if (!disk && tab.saved && current)
        throw Error('这首曲目的本地保存已改变或被移除，请导出当前修改后重新打开。');
      previousSave = disk ?? previousSave;
      library.set(tab.id, { id: tab.id, song: validate(tab.song) });
    } else if (!library.has(tab.id) && tab.saved && !current)
      library.set(tab.id, { id: tab.id, song: validate(JSON.parse(tab.saved)) });
  }
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 2,
      active,
      tabs: tabs.filter((t) => library.has(t.id)).map((t) => t.id),
      library: [...library.values()],
      previousSave,
      quarantined: current?.quarantined ?? [],
    }),
  );
}
/** 同一来源的多个网页串行执行读取、冲突检查、写入。 */
export async function withStorageLock<T>(work: () => T): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return navigator.locks.request(STORAGE_KEY, work);
  return work();
}
