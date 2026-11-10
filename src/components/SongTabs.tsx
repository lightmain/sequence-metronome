import type { Tab } from '../storage';
import { Icon } from './Controls';
type Props = {
  tabs: Tab[];
  active: string;
  dirtyTabs: Map<string, boolean>;
  switchTab: (id: string) => void;
  rename: (id: string) => void;
  closeTab: (id: string) => void;
  addTab: () => void;
};
export function SongTabs({ tabs, active, dirtyTabs, switchTab, rename, closeTab, addTab }: Props) {
  return (
    <div className="tabs-bar" role="tablist" aria-label="曲目标签">
      {tabs.map((t) => (
        <div key={t.id} className={`song-tab ${t.id === active ? 'active' : ''}`}>
          <button
            role="tab"
            aria-selected={t.id === active}
            onClick={() => switchTab(t.id)}
            onDoubleClick={() => {
              switchTab(t.id);
              rename(t.id);
            }}
          >
            <span>{t.song.title}</span>
            {dirtyTabs.get(t.id) && (
              <span className="dirty" aria-label="未保存">
                *
              </span>
            )}
          </button>
          <button
            className="tab-close"
            aria-label={`关闭 ${t.song.title}`}
            onClick={() => closeTab(t.id)}
          >
            ×
          </button>
        </div>
      ))}
      <button className="new-tab" aria-label="新建曲目" onClick={() => addTab()}>
        <Icon name="plus" />
      </button>
    </div>
  );
}
