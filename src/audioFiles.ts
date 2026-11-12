import type { AudioReference } from './model';

const DB = 'metronome.audio.v2';
const LEGACY_DB = 'metronome.audio.v1';
type StoredAudio = { id: string; blob: Blob; created: number };
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? Error('音频数据库无法打开。'));
    request.onblocked = () => reject(Error('音频数据库正被旧网页占用，请关闭旧网页后重试。'));
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('files', mode);
      const request = work(tx.objectStore('files'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? request.error ?? Error('音频保存被中断。'));
      tx.onerror = () => {
        /* onabort 统一报告 */
      };
    });
  } finally {
    db.close();
  }
}
export function audioReference(file: File, sha256: string): AudioReference {
  return {
    sha256,
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
  };
}
export async function readAudio(sha256: string): Promise<Blob | undefined> {
  const record = await transaction<StoredAudio | undefined>('readonly', (store) =>
    store.get(sha256),
  );
  return record?.blob;
}
/** 文件标识不可变：先完成二进制事务，再发布引用它的曲目参数。 */
export async function writeAudio(sha256: string, blob: Blob) {
  await transaction('readwrite', (store) => store.put({ id: sha256, blob, created: Date.now() }));
}
/** 保留恢复版本和隔离数据中的引用，延迟清理，避免删除其他网页刚写入的文件。 */
export async function cleanAudio(document: unknown) {
  const keep = new Set<string>();
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    if (
      'audios' in value &&
      value.audios &&
      typeof value.audios === 'object' &&
      !Array.isArray(value.audios)
    )
      for (const sha of Object.keys(value.audios)) keep.add(sha);
    for (const child of Object.values(value)) visit(child);
  }
  visit(document);
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      const request = tx.objectStore('files').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const item = cursor.value as StoredAudio;
        if (!keep.has(item.id) && item.created < Date.now() - 86400000) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? Error('旧音频清理失败。'));
    });
  } finally {
    db.close();
  }
}
/** 旧版数据库不再读取；用户确认不需要兼容旧数据，升级时直接删除。 */
export function clearLegacyAudio() {
  if (typeof indexedDB === 'undefined') return;
  try {
    indexedDB.deleteDatabase(LEGACY_DB);
  } catch {
    /* 浏览器拒绝删除时忽略，旧数据库不会再被读取。 */
  }
}
