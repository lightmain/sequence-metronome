export type Meter = [number, number];
export type Section = { id: string; type: 'section'; start: number; meter: Meter; bpm: number };
export type Comment = { id: string; type: 'comment'; text: string };
export type Row = Section | Comment;
export type Alignment = {
  bpm: number;
  start: number;
  countin: number;
  countin_bpm: number;
  countin_time: string;
};
export type AlignmentCore = { firstBeatMs: number; referenceBpm: number };
export type AudioReference = {
  sha256: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
};
export type CountIn = { bars: number; meter: Meter; bpm: number };
export type Music = {
  audios: Record<string, AudioReference>;
  alignments: Record<string, Alignment>;
  activeSha?: string;
  countIn?: CountIn;
  volume?: number;
};
export type Song = {
  version: 1 | 3;
  title: string;
  endExclusive: number;
  rows: Row[];
  music?: Music;
};
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
export const meterText = (meter: Meter) => `${meter[0]}/${meter[1]}`;
export function parseMeterText(text: string): Meter {
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (!match) throw Error('预备节拍拍号须写成“分子/分母”，例如 4/4。');
  const meter: Meter = [+match[1], +match[2]];
  if (
    !Number.isInteger(meter[0]) ||
    meter[0] < 1 ||
    meter[0] > 32 ||
    !denominators.includes(meter[1])
  )
    throw Error('拍号分子须为 1–32，分母须为 1、2、4、8、16、32。');
  return meter;
}
export function effectiveCountIn(song: Song): CountIn {
  const list = sections(song);
  return (
    song.music?.countIn ?? {
      bars: 0,
      meter: [...(list[0]?.meter ?? [4, 4])],
      bpm: list[0]?.bpm ?? 120,
    }
  );
}
export function activeAlignment(song: Song): Alignment | undefined {
  const sha = song.music?.activeSha;
  return sha ? song.music?.alignments?.[sha] : undefined;
}
export function validate(song: Song): Song {
  if (
    !song ||
    ![1, 3].includes(song.version) ||
    typeof song.title !== 'string' ||
    !Array.isArray(song.rows)
  )
    throw Error('曲目格式不正确，version 必须为 1 或 3。');
  if (song.music !== undefined) {
    if (song.version !== 3) throw Error('音乐参数需要曲目格式 version 3。');
    validateMusic(song.music);
  }
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
  const alignments = Object.entries(song.music?.alignments ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([sha, a]) =>
        `Alignment:{SHA:${sha}, bpm:${a.bpm}, start:${a.start}, countin:${a.countin}, countin_bpm:${a.countin_bpm}, countin_time:${a.countin_time}}`,
    );
  return (
    [
      ...alignments,
      ...song.rows.flatMap((r) =>
        r.type === 'comment'
          ? r.text.split(/\r?\n/).map((line) => '#' + line)
          : [`${r.start} ${r.meter.join('/')} ${r.bpm}`],
      ),
      String(song.endExclusive),
    ].join('\n') + '\n'
  );
}

function parseAlignment(line: string): [string, Alignment] {
  const match = /^Alignment\s*:\s*\{(.*)\}\s*$/.exec(line);
  if (!match)
    throw Error(
      'Alignment 行格式为 Alignment:{SHA:..., bpm:..., start:..., countin:..., countin_bpm:..., countin_time:...}。',
    );
  const fields = new Map<string, string>();
  for (const part of match[1].split(',')) {
    const separator = part.indexOf(':');
    if (separator < 1) throw Error('Alignment 字段须写成“名称:值”。');
    const key = part.slice(0, separator).trim(),
      value = part.slice(separator + 1).trim();
    if (!key || !value) throw Error('Alignment 字段名称和值不能为空。');
    if (fields.has(key)) throw Error(`Alignment 字段 ${key} 重复。`);
    fields.set(key, value);
  }
  const expected = ['SHA', 'bpm', 'start', 'countin', 'countin_bpm', 'countin_time'];
  for (const key of expected) if (!fields.has(key)) throw Error(`Alignment 缺少 ${key}。`);
  for (const key of fields.keys())
    if (!expected.includes(key)) throw Error(`Alignment 包含未知字段 ${key}。`);
  const sha = fields.get('SHA')!.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha)) throw Error('Alignment 的 SHA 须为 64 位十六进制。');
  const number = (key: string) => {
    const value = fields.get(key)!;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))
      throw Error(`Alignment 的 ${key} 须为数字。`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw Error(`Alignment 的 ${key} 须为有限数字。`);
    return parsed;
  };
  const bpm = number('bpm'),
    start = number('start'),
    countinBpm = number('countin_bpm');
  if (bpm <= 0) throw Error('Alignment 的 bpm 须为正数。');
  if (countinBpm <= 0) throw Error('Alignment 的 countin_bpm 须为正数。');
  const rawCountin = fields.get('countin')!;
  if (!/^\d+$/.test(rawCountin)) throw Error('Alignment 的 countin 须为非负整数。');
  const countin = Number(rawCountin);
  if (!Number.isSafeInteger(countin)) throw Error('Alignment 的 countin 须为非负整数。');
  let countinTime: string;
  try {
    countinTime = meterText(parseMeterText(fields.get('countin_time')!));
  } catch (error) {
    throw Error(`Alignment 的 countin_time 无效：${(error as Error).message}`, { cause: error });
  }
  return [sha, { bpm, start, countin, countin_bpm: countinBpm, countin_time: countinTime }];
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
      if (/^Alignment\s*:/i.test(line)) {
        if (song.rows.length || ended) throw Error('Alignment 声明必须位于文本开头。');
        const [sha, alignment] = parseAlignment(line);
        song.version = 3;
        song.music ??= { audios: {}, alignments: {} };
        if (song.music.alignments[sha]) throw Error('同一 SHA 的 Alignment 声明重复。');
        song.music.alignments[sha] = alignment;
      } else if (/^Aligned\b/i.test(line)) {
        throw Error('旧 Aligned 行不再支持，请使用 Alignment:{...}。');
      } else if (line.startsWith('#'))
        song.rows.push({ id: uid(), type: 'comment', text: line.slice(1) });
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
    version: song.version,
    title: song.title,
    endExclusive: song.endExclusive,
    rows: song.rows.map((row) =>
      row.type === 'comment'
        ? { id: row.id, type: row.type, text: row.text }
        : { id: row.id, type: row.type, start: row.start, meter: row.meter, bpm: row.bpm },
    ),
    music: song.music && {
      audios: Object.fromEntries(
        Object.entries(song.music.audios ?? {})
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([sha, audio]) => [
            sha,
            {
              name: audio.name,
              size: audio.size,
              type: audio.type,
              lastModified: audio.lastModified,
            },
          ]),
      ),
      alignments: Object.fromEntries(
        Object.entries(song.music.alignments ?? {}).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      activeSha: song.music.activeSha,
      countIn: song.music.countIn && {
        bars: song.music.countIn.bars,
        meter: song.music.countIn.meter,
        bpm: song.music.countIn.bpm,
      },
      volume: song.music.volume,
    },
  });

/** 页面文本编辑只修改段落和 TXT 携带的对齐映射，保留音频集合及预备设置。 */
export function applyText(original: Song, text: string): Song {
  const parsed = parseText(text, original.title);
  if (!original.music) {
    if (!parsed.music) return parsed;
    return validate({
      ...parsed,
      version: 3,
      music: { audios: {}, alignments: parsed.music.alignments },
    });
  }
  return validate({
    ...parsed,
    version: 3,
    music: {
      ...original.music,
      alignments: parsed.music?.alignments ?? {},
    },
  });
}

function validateAlignment(sha: string, alignment: Alignment) {
  if (!/^[0-9a-f]{64}$/.test(sha)) throw Error('对齐映射的 SHA 须为 64 位小写十六进制。');
  if (!alignment || typeof alignment !== 'object' || Array.isArray(alignment))
    throw Error('对齐参数格式不正确。');
  if (!Number.isFinite(alignment.bpm) || alignment.bpm <= 0) throw Error('对齐参考 BPM 须为正数。');
  if (!Number.isFinite(alignment.start)) throw Error('首拍时间须为有限的毫秒数。');
  if (!Number.isSafeInteger(alignment.countin) || alignment.countin < 0)
    throw Error('对齐的预备小节数须为非负整数。');
  if (!Number.isFinite(alignment.countin_bpm) || alignment.countin_bpm <= 0)
    throw Error('对齐的预备节拍 BPM 须为正数。');
  if (typeof alignment.countin_time !== 'string') throw Error('对齐的预备节拍拍号须为文字。');
  parseMeterText(alignment.countin_time);
}

function validateMusic(music: Music) {
  if (!music || typeof music !== 'object' || Array.isArray(music))
    throw Error('音乐参数格式不正确。');
  if (
    !music.audios ||
    typeof music.audios !== 'object' ||
    Array.isArray(music.audios) ||
    !music.alignments ||
    typeof music.alignments !== 'object' ||
    Array.isArray(music.alignments)
  )
    throw Error('音频集合或对齐映射格式不正确。');
  for (const [sha, audio] of Object.entries(music.audios)) {
    if (
      !audio ||
      typeof audio !== 'object' ||
      audio.sha256 !== sha ||
      typeof audio.name !== 'string' ||
      !audio.name ||
      typeof audio.type !== 'string' ||
      !Number.isSafeInteger(audio.size) ||
      audio.size <= 0 ||
      !Number.isSafeInteger(audio.lastModified) ||
      audio.lastModified < 0
    )
      throw Error('音频文件识别信息不正确。');
    validateAlignmentSha(sha);
  }
  for (const [sha, alignment] of Object.entries(music.alignments))
    validateAlignment(sha, alignment);
  if (music.activeSha !== undefined && !music.audios[music.activeSha])
    throw Error('当前音频不在关联列表中。');
  if (music.countIn !== undefined) {
    const c = music.countIn;
    if (
      !c ||
      !Number.isSafeInteger(c.bars) ||
      c.bars < 0 ||
      !Array.isArray(c.meter) ||
      c.meter.length !== 2 ||
      !Number.isInteger(c.meter[0]) ||
      c.meter[0] < 1 ||
      c.meter[0] > 32 ||
      !denominators.includes(c.meter[1]) ||
      !Number.isFinite(c.bpm) ||
      c.bpm < 20 ||
      c.bpm > 400
    )
      throw Error('预备节拍参数不正确。');
  }
  if (
    music.volume !== undefined &&
    (!Number.isFinite(music.volume) || music.volume < 0 || music.volume > 1)
  )
    throw Error('音频音量须在 0–1 之间。');
}

function validateAlignmentSha(sha: string) {
  if (!/^[0-9a-f]{64}$/.test(sha)) throw Error('音频 SHA 须为 64 位小写十六进制。');
}

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
