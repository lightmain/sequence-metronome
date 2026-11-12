export type Interval = [number, number];

// 双侧 95% Student t 临界值。较大自由度用 Cornish–Fisher 展开，
// 在自由度 31 处误差小于 2e-7，此后继续减小。
const t95 = [
  0, 12.7062047364, 4.3026527297, 3.1824463053, 2.7764451052, 2.5705818356, 2.4469118511,
  2.3646242516, 2.3060041352, 2.2621571629, 2.228138852, 2.2009851601, 2.1788128297, 2.1603686565,
  2.1447866879, 2.1314495456, 2.1199052992, 2.1098155778, 2.1009220402, 2.0930240544, 2.0859634473,
  2.0796138447, 2.0738730679, 2.0686576104, 2.0638985616, 2.0595385528, 2.0555294386, 2.0518305165,
  2.0484071418, 2.0452296421, 2.0422724563,
];
export function critical95(df: number) {
  if (df <= 30) return t95[df];
  const z = 1.959963984540054;
  return (
    z +
    (z ** 3 + z) / (4 * df) +
    (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2) +
    (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3) +
    (79 * z ** 9 + 776 * z ** 7 + 1482 * z ** 5 - 1920 * z ** 3 - 945 * z) / (92160 * df ** 4)
  );
}

/** 均值的双侧 95% 置信区间；输入须为有限数的独立样本。 */
export function meanConfidenceInterval(samples: readonly number[]) {
  if (samples.length < 2) throw Error('至少需要 2 个样本。');
  for (const sample of samples) if (!Number.isFinite(sample)) throw Error('样本必须为有限数。');
  const mean = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  const variance =
    samples.reduce((sum, sample) => sum + (sample - mean) ** 2, 0) / (samples.length - 1);
  const standardDeviation = Math.sqrt(variance);
  const standardError = standardDeviation / Math.sqrt(samples.length);
  const margin = critical95(samples.length - 1) * standardError;
  return {
    mean,
    standardDeviation,
    standardError,
    interval: [mean - margin, mean + margin] as Interval,
  };
}
