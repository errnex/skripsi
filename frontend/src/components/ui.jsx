import { useState } from "react";
import { MS_STATUS_ID, ORDER_STATUS_ID, shortAddr, fmtDuration } from "../lib/format";
import { addressUrl, HARDHAT_LABELS, NETWORK } from "../config";
import { fetchFile, gatewayUrl } from "../lib/ipfs";
import { useApp } from "../lib/AppContext";

const ORDER_COLORS = { Funded: "amber", Active: "blue", Completed: "green", Cancelled: "gray", Terminated: "red" };
const MS_COLORS = {
  Locked: "gray",
  Pending: "blue",
  Submitted: "amber",
  RevisionRequested: "purple",
  Disputed: "red",
  Paid: "green",
  Resolved: "teal",
  Refunded: "gray",
};

export function OrderBadge({ status }) {
  return <span className={`badge badge-${ORDER_COLORS[status] || "gray"}`}>{ORDER_STATUS_ID[status] || status}</span>;
}

export function MilestoneBadge({ status }) {
  return (
    <span className={`badge badge-${MS_COLORS[status] || "gray"}`} title={status}>
      {MS_STATUS_ID[status] || status}
    </span>
  );
}

export function Addr({ address, you, plain }) {
  const { account } = useApp();
  if (!address) return <span>-</span>;
  const isYou = account && account.toLowerCase() === address.toLowerCase();
  const label = NETWORK.key === "localhost" ? HARDHAT_LABELS[address.toLowerCase()] : null;
  const url = plain ? null : addressUrl(address);
  const inner = (
    <>
      <code>{shortAddr(address)}</code>
      {label && <span className="muted small"> · {label}</span>}
      {(isYou || you) && <span className="you-tag">Anda</span>}
    </>
  );
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="addr" title={address}>
      {inner}
    </a>
  ) : (
    <span className="addr" title={address}>
      {inner}
    </span>
  );
}

/** Tautan untuk membuka berkas IPFS (atau berkas DEMO lokal). */
export function CidLink({ cid, label }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [source, setSource] = useState(null);
  if (!cid) return <span className="muted">-</span>;
  const open = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const f = await fetchFile(cid);
      setSource(f.source);
      const url = URL.createObjectURL(f.blob);
      window.open(url, "_blank");
    } catch (ex) {
      setErr("Tidak dapat dibuka di browser ini");
      window.open(gatewayUrl(cid), "_blank");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="cid">
      <a href={gatewayUrl(cid)} onClick={open} title={cid}>
        {label || "Buka berkas"} <code>{cid.length > 18 ? `${cid.slice(0, 10)}…${cid.slice(-6)}` : cid}</code>
      </a>
      {busy && <span className="muted small"> memuat…</span>}
      {source === "demo" && <span className="badge badge-amber small">DEMO lokal</span>}
      {err && <span className="error small"> {err}</span>}
    </span>
  );
}

export function Countdown({ target, now, doneText = "sudah lewat", prefix = "" }) {
  const left = Number(target) - Number(now);
  if (left <= 0) return <span className="countdown done">{doneText}</span>;
  return (
    <span className={`countdown ${left < 120 ? "soon" : ""}`}>
      {prefix}
      {fmtDuration(left)}
    </span>
  );
}

export function TxButton({ children, onClick, disabled, variant = "primary", title }) {
  const { canTransact } = useApp();
  const [busy, setBusy] = useState(false);
  const off = disabled || !canTransact || busy;
  return (
    <button
      className={`btn btn-${variant}`}
      disabled={off}
      title={!canTransact ? "Hubungkan dompet ke jaringan yang benar terlebih dahulu" : title}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Memproses…" : children}
    </button>
  );
}

export function Toasts() {
  const { toasts, closeToast } = useApp();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.state}`}>
          <div className="toast-head">
            <strong>{t.label}</strong>
            <button className="toast-x" onClick={() => closeToast(t.id)} aria-label="Tutup">
              ×
            </button>
          </div>
          <div>{t.text}</div>
          {t.hash &&
            (t.url ? (
              <a href={t.url} target="_blank" rel="noreferrer">
                Lihat di Etherscan ↗
              </a>
            ) : (
              <code className="small">{t.hash.slice(0, 18)}…</code>
            ))}
        </div>
      ))}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}
