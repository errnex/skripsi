/**
 * Uji unit logika website (vitest): npm test
 * Memetakan skenario black box yang diperiksa di sisi website:
 *   BB-02 persentase milestone harus 100%  -> validateOrderForm
 *   BB-03 alamat freelancer = klien/arbiter -> validateOrderForm (sebelum transaksi)
 *   BB-23 jaringan selain Sepolia            -> isCorrectNetwork
 *   BB-24 dashboard sesuai peran             -> detectRoles
 *   BB-08/09 pratinjau denda = rumus kontrak -> lateFee
 */
import { describe, it, expect } from "vitest";
import { parseEther } from "ethers";
import { detectRoles, isCorrectNetwork, splitAmounts, validateOrderForm } from "./validation";
import { lateFee, daysLate } from "./lateFee";

const CLIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const FREELANCER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const ARBITER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

const baseForm = () => ({
  freelancer: FREELANCER,
  category: "Website",
  title: "Website company profile",
  description: "5 halaman",
  total: "1",
  milestones: [
    { title: "Desain", percent: 30, durationDays: 5 },
    { title: "Website jadi", percent: 50, durationDays: 10 },
    { title: "Online", percent: 20, durationDays: 4 },
  ],
  dailyRatePct: 5,
  capPct: 50,
  maxRevisions: 2,
  graceDays: 7,
});

describe("BB-02 persentase milestone", () => {
  it("valid jika berjumlah 100%", () => {
    expect(validateOrderForm(baseForm(), { account: CLIENT, arbiter: ARBITER })).toEqual([]);
  });
  it("ditolak sebelum transaksi jika tidak 100%", () => {
    const f = baseForm();
    f.milestones[2].percent = 10; // total 90%
    const errs = validateOrderForm(f, { account: CLIENT, arbiter: ARBITER });
    expect(errs.some((e) => e.includes("100%"))).toBe(true);
  });
  it("ditolak jika lebih dari 100%", () => {
    const f = baseForm();
    f.milestones[0].percent = 40;
    expect(validateOrderForm(f, { account: CLIENT, arbiter: ARBITER }).some((e) => e.includes("110%"))).toBe(true);
  });
});

describe("BB-03 alamat tidak valid di formulir", () => {
  it("freelancer = klien ditolak", () => {
    const f = { ...baseForm(), freelancer: CLIENT };
    expect(validateOrderForm(f, { account: CLIENT, arbiter: ARBITER }).join(" ")).toMatch(/tidak boleh sama/);
  });
  it("freelancer = arbiter ditolak", () => {
    const f = { ...baseForm(), freelancer: ARBITER };
    expect(validateOrderForm(f, { account: CLIENT, arbiter: ARBITER }).join(" ")).toMatch(/arbiter/);
  });
  it("arbiter tidak boleh menjadi klien", () => {
    expect(validateOrderForm(baseForm(), { account: ARBITER, arbiter: ARBITER }).join(" ")).toMatch(/arbiter/);
  });
  it("alamat bukan format Ethereum ditolak", () => {
    const f = { ...baseForm(), freelancer: "0x123" };
    expect(validateOrderForm(f, { account: CLIENT, arbiter: ARBITER }).join(" ")).toMatch(/tidak valid/);
  });
});

describe("BB-23 pemeriksaan jaringan", () => {
  it("hanya chainId target yang dianggap benar", () => {
    expect(isCorrectNetwork(11155111, 11155111)).toBe(true);
    expect(isCorrectNetwork(1, 11155111)).toBe(false); // mainnet
    expect(isCorrectNetwork(31337, 11155111)).toBe(false);
    expect(isCorrectNetwork(null, 11155111)).toBe(false);
  });
});

describe("BB-24 deteksi peran", () => {
  const orders = [
    { id: 1, client: CLIENT, freelancer: FREELANCER },
    { id: 2, client: FREELANCER, freelancer: CLIENT }, // satu alamat bisa klien di pesanan lain
  ];
  it("arbiter mendapat dashboard arbiter", () => {
    const r = detectRoles(ARBITER, ARBITER, orders);
    expect(r.isArbiter).toBe(true);
    expect(r.isClient || r.isFreelancer).toBe(false);
  });
  it("klien dan freelancer terdeteksi dari data pesanan (tidak peka huruf besar/kecil)", () => {
    const r = detectRoles(CLIENT.toLowerCase(), ARBITER, orders);
    expect(r.isClient).toBe(true);
    expect(r.clientOrders).toEqual([1]);
    expect(r.freelancerOrders).toEqual([2]);
    expect(r.isArbiter).toBe(false);
  });
  it("alamat tanpa pesanan tidak memiliki peran", () => {
    const r = detectRoles("0x0000000000000000000000000000000000000001", ARBITER, orders);
    expect(r.isArbiter || r.isClient || r.isFreelancer).toBe(false);
  });
});

describe("splitAmounts", () => {
  it("jumlah nilai milestone persis sama dengan total (syarat createOrder)", () => {
    const total = parseEther("0.01");
    const a = splitAmounts(total, [17, 17, 17, 17, 16, 16]);
    expect(a.reduce((x, y) => x + y, 0n)).toBe(total);
    const b = splitAmounts(parseEther("1"), [30, 50, 20]);
    expect(b).toEqual([parseEther("0.3"), parseEther("0.5"), parseEther("0.2")]);
  });
});

describe("pratinjau denda = rumus kontrak (subbab 3.4.7)", () => {
  const DAY = 86400;
  const V = parseEther("0.5");
  it("BB-07 tepat waktu = 0", () => {
    expect(lateFee(V, 1000, 1000, 500, 5000, DAY)).toBe(0n);
  });
  it("BB-08 terlambat 2 hari 3 jam -> 3 hari -> 0,075 ETH", () => {
    const deadline = 1_000_000;
    const t = deadline + 2 * DAY + 3 * 3600;
    expect(daysLate(t, deadline, DAY)).toBe(3n);
    expect(lateFee(V, t, deadline, 500, 5000, DAY)).toBe(parseEther("0.075"));
  });
  it("BB-09 terlambat 11 hari -> dibatasi 50% = 0,25 ETH", () => {
    expect(lateFee(V, 11 * DAY, 0, 500, 5000, DAY)).toBe(parseEther("0.25"));
  });
  it("mode demo (1 hari = 60 detik)", () => {
    expect(lateFee(V, 150, 0, 500, 5000, 60)).toBe(parseEther("0.075"));
  });
});
