import { memo, useMemo } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { ClipRow, Section, Song } from '../model';
import type { Tab } from '../storage';
import type { Position } from '../transport';
import { Icon, MeterFields, NumberField } from './Controls';

type Props = {
  editorRef: RefObject<HTMLElement | null>;
  follow: boolean;
  setFollow: Dispatch<SetStateAction<boolean>>;
  sequenceLocked: boolean;
  add: (at?: number, content?: ClipRow[]) => void;
  insertion: number;
  tab: Tab;
  history: (direction: 'undo' | 'redo') => void;
  textEditor: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  drag: RefObject<{ x: number; y: number; initial: Set<string>; moved: boolean } | null>;
  setPasteAt: Dispatch<SetStateAction<number | null>>;
  setSelection: Dispatch<SetStateAction<Set<string>>>;
  anchor: RefObject<string | null>;
  selection: Set<string>;
  song: Song;
  pasteAt: number | null;
  position: Pick<Position, 'phase' | 'sectionId' | 'localBar'>;
  selectRow: (id: string, shift: boolean, additive: boolean) => void;
  modifyRow: (id: string, change: Partial<Section> | { text: string }) => void;
  list: Section[];
  updateSong: (change: (song: Song) => Song) => void;
  toolbarCopy: () => Promise<void>;
  toolbarPaste: () => Promise<void>;
  remove: () => void;
};
export const SegmentEditor = memo(function SegmentEditor({
  editorRef,
  follow,
  setFollow,
  sequenceLocked,
  add,
  insertion,
  tab,
  history,
  textEditor,
  scrollRef,
  drag,
  setPasteAt,
  setSelection,
  anchor,
  selection,
  song,
  pasteAt,
  position,
  selectRow,
  modifyRow,
  list,
  updateSong,
  toolbarCopy,
  toolbarPaste,
  remove,
}: Props) {
  const ends = useMemo(
    () =>
      new Map(
        list.map((row, index) => [row.id, (list[index + 1]?.start ?? song.endExclusive) - 1]),
      ),
    [list, song.endExclusive],
  );
  const starts = useMemo(
    () => new Map(list.map((row, index) => [row.id, (list[index - 1]?.start ?? 0) + 1])),
    [list],
  );
  function gap(index: number) {
    return (
      <div key={'gap-' + index} className={'insert-gap ' + (pasteAt === index ? 'chosen' : '')}>
        <button
          disabled={sequenceLocked}
          onClick={() => {
            setPasteAt(index);
            setSelection(new Set());
            anchor.current = null;
          }}
          aria-label={'选择第 ' + (index + 1) + ' 个插入位置'}
        >
          <span>＋</span>
          <span className="gap-label">在此新增或粘贴</span>
        </button>
      </div>
    );
  }

  return (
    <section ref={editorRef} className="editor" aria-label="段落编辑器">
      <div className="editor-heading">
        <h3>段落列表</h3>
        <label className="follow">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          列表滚动跟随播放
        </label>
      </div>
      <div className="editor-toolbar">
        <div>
          <button disabled={sequenceLocked} onClick={() => add()}>
            <Icon name="plus" />
            新增段落
          </button>
          <button
            disabled={sequenceLocked}
            onClick={() => add(insertion, [{ type: 'comment', text: '段落注释' }])}
          >
            <Icon name="note" />
            新增注释
          </button>
          <span className="toolbar-divider" />
          <button
            className="icon-button"
            aria-label="撤销"
            disabled={sequenceLocked || !tab.past.length}
            onClick={() => history('undo')}
          >
            <Icon name="undo" />
          </button>
          <button
            className="icon-button"
            aria-label="重做"
            disabled={sequenceLocked || !tab.future.length}
            onClick={() => history('redo')}
          >
            <Icon name="redo" />
          </button>
        </div>
        <button disabled={sequenceLocked} onClick={textEditor}>
          <Icon name="text" />
          文本编辑 <kbd>V</kbd>
        </button>
      </div>
      <div
        ref={scrollRef}
        className="table-scroll"
        onClick={(e) => {
          if (
            drag.current?.moved ||
            (e.target as HTMLElement).closest('[data-row-id],button,input,select,textarea')
          )
            return;
          setPasteAt(null);
          if (!e.ctrlKey && !e.metaKey) {
            setSelection(new Set());
            anchor.current = null;
          }
        }}
        onPointerDown={(e) => {
          if (
            e.button !== 0 ||
            (e.target as HTMLElement).closest('input,button,select,textarea,a,summary')
          )
            return;
          e.preventDefault();
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          setPasteAt(null);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            moved: false,
            initial: e.ctrlKey || e.metaKey ? new Set(selection) : new Set(),
          };
        }}
      >
        <div className="table-head" aria-hidden="true">
          <span>起始小节</span>
          <span>结束小节</span>
          <span>拍号</span>
          <span>
            速度 <small>♩ = BPM</small>
          </span>
          <span>小节数</span>
        </div>
        <div className="table-body">
          {song.rows.flatMap((row, index) => [
            gap(index),
            <div
              id={`row-${row.id}`}
              data-row-id={row.id}
              key={row.id}
              role="row"
              aria-selected={selection.has(row.id)}
              aria-label={`第 ${index + 1} 行`}
              className={`segment-row ${row.type === 'comment' ? 'comment-row' : ''} ${selection.has(row.id) ? 'selected' : ''} ${position.sectionId === row.id ? 'current' : ''}`}
              onClick={(e) => {
                if (
                  drag.current?.moved ||
                  (e.target as HTMLElement).closest('input,select,button,textarea')
                )
                  return;
                selectRow(row.id, e.shiftKey, e.ctrlKey || e.metaKey);
              }}
            >
              {row.type === 'comment' ? (
                <div className="comment-content">
                  <span>#</span>
                  <input
                    aria-label={`第 ${index + 1} 行注释`}
                    disabled={sequenceLocked}
                    value={row.text}
                    onChange={(e) => modifyRow(row.id, { text: e.target.value })}
                  />
                </div>
              ) : (
                <>
                  <div className="start-cell">
                    {row.id === list[0]?.id ? (
                      <span className="fixed-start">1</span>
                    ) : (
                      <NumberField
                        label={`第 ${index + 1} 行起始小节`}
                        value={row.start}
                        min={starts.get(row.id)!}
                        max={ends.get(row.id)!}
                        integer
                        disabled={sequenceLocked}
                        onCommit={(start) => modifyRow(row.id, { start })}
                      />
                    )}
                  </div>
                  <div className="end-cell">
                    {row.id === list.at(-1)?.id ? (
                      <NumberField
                        label="曲目最后小节"
                        value={song.endExclusive - 1}
                        min={row.start}
                        max={Number.MAX_SAFE_INTEGER - 1}
                        integer
                        disabled={sequenceLocked}
                        onCommit={(end) => updateSong((s) => ({ ...s, endExclusive: end + 1 }))}
                      />
                    ) : (
                      <span>{ends.get(row.id)!}</span>
                    )}
                  </div>
                  <MeterFields
                    label={`第 ${index + 1} 行`}
                    meter={row.meter}
                    disabled={sequenceLocked}
                    onChange={(meter) => modifyRow(row.id, { meter })}
                  />
                  <div className="bpm-cell">
                    <NumberField
                      label={`第 ${index + 1} 行 BPM`}
                      value={row.bpm}
                      min={20}
                      max={400}
                      disabled={sequenceLocked}
                      onCommit={(bpm) => modifyRow(row.id, { bpm })}
                    />
                  </div>
                  <span className="length-cell">
                    {position.phase === 'playing' && position.sectionId === row.id ? (
                      <>
                        <strong>{position.localBar}</strong>
                        <span>/ {ends.get(row.id)! - row.start + 1}</span>
                      </>
                    ) : (
                      ends.get(row.id)! - row.start + 1
                    )}
                  </span>
                </>
              )}
            </div>,
          ])}
          {gap(song.rows.length)}
          {!list.length && <div className="empty-state">还没有演奏段落。</div>}
        </div>
      </div>
      <div className="selection-toolbar">
        <button disabled={!selection.size} onClick={() => void toolbarCopy()}>
          <Icon name="copy" />
          复制 <kbd>Ctrl C</kbd>
        </button>
        <button disabled={sequenceLocked} onClick={() => void toolbarPaste()}>
          <Icon name="paste" />
          粘贴 <kbd>Ctrl V</kbd>
        </button>
        <button
          disabled={sequenceLocked || !selection.size}
          className="delete-action"
          onClick={() => remove()}
        >
          <Icon name="trash" />
          删除 <kbd>Del</kbd>
        </button>
      </div>
    </section>
  );
});
