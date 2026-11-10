import { describe, expect, it } from 'vitest';
import { selectRows } from '../src/selection';
const order = ['a', 'b', 'c', 'd', 'e'];
describe('行选择', () => {
  it('普通单击替换已有选择', () =>
    expect([...selectRows(order, new Set(['a', 'c']), 'b', 'a', false, false)]).toEqual(['b']));
  it('Ctrl 单击取并集，再次点击不取消', () => {
    const selected = selectRows(order, new Set(['a']), 'c', 'a', false, true);
    expect([...selected]).toEqual(['a', 'c']);
    expect([...selectRows(order, selected, 'c', 'c', false, true)]).toEqual(['a', 'c']);
  });
  it('Shift 正向和反向范围都替换原选择', () => {
    expect([...selectRows(order, new Set(['e']), 'd', 'b', true, false)]).toEqual(['b', 'c', 'd']);
    expect([...selectRows(order, new Set(['e']), 'b', 'd', true, false)]).toEqual(['b', 'c', 'd']);
  });
  it('Ctrl+Shift 添加范围，保留不相邻选择', () =>
    expect([...selectRows(order, new Set(['a']), 'e', 'c', true, true)]).toEqual([
      'a',
      'c',
      'd',
      'e',
    ]));
  it('没有有效起点时 Shift 按单击处理', () =>
    expect([...selectRows(order, new Set(['a']), 'c', 'removed', true, false)]).toEqual(['c']));
});
