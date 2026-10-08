/**
 * Skenario end-to-end di jaringan lokal (Hardhat node) terhadap kontrak yang SUDAH di-deploy
 * oleh scripts/deploy.ts (alamat dibaca dari frontend/src/config/deployments.json).
 *
 *   Terminal 1: npx hardhat node
 *   Terminal 2: npm run deploy:local && npm run e2e:local
 *
 * Skenario:
 *   A. Website 3 milestone: tepat waktu -> terlambat + revisi -> sengketa diputus arbiter (70%)
 *   B. Artikel 6 bab: finalizeAfterReview -> bab 2 tidak dikirim -> claimRefund
 *   C. Sengketa kedaluwarsa -> settleDisputeTimeout (50:50)
 *   D. Pembatalan sebelum diterima -> cancelOrder
 * Waktu dimajukan dengan evm_increaseTime (hanya bisa di jaringan lokal).
 * Setelah selesai, pesanan-pesanan ini tetap ada sehingga bisa dilihat di website (mode lokal).
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const eth = (v: string) => ethers.parseEther(v);
const fmt = (v: bigint) => ethers.formatEther(v);
const gasTable: Record<string, bigint[]> = {};
let checks = 0;

function check(cond: boolean, msg: string) {
  if (!cond) throw new Error("GAGAL: " + msg);
  checks++;
  console.log("   ✔", msg);
}

async function advance(seconds: number) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine", []);
}

async function send(label: string, txPromise: Promise<any>) {
  const tx = await txPromise;
  const rc = await tx.wait();
  (gasTable[label] ||= []).push(rc.gasUsed);
  return rc;
}

async function main() {
  if (network.name !== "localhost") throw new Error("Jalankan dengan --network localhost");
  const file = path.resolve(__dirname, "../../frontend/src/config/deployments.json");
  const dep = JSON.parse(fs.readFileSync(file, "utf8")).localhost;
  if (!dep?.address) throw new Error("Belum ada deployment lokal. Jalankan npm run deploy:local");

  const [, client, freelancer, arbiter] = await ethers.getSigners();
  const escrow = await ethers.getContractAt("FreelanceEscrow", dep.address);
  check((await escrow.arbiter()) === arbiter.address, "arbiter kontrak = akun Hardhat #3");
  const DAY = Number(await escrow.DAY_LENGTH());
  const REVIEW = Number(await escrow.REVIEW_PERIOD());
  const DISPUTE = Number(await escrow.DISPUTE_TIMEOUT());
  console.log(`Kontrak ${dep.address} | 1 hari = ${DAY} detik | review ${REVIEW}s | arbiter ${DISPUTE}s\n`);

  const bal = (a: string) => ethers.provider.getBalance(a);
  const nextId = async () => (await escrow.orderCount()) + 1n;

  // ------------------------------------------------------------------ A
  console.log("A. Jasa website, 3 milestone (0,3 / 0,5 / 0,2 ETH), denda 5%/hari, maks 50%, batas akhir 7 hari");
  const A = await nextId();
  await send(
    "createOrder (3 milestone)",
    escrow
      .connect(client)
      .createOrder(freelancer.address, "bafkreidemo-brief-website", [eth("0.3"), eth("0.5"), eth("0.2")], [5 * DAY, 10 * DAY, 4 * DAY], 500, 5000, 2, 7 * DAY, {
        value: eth("1"),
      }),
  );
  check((await escrow.getOrder(A)).status === 0n, `pesanan #${A} berstatus Funded`);
  await send("acceptOrder", escrow.connect(freelancer).acceptOrder(A));
  await send("submitWork (pertama)", escrow.connect(freelancer).submitWork(A, 0, "bafkreidemo-desain"));
  let f0 = await bal(freelancer.address);
  let rc = await send("approveMilestone", escrow.connect(client).approveMilestone(A, 0));
  check((await bal(freelancer.address)) === f0 + eth("0.3"), "M1 tepat waktu: freelancer menerima 0,3 ETH");

  const m2 = await escrow.getMilestone(A, 1);
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  await advance(Number(m2.deadline) - now + 2 * DAY + Math.floor(DAY / 8) - 1); // 2 hari 3 jam terlambat
  await send("submitWork (pertama)", escrow.connect(freelancer).submitWork(A, 1, "bafkreidemo-website-v1"));
  check((await escrow.getMilestone(A, 1)).lateFee === eth("0.075"), "M2 terlambat 2 hari 3 jam -> d = 3, denda 0,075 ETH");
  await send("requestRevision", escrow.connect(client).requestRevision(A, 1, "bafkreidemo-catatan-revisi"));
  await send("submitWork (revisi)", escrow.connect(freelancer).submitWork(A, 1, "bafkreidemo-website-v2"));
  check((await escrow.getMilestone(A, 1)).lateFee === eth("0.075"), "revisi tidak menambah denda");
  f0 = await bal(freelancer.address);
  let c0 = await bal(client.address);
  rc = await send("approveMilestone", escrow.connect(client).approveMilestone(A, 1));
  const gasCost = rc.gasUsed * rc.gasPrice;
  check((await bal(freelancer.address)) === f0 + eth("0.425"), "M2 disetujui: freelancer menerima 0,425 ETH");
  check((await bal(client.address)) === c0 + eth("0.075") - gasCost, "M2 disetujui: klien menerima denda 0,075 ETH");

  await send("submitWork (pertama)", escrow.connect(freelancer).submitWork(A, 2, "bafkreidemo-online"));
  await send("rejectMilestone", escrow.connect(client).rejectMilestone(A, 2, "bafkreidemo-alasan-tolak"));
  check((await escrow.getMilestone(A, 2)).status === 3n, "M3 ditolak -> Disputed (tanpa refund otomatis)");
  await send("submitEvidence", escrow.connect(freelancer).submitEvidence(A, 2, "bafkreidemo-bukti-freelancer"));
  await send("submitEvidence", escrow.connect(client).submitEvidence(A, 2, "bafkreidemo-bukti-klien"));
  f0 = await bal(freelancer.address);
  c0 = await bal(client.address);
  const a0 = await bal(arbiter.address);
  rc = await send("resolveDispute", escrow.connect(arbiter).resolveDispute(A, 2, 70, "bafkreidemo-alasan-arbiter"));
  check((await bal(client.address)) === c0 + eth("0.14"), "arbiter 70%: klien menerima 0,14 ETH");
  check((await bal(freelancer.address)) === f0 + eth("0.06"), "arbiter 70%: freelancer menerima 0,06 ETH");
  check((await bal(arbiter.address)) === a0 - rc.gasUsed * rc.gasPrice, "arbiter tidak menerima dana (hanya membayar gas)");
  check((await escrow.getOrder(A)).status === 2n, `pesanan #${A} Completed`);

  // ------------------------------------------------------------------ B
  console.log("\nB. Jasa artikel, 6 bab x 0,1 ETH; bab 1 dicairkan otomatis setelah masa review, bab 2 tidak dikirim -> refund");
  const B = await nextId();
  await send(
    "createOrder (6 milestone)",
    escrow
      .connect(client)
      .createOrder(freelancer.address, "bafkreidemo-brief-artikel", Array(6).fill(eth("0.1")), Array(6).fill(3 * DAY), 500, 5000, 1, 7 * DAY, {
        value: eth("0.6"),
      }),
  );
  await send("acceptOrder", escrow.connect(freelancer).acceptOrder(B));
  await send("submitWork (pertama)", escrow.connect(freelancer).submitWork(B, 0, "bafkreidemo-bab1"));
  await advance(REVIEW + 1);
  f0 = await bal(freelancer.address);
  rc = await send("finalizeAfterReview", escrow.connect(freelancer).finalizeAfterReview(B, 0));
  check((await bal(freelancer.address)) === f0 + eth("0.1") - rc.gasUsed * rc.gasPrice, "bab 1: finalizeAfterReview mencairkan 0,1 ETH");
  await advance(3 * DAY + 7 * DAY + 1);
  c0 = await bal(client.address);
  rc = await send("claimRefund", escrow.connect(client).claimRefund(B));
  check((await bal(client.address)) === c0 + eth("0.5") - rc.gasUsed * rc.gasPrice, "bab 2-6 (0,5 ETH) dikembalikan ke klien");
  check((await escrow.getOrder(B)).status === 4n, `pesanan #${B} Terminated`);

  // ------------------------------------------------------------------ C
  console.log("\nC. Sengketa tanpa keputusan arbiter -> settleDisputeTimeout (50:50)");
  const C = await nextId();
  await send(
    "createOrder (1 milestone)",
    escrow.connect(client).createOrder(freelancer.address, "bafkreidemo-brief-c", [eth("0.2")], [2 * DAY], 500, 5000, 1, 7 * DAY, { value: eth("0.2") }),
  );
  await send("acceptOrder", escrow.connect(freelancer).acceptOrder(C));
  await send("submitWork (pertama)", escrow.connect(freelancer).submitWork(C, 0, "bafkreidemo-c"));
  await send("rejectMilestone", escrow.connect(client).rejectMilestone(C, 0, "bafkreidemo-alasan-c"));
  await advance(DISPUTE + 1);
  c0 = await bal(client.address);
  rc = await send("settleDisputeTimeout", escrow.connect(client).settleDisputeTimeout(C, 0));
  check((await bal(client.address)) === c0 + eth("0.1") - rc.gasUsed * rc.gasPrice, "dibagi 50:50: klien 0,1 ETH, freelancer 0,1 ETH");

  // ------------------------------------------------------------------ D
  console.log("\nD. Pembatalan sebelum freelancer menerima");
  const D = await nextId();
  await send(
    "createOrder (1 milestone)",
    escrow.connect(client).createOrder(freelancer.address, "bafkreidemo-brief-d", [eth("0.3")], [2 * DAY], 500, 5000, 1, 7 * DAY, { value: eth("0.3") }),
  );
  c0 = await bal(client.address);
  rc = await send("cancelOrder", escrow.connect(client).cancelOrder(D));
  check((await bal(client.address)) === c0 + eth("0.3") - rc.gasUsed * rc.gasPrice, "cancelOrder: 0,3 ETH kembali penuh ke klien");

  // ------------------------------------------------------------------ ringkasan
  const contractBal = await bal(dep.address);
  console.log(`\nSaldo kontrak setelah semua skenario: ${fmt(contractBal)} ETH`);
  console.log("\nGas terpakai per fungsi (jaringan lokal):");
  console.log("Fungsi".padEnd(30), "n".padStart(3), "min".padStart(10), "max".padStart(10), "rata-rata".padStart(10));
  for (const [k, v] of Object.entries(gasTable)) {
    const min = v.reduce((a, b) => (a < b ? a : b));
    const max = v.reduce((a, b) => (a > b ? a : b));
    const avg = v.reduce((a, b) => a + b, 0n) / BigInt(v.length);
    console.log(k.padEnd(30), String(v.length).padStart(3), String(min).padStart(10), String(max).padStart(10), String(avg).padStart(10));
  }
  console.log(`\nSEMUA ${checks} PEMERIKSAAN LULUS ✔`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
