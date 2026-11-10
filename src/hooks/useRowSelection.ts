import { useEvent } from './useEvent';
import { useEffect, useRef, useState } from 'react';
import type { Row } from '../model';
import { selectRows } from '../selection';

export function useRowSelection(rows: Row[]) {
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [pasteAt, setPasteAt] = useState<number | null>(null);
  const anchor = useRef<string | null>(null);
  const editorRef = useRef<HTMLElement>(null),
    scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; initial: Set<string>; moved: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const selectRow = useEvent(function selectRow(id: string, shift: boolean, additive: boolean) {
    setPasteAt(null);
    setSelection((previous) =>
      selectRows(
        rows.map((r) => r.id),
        previous,
        id,
        anchor.current,
        shift,
        additive,
      ),
    );
    if (!shift || !rows.some((r) => r.id === anchor.current)) anchor.current = id;
  });

  useEffect(() => {
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    function outside(e: PointerEvent) {
      if (e.target instanceof Node && !editorRef.current?.contains(e.target)) {
        setPasteAt(null);
        if (!e.ctrlKey && !e.metaKey) {
          setSelection(new Set());
          anchor.current = null;
        }
      }
    }
    function move(e: PointerEvent) {
      const d = drag.current;
      if (!d || Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 6) return;
      d.moved = true;
      setPasteAt(null);
      const rect = {
        x: Math.min(d.x, e.clientX),
        y: Math.min(d.y, e.clientY),
        width: Math.abs(e.clientX - d.x),
        height: Math.abs(e.clientY - d.y),
      };
      setMarquee(rect);
      const next = new Set(d.initial);
      const container = scrollRef.current,
        viewport = container?.getBoundingClientRect();
      container?.querySelectorAll<HTMLElement>('[data-row-id]').forEach((el) => {
        const box = el.getBoundingClientRect();
        if (
          viewport &&
          box.bottom >= viewport.top &&
          box.top <= viewport.bottom &&
          box.bottom >= rect.y &&
          box.top <= rect.y + rect.height &&
          box.right >= rect.x &&
          box.left <= rect.x + rect.width
        )
          next.add(el.dataset.rowId!);
      });
      setSelection(next);
    }
    function up() {
      setMarquee(null);
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => {
        drag.current = null;
      }, 0);
    }
    function cancel() {
      clearTimeout(releaseTimer);
      drag.current = null;
      setMarquee(null);
    }
    document.addEventListener('pointerdown', outside);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      clearTimeout(releaseTimer);
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, []);
  return {
    selection,
    setSelection,
    pasteAt,
    setPasteAt,
    anchor,
    editorRef,
    scrollRef,
    drag,
    marquee,
    selectRow,
  };
}
