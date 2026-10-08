import { BrowserProvider, Contract, JsonRpcProvider, zeroPadValue, toBeHex } from "ethers";
import { ABI, CONTRACT_ADDRESS, DEPLOY_BLOCK, NETWORK } from "../config";
import { ORDER_STATUS, MS_STATUS } from "./format";

/** Provider khusus BACA data (tidak butuh MetaMask). */
export const readProvider = new JsonRpcProvider(NETWORK.rpcUrl, NETWORK.chainId, { staticNetwork: true });
export const readContract = new Contract(CONTRACT_ADDRESS, ABI, readProvider);

/** Kontrak untuk MENULIS (transaksi), ditandatangani lewat MetaMask. */
export function writeContract(signer) {
  return new Contract(CONTRACT_ADDRESS, ABI, signer);
}

export async function isContractDeployed() {
  const code = await readProvider.getCode(CONTRACT_ADDRESS);
  return code && code !== "0x";
}

export async function fetchParams() {
  const [arbiter, dayLength, reviewPeriod, revisionWindow, disputeTimeout] = await Promise.all([
    readContract.arbiter(),
    readContract.DAY_LENGTH(),
    readContract.REVIEW_PERIOD(),
    readContract.REVISION_WINDOW(),
    readContract.DISPUTE_TIMEOUT(),
  ]);
  return { arbiter, dayLength, reviewPeriod, revisionWindow, disputeTimeout };
}

function normMilestone(m, i) {
  return {
    index: i,
    amount: m.amount,
    duration: m.duration,
    deadline: m.deadline,
    firstSubmittedAt: m.firstSubmittedAt,
    lastSubmittedAt: m.lastSubmittedAt,
    workCID: m.workCID,
    revisionCount: Number(m.revisionCount),
    lateFee: m.lateFee,
    disputeStartedAt: m.disputeStartedAt,
    clientEvidenceCID: m.clientEvidenceCID,
    freelancerEvidenceCID: m.freelancerEvidenceCID,
    resolutionCID: m.resolutionCID,
    revisionRequestedAt: m.revisionRequestedAt,
    status: MS_STATUS[Number(m.status)],
  };
}

export async function fetchOrder(id) {
  const [o, ms] = await Promise.all([readContract.getOrder(id), readContract.getMilestones(id)]);
  return {
    id: Number(id),
    client: o.client,
    freelancer: o.freelancer,
    briefCID: o.briefCID,
    totalAmount: o.totalAmount,
    dailyRateBps: Number(o.dailyRateBps),
    capBps: Number(o.capBps),
    maxRevisions: Number(o.maxRevisions),
    gracePeriod: o.gracePeriod,
    currentMilestone: Number(o.currentMilestone),
    status: ORDER_STATUS[Number(o.status)],
    milestones: ms.map(normMilestone),
  };
}

export async function fetchAllOrders() {
  const count = Number(await readContract.orderCount());
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  const out = [];
  // ambil bertahap (maks 8 paralel) agar ramah terhadap RPC publik
  for (let i = 0; i < ids.length; i += 8) {
    const chunk = await Promise.all(ids.slice(i, i + 8).map(fetchOrder));
    out.push(...chunk);
  }
  return out.reverse(); // terbaru di atas
}

/**
 * Daftar provider untuk membaca event. MetaMask (jika terhubung ke jaringan yang benar) dicoba dulu
 * karena RPC bawaannya biasanya menyimpan riwayat lengkap; RPC publik (publicnode) hanya menyimpan
 * riwayat blok beberapa hari terakhir ("pruned history unavailable").
 */
async function logProviders() {
  const list = [];
  if (typeof window !== "undefined" && window.ethereum) {
    try {
      const hex = await window.ethereum.request({ method: "eth_chainId" });
      if (parseInt(hex, 16) === NETWORK.chainId) list.push(new BrowserProvider(window.ethereum));
    } catch {
      /* abaikan */
    }
  }
  list.push(readProvider);
  return list;
}

/** getLogs bertahap: rentang blok dikecilkan otomatis jika RPC menolak rentang besar. */
async function getLogsWith(provider, filter) {
  const latest = await provider.getBlockNumber();
  let from = DEPLOY_BLOCK;
  let step = Math.min(latest - from + 1, 50_000);
  const logs = [];
  while (from <= latest) {
    const to = Math.min(from + step - 1, latest);
    try {
      const part = await provider.getLogs({ ...filter, fromBlock: from, toBlock: to });
      logs.push(...part);
      from = to + 1;
    } catch (e) {
      if (/pruned/i.test(e?.message || "") || step <= 100) throw e;
      step = Math.max(100, Math.floor(step / 5));
    }
  }
  return logs;
}

async function getLogsChunked(filter) {
  let lastErr;
  for (const p of await logProviders()) {
    try {
      return { logs: await getLogsWith(p, filter), provider: p };
    } catch (e) {
      lastErr = e;
    }
  }
  const msg = lastErr?.message || String(lastErr);
  if (/pruned/i.test(msg)) {
    throw new Error(
      "RPC publik tidak lagi menyimpan riwayat blok lama. Hubungkan MetaMask ke jaringan yang benar, atau isi VITE_SEPOLIA_RPC_URL dengan RPC Alchemy/Infura (lihat PANDUAN.md).",
    );
  }
  throw lastErr;
}

const blockTimeCache = new Map();
async function blockTime(provider, n) {
  if (!blockTimeCache.has(n)) {
    const b = await provider.getBlock(n);
    blockTimeCache.set(n, b ? b.timestamp : 0);
  }
  return blockTimeCache.get(n);
}

/** Riwayat transaksi satu pesanan dari event kontrak (orderId = topic indexed pertama). */
export async function fetchHistory(orderId) {
  const topic = zeroPadValue(toBeHex(orderId), 32);
  const { logs, provider } = await getLogsChunked({ address: CONTRACT_ADDRESS, topics: [null, topic] });
  const items = [];
  for (const log of logs) {
    let parsed;
    try {
      parsed = readContract.interface.parseLog(log);
    } catch {
      continue;
    }
    if (!parsed) continue;
    items.push({
      name: parsed.name,
      args: parsed.args,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.index,
      timestamp: await blockTime(provider, log.blockNumber),
    });
  }
  items.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  return items;
}
