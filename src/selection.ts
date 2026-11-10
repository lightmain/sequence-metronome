export function selectRows(order: string[], previous: Set<string>, id: string, anchor: string | null, shift: boolean, additive: boolean): Set<string> {
  const start = anchor ? order.indexOf(anchor) : -1, end = order.indexOf(id);
  if (end < 0) return new Set(previous);
  const picked = shift && start >= 0 ? order.slice(Math.min(start, end), Math.max(start, end) + 1) : [id];
  return new Set([...(additive ? previous : []), ...picked]);
}
