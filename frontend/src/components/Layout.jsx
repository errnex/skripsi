import { NavLink, Link } from "react-router-dom";
import { useApp } from "../lib/AppContext";
import { NETWORK, IS_DEPLOYED, CONTRACT_ADDRESS, addressUrl } from "../config";
import { IPFS_MODE } from "../lib/ipfs";
import { shortAddr } from "../lib/format";
import { Toasts } from "./ui";

export function Navbar() {
  const { account, connect, disconnect, roles, hasWallet, correctNetwork, chainId } = useApp();
  return (
    <header className="navbar">
      <div className="container nav-inner">
        <Link to="/" className="brand">
          <span className="logo">✓</span>
          <span>
            FreelanceEscrow
            <small>Escrow per Milestone · Denda Otomatis</small>
          </span>
        </Link>
        <nav className="nav-links">
          <NavLink to="/" end>
            Beranda
          </NavLink>
          <NavLink to="/buat">Buat Pesanan</NavLink>
          <NavLink to="/klien">Dashboard Klien</NavLink>
          <NavLink to="/freelancer">Dashboard Freelancer</NavLink>
          {roles.isArbiter && <NavLink to="/arbiter">Dashboard Arbiter</NavLink>}
        </nav>
        <div className="wallet">
          {account ? (
            <>
              <div className="wallet-info">
                <span className={`net-dot ${correctNetwork ? "ok" : "bad"}`} title={`chainId ${chainId}`} />
                <code>{shortAddr(account)}</code>
                <div className="role-chips">
                  {roles.isArbiter && <span className="chip chip-red">Arbiter</span>}
                  {roles.isClient && <span className="chip chip-blue">Klien</span>}
                  {roles.isFreelancer && <span className="chip chip-green">Freelancer</span>}
                  {!roles.isArbiter && !roles.isClient && !roles.isFreelancer && <span className="chip">Pengguna baru</span>}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={disconnect}>
                Putuskan
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => connect().catch(() => {})}>
              {hasWallet ? "Hubungkan MetaMask" : "Pasang MetaMask"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

export function Banners() {
  const { account, correctNetwork, switchNetwork, hasWallet, contractOk, params, loadError } = useApp();
  const demoTime = params && Number(params.dayLength) !== 86400;
  return (
    <div className="banners">
      {!hasWallet && (
        <div className="banner banner-amber container">
          MetaMask belum terpasang. Anda tetap bisa melihat data, tetapi untuk bertransaksi pasang ekstensi{" "}
          <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
            MetaMask
          </a>
          .
        </div>
      )}
      {account && !correctNetwork && (
        <div className="banner banner-red container" data-testid="wrong-network">
          <strong>Jaringan salah.</strong> Dompet Anda tidak terhubung ke <b>{NETWORK.name}</b> (chainId {NETWORK.chainId}). Tombol
          transaksi dinonaktifkan.
          <button className="btn btn-sm btn-light" onClick={() => switchNetwork().catch(() => {})}>
            Ganti ke {NETWORK.name}
          </button>
        </div>
      )}
      {!IS_DEPLOYED && (
        <div className="banner banner-amber container">
          <strong>Kontrak belum di-deploy ke {NETWORK.name}.</strong> Alamat di <code>frontend/src/config/deployments.json</code> masih
          placeholder. Jalankan <code>cd contracts &amp;&amp; npm run deploy:sepolia</code>, atau coba mode lokal (
          <code>npm run dev:local</code>). Lihat PANDUAN.md.
        </div>
      )}
      {IS_DEPLOYED && contractOk === false && (
        <div className="banner banner-red container">
          <strong>Kontrak tidak ditemukan</strong> di alamat {shortAddr(CONTRACT_ADDRESS)} pada jaringan {NETWORK.name}.{" "}
          {NETWORK.key === "localhost"
            ? "Hardhat node mungkin di-restart: jalankan lagi npm run deploy:local di folder contracts."
            : "Periksa alamat di deployments.json."}
        </div>
      )}
      {loadError && <div className="banner banner-red container">Gagal memuat data kontrak: {loadError}</div>}
      {(demoTime || IPFS_MODE === "demo" || NETWORK.key === "localhost") && (
        <div className="banner banner-blue container">
          {NETWORK.key === "localhost" && (
            <span className="pill">
              <b>Mode lokal</b> · Hardhat node 127.0.0.1:8545
            </span>
          )}
          {demoTime && (
            <span className="pill" data-testid="demo-time">
              <b>Mode DEMO waktu</b> · 1 hari = {Number(params.dayLength)} detik (review {Number(params.reviewPeriod)} dtk, revisi{" "}
              {Number(params.revisionWindow)} dtk, arbiter {Number(params.disputeTimeout)} dtk)
            </span>
          )}
          {IPFS_MODE === "demo" && (
            <span className="pill" data-testid="demo-ipfs">
              <b>IPFS mode DEMO</b> · berkas disimpan di browser ini, CID dihitung lokal (tanpa Pinata)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div>
          Kontrak:{" "}
          {IS_DEPLOYED ? (
            addressUrl(CONTRACT_ADDRESS) ? (
              <a href={addressUrl(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">
                <code>{CONTRACT_ADDRESS}</code>
              </a>
            ) : (
              <code>{CONTRACT_ADDRESS}</code>
            )
          ) : (
            "belum di-deploy"
          )}{" "}
          · Jaringan {NETWORK.name} · IPFS: {IPFS_MODE === "pinata" ? "Pinata" : "DEMO lokal"}
        </div>
        <div className="muted small">
          Prototipe skripsi: Rancang Bangun Sistem Pembayaran Jasa Freelance Berbasis Smart Contract Ethereum dengan Mekanisme
          Escrow per Milestone dan Denda Keterlambatan Otomatis. Hanya untuk jaringan uji (testnet).
        </div>
      </div>
      <Toasts />
    </footer>
  );
}
