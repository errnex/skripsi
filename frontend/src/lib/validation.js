import { isAddress, parseEther, getAddress } from "ethers";

/** BB-23: website hanya mengizinkan transaksi jika chainId dompet = jaringan target. */
export function isCorrectNetwork(walletChainId, targetChainId) {
  if (walletChainId === null || walletChainId === undefined) return false;
  return Number(walletChainId) === Number(targetChainId);
}

/**
 * BB-24: menentukan peran/dashboard dari alamat dompet.
 * - arbiter  : alamat sama dengan variabel arbiter di kontrak
 * - klien    : tercatat sebagai client pada minimal satu pesanan (event OrderCreated)
 * - freelancer: tercatat sebagai freelancer pada minimal satu pesanan
 */
export function detectRoles(account, arbiter, orders) {
  if (!account) return { isArbiter: false, isClient: false, isFreelancer: false, clientOrders: [], freelancerOrders: [] };
  const a = account.toLowerCase();
  const clientOrders = orders.filter((o) => o.client.toLowerCase() === a).map((o) => o.id);
  const freelancerOrders = orders.filter((o) => o.freelancer.toLowerCase() === a).map((o) => o.id);
  return {
    isArbiter: !!arbiter && arbiter.toLowerCase() === a,
    isClient: clientOrders.length > 0,
    isFreelancer: freelancerOrders.length > 0,
    clientOrders,
    freelancerOrders,
  };
}

/**
 * Membagi total (wei) sesuai persentase. Sisa pembulatan diberikan ke milestone terakhir
 * agar jumlahnya PERSIS sama dengan total (syarat createOrder: msg.value = total milestone).
 */
export function splitAmounts(totalWei, percents) {
  const total = BigInt(totalWei);
  const amounts = percents.map((p) => (total * BigInt(Math.round(Number(p) * 100))) / 10000n);
  const sum = amounts.reduce((a, b) => a + b, 0n);
  if (amounts.length) amounts[amounts.length - 1] += total - sum;
  return amounts;
}

/**
 * Validasi formulir Buat Pesanan (BB-02 dan BB-03 di sisi website, sebelum transaksi dikirim).
 * Mengembalikan daftar pesan kesalahan (kosong = valid).
 */
export function validateOrderForm(form, { account, arbiter } = {}) {
  const errors = [];
  if (!form.freelancer || !isAddress(form.freelancer)) {
    errors.push("Alamat freelancer tidak valid.");
  } else {
    const f = getAddress(form.freelancer);
    if (account && f.toLowerCase() === account.toLowerCase()) errors.push("Alamat freelancer tidak boleh sama dengan alamat Anda (klien).");
    if (arbiter && f.toLowerCase() === arbiter.toLowerCase()) errors.push("Alamat freelancer tidak boleh alamat arbiter.");
  }
  if (account && arbiter && account.toLowerCase() === arbiter.toLowerCase()) errors.push("Dompet arbiter tidak boleh membuat pesanan.");
  if (!form.title || !form.title.trim()) errors.push("Judul pesanan wajib diisi.");
  if (!form.description || !form.description.trim()) errors.push("Deskripsi/brief wajib diisi.");

  let totalOk = true;
  try {
    if (!(parseEther(String(form.total || "0")) > 0n)) totalOk = false;
  } catch {
    totalOk = false;
  }
  if (!totalOk) errors.push("Total nilai pesanan harus berupa angka ETH lebih dari 0 (gunakan titik untuk desimal, mis. 0.05).");

  const ms = form.milestones || [];
  if (ms.length === 0) errors.push("Minimal satu milestone.");
  if (ms.length > 20) errors.push("Maksimal 20 milestone.");
  ms.forEach((m, i) => {
    if (!m.title || !m.title.trim()) errors.push(`Milestone ${i + 1}: judul wajib diisi.`);
    if (!(Number(m.percent) > 0)) errors.push(`Milestone ${i + 1}: persentase harus > 0.`);
    if (!(Number(m.durationDays) > 0)) errors.push(`Milestone ${i + 1}: durasi harus > 0 hari.`);
  });
  const sum = ms.reduce((a, m) => a + Number(m.percent || 0), 0);
  if (ms.length && Math.abs(sum - 100) > 1e-9) errors.push(`Jumlah persentase milestone harus 100% (sekarang ${sum}%).`);

  const rate = Number(form.dailyRatePct);
  const cap = Number(form.capPct);
  if (!(rate >= 0 && rate <= 100)) errors.push("Tarif denda harian harus 0-100%.");
  if (!(cap >= 0 && cap <= 100)) errors.push("Batas maksimum denda harus 0-100%.");
  const rev = Number(form.maxRevisions);
  if (!(Number.isInteger(rev) && rev >= 0 && rev <= 255)) errors.push("Batas revisi harus bilangan bulat 0-255.");
  const g = Number(form.graceDays);
  if (!(g >= 0)) errors.push("Batas akhir pengiriman (grace period) tidak valid.");
  return errors;
}
