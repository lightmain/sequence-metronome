import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  archiveBaseName,
  audioExtension,
  chooseSequence,
  createZip,
  readZipFile,
  selectZipEntries,
  sequenceShas,
  zipBaseName,
} from '../src/zip';
import type { Song } from '../src/model';

const SHA = 'a'.repeat(64);
const song = (): Song => ({
  version: 3,
  title: 'ZIP 测试',
  endExclusive: 3,
  rows: [{ id: 'row', type: 'section', start: 1, meter: [4, 4], bpm: 120 }],
  music: {
    audios: {
      [SHA]: { sha256: SHA, name: '录音.wav', size: 1, type: 'audio/wav', lastModified: 1 },
    },
    alignments: {
      [SHA]: { bpm: 120, start: 250, countin: 0, countin_bpm: 120, countin_time: '4/4' },
    },
    activeSha: SHA,
  },
});
const text = `Alignment:{SHA:${SHA}, bpm:120, start:250, countin:0, countin_bpm:120, countin_time:4/4}\n1 4/4 120\n2\n`;

describe('ZIP 文件命名与选择', () => {
  it('清理导出基名并保留音频扩展名', () => {
    expect(archiveBaseName(' 曲目:一? ')).toBe('曲目_一_');
    expect(archiveBaseName('...')).toBe('曲目');
    expect(zipBaseName('song.ZIP')).toBe('song');
    expect(audioExtension('录音.MP3')).toBe('mp3');
    expect(audioExtension('录音', 'audio/mpeg')).toBe('mp3');
    expect(audioExtension('录音', 'audio/wav')).toBe('wav');
  });

  it('只选择根目录、同基名的 txt/json 和第一个音频', () => {
    const entries = {
      'song.txt': strToU8('txt'),
      'song.json': strToU8('json'),
      'song.wav': strToU8('audio'),
      'song.mp3': strToU8('other'),
      'folder/song.txt': strToU8('nested'),
      'other.txt': strToU8('other'),
    };
    const selected = selectZipEntries(entries, 'song.zip');
    expect(selected.txt?.name).toBe('song.txt');
    expect(selected.json?.name).toBe('song.json');
    expect(selected.audio?.name).toBe('song.mp3');
  });

  it('忽略子目录和没有匹配文件的 ZIP', () => {
    const selected = selectZipEntries(
      { 'folder/song.json': strToU8('{}'), 'song.flac': strToU8('audio') },
      'song.zip',
    );
    expect(selected).toEqual({});
  });
});

describe('ZIP 序列来源', () => {
  it('JSON 有效时优先使用 JSON，即使 TXT 也有效', () => {
    const json = strToU8(JSON.stringify(song()));
    const result = chooseSequence(
      { json: { name: 'song.json', bytes: json }, txt: { name: 'song.txt', bytes: strToU8(text) } },
      'song',
    );
    expect(result.source).toBe('json');
    expect(result.song.title).toBe('ZIP 测试');
  });

  it('JSON 无效时回退 TXT，并使用 ZIP 基名作为标题', () => {
    const result = chooseSequence(
      {
        json: { name: 'song.json', bytes: strToU8('{') },
        txt: { name: 'song.txt', bytes: strToU8(text) },
      },
      'song',
    );
    expect(result.source).toBe('txt');
    expect(result.song.title).toBe('song');
    expect(result.song.music?.alignments[SHA]?.start).toBe(250);
  });

  it('JSON 缺失时使用 TXT', () => {
    const result = chooseSequence({ txt: { name: 'song.txt', bytes: strToU8(text) } }, 'song');
    expect(result.source).toBe('txt');
  });

  it('两者都没有或都失败时使用统一错误文案', () => {
    expect(() => chooseSequence({}, 'song')).toThrow('节拍器序列读取错误');
    expect(() =>
      chooseSequence(
        {
          json: { name: 'song.json', bytes: strToU8('{') },
          txt: { name: 'song.txt', bytes: strToU8('bad') },
        },
        'song',
      ),
    ).toThrow('节拍器序列读取错误');
  });

  it('SHA 集合来自音频、对齐和当前音频', () => {
    const other = 'b'.repeat(64);
    expect([...sequenceShas(song())]).toEqual([SHA]);
    expect([...sequenceShas({ ...song(), music: { ...song().music!, activeSha: other } })]).toEqual(
      [SHA, other],
    );
  });
});

describe('ZIP 打包与读取', () => {
  it('打包三个文件并可重新读取', async () => {
    const blob = createZip([
      { name: 'song.txt', bytes: strToU8(text) },
      { name: 'song.json', bytes: strToU8(JSON.stringify(song())) },
      { name: 'song.wav', bytes: new Uint8Array([1, 2, 3]) },
    ]);
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(['song.json', 'song.txt', 'song.wav']);
    expect([...entries['song.wav']]).toEqual([1, 2, 3]);
  });

  it('拒绝缺少匹配基名的序列', () => {
    const data = zipSync({ 'other.txt': strToU8(text) });
    const file = new File([data as unknown as BlobPart], 'song.zip', { type: 'application/zip' });
    return expect(readZipFile(file)).resolves.toEqual({ 'other.txt': expect.any(Uint8Array) });
  });

  it('读取时拒绝不安全路径', async () => {
    const data = zipSync({ '../song.txt': strToU8(text) });
    const file = new File([data as unknown as BlobPart], 'song.zip', { type: 'application/zip' });
    await expect(readZipFile(file)).rejects.toThrow('不安全的路径');
  });
});
