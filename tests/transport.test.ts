import { describe, expect, it } from 'vitest';
import { parseText } from '../src/model';
import { Timeline } from '../src/transport';
const song = () => parseText('1 4/4 120\n2 2/4 60\n3 8/8 120\n4');
describe('序列播放时序', () => {
  it('M 产生不完整 -2、完整 -1、完整 0，并冻结倒计时', () => {
    const t=new Timeline(song(),'prepare',3,0);
    t.take(); expect(t.requestEntry(2,.1,0)).toBe(true);
    expect(t.requestEntry(0,.2,0)).toBe(false);
    for(let i=0;i<3;i++) expect(t.take()).toMatchObject({phase:'countdown',bar:-2,fullCountIn:false});
    for(let i=0;i<4;i++) expect(t.take()).toMatchObject({phase:'countdown',bar:-1,fullCountIn:true});
    for(let i=0;i<4;i++) expect(t.take()).toMatchObject({phase:'countdown',bar:0,fullCountIn:true});
    expect(t.take()).toMatchObject({phase:'playing',bar:3,time:6,fullCountIn:false});
  });
  it('下一小节开始只使用当前不完整小节，并显示 0', () => {
    const t=new Timeline(song(),'prepare',2,0); t.take(); t.requestEntry(0,.1,0);
    expect(t.take()).toMatchObject({phase:'countdown',bar:0,fullCountIn:false});
  });
  it('连续变拍变速，曲尾最后一拍完整播放', () => {
    const timeline = new Timeline(song(), 'direct', 1, 10);
    const events = []; while (timeline.phase !== 'stopped') events.push(timeline.take()!);
    expect(events).toHaveLength(14);
    expect(events.map(e => e.time)).toEqual([10,10.5,11,11.5,12,13,14,14.25,14.5,14.75,15,15.25,15.5,15.75]);
    expect(timeline.nextTime).toBe(16);
    expect(events[4]).toMatchObject({ bar: 2, localBar: 1, beat: 0, meter: [2,4], bpm: 60 });
  });
  it('从段内指定小节开始', () => {
    const s = parseText('1 4/4 120\n10 3/4 100\n20');
    const t = new Timeline(s, 'direct', 13, 0);
    expect(t.take()).toMatchObject({ bar:13, localBar:4, meter:[3,4], beat:0 });
  });
  it('准备模式按第一段循环，空格在当前小节结束进入指定小节', () => {
    const t = new Timeline(song(), 'prepare', 3, 0);
    expect(t.take()).toMatchObject({ phase:'prepare', meter:[4,4] });
    t.requestEntry(0, .1, 0);
    for (let i=0;i<3;i++) expect(t.take()?.phase).toBe('countdown');
    expect(t.take()).toMatchObject({ phase:'playing', bar:3, meter:[8,8], time:2 });
  });
  it('准备模式 N 等当前小节结束再过一小节', () => {
    const t = new Timeline(song(), 'prepare', 2, 0); t.take(); t.requestEntry(1, .1, 0);
    for (let i=0;i<7;i++) expect(t.take()?.phase).toBe('countdown');
    expect(t.take()).toMatchObject({ phase:'playing', bar:2, time:4 });
  });
  it('一小节后开始完整准备一次', () => {
    const t = new Timeline(song(), 'count', 2, 0);
    for(let i=0;i<4;i++) expect(t.take()).toMatchObject({ phase:'countdown', meter:[4,4] });
    expect(t.take()).toMatchObject({ phase:'playing', bar:2, time:2 });
  });
  it('普通模式持续运行，改拍号到下一小节生效', () => {
    const t = new Timeline(song(), 'simple', 1, 0); t.take(); t.pendingMeter = [3,8]; t.bpm = 90;
    for(let i=0;i<3;i++) expect(t.take()?.meter).toEqual([4,4]);
    expect(t.take()).toMatchObject({ phase:'simple', meter:[3,8], bpm:90, bar:2, beat:0 });
  });
  it('拒绝无效开始小节', () => { expect(() => new Timeline(song(),'direct',4,0)).toThrow(); expect(() => new Timeline(song(),'direct',1.5,0)).toThrow(); });
});
