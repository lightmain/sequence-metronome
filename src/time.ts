/** 总时长达到 60 秒时，当前位置和总时长统一显示为分:秒，避免一行内混用单位。 */
export function formatAudioTime(current: number, total: number, decimals: number): string {
  if (total < 60) return `${current.toFixed(decimals)} / ${total.toFixed(decimals)} s`;
  return `${clock(current)} / ${clock(total)}`;
}

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}
