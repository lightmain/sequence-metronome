import type { Dispatch, SetStateAction } from 'react';
import type { SavedEntry, Tab } from '../storage';
import { sections } from '../model';
import { Dialog } from './Dialog';
export type Modal =
  | { type: 'text'; text: string }
  | { type: 'rename'; text: string; tabId: string }
  | { type: 'close'; tabId: string }
  | { type: 'message'; title: string; text: string }
  | { type: 'library'; entries: SavedEntry[] };

type Props = {
  modal: Modal;
  tabs: Tab[];
  parseError: string;
  setModal: Dispatch<SetStateAction<Modal | null>>;
  setParseError: Dispatch<SetStateAction<string>>;
  acceptText: () => void;
  save: (id: string) => Promise<boolean>;
  finishClose: (id: string) => Promise<void>;
  renameSong: (id: string, title: string) => void;
  openSaved: (entry: SavedEntry) => void;
};
export function WorkspaceDialog({
  modal,
  tabs,
  parseError,
  setModal,
  setParseError,
  acceptText,
  save,
  finishClose,
  renameSong,
  openSaved,
}: Props) {
  return (
    <Dialog
      title={
        modal.type === 'text'
          ? '编辑曲目文本'
          : modal.type === 'rename'
            ? '重命名曲目'
            : modal.type === 'close'
              ? '保存修改？'
              : modal.type === 'library'
                ? '打开已保存曲目'
                : modal.title
      }
      close={() => setModal(null)}
      footer={
        modal.type === 'text' ? (
          <>
            <button onClick={() => setModal(null)}>取消</button>
            <button className="primary" onClick={acceptText}>
              确定
            </button>
          </>
        ) : modal.type === 'rename' ? (
          <>
            <button onClick={() => setModal(null)}>取消</button>
            <button
              className="primary"
              disabled={!modal.text.trim()}
              onClick={() => {
                renameSong(modal.tabId, modal.text.trim());
              }}
            >
              确定
            </button>
          </>
        ) : modal.type === 'close' ? (
          <>
            <button onClick={() => setModal(null)}>取消</button>
            <button onClick={() => finishClose(modal.tabId)}>不保存</button>
            <button
              className="primary"
              onClick={async () => {
                if (await save(modal.tabId)) await finishClose(modal.tabId);
              }}
            >
              保存
            </button>
          </>
        ) : (
          <button className="primary" onClick={() => setModal(null)}>
            确定
          </button>
        )
      }
    >
      {modal.type === 'text' ? (
        <>
          <div className="format-help">
            <strong>每段一行：起始小节 拍号 BPM</strong>
            <span>
              例如：<code>1 4/4 120</code>。<code>#</code> 开头为注释，最后独立数字为最后实际小节 +
              1。第一段从 1 开始，
            </span>
            <span>
              对齐行（可选）：
              <code>
                Alignment:{'{'}SHA:…, bpm:120, start:250, countin:2, countin_bpm:120,
                countin_time:4/4{'}'}
              </code>
            </span>
          </div>
          <textarea
            autoFocus
            spellCheck={false}
            aria-label="曲目文本"
            className="text-editor"
            value={modal.text}
            onChange={(e) => {
              setModal({ ...modal, text: e.target.value });
              setParseError('');
            }}
          />
          {parseError && (
            <pre className="parse-error" role="alert">
              {parseError}
            </pre>
          )}
        </>
      ) : modal.type === 'rename' ? (
        <label className="rename-label">
          曲目名称
          <input
            autoFocus
            maxLength={100}
            value={modal.text}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setModal({ ...modal, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && modal.text.trim() && !e.nativeEvent.isComposing) {
                renameSong(modal.tabId, modal.text.trim());
              }
            }}
          />
        </label>
      ) : modal.type === 'library' ? (
        <div className="saved-list">
          {modal.entries.length ? (
            modal.entries.map((entry) => (
              <button key={entry.id} onClick={() => openSaved(entry)}>
                <span>{entry.song.title}</span>
                <small>
                  {sections(entry.song).length} 段 · {entry.song.endExclusive - 1} 小节
                </small>
              </button>
            ))
          ) : (
            <p>还没有保存的曲目。使用 Ctrl+S 保存后会显示在这里。</p>
          )}
        </div>
      ) : modal.type === 'close' ? (
        <p>“{tabs.find((t) => t.id === modal.tabId)?.song.title}”有未保存的修改。</p>
      ) : (
        <p className="message-text">{modal.type === 'message' ? modal.text : ''}</p>
      )}
    </Dialog>
  );
}
