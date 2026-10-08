import { formatEther } from "ethers";

export const ORDER_STATUS = ["Funded", "Active", "Completed", "Cancelled", "Terminated"];
export const ORDER_STATUS_ID = {
  Funded: "Menunggu freelancer",
  Active: "Berjalan",
  Completed: "Selesai",
  Cancelled: "Dibatalkan",
  Terminated: "Dihentikan (refund)",
};
export const MS_STATUS = ["Pending", "Submitted", "RevisionRequested", "Disputed", "Paid", "Resolved", "Refunded"];
export const MS_STATUS_ID = {
  Pending: "Menunggu kiriman",
  Submitted: "Menunggu review klien",
  RevisionRequested: "Revisi diminta",
  Disputed: "Sengketa",
  Paid: "Dibayar",
  Resolved: "Sengketa diputus",
  Refunded: "Dikembalikan",
  Locked: "Belum dibuka",
};

export function shortAddr(a) {
  if (!a) return "-";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function fmtEth(wei, digits = 4) {
  if (wei === undefined || wei === null) return "-";
  const s = formatEther(wei);
  const n = Number(s);
  if (n === 0) return "0";
  // tampilkan hingga `digits` desimal tanpa nol berlebih, format Indonesia (koma desimal)
  const fixed = n.toLocaleString("id-ID", { maximumFractionDigits: Math.max(digits, 6) });
  return fixed;
}

export function fmtDate(ts) {
  if (!ts) return "-";
  return new Date(Number(ts) * 1000).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Menampilkan durasi detik sebagai teks. Jika dayLength != 86400 (mode demo), satuan "hari"
 * dikonversi sesuai kontrak: mis. dayLength 60 -> 1 hari demo = 60 detik.
 */
export function fmtDuration(seconds) {
  let s = Math.max(0, Math.floor(Number(seconds)));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const parts = [];
  if (d) parts.push(`${d} hari`);
  if (h) parts.push(`${h} jam`);
  if (m) parts.push(`${m} menit`);
  if ((!d && !h && s) || parts.length === 0) parts.push(`${s} detik`);
  return parts.join(" ");
}

/** "x hari" dalam satuan kontrak (dayLength). Contoh mode demo: 3 hari (= 3 menit nyata). */
export function fmtContractDays(seconds, dayLength) {
  const dl = Number(dayLength || 86400);
  const days = Number(seconds) / dl;
  const txt = `${Number.isInteger(days) ? days : days.toFixed(2)} hari`;
  if (dl === 86400) return txt;
  return `${txt} (= ${fmtDuration(seconds)} nyata)`;
}

export function bpsToPct(bps) {
  return `${(Number(bps) / 100).toLocaleString("id-ID")}%`;
}
