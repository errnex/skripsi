import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../lib/AppContext";
import OrderCard from "../components/OrderCard";
import { Empty } from "../components/ui";
import { useBrief } from "../lib/useBrief";
import { fmtEth } from "../lib/format";

function CategoryFilterItem({ order, category, status, children }) {
  const { brief } = useBrief(order.briefCID);
  const cat = brief?.category || "Tanpa kategori";
  if (category !== "Semua" && cat !== category) return null;
  if (status !== "Semua" && order.status !== status) return null;
  return children;
}

export default function Beranda() {
  const { account, connect, roles, orders, loading, hasWallet } = useApp();
  const [category, setCategory] = useState("Semua");
  const [status, setStatus] = useState("Semua");

  const stats = useMemo(() => {
    const locked = orders
      .filter((o) => o.status === "Funded" || o.status === "Active")
      .reduce(
        (s, o) =>
          s +
          o.milestones
            .filter((m) => !["Paid", "Resolved", "Refunded"].includes(m.status))
            .reduce((a, m) => a + m.amount, 0n),
        0n,
      );
    return {
      total: orders.length,
      active: orders.filter((o) => o.status === "Active").length,
      disputes: orders.filter((o) => o.status === "Active" && o.milestones[o.currentMilestone]?.status === "Disputed").length,
      locked,
    };
  }, [orders]);

  return (
    <div className="container">
      <section className="hero">
        <div>
          <h1>Bayar jasa freelance dengan aman lewat smart contract</h1>
          <p className="lead">
            Klien menyetor seluruh nilai pesanan ke smart contract (escrow). Dana dicairkan <b>per milestone</b> setelah hasil kerja
            disetujui. Keterlambatan dikenai <b>denda otomatis</b> berdasarkan waktu blok, dan sengketa diputus arbiter yang tidak
            menerima dana.
          </p>
          {!account ? (
            <button className="btn btn-primary btn-lg" onClick={() => connect().catch(() => {})}>
              {hasWallet ? "Hubungkan MetaMask" : "Pasang MetaMask"}
            </button>
          ) : (
            <div className="role-box" data-testid="role-box">
              <div>Dompet Anda terdeteksi sebagai:</div>
              <div className="role-links">
                {roles.isArbiter && (
                  <Link className="btn btn-danger" to="/arbiter">
                    Arbiter → Dashboard Arbiter
                  </Link>
                )}
                {roles.isClient && (
                  <Link className="btn btn-primary" to="/klien">
                    Klien → Dashboard Klien
                  </Link>
                )}
                {roles.isFreelancer && (
                  <Link className="btn btn-success" to="/freelancer">
                    Freelancer → Dashboard Freelancer
                  </Link>
                )}
                {!roles.isArbiter && !roles.isClient && !roles.isFreelancer && (
                  <>
                    <span className="muted">Belum memiliki pesanan.</span>
                    <Link className="btn btn-primary" to="/buat">
                      Buat pesanan pertama
                    </Link>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="steps">
          <div className="step">
            <span>1</span>
            <div>
              <b>Klien membuat pesanan</b>
              <p>Brief diunggah ke IPFS, milestone dan denda ditentukan, dana penuh dikunci di kontrak.</p>
            </div>
          </div>
          <div className="step">
            <span>2</span>
            <div>
              <b>Freelancer menerima & mengirim hasil</b>
              <p>Tenggat tiap milestone dihitung sejak dibuka. Telat = denda otomatis (ada batas maksimum).</p>
            </div>
          </div>
          <div className="step">
            <span>3</span>
            <div>
              <b>Klien menyetujui / minta revisi / menolak</b>
              <p>Disetujui: dana cair. Tidak ditanggapi selama masa review: freelancer bisa mencairkan sendiri.</p>
            </div>
          </div>
          <div className="step">
            <span>4</span>
            <div>
              <b>Sengketa → arbiter</b>
              <p>Arbiter membagi sisa dana dengan alasan tercatat. Lewat 7 hari tanpa keputusan: dibagi 50:50.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="stats">
        <div className="stat">
          <div className="stat-num">{stats.total}</div>
          <div className="stat-label">Total pesanan</div>
        </div>
        <div className="stat">
          <div className="stat-num">{stats.active}</div>
          <div className="stat-label">Sedang berjalan</div>
        </div>
        <div className="stat">
          <div className="stat-num">{stats.disputes}</div>
          <div className="stat-label">Dalam sengketa</div>
        </div>
        <div className="stat">
          <div className="stat-num">{fmtEth(stats.locked)} ETH</div>
          <div className="stat-label">Dana terkunci di escrow</div>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>Katalog Pesanan</h2>
          <div className="filters">
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter kategori">
              {["Semua", "Website", "Artikel", "Tanpa kategori"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
              {["Semua", "Funded", "Active", "Completed", "Cancelled", "Terminated"].map((c) => (
                <option key={c} value={c}>
                  {c === "Semua" ? "Semua status" : c}
                </option>
              ))}
            </select>
          </div>
        </div>
        {loading ? (
          <Empty>Memuat data dari blockchain…</Empty>
        ) : orders.length === 0 ? (
          <Empty>
            Belum ada pesanan. <Link to="/buat">Buat pesanan pertama →</Link>
          </Empty>
        ) : (
          <div className="grid">
            {orders.map((o) => (
              <CategoryFilterItem key={o.id} order={o} category={category} status={status}>
                <OrderCard order={o} />
              </CategoryFilterItem>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
