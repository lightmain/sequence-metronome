import { strFromU8, unzipSync, zipSync } from 'fflate';
import type { Unzipped, Zippable } from 'fflate';
import { parseJson, parseText } from './model';
import type { Song } from './model';

export const MAX_ZIP_BYTES = 200 * 1024 * 1024;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 300 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 32;

export type ZipFileEntry = { name: string; bytes: Uint8Array };
export type ZipSelection = {
  json?: ZipFileEntry;
  txt?: ZipFileEntry;
  audio?: ZipFileEntry;
};

const audioExtensions = ['wav', 'mp3'] as const;

export function isZipFile(name: string) {
  return name.toLowerCase().endsWith('.zip');
}

export function zipBaseName(name: string) {
  return name.replace(/\.zip$/i, '').trim() || '曲目';
}

export function archiveBaseName(title: string) {
  const base = title
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '');
  return base || '曲目';
}

export function audioExtension(name: string, type = '') {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase();
  if (extension === 'wav' || extension === 'mp3') return extension;
  return type === 'audio/mpeg' ? 'mp3' : 'wav';
}

export function audioMime(name: string) {
  return audioExtension(name) === 'mp3' ? 'audio/mpeg' : 'audio/wav';
}

/** 根目录、与 ZIP 同基名的 txt/json 和第一个 wav/mp3。 */
export function selectZipEntries(entries: Unzipped, zipName: string): ZipSelection {
  const base = zipBaseName(zipName).toLowerCase();
  const selection: ZipSelection = {};
  for (const name of Object.keys(entries).sort((a, b) => a.localeCompare(b))) {
    if (name.includes('/') || name.includes('\\') || name.endsWith('/')) continue;
    const lower = name.toLowerCase();
    const bytes = entries[name];
    if (lower === `${base}.json`) {
      selection.json ??= { name, bytes };
      continue;
    }
    if (lower === `${base}.txt`) {
      selection.txt ??= { name, bytes };
      continue;
    }
    for (const extension of audioExtensions)
      if (lower === `${base}.${extension}` && !selection.audio) {
        selection.audio = { name, bytes };
        break;
      }
  }
  return selection;
}

/** JSON 优先；JSON 不可用时回退 TXT；两者都失败时使用统一文案。 */
export function chooseSequence(
  selection: ZipSelection,
  title: string,
): { song: Song; source: 'json' | 'txt' } {
  if (selection.json) {
    try {
      return { song: parseJson(strFromU8(selection.json.bytes)), source: 'json' };
    } catch {
      /* 回退 TXT */
    }
  }
  if (selection.txt) {
    try {
      return { song: parseText(strFromU8(selection.txt.bytes), title), source: 'txt' };
    } catch {
      /* 统一报错 */
    }
  }
  throw Error('节拍器序列读取错误');
}

export function sequenceShas(song: Song) {
  const shas = new Set<string>();
  if (!song.music) return shas;
  for (const sha of Object.keys(song.music.audios ?? {})) shas.add(sha);
  for (const sha of Object.keys(song.music.alignments ?? {})) shas.add(sha);
  if (song.music.activeSha) shas.add(song.music.activeSha);
  return shas;
}

export async function readZipFile(file: File) {
  if (file.size > MAX_ZIP_BYTES) throw Error('ZIP 文件过大。');
  let entries: Unzipped;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch (cause) {
    throw Error('ZIP 文件无法读取。', { cause });
  }
  const names = Object.keys(entries);
  if (names.length > MAX_ZIP_ENTRIES) throw Error('ZIP 内文件过多。');
  let total = 0;
  for (const name of names) {
    if (
      name.startsWith('/') ||
      name.includes('\\') ||
      name.split('/').some((part) => part === '..')
    )
      throw Error('ZIP 包含不安全的路径。');
    total += entries[name].byteLength;
    if (total > MAX_ZIP_UNCOMPRESSED_BYTES) throw Error('ZIP 解压后过大。');
  }
  return entries;
}

export function createZip(entries: ZipFileEntry[]) {
  const data: Zippable = {};
  for (const entry of entries) {
    if (data[entry.name]) throw Error('ZIP 内文件重名。');
    data[entry.name] = entry.bytes;
  }
  return new Blob([zipSync(data, { level: 0 }) as unknown as BlobPart], {
    type: 'application/zip',
  });
}
