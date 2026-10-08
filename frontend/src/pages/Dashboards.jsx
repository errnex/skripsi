import { Link } from "react-router-dom";
import { useApp } from "../lib/AppContext";
import OrderCard, { useOrderMeta } from "../components/OrderCard";
import { Countdown, Empty, MilestoneBadge } from "../components/ui";
import { fmtEth, fmtDate } from "../lib/format";
import { lateFee } from "../lib/lateFee";

function NeedWallet() {
  const { connect } = useApp();
  return (
    <Empty>
      Hubungkan MetaMask untuk melihat dashboard.{" "}
      <button className="btn btn-primary btn-sm" onClick={() => connect().catch(() => {})}>
        Hubungkan
      </button>
    </Empty>
  );
}

function sumMs(orders, pred) {
  return orders.reduce((s, o) => s + o.milestones.filter((m, i) => pred(o, m, i)).reduce((a, m) => a + m.amount, 0n), 0n);
}

/** Petunjuk tindakan yang perlu dilakukan pengguna pada sebuah pesanan. */
function clientHint(o, now, p) {
  const m = o.milestones[o.currentMilestone];
  if (o.status === "Funded") return "Menunggu freelancer menerima (bisa dibatalkan)";
  if (o.status !== "Active" || !m) return null;
  if (m.status === "Submitted") return "⚡ Hasil kerja masuk, perlu direview";
  if (m.status === "Disputed") return "Sengketa sedang ditinjau arbiter";
  if (m.status === "Pending" && BigInt(now) > m.deadline + o.gracePeriod) return "⚡ Freelancer tidak mengirim, refund bisa diklaim";
  if (m.status === "Pending" && BigInt(now) > m.deadline) return "Freelancer terlambat (denda berjalan)";
  return null;
}

function freelancerHint(o, now, p) {
  const m = o.milestones[o.currentMilestone];
  if (o.status === "Funded") return "⚡ Pesanan baru, terima untuk mulai";
  if (o.status !== "Active" || !m) return null;
  if (m.status === "Pending") return BigInt(now) > m.deadline ? "⚡ Terlambat, segera kirim" : "Kerjakan dan kirim hasil";
  if (m.status === "RevisionRequested") return "⚡ Klien meminta revisi";
  if (m.status === "Submitted" && p && BigInt(now) > m.lastSubmittedAt + p.reviewPeriod) return "⚡ Masa review habis, dana bisa dicairkan";
  if (m.status === "Disputed") return "Sengketa: unggah bukti Anda";
  return null;
}

export function DashboardKlien() {
  const { account, orders, roles, chainNow, params } = useApp();
  if (!account) return <div className="container"><NeedWallet /></div>;
  const mine = orders.filter((o) => roles.clientOrders.includes(o.id));
  const locked = sumMs(mine, (o, m) => (o.status === "Active" || o.status === "Funded") && !["Paid", "Resolved", "Refunded"].includes(m.status));
  const paid = sumMs(mine, (o, m) => m.status === "Paid" || m.status === "Resolved");
  const refunded = sumMs(mine, (o, m) => m.status === "Refunded");
  return (
    <div className="container">
      <div className="section-head">
        <h1>Dashboard Klien</h1>
        <Link to="/buat" className="btn btn-primary">
          + Buat pesanan
        </Link>
      </div>
      <section className="stats">
        <div className="stat"><div className="stat-num">{mine.length}</div><div className="stat-label">Pesanan saya</div></div>
        <div className="stat"><div className="stat-num">{fmtEth(locked)} ETH</div><div className="stat-label">Masih di escrow</div></div>
        <div className="stat"><div className="stat-num">{fmtEth(paid)} ETH</div><div className="stat-label">Sudah dicairkan/diputus</div></div>
        <div className="stat"><div className="stat-num">{fmtEth(refunded)} ETH</div><div className="stat-label">Refund</div></div>
      </section>
      {mine.length === 0 ? (
        <Empty>Anda belum membuat pesanan sebagai klien. <Link to="/buat">Buat pesanan →</Link></Empty>
      ) : (
        <div className="grid">
          {mine.map((o) => (
            <OrderCard key={o.id} order={o} highlight={clientHint(o, chainNow, params)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActiveMilestoneRow({ o }) {
  const { chainNow, params } = useApp();
  const { title, brief } = useOrderMeta(o);
  const m = o.milestones[o.currentMilestone];
  if (!m) return null;
  const dl = Number(params?.dayLength || 86400);
  const fee = m.firstSubmittedAt > 0n ? m.lateFee : lateFee(m.amount, chainNow, m.deadline, o.dailyRateBps, o.capBps, dl);
  return (
    <tr>
      <td>
        <Link to={`/pesanan/${o.id}`}>#{o.id} {title}</Link>
      </td>
      <td>
        M{o.currentMilestone + 1}: {brief?.milestones?.[o.currentMilestone]?.title || ""} <MilestoneBadge status={m.status} />
      </td>
      <td className="mono">{fmtEth(m.amount)}</td>
      <td className="small">
        {fmtDate(m.deadline)}
        <br />
        <Countdown target={m.deadline} now={chainNow} prefix="sisa " doneText="terlambat" />
      </td>
      <td className={`mono ${fee > 0n ? "error" : ""}`}>{fmtEth(fee)}</td>
    </tr>
  );
}

export function DashboardFreelancer() {
  const { account, orders, roles, chainNow, params } = useApp();
  if (!account) return <div className="container"><NeedWallet /></div>;
  const mine = orders.filter((o) => roles.freelancerOrders.includes(o.id));
  const incoming = mine.filter((o) => o.status === "Funded");
  const active = mine.filter((o) => o.status === "Active");
  const earned = mine.reduce(
    (s, o) => s + o.milestones.filter((m) => m.status === "Paid").reduce((a, m) => a + m.amount - m.lateFee, 0n),
    0n,
  );
  const escrow = sumMs(mine, (o, m) => o.status === "Active" && !["Paid", "Resolved", "Refunded"].includes(m.status));
  return (
    <div className="container">
      <h1>Dashboard Freelancer</h1>
      <section className="stats">
        <div className="stat"><div className="stat-num">{incoming.length}</div><div className="stat-label">Pesanan masuk</div></div>
        <div className="stat"><div className="stat-num">{active.length}</div><div className="stat-label">Sedang dikerjakan</div></div>
        <div className="stat"><div className="stat-num">{fmtEth(escrow)} ETH</div><div className="stat-label">Dana dijamin di escrow</div></div>
        <div className="stat"><div className="stat-num">{fmtEth(earned)} ETH</div><div className="stat-label">Diterima (dibayar)</div></div>
      </section>
      {active.length > 0 && (
        <div className="card">
          <h2>Milestone aktif</h2>
          <table className="history">
            <thead>
              <tr>
                <th>Pesanan</th>
                <th>Milestone</th>
                <th>Nilai (ETH)</th>
                <th>Tenggat</th>
                <th>Perkiraan denda (ETH)</th>
              </tr>
            </thead>
            <tbody>
              {active.map((o) => (
                <ActiveMilestoneRow key={o.id} o={o} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mine.length === 0 ? (
        <Empty>Belum ada pesanan untuk alamat ini. Berikan alamat dompet Anda kepada klien.</Empty>
      ) : (
        <div className="grid">
          {mine.map((o) => (
            <OrderCard key={o.id} order={o} highlight={freelancerHint(o, chainNow, params)} />
          ))}
        </div>
      )}
    </div>
  );
}

function DisputeRow({ o }) {
  const { chainNow, params } = useApp();
  const { title } = useOrderMeta(o);
  const m = o.milestones[o.currentMilestone];
  const end = m.disputeStartedAt + (params?.disputeTimeout || 0n);
  return (
    <tr>
      <td>
        <Link to={`/pesanan/${o.id}`}>#{o.id} {title}</Link>
      </td>
      <td>M{o.currentMilestone + 1}</td>
      <td className="mono">{fmtEth(m.amount)}</td>
      <td className="mono">{fmtEth(m.lateFee)}</td>
      <td className="small">{fmtDate(m.disputeStartedAt)}</td>
      <td>
        <Countdown target={end} now={chainNow} prefix="sisa " doneText="lewat (50:50)" />
      </td>
      <td>
        <Link className="btn btn-danger btn-sm" to={`/pesanan/${o.id}`}>
          Tinjau & putuskan
        </Link>
      </td>
    </tr>
  );
}

export function DashboardArbiter() {
  const { account, orders, roles, params } = useApp();
  if (!account) return <div className="container"><NeedWallet /></div>;
  if (!roles.isArbiter)
    return (
      <div className="container">
        <Empty>
          <b>Akses ditolak.</b> Dashboard Arbiter hanya untuk dompet arbiter <code>{params?.arbiter}</code>.
        </Empty>
      </div>
    );
  const disputes = orders.filter((o) => o.status === "Active" && o.milestones[o.currentMilestone]?.status === "Disputed");
  const resolved = orders.flatMap((o) => o.milestones.filter((m) => m.status === "Resolved").map((m) => ({ o, m })));
  return (
    <div className="container">
      <h1>Dashboard Arbiter</h1>
      <p className="muted">
        Arbiter hanya dapat membagi dana milestone yang bersengketa antara klien dan freelancer, dalam batas waktu, dan tidak pernah
        menerima dana. Setiap keputusan wajib disertai alasan yang dicatat di IPFS.
      </p>
      <div className="card">
        <h2>Sengketa menunggu keputusan ({disputes.length})</h2>
        {disputes.length === 0 ? (
          <Empty>Tidak ada sengketa aktif.</Empty>
        ) : (
          <table className="history">
            <thead>
              <tr>
                <th>Pesanan</th>
                <th>Milestone</th>
                <th>Nilai (ETH)</th>
                <th>Denda (ETH)</th>
                <th>Mulai</th>
                <th>Sisa waktu</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {disputes.map((o) => (
                <DisputeRow key={o.id} o={o} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h2>Riwayat sengketa selesai ({resolved.length})</h2>
        {resolved.length === 0 ? (
          <Empty>Belum ada.</Empty>
        ) : (
          <ul className="plain">
            {resolved.map(({ o, m }) => (
              <li key={`${o.id}-${m.index}`}>
                <Link to={`/pesanan/${o.id}`}>Pesanan #{o.id}</Link> · M{m.index + 1} · {fmtEth(m.amount)} ETH ·{" "}
                {m.resolutionCID ? "diputus arbiter" : "50:50 (kedaluwarsa)"}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
