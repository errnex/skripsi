import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { parseEther } from "ethers";
import { useApp } from "../lib/AppContext";
import { splitAmounts, validateOrderForm } from "../lib/validation";
import { uploadFile, uploadJSON, IPFS_MODE } from "../lib/ipfs";
import { fmtEth, fmtDuration } from "../lib/format";
import { lateFee } from "../lib/lateFee";
import { TxButton } from "../components/ui";

const TEMPLATES = {
  Website: {
    title: "Pembuatan Website Company Profile",
    description:
      "Website company profile responsif (5 halaman: Beranda, Tentang, Layanan, Portofolio, Kontak). Desain modern, form kontak berfungsi, dan di-online-kan di hosting klien.",
    milestones: [
      { title: "Desain tampilan (mockup)", percent: 30, durationDays: 5 },
      { title: "Website jadi", percent: 50, durationDays: 10 },
      { title: "Revisi dan online", percent: 20, durationDays: 4 },
    ],
  },
  Artikel: {
    title: "Penulisan Artikel per Bab",
    description:
      "Artikel/e-book 6 bab, masing-masing minimal 1.000 kata, bebas plagiarisme (similarity < 20%), menyertakan kata kunci yang disepakati.",
    milestones: [1, 2, 3, 4, 5, 6].map((n) => ({ title: `Bab ${n}`, percent: n <= 4 ? 17 : 16, durationDays: 3 })),
  },
};

export default function BuatPesanan() {
  const { account, params, runTx, canTransact } = useApp();
  const navigate = useNavigate();
  const dayLength = Number(params?.dayLength || 86400);
  const [form, setForm] = useState({
    freelancer: "",
    category: "Website",
    title: TEMPLATES.Website.title,
    description: TEMPLATES.Website.description,
    total: "0.01",
    milestones: TEMPLATES.Website.milestones,
    dailyRatePct: 5,
    capPct: 50,
    maxRevisions: 2,
    graceDays: 7,
  });
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState([]);
  const [step, setStep] = useState("");

  const set = (k, v) => {
    setErrors([]);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const setMs = (i, k, v) => {
    setErrors([]);
    setForm((f) => ({ ...f, milestones: f.milestones.map((m, j) => (j === i ? { ...m, [k]: v } : m)) }));
  };
  const applyTemplate = (cat) =>
    setForm((f) => ({ ...f, category: cat, title: TEMPLATES[cat].title, description: TEMPLATES[cat].description, milestones: TEMPLATES[cat].milestones }));

  const percentSum = form.milestones.reduce((a, m) => a + Number(m.percent || 0), 0);
  const amounts = useMemo(() => {
    try {
      return splitAmounts(parseEther(String(form.total || "0")), form.milestones.map((m) => m.percent || 0));
    } catch {
      return form.milestones.map(() => 0n);
    }
  }, [form.total, form.milestones]);

  // simulasi denda untuk milestone terbesar
  const sim = useMemo(() => {
    const maxIdx = amounts.reduce((bi, a, i) => (a > amounts[bi] ? i : bi), 0);
    const V = amounts[maxIdx] || 0n;
    const r = Math.round(Number(form.dailyRatePct) * 100);
    const c = Math.round(Number(form.capPct) * 100);
    const rows = [];
    for (let d = 1; d <= 12; d++) {
      const fee = lateFee(V, d * dayLength, 0, r, c, dayLength);
      rows.push({ d, fee, net: V - fee });
      if (r > 0 && d * r >= c) break;
    }
    return { idx: maxIdx, V, rows };
  }, [amounts, form.dailyRatePct, form.capPct, dayLength]);

  const submit = async () => {
    const errs = validateOrderForm(form, { account, arbiter: params?.arbiter });
    setErrors(errs);
    if (errs.length) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    try {
      let attachment = null;
      if (file) {
        setStep("Mengunggah lampiran ke IPFS…");
        const up = await uploadFile(file);
        attachment = { name: file.name, size: file.size, type: file.type, cid: up.cid };
      }
      setStep("Mengunggah brief ke IPFS…");
      const brief = {
        app: "freelance-escrow",
        version: 1,
        category: form.category,
        title: form.title.trim(),
        description: form.description.trim(),
        milestones: form.milestones.map((m, i) => ({
          title: m.title.trim(),
          percent: Number(m.percent),
          durationDays: Number(m.durationDays),
          amountWei: amounts[i].toString(),
        })),
        lateFee: { dailyRatePct: Number(form.dailyRatePct), capPct: Number(form.capPct), graceDays: Number(form.graceDays) },
        maxRevisions: Number(form.maxRevisions),
        attachment,
        client: account,
        freelancer: form.freelancer,
        createdAt: new Date().toISOString(),
      };
      const { cid } = await uploadJSON(brief, `brief-${Date.now()}.json`);
      setStep("Menunggu konfirmasi MetaMask…");
      const durations = form.milestones.map((m) => Math.max(1, Math.round(Number(m.durationDays) * dayLength)));
      const total = amounts.reduce((a, b) => a + b, 0n);
      const rc = await runTx("Buat pesanan (createOrder)", (c) =>
        c.createOrder(
          form.freelancer.trim(),
          cid,
          amounts,
          durations,
          Math.round(Number(form.dailyRatePct) * 100),
          Math.round(Number(form.capPct) * 100),
          Number(form.maxRevisions),
          Math.round(Number(form.graceDays) * dayLength),
          { value: total },
        ),
      );
      setStep("");
      if (rc) {
        const ev = rc.logs.find((l) => l.fragment?.name === "OrderCreated");
        const id = ev ? Number(ev.args[0]) : null;
        navigate(id ? `/pesanan/${id}` : "/klien");
      }
    } catch (e) {
      setStep("");
      setErrors([e.message || String(e)]);
    }
  };

  return (
    <div className="container narrow">
      <h1>Buat Pesanan</h1>
      <p className="muted">
        Anda bertindak sebagai <b>Klien</b>. Seluruh nilai pesanan akan dikunci di smart contract dan dicairkan per milestone.
        {dayLength !== 86400 && (
          <>
            {" "}
            <span className="badge badge-blue">Mode DEMO: 1 hari = {dayLength} detik</span>
          </>
        )}
      </p>

      {errors.length > 0 && (
        <div className="alert alert-red" data-testid="form-errors">
          <b>Periksa kembali formulir:</b>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card form-card">
        <h2>1. Pihak dan kategori</h2>
        <label>
          Alamat dompet freelancer
          <input
            placeholder="0x…"
            value={form.freelancer}
            onChange={(e) => set("freelancer", e.target.value.trim())}
            data-testid="input-freelancer"
          />
        </label>
        <div className="row">
          <label>
            Kategori jasa
            <select value={form.category} onChange={(e) => applyTemplate(e.target.value)} data-testid="input-category">
              <option>Website</option>
              <option>Artikel</option>
            </select>
          </label>
          <div className="hint">Memilih kategori mengisi contoh milestone (Website 30/50/20%, Artikel 6 bab). Semua bisa diubah.</div>
        </div>
      </div>

      <div className="card form-card">
        <h2>2. Brief pekerjaan (disimpan di IPFS)</h2>
        <label>
          Judul
          <input value={form.title} onChange={(e) => set("title", e.target.value)} />
        </label>
        <label>
          Deskripsi / ruang lingkup
          <textarea rows={4} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </label>
        <label>
          Lampiran brief (opsional, mis. PDF/DOCX/gambar)
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        <div className="hint">
          IPFS: {IPFS_MODE === "pinata" ? "Pinata (IPFS publik)" : "MODE DEMO, berkas hanya disimpan di browser ini dan CID dihitung lokal"}. Setelah
          pesanan dibuat, CID brief tidak dapat diubah.
        </div>
      </div>

      <div className="card form-card">
        <h2>3. Milestone dan nilai</h2>
        <label className="w-200">
          Total nilai pesanan (ETH)
          <input value={form.total} onChange={(e) => set("total", e.target.value.replace(",", "."))} inputMode="decimal" data-testid="input-total" />
        </label>
        <table className="ms-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Judul milestone</th>
              <th>Persentase (%)</th>
              <th>Durasi (hari)</th>
              <th>Nilai (ETH)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {form.milestones.map((m, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <input value={m.title} onChange={(e) => setMs(i, "title", e.target.value)} />
                </td>
                <td>
                  <input className="num" value={m.percent} onChange={(e) => setMs(i, "percent", e.target.value)} inputMode="decimal" data-testid={`input-pct-${i}`} />
                </td>
                <td>
                  <input className="num" value={m.durationDays} onChange={(e) => setMs(i, "durationDays", e.target.value)} inputMode="decimal" />
                  {dayLength !== 86400 && <div className="tiny muted">= {fmtDuration(Number(m.durationDays || 0) * dayLength)}</div>}
                </td>
                <td className="mono">{fmtEth(amounts[i])}</td>
                <td>
                  {form.milestones.length > 1 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => set("milestones", form.milestones.filter((_, j) => j !== i))}>
                      Hapus
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td></td>
              <td>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => set("milestones", [...form.milestones, { title: `Milestone ${form.milestones.length + 1}`, percent: 0, durationDays: 3 }])}
                >
                  + Tambah milestone
                </button>
              </td>
              <td className={Math.abs(percentSum - 100) > 1e-9 ? "error" : "ok"} data-testid="pct-sum">
                Σ {percentSum}%
              </td>
              <td></td>
              <td className="mono">{fmtEth(amounts.reduce((a, b) => a + b, 0n))}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <div className="hint">Milestone dikerjakan berurutan. Tenggat setiap milestone dihitung sejak milestone tersebut dibuka.</div>
      </div>

      <div className="card form-card">
        <h2>4. Denda keterlambatan, revisi, dan batas akhir</h2>
        <div className="row4">
          <label>
            Tarif denda per hari (%)
            <input value={form.dailyRatePct} onChange={(e) => set("dailyRatePct", e.target.value)} inputMode="decimal" />
          </label>
          <label>
            Batas maksimum denda (%)
            <input value={form.capPct} onChange={(e) => set("capPct", e.target.value)} inputMode="decimal" />
          </label>
          <label>
            Batas revisi per milestone
            <input value={form.maxRevisions} onChange={(e) => set("maxRevisions", e.target.value)} inputMode="numeric" />
          </label>
          <label>
            Batas akhir setelah tenggat (hari)
            <input value={form.graceDays} onChange={(e) => set("graceDays", e.target.value)} inputMode="decimal" />
          </label>
        </div>
        <div className="formula">
          denda = V × min(⌈hari terlambat⌉ × {form.dailyRatePct}%, {form.capPct}%) · Jika milestone tidak dikirim sampai tenggat +{" "}
          {form.graceDays} hari, klien dapat menarik kembali dana milestone tersebut dan semua milestone sisanya.
        </div>
        <h3>Simulasi denda untuk Milestone {sim.idx + 1} (V = {fmtEth(sim.V)} ETH)</h3>
        <table className="sim-table">
          <thead>
            <tr>
              <th>Terlambat</th>
              <th>Denda</th>
              <th>Freelancer menerima</th>
            </tr>
          </thead>
          <tbody>
            {sim.rows.map((r) => (
              <tr key={r.d}>
                <td>{r.d} hari</td>
                <td className="mono">{fmtEth(r.fee)} ETH</td>
                <td className="mono">{fmtEth(r.net)} ETH</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="submit-bar">
        {step && <span className="muted">{step}</span>}
        {!canTransact && <span className="muted">Hubungkan MetaMask ke jaringan yang benar untuk mengirim.</span>}
        <TxButton onClick={submit} variant="primary">
          Kunci {fmtEth(amounts.reduce((a, b) => a + b, 0n))} ETH &amp; Buat Pesanan
        </TxButton>
      </div>
    </div>
  );
}
