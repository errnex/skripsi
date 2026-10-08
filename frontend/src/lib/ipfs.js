/**
 * Upload dan baca berkas IPFS.
 *
 * - Jika VITE_PINATA_JWT diisi  -> upload ke Pinata (IPFS publik), CID asli dari Pinata.
 * - Jika kosong                -> MODE DEMO: CID dihitung lokal dari hash SHA-256 isi berkas
 *                                 (format CIDv1 raw, sama dengan CID Pinata untuk berkas < 256 KiB),
 *                                 dan berkas disimpan di IndexedDB browser ini saja.
 *                                 Berkas DEMO tidak bisa dibuka dari browser/perangkat lain.
 */
const PINATA_JWT = (import.meta.env.VITE_PINATA_JWT || "").trim();
const PINATA_GATEWAY = (import.meta.env.VITE_PINATA_GATEWAY || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");

export const IPFS_MODE = PINATA_JWT ? "pinata" : "demo";

export const GATEWAYS = [
  ...(PINATA_GATEWAY ? [`https://${PINATA_GATEWAY}/ipfs/`] : []),
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
];

export function gatewayUrl(cid) {
  return `${GATEWAYS[0]}${cid}`;
}

// ---------------------------------------------------------------- CID lokal (mode demo)
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** CIDv1 (codec raw 0x55, multihash sha2-256 0x12) dari isi berkas -> "bafkrei..." */
export async function computeCid(arrayBuffer) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", arrayBuffer));
  const bytes = new Uint8Array(4 + digest.length);
  bytes.set([0x01, 0x55, 0x12, 0x20], 0);
  bytes.set(digest, 4);
  return "b" + base32(bytes);
}

// ---------------------------------------------------------------- IndexedDB sederhana
const DB_NAME = "freelance-escrow-demo-ipfs";
const STORE = "files";
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------- API publik
/**
 * Upload sebuah File/Blob. Mengembalikan { cid, mode }.
 */
export async function uploadFile(file, name) {
  const fileName = name || file.name || "berkas";
  if (IPFS_MODE === "pinata") {
    const form = new FormData();
    form.append("file", file, fileName);
    form.append("network", "public");
    form.append("name", fileName);
    const res = await fetch("https://uploads.pinata.cloud/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${PINATA_JWT}` },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Upload Pinata gagal (${res.status}). Periksa VITE_PINATA_JWT. ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const cid = json?.data?.cid;
    if (!cid) throw new Error("Respons Pinata tidak berisi CID");
    // simpan juga salinan lokal agar langsung bisa dibuka tanpa menunggu gateway
    await idbPut(cid, { name: fileName, type: file.type || "application/octet-stream", blob: file, mode: "pinata" }).catch(() => {});
    return { cid, mode: "pinata" };
  }
  const buf = await file.arrayBuffer();
  const cid = await computeCid(buf);
  await idbPut(cid, { name: fileName, type: file.type || "application/octet-stream", blob: new Blob([buf], { type: file.type }), mode: "demo" });
  return { cid, mode: "demo" };
}

export async function uploadJSON(obj, name = "data.json") {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  return uploadFile(new File([blob], name, { type: "application/json" }), name);
}

export async function uploadText(text, name = "catatan.txt") {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  return uploadFile(new File([blob], name, { type: "text/plain" }), name);
}

const memCache = new Map();

/**
 * Mengambil berkas berdasarkan CID: IndexedDB lokal dulu, lalu gateway IPFS.
 * Mengembalikan { blob, name, type, source: "lokal" | "ipfs" } atau melempar error.
 */
export async function fetchFile(cid) {
  if (!cid) throw new Error("CID kosong");
  if (memCache.has(cid)) return memCache.get(cid);
  const local = await idbGet(cid).catch(() => null);
  if (local) {
    const r = { blob: local.blob, name: local.name, type: local.type, source: local.mode === "demo" ? "demo" : "lokal" };
    memCache.set(cid, r);
    return r;
  }
  let lastErr;
  for (const gw of GATEWAYS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(gw + cid, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const r = { blob, name: cid, type: blob.type, source: "ipfs" };
      memCache.set(cid, r);
      return r;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Berkas tidak ditemukan (${lastErr?.message || "gateway gagal"})`);
}

export async function fetchJSON(cid) {
  const f = await fetchFile(cid);
  return JSON.parse(await f.blob.text());
}

export async function fetchText(cid) {
  const f = await fetchFile(cid);
  return f.blob.text();
}
