import { activeAlignment, beatSeconds, effectiveCountIn, sections, validate } from './model';
import type { CountIn, Song } from './model';
import type { BeatEvent, Position } from './transport';

type Span = {
  start: number;
  end: number;
  interval: number;
  count: number;
  position: Position;
};

/** 播放及导出共用秒时间线；首拍参数始终相对原音频，不回写前补量。 */
export class MusicTimeline {
  readonly shift: number;
  readonly audioStart: number;
  readonly audioEnd: number;
  readonly firstBeat: number | undefined;
  readonly preparationStart: number | undefined;
  readonly formalEnd: number | undefined;
  readonly duration: number;
  readonly countIn: CountIn;
  private readonly spans: Span[] = [];

  constructor(song: Song, audioDuration: number) {
    validate(song);
    if (!Number.isFinite(audioDuration) || audioDuration < 0)
      throw Error('音频时长须为有限的非负秒数。');
    const list = sections(song);
    this.countIn = effectiveCountIn(song);
    const alignment = activeAlignment(song);
    const preparation =
      this.countIn.bars * this.countIn.meter[0] * beatSeconds(this.countIn.meter, this.countIn.bpm);
    this.shift =
      alignment && this.countIn.bars > 0
        ? Math.max(0, 0.5 - (alignment.start / 1000 - preparation))
        : 0;
    this.audioStart = this.shift;
    this.audioEnd = this.shift + audioDuration;
    if (alignment) {
      this.firstBeat = alignment.start / 1000 + this.shift;
      this.preparationStart = this.firstBeat - preparation;
      if (this.countIn.bars > 0) {
        this.spans.push({
          start: this.preparationStart,
          end: this.firstBeat,
          interval: beatSeconds(this.countIn.meter, this.countIn.bpm),
          count: this.countIn.bars * this.countIn.meter[0],
          position: {
            phase: 'countdown',
            bar: 1 - this.countIn.bars,
            localBar: 1,
            beat: 0,
            meter: [...this.countIn.meter],
            bpm: this.countIn.bpm,
            fullCountIn: true,
          },
        });
      }
      let cursor = this.firstBeat;
      for (const [index, section] of list.entries()) {
        const count =
          ((list[index + 1]?.start ?? song.endExclusive) - section.start) * section.meter[0];
        const interval = beatSeconds(section.meter, section.bpm);
        const end = cursor + count * interval;
        this.spans.push({
          start: cursor,
          end,
          interval,
          count,
          position: {
            phase: 'playing',
            bar: section.start,
            localBar: 1,
            beat: 0,
            meter: [...section.meter],
            bpm: section.bpm,
            sectionId: section.id,
          },
        });
        cursor = end;
      }
      this.formalEnd = cursor;
    }
    this.duration = Math.max(0, this.audioEnd, this.formalEnd ?? 0);
    if (!Number.isFinite(this.duration)) throw Error('播放时间范围过大。');
  }

  positionAt(time: number): Position | null {
    if (!Number.isFinite(time)) throw Error('播放位置须为有限的秒数。');
    const span = this.spans.find((s) => time >= s.start && time < s.end);
    if (!span || time < 0 || time >= this.duration) return null;
    const index = Math.min(span.count - 1, Math.floor((time - span.start) / span.interval));
    return this.position(span, index);
  }

  /** 只枚举 [from, to) 内的节拍，不因长曲目预先分配每拍对象。 */
  *beatsBetween(from: number, to: number): Generator<BeatEvent> {
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from)
      throw Error('节拍时间范围不正确。');
    from = Math.max(0, from);
    to = Math.min(this.duration, to);
    for (const span of this.spans) {
      if (span.end <= from || span.start >= to) continue;
      let index = Math.max(0, Math.floor((from - span.start) / span.interval));
      for (; index < span.count; index++) {
        const time = span.start + index * span.interval;
        if (time >= to) break;
        if (time < from) continue;
        yield { ...this.position(span, index), time };
      }
    }
  }

  private position(span: Span, index: number): Position {
    const bars = Math.floor(index / span.position.meter[0]);
    return {
      ...span.position,
      meter: [...span.position.meter],
      bar: span.position.bar + bars,
      localBar: span.position.localBar + bars,
      beat: index % span.position.meter[0],
      ...(span.position.phase === 'countdown' ? { remaining: this.countIn.bars - bars } : {}),
    };
  }
}
