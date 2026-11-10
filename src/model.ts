export type Meter = [number, number];
export type Section = { id: string; type: 'section'; start: number; meter: Meter; bpm: number };
export type Comment = { id: string; type: 'comment'; text: string };
export type Row = Section | Comment;
export type Song = { version: 1; title: string; endExclusive: number; rows: Row[] };
export type ClipRow =
  | { type: 'section'; length: number; meter: Meter; bpm: number }
  | { type: 'comment'; text: string };
export const denominators = [1, 2, 4, 8, 16, 32];
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 10000;
export const uid = () => crypto.randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);
export const sections = (song: Song) => song.rows.filter((r): r is Section => r.type === 'section');
export function sectionEnd(song: Song, id: string) {
  const list = sections(song),
    index = list.findIndex((r) => r.id === id);
  return (list[index + 1]?.start ?? song.endExclusive) - 1;
}
export const beatSeconds = (meter: Meter, bpm: number) => ((60 / bpm) * 4) / meter[1];
export function validate(song: Song): Song {
  if (!song || song.version !== 1 || typeof song.title !== 'string' || !Array.isArray(song.rows))
    throw Error('曲目格式不正确，version 必须为 1。');
  if (!song.title.trim() || song.title.length > 200) throw Error('曲目名称须为 1–200 个字符。');
  if (song.rows.length > MAX_ROWS) throw Error(`曲目最多包含 ${MAX_ROWS} 行。`);
  if (!Number.isSafeInteger(song.endExclusive) || song.endExclusive < 1)
    throw Error('结束边界必须是正整数。');
  const ids = new Set<string>();
  let previous = 0;
  for (const [index, row] of song.rows.entries()) {
    const at = `第 ${index + 1} 行：`;
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id))
      throw Error(at + '行标识缺失或重复。');
    ids.add(row.id);
    if (row.type === 'comment') {
      if (typeof row.text !== 'string' || row.text.length > 20000)
        throw Error(at + '注释必须是文字且不能超过 20000 个字符。');
    } else if (row.type === 'section') {
      if (
        !Number.isSafeInteger(row.start) ||
        row.start <= previous ||
        (!previous && row.start !== 1)
      )
        throw Error(at + '第一段从 1 开始，后续起点必须严格递增。');
      if (
        !Array.isArray(row.meter) ||
        row.meter.length !== 2 ||
        !Number.isInteger(row.meter[0]) ||
        row.meter[0] < 1 ||
        row.meter[0] > 32 ||
        !denominators.includes(row.meter[1])
      )
        throw Error(at + '分子须为 1–32，分母须为 1、2、4、8、16、32。');
      if (!Number.isFinite(row.bpm) || row.bpm < 20 || row.bpm > 400)
        throw Error(at + 'BPM 须在 20–400 之间。');
      previous = row.start;
    } else throw Error(at + '未知行类型。');
  }
  if (previous ? song.endExclusive <= previous : song.endExclusive !== 1)
    throw Error('结束边界必须大于最后一段起点；空曲目的结束边界为 1。');
  return song;
}
export function exampleSong(): Song {
  return {
    version: 1,
    title: '变拍练习',
    endExclusive: 130,
    rows: [
      { id: uid(), type: 'section', start: 1, meter: [4, 4], bpm: 120 },
      { id: uid(), type: 'comment', text: '变拍 · 留意第 63 小节' },
      { id: uid(), type: 'section', start: 63, meter: [2, 4], bpm: 120 },
      { id: uid(), type: 'section', start: 64, meter: [4, 4], bpm: 120 },
    ],
  };
}
export function newSong(title = '未命名曲目'): Song {
  return {
    version: 1,
    title,
    endExclusive: 2,
    rows: [{ id: uid(), type: 'section', start: 1, meter: [4, 4], bpm: 120 }],
  };
}
export function insertRows(original: Song, position: number, clips?: ClipRow[]): Song {
  const song = clone(original);
  if (!Number.isInteger(position) || position < 0 || position > song.rows.length)
    throw Error('插入位置不正确。');
  const before = song.rows
    .slice(0, position)
    .filter((r): r is Section => r.type === 'section')
    .at(-1);
  const after = song.rows.slice(position).find((r): r is Section => r.type === 'section');
  const template = before ?? after;
  const content = clips ?? [
    { type: 'section', length: 1, meter: template?.meter ?? [4, 4], bpm: template?.bpm ?? 120 },
  ];
  let cursor = after?.start ?? song.endExclusive;
  const added = content.map((clip): Row => {
    if (clip.type === 'comment') return { id: uid(), ...clip };
    if (!Number.isSafeInteger(clip.length) || clip.length < 1)
      throw Error('粘贴段落的长度必须为正整数。');
    const row: Section = {
      id: uid(),
      type: 'section',
      start: cursor,
      meter: [...clip.meter],
      bpm: clip.bpm,
    };
    cursor += clip.length;
    return row;
  });
  song.rows.splice(position, 0, ...added);
  if (content.some((c) => c.type === 'section')) {
    for (const row of song.rows.slice(position + added.length)) {
      if (row.type === 'comment') continue;
      row.start = Math.max(row.start, cursor);
      cursor = row.start + 1;
    }
    song.endExclusive = Math.max(song.endExclusive, cursor);
  }
  return validate(song);
}
export function removeRows(original: Song, selected: Set<string>, toComment = false): Song {
  const song = clone(original);
  let pendingStart: number | undefined;
  const result: Row[] = [];
  for (const row of song.rows) {
    if (selected.has(row.id)) {
      if (row.type === 'section') {
        pendingStart ??= row.start;
        if (toComment)
          result.push({
            id: row.id,
            type: 'comment',
            text: `${row.start}–${sectionEnd(original, row.id)} 小节 · ${row.meter.join('/')} · BPM ${row.bpm}`,
          });
      } else if (toComment) result.push(row);
    } else {
      if (row.type === 'section' && pendingStart !== undefined) {
        row.start = pendingStart;
        pendingStart = undefined;
      }
      result.push(row);
    }
  }
  if (pendingStart !== undefined) song.endExclusive = pendingStart;
  song.rows = result;
  return validate(song);
}
export function copyRows(song: Song, selected: Set<string>): ClipRow[] {
  return song.rows
    .filter((r) => selected.has(r.id))
    .map((r) =>
      r.type === 'comment'
        ? { type: 'comment', text: r.text }
        : {
            type: 'section',
            length: sectionEnd(song, r.id) - r.start + 1,
            meter: [...r.meter],
            bpm: r.bpm,
          },
    );
}
export function exportText(song: Song) {
  return (
    [
      ...song.rows.flatMap((r) =>
        r.type === 'comment'
          ? r.text.split(/\r?\n/).map((line) => '#' + line)
          : [`${r.start} ${r.meter.join('/')} ${r.bpm}`],
      ),
      String(song.endExclusive),
    ].join('\n') + '\n'
  );
}
export function parseText(text: string, title = '导入曲目'): Song {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES)
    throw Error('文件不能超过 2 MiB。');
  const song: Song = { version: 1, title, endExclusive: 0, rows: [] };
  let ended = false,
    previousStart = 0;
  for (const [index, source] of text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .entries()) {
    const line = source.trim();
    if (!line) continue;
    try {
      if (line.startsWith('#')) song.rows.push({ id: uid(), type: 'comment', text: line.slice(1) });
      else if (/^\d+$/.test(line)) {
        if (ended) throw Error('只能有一个结束数字。');
        song.endExclusive = Number(line);
        ended = true;
      } else {
        if (ended) throw Error('结束数字后不能再出现演奏段落。');
        const match = /^(\d+)\s+(\d+)\/(\d+)\s+((?:\d+(?:\.\d*)?|\.\d+))$/.exec(line);
        if (!match) throw Error('应为“起始小节 分子/分母 BPM”，或 # 开头的注释。');
        const row: Section = {
          id: uid(),
          type: 'section',
          start: +match[1],
          meter: [+match[2], +match[3]],
          bpm: +match[4],
        };
        if (
          !Number.isSafeInteger(row.start) ||
          row.start <= previousStart ||
          (!previousStart && row.start !== 1)
        )
          throw Error('第一段从 1 开始，后续起点必须严格递增。');
        validate({ version: 1, title, endExclusive: 2, rows: [{ ...row, start: 1 }] });
        song.rows.push(row);
        previousStart = row.start;
      }
    } catch (error) {
      throw Error(`第 ${index + 1} 行：${source}\n${(error as Error).message}`, { cause: error });
    }
  }
  if (!ended) throw Error('缺少末尾的结束数字（最后实际小节 + 1）。');
  return validate(song);
}
export function parseJson(text: string): Song {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES)
    throw Error('文件不能超过 2 MiB。');
  let data: Song;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw Error('JSON 语法错误，请检查引号、逗号和括号。');
  }
  return validate(data);
}
export const fingerprint = (song: Song) =>
  JSON.stringify({
    version: 1,
    title: song.title,
    endExclusive: song.endExclusive,
    rows: song.rows.map((row) =>
      row.type === 'comment'
        ? { id: row.id, type: row.type, text: row.text }
        : { id: row.id, type: row.type, start: row.start, meter: row.meter, bpm: row.bpm },
    ),
  });

export function parseClipboard(text: string): ClipRow[] {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES)
    throw Error('剪贴板内容不能超过 2 MiB。');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const song = parseText(text);
    return copyRows(song, new Set(song.rows.map((row) => row.id)));
  }
  if (
    !data ||
    typeof data !== 'object' ||
    !('format' in data) ||
    data.format !== 'metronome-rows-v1' ||
    !('rows' in data) ||
    !Array.isArray(data.rows) ||
    data.rows.length > MAX_ROWS
  )
    throw Error('剪贴板段落格式不正确。');
  return data.rows.map((value: unknown, index) => {
    if (!value || typeof value !== 'object' || !('type' in value))
      throw Error(`剪贴板第 ${index + 1} 行格式不正确。`);
    if (
      value.type === 'comment' &&
      'text' in value &&
      typeof value.text === 'string' &&
      value.text.length <= 20000
    )
      return { type: 'comment', text: value.text };
    if (
      value.type !== 'section' ||
      !('length' in value) ||
      !Number.isSafeInteger(value.length) ||
      Number(value.length) < 1 ||
      !('meter' in value) ||
      !('bpm' in value)
    )
      throw Error(`剪贴板第 ${index + 1} 行参数不正确。`);
    const row: Section = {
      id: 'clipboard',
      type: 'section',
      start: 1,
      meter: value.meter as Meter,
      bpm: value.bpm as number,
    };
    validate({ version: 1, title: '剪贴板', endExclusive: 2, rows: [row] });
    return { type: 'section', length: Number(value.length), meter: [...row.meter], bpm: row.bpm };
  });
}
