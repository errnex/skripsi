/** Menerjemahkan error ethers/MetaMask menjadi pesan bahasa Indonesia yang mudah dipahami. */
export function parseError(err) {
  if (!err) return "Terjadi kesalahan tidak dikenal.";
  const code = err.code || err?.info?.error?.code || err?.error?.code;
  if (code === "ACTION_REJECTED" || code === 4001) return "Transaksi dibatalkan di MetaMask.";
  if (code === "INSUFFICIENT_FUNDS") return "Saldo ETH tidak cukup untuk nilai transaksi + biaya gas. Isi saldo dari faucet Sepolia.";
  if (err.reason) return `Ditolak kontrak: ${err.reason}`;
  const msg =
    err?.revert?.args?.[0] ||
    err?.info?.error?.data?.message ||
    err?.info?.error?.message ||
    err?.error?.message ||
    err?.shortMessage ||
    err?.message ||
    String(err);
  const m = /reverted with reason string '([^']+)'/.exec(msg) || /execution reverted: (.+)$/.exec(msg);
  if (m) return `Ditolak kontrak: ${m[1]}`;
  if (/nonce/i.test(msg))
    return "Masalah nonce. Jika memakai Hardhat lokal yang baru di-restart: MetaMask > Settings > Advanced > Clear activity tab data, lalu coba lagi.";
  if (/insufficient funds/i.test(msg)) return "Saldo ETH tidak cukup untuk nilai transaksi + biaya gas.";
  if (/Failed to fetch|NetworkError|CORS/i.test(msg)) return "Gagal terhubung ke RPC/IPFS (jaringan atau CORS). Coba lagi atau ganti RPC.";
  return msg.length > 300 ? msg.slice(0, 300) + "…" : msg;
}
