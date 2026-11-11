import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Meter } from '../model';
import { denominators } from '../model';
export function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: (
      <>
        <rect x="7" y="5" width="3.5" height="14" rx="1" />
        <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
      </>
    ),
    stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
    plus: <path d="M12 5v14M5 12h14" />,
    save: (
      <>
        <path d="M5 3h12l4 4v14H3V3Z" />
        <path d="M7 3v6h10V3M7 21v-8h10v8" />
      </>
    ),
    undo: (
      <>
        <path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14" />
      </>
    ),
    redo: (
      <>
        <path d="m16 4 5 5-5 5M21 9H11a7 7 0 0 0 0 14" />
      </>
    ),
    text: (
      <>
        <path d="M4 5h16M12 5v15M8 20h8" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M15 8V3H3v13h5" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
      </>
    ),
    note: (
      <>
        <path d="M4 4h16v12H9l-5 4Z" />
        <path d="M8 8h8M8 12h5" />
      </>
    ),
    paste: (
      <>
        <path d="M9 5H5v16h14V5h-4" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <path d="M8 12h8M8 16h6" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  };
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={name === 'play' || name === 'pause' || name === 'stop' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function NumberField({
  value,
  onCommit,
  label,
  min,
  max,
  disabled,
  integer = false,
}: {
  value: number;
  onCommit: (v: number) => void;
  label: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  integer?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const cancelled = useRef(false);
  useEffect(() => setDraft(String(value)), [value]);
  function apply() {
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(String(value));
      return;
    }
    const number = Number(draft);
    if (
      !draft.trim() ||
      !Number.isFinite(number) ||
      (integer && !Number.isInteger(number)) ||
      (min !== undefined && number < min) ||
      (max !== undefined && number > max)
    ) {
      setDraft(String(value));
      window.dispatchEvent(
        new CustomEvent('field-error', {
          detail: `${label}须${integer ? '为整数且' : ''}在 ${min ?? '无限制'}–${max ?? '无限制'} 之间。`,
        }),
      );
      return;
    }
    try {
      onCommit(number);
    } finally {
      setDraft(String(value));
    }
  }
  return (
    <input
      type="number"
      aria-label={label}
      min={min}
      max={max}
      step={integer ? 1 : 'any'}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.stopPropagation();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          cancelled.current = true;
          setDraft(String(value));
          e.currentTarget.blur();
        }
      }}
    />
  );
}
export function MeterFields({
  meter,
  onChange,
  disabled = false,
  label = '',
}: {
  meter: Meter;
  onChange: (v: Meter) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="meter-fields">
      <NumberField
        value={meter[0]}
        label={`${label}拍号分子`}
        min={1}
        max={32}
        integer
        disabled={disabled}
        onCommit={(v) => onChange([v, meter[1]])}
      />
      <span>/</span>
      <select
        aria-label={`${label}拍号分母`}
        value={meter[1]}
        disabled={disabled}
        onChange={(e) => onChange([meter[0], +e.target.value])}
      >
        {denominators.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </div>
  );
}
