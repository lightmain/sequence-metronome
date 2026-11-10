import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
export function Dialog({
  title,
  children,
  footer,
  close,
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const focusBefore = useRef<Element | null>(document.activeElement);
  useEffect(() => {
    const dialog = ref.current,
      previousFocus = focusBefore.current;
    dialog?.showModal();
    const field = dialog?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea');
    field?.focus();
    if (field instanceof HTMLInputElement) field.select();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button aria-label="关闭对话框" onClick={close} className="icon-button">
          ×
        </button>
      </div>
      <div className="dialog-body">{children}</div>
      <div className="dialog-footer">{footer}</div>
    </dialog>
  );
}
