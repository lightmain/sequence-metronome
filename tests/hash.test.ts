import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/hash';

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe('音频 SHA-256', () => {
  it('已知内容得到标准 SHA-256', async () => {
    expect(await sha256Hex(bytes('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('相同字节得到相同 SHA，改一个字节即变化', async () => {
    const first = await sha256Hex(bytes('same file bytes'));
    const second = await sha256Hex(bytes('same file bytes'));
    const changed = await sha256Hex(bytes('same file bytez'));
    expect(first).toBe(second);
    expect(changed).not.toBe(first);
  });
});
