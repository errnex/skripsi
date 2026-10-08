/**
 * Formula denda (subbab 3.4.7 proposal), sama persis dengan kontrak:
 *   d = 0                                   jika t_kirim <= t_tenggat
 *   d = ceil((t_kirim - t_tenggat) / DAY)   jika t_kirim >  t_tenggat
 *   denda = V * min(d * r_bps, c_bps) / 10.000
 * Semua nilai BigInt (wei / detik).
 */
export function daysLate(submitTs, deadline, dayLength) {
  const t = BigInt(submitTs);
  const dl = BigInt(deadline);
  const day = BigInt(dayLength);
  if (t <= dl) return 0n;
  return (t - dl + day - 1n) / day;
}

export function lateFee(amount, submitTs, deadline, dailyRateBps, capBps, dayLength) {
  const d = daysLate(submitTs, deadline, dayLength);
  let pct = d * BigInt(dailyRateBps);
  if (pct > BigInt(capBps)) pct = BigInt(capBps);
  return (BigInt(amount) * pct) / 10000n;
}

export function lateFeePct(submitTs, deadline, dailyRateBps, capBps, dayLength) {
  const d = daysLate(submitTs, deadline, dayLength);
  let pct = d * BigInt(dailyRateBps);
  if (pct > BigInt(capBps)) pct = BigInt(capBps);
  return Number(pct) / 100;
}
