import { describe, expect, it } from 'vitest';
import { exampleSong, exportText, fingerprint, parseText } from '../src/model';
import {
  commit,
  dirty,
  loadLibrary,
  loadWorkspace,
  persistWorkspace,
  redo,
  STORAGE_KEY,
  undo,
} from '../src/storage';
import type { Tab } from '../src/storage';
const tab = (id: string): Tab => {
  const song = exampleSong();
  return { id, song, saved: fingerprint(song), past: [], future: [] };
};
describe('本地保存和历史', () => {
  it('确认相同文本不会因内部行标识变化而产生修改或撤销记录', () => {
    const original = tab('a');
    const parsed = parseText(exportText(original.song), original.song.title);
    const result = commit(original, parsed);
    expect(result).toBe(original);
    expect(dirty(result)).toBe(false);
  });
  it('修改、撤销至保存内容、重做正确显示未保存状态', () => {
    const a = tab('a'),
      b = commit(a, { ...a.song, title: '改名' });
    expect(dirty(b)).toBe(true);
    expect(dirty(undo(b))).toBe(false);
    expect(dirty(redo(undo(b)))).toBe(true);
    const saved = { ...b, saved: fingerprint(b.song) };
    expect(dirty(undo(saved))).toBe(true);
    expect(dirty(redo(undo(saved)))).toBe(false);
  });
  it('保存当前曲目，不提交其他标签未保存草稿', () => {
    const a = tab('a'),
      b = tab('b');
    a.song = { ...a.song, title: 'A新' };
    b.song = { ...b.song, title: 'B草稿' };
    let raw = '';
    const storage = {
      setItem: (_key: string, value: string) => {
        raw = value;
      },
      getItem: () => raw,
    };
    persistWorkspace(storage, [a, b], 'a', 'a');
    const loaded = loadWorkspace(storage)!;
    expect(loaded.tabs[0].song.title).toBe('A新');
    expect(loaded.tabs[1].song.title).toBe('变拍练习');
    expect(loaded.tabs.every((t) => !dirty(t))).toBe(true);
  });
  it('存储失败会向界面报告，不静默成功', () => {
    expect(() =>
      persistWorkspace(
        {
          getItem: () => null,
          setItem: () => {
            throw Error('quota');
          },
        },
        [tab('a')],
        'a',
        'a',
      ),
    ).toThrow('quota');
  });
  it('关闭标签后保留已保存曲目，未保存草稿不会覆盖曲目库', () => {
    let raw = '';
    const storage = {
      setItem: (_key: string, value: string) => {
        raw = value;
      },
      getItem: () => raw,
    };
    const a = tab('a');
    persistWorkspace(storage, [a], 'a', 'a');
    const changed = commit(a, { ...a.song, title: '未保存的名称' });
    persistWorkspace(storage, [changed], 'a');
    persistWorkspace(storage, [], '');
    expect(loadWorkspace(storage)!.tabs).toEqual([]);
    expect(loadLibrary(storage)[0].song.title).toBe('变拍练习');
  });
  it('拒绝损坏本地数据', () => {
    expect(() => loadWorkspace({ getItem: () => '{' })).toThrow();
    expect(() => loadWorkspace({ getItem: () => '{"version":3}' })).toThrow();
    expect(STORAGE_KEY).toContain('v2');
  });
});
