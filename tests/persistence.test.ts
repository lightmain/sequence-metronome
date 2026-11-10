import { describe, expect, it } from 'vitest';
import { newSong, fingerprint } from '../src/model';
import { loadLibrary, loadWorkspace, persistWorkspace, STORAGE_KEY } from '../src/persistence';
import { commit, dirty } from '../src/storage';
import type { Tab } from '../src/storage';

function memory(initial?: unknown) {
  let raw = initial === undefined ? '' : JSON.stringify(initial);
  return {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
  };
}
const savedTab = (id: string): Tab => {
  const song = newSong(id);
  return { id, song, saved: fingerprint(song), past: [], future: [] };
};

describe('本地格式迁移、冲突和损坏恢复', () => {
  it('旧格式可读取，下一次保存迁移到 V4 保存格式且标签不再重复存储曲目', () => {
    const tab = savedTab('a');
    const storage = memory({
      version: 1,
      active: 'a',
      tabs: [{ id: 'a', song: tab.song }],
      library: [{ id: 'a', song: tab.song }],
    });
    expect(loadWorkspace(storage)!.tabs[0].song).toEqual(tab.song);
    persistWorkspace(storage, [tab], 'a', 'a');
    const raw = JSON.parse(storage.getItem());
    expect(raw.version).toBe(3);
    expect(raw.tabs).toEqual(['a']);
    expect(raw.library).toHaveLength(1);
  });
  it('旧网页元数据写入不覆盖新内容，旧版本保存明确失败并保留修改', () => {
    const storage = memory(),
      original = savedTab('a');
    persistWorkspace(storage, [original], 'a', 'a');
    const stale = loadWorkspace(storage)!.tabs[0];
    const changed = commit(original, { ...original.song, title: '最新保存' });
    persistWorkspace(storage, [changed], 'a', 'a');
    persistWorkspace(storage, [stale], 'a');
    expect(loadLibrary(storage)[0].song.title).toBe('最新保存');
    const draft = commit(stale, { ...stale.song, title: '旧页修改' });
    const before = storage.getItem();
    expect(() => persistWorkspace(storage, [draft], 'a', 'a')).toThrow('另一个网页');
    expect(storage.getItem()).toBe(before);
    expect(dirty(draft)).toBe(true);
  });
  it('损坏单首曲目隔离原始条目，其他曲目继续可读可保存', () => {
    const good = savedTab('good'),
      bad = { id: 'bad', song: { broken: true } };
    const storage = memory({
      version: 2,
      active: 'bad',
      tabs: ['bad', 'good'],
      library: [bad, { id: 'good', song: good.song }],
    });
    const result = loadWorkspace(storage)!;
    expect(result.tabs.map((t) => t.id)).toEqual(['good']);
    expect(result.warnings).toHaveLength(1);
    persistWorkspace(storage, result.tabs, 'good');
    expect(JSON.parse(storage.getItem()).quarantined).toEqual([bad]);
    expect(loadLibrary(storage)[0].id).toBe('good');
  });
  it('最后一次被覆盖的曲目留有一个恢复版本', () => {
    const storage = memory(),
      original = savedTab('a');
    persistWorkspace(storage, [original], 'a', 'a');
    persistWorkspace(storage, [commit(original, { ...original.song, title: '新版本' })], 'a', 'a');
    const raw = JSON.parse(storage.getItem());
    raw.library[0].song.rows[0].bpm = '坏数据';
    storage.setItem(STORAGE_KEY, JSON.stringify(raw));
    const recovered = loadWorkspace(storage)!;
    expect(recovered.tabs[0].song.title).toBe('a');
    expect(recovered.warnings[0]).toContain('恢复');
    persistWorkspace(storage, recovered.tabs, 'a');
    expect(JSON.parse(storage.getItem()).quarantined[0].song.title).toBe('新版本');
  });
  it.each(['{', '{"version":999,"tabs":[],"active":""}'])(
    '无法读取的整个文档不被覆盖：%s',
    (raw) => {
      let value = raw;
      const storage = {
        getItem: () => value,
        setItem: (_key: string, next: string) => {
          value = next;
        },
      };
      expect(() => persistWorkspace(storage, [savedTab('a')], 'a', 'a')).toThrow();
      expect(value).toBe(raw);
    },
  );
  it('字段顺序变化不触发误报保存冲突', () => {
    const storage = memory(),
      tab = savedTab('a');
    persistWorkspace(storage, [tab], 'a', 'a');
    const raw = JSON.parse(storage.getItem());
    raw.library[0].song = {
      rows: raw.library[0].song.rows,
      endExclusive: 2,
      title: 'a',
      version: 1,
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(raw));
    expect(() => persistWorkspace(storage, [tab], 'a', 'a')).not.toThrow();
  });
});
