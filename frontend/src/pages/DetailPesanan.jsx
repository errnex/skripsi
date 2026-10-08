import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp } from "../lib/AppContext";
import { fetchHistory } from "../lib/contract";
import { useBrief } from "../lib/useBrief";
import { uploadFile, uploadJSON } from "../lib/ipfs";
import { lateFee, daysLate } from "../lib/lateFee";
import { bpsToPct, fmtContractDays, fmtDate, fmtEth } from "../lib/format";
import { txUrl } from "../config";
import { Addr, CidLink, Countdown, Empty, MilestoneBadge, OrderBadge, TxButton } from "../components/ui";
import IpfsDoc from "../components/IpfsDoc";

// ------------------------------------------------------------------ dokumen kecil ke IPFS
async function makeDoc(kind, { note, link, file }, extra = {}) {
  let attachment = null;
  if (file) {
    const up = await uploadFile(file);
    attachment = { name: file.name, size: file.size, type: file.type, cid: up.cid };
  }
  const { cid } = await uploadJSON({ app: "freelance-escrow", kind, note: note || "", link: link || "", attachment, ...extra, createdAt: new Date().toISOString() }, `${kind}-${Date.now()}.json`);
  return cid;
}

function DocForm({ title, button, variant = "primary", requireSomething = true, onSubmit, withLink = false, placeholder }) {
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");
  const [file, setFile] = useState(null);
  const [err, setErr] = useState("");
  return (
    <div className="doc-form">
      {title && <h4>{title}</h4>}
      <textarea rows={2} placeholder={placeholder || "Catatan…"} value={note} onChange={(e) => setNote(e.target.value)} />
      {withLink && <input placeholder="Tautan hasil kerja (opsional), mis. https://…" value={link} onChange={(e) => setLink(e.target.value)} />}
      <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      {err && <div className="error small">{err}</div>}
      <TxButton
        variant={variant}
        onClick={async () => {
          if (requireSomething && !note.trim() && !link.trim() && !file) {
            setErr("Isi catatan, tautan, atau lampiran terlebih dahulu.");
            return;
          }
          setErr("");
          const ok = await onSubmit({ note: note.trim(), link: link.trim(), file });
          if (ok) {
            setNote("");
            setLink("");
            setFile(null);
          }
        }}
      >
        {button}
      </TxButton>
    </div>
  );
}

// ------------------------------------------------------------------ label riwayat
const EVENT_LABEL = {
  OrderCreated: "Pesanan dibuat & dana dikunci",
  OrderCancelled: "Pesanan dibatalkan (refund penuh)",
  OrderAccepted: "Pesanan diterima freelancer",
  MilestoneOpened: "Milestone dibuka",
  WorkSubmitted: "Hasil kerja dikirim",
  RevisionRequested: "Revisi diminta",
  MilestonePaid: "Milestone dibayar",
  MilestoneDisputed: "Hasil ditolak → sengketa",
  EvidenceSubmitted: "Bukti sengketa diunggah",
  DisputeResolved: "Sengketa diselesaikan",
  RefundClaimed: "Refund diklaim klien",
  OrderCompleted: "Pesanan selesai",
};

function eventDetail(ev, dayLength) {
  const a = ev.args;
  switch (ev.name) {
    case "OrderCreated":
      return `${fmtEth(a.totalAmount)} ETH, ${a.milestoneCount} milestone`;
    case "OrderCancelled":
      return `${fmtEth(a.refundAmount)} ETH kembali ke klien`;
    case "MilestoneOpened":
      return `M${Number(a.milestoneId) + 1}, tenggat ${fmtDate(a.deadline)}`;
    case "WorkSubmitted":
      return `M${Number(a.milestoneId) + 1}${a.isRevision ? " (revisi)" : ""}, denda ${fmtEth(a.lateFee)} ETH`;
    case "RevisionRequested":
      return `M${Number(a.milestoneId) + 1}, revisi ke-${a.revisionCount}`;
    case "MilestonePaid":
      return `M${Number(a.milestoneId) + 1}: freelancer ${fmtEth(a.freelancerAmount)} ETH, klien (denda) ${fmtEth(a.clientAmount)} ETH${a.byReviewTimeout ? " · otomatis setelah masa review" : ""}`;
    case "MilestoneDisputed":
      return `M${Number(a.milestoneId) + 1}`;
    case "EvidenceSubmitted":
      return `M${Number(a.milestoneId) + 1}`;
    case "DisputeResolved":
      return `M${Number(a.milestoneId) + 1}: klien ${fmtEth(a.clientAmount)} ETH, freelancer ${fmtEth(a.freelancerAmount)} ETH${a.byTimeout ? " · 50:50 karena arbiter melewati tenggat" : ` · keputusan arbiter ${a.clientPercent}% untuk klien`}`;
    case "RefundClaimed":
      return `mulai M${Number(a.fromMilestoneId) + 1}: ${fmtEth(a.refundAmount)} ETH kembali ke klien`;
    default:
      return "";
  }
}

// ------------------------------------------------------------------ halaman
export default function DetailPesanan() {
  const { id } = useParams();
  const { orders, loading, account, params, chainNow, runTx } = useApp();
  const order = orders.find((o) => o.id === Number(id));
  const { brief, error: briefError } = useBrief(order?.briefCID);
  const [history, setHistory] = useState([]);
  const [histErr, setHistErr] = useState(null);

  const orderKey = order ? JSON.stringify(order, (k, v) => (typeof v === "bigint" ? v.toString() : v)) : "";
  const loadHistory = useCallback(() => {
    if (!order) return;
    fetchHistory(order.id)
      .then((h) => {
        setHistory(h);
        setHistErr(null);
      })
      .catch((e) => setHistErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);
  useEffect(loadHistory, [loadHistory]);

  const dayLength = Number(params?.dayLength || 86400);
  const me = account?.toLowerCase();
  const isClient = order && me === order.client.toLowerCase();
  const isFreelancer = order && me === order.freelancer.toLowerCase();
  const isArbiter = params && me === params.arbiter.toLowerCase();

  const revisionNotes = useMemo(() => {
    const map = {};
    history.filter((h) => h.name === "RevisionRequested").forEach((h) => {
      map[Number(h.args.milestoneId)] = h.args.noteCID;
    });
    return map;
  }, [history]);

  if (loading && !order) return <div className="container"><Empty>Memuat pesanan…</Empty></div>;
  if (!order) return <div className="container"><Empty>Pesanan #{id} tidak ditemukan. <Link to="/">Kembali</Link></Empty></div>;

  const title = brief?.title || `Pesanan #${order.id}`;
  const msTitle = (i) => brief?.milestones?.[i]?.title || `Milestone ${i + 1}`;
  const cur = order.milestones[order.currentMilestone];
  const curIdx = order.currentMilestone;
  const p = params || {};
  const now = BigInt(chainNow);

  const tx = (label, fn) => runTx(label, fn);

  // ------------------------------------------------ panel aksi
  let actions = null;
  if (order.status === "Funded") {
    actions = (
      <div className="actions">
        <p>Dana {fmtEth(order.totalAmount)} ETH sudah terkunci. Menunggu freelancer menerima pesanan.</p>
        {isFreelancer && (
          <TxButton variant="success" onClick={() => tx("Terima pesanan (acceptOrder)", (c) => c.acceptOrder(order.id))}>
            Terima pesanan
          </TxButton>
        )}
        {isClient && (
          <TxButton variant="danger" onClick={() => tx("Batalkan pesanan (cancelOrder)", (c) => c.cancelOrder(order.id))}>
            Batalkan pesanan (refund penuh)
          </TxButton>
        )}
      </div>
    );
  } else if (order.status === "Active" && cur) {
    const fixedFee = cur.firstSubmittedAt > 0n;
    const feeNow = fixedFee ? cur.lateFee : lateFee(cur.amount, now, cur.deadline, order.dailyRateBps, order.capBps, dayLength);
    const dLate = fixedFee ? daysLate(cur.firstSubmittedAt, cur.deadline, dayLength) : daysLate(now, cur.deadline, dayLength);
    const refundAt = cur.deadline + order.gracePeriod;
    const reviewEnd = cur.lastSubmittedAt + (p.reviewPeriod || 0n);
    const revisionEnd = cur.revisionRequestedAt + (p.revisionWindow || 0n);
    const disputeEnd = cur.disputeStartedAt + (p.disputeTimeout || 0n);

    actions = (
      <div className="actions">
        <div className="actions-head">
          <h3>
            Milestone {curIdx + 1}: {msTitle(curIdx)}
          </h3>
          <MilestoneBadge status={cur.status} />
        </div>
        <div className="kv">
          <div>
            <span>Nilai (V)</span>
            <b>{fmtEth(cur.amount)} ETH</b>
          </div>
          <div>
            <span>Tenggat</span>
            <b>
              {fmtDate(cur.deadline)} · <Countdown target={cur.deadline} now={chainNow} prefix="sisa " doneText="tenggat terlewati" />
            </b>
          </div>
          <div className={feeNow > 0n ? "fee-box warn" : "fee-box"} data-testid="late-fee">
            <span>{fixedFee ? "Denda (ditetapkan saat kiriman pertama)" : "Perkiraan denda jika dikirim sekarang"}</span>
            <b>
              {fmtEth(feeNow)} ETH {dLate > 0n && <small>({dLate.toString()} hari × {bpsToPct(order.dailyRateBps)}, maks {bpsToPct(order.capBps)})</small>}
            </b>
          </div>
        </div>

        {cur.status === "Pending" && (
          <>
            {isFreelancer && (
              <DocForm
                title="Kirim hasil kerja"
                button={feeNow > 0n ? `Kirim hasil (denda ${fmtEth(feeNow)} ETH)` : "Kirim hasil kerja"}
                withLink
                placeholder="Catatan untuk klien…"
                onSubmit={async (d) => {
                  const cid = await makeDoc("work", d, { orderId: order.id, milestone: curIdx + 1 });
                  return tx("Kirim hasil kerja (submitWork)", (c) => c.submitWork(order.id, curIdx, cid));
                }}
              />
            )}
            {isClient && (
              <div className="sub-action">
                <p className="small">
                  Jika freelancer tidak mengirim hingga tenggat + batas akhir ({fmtContractDays(order.gracePeriod, dayLength)}), Anda dapat menarik
                  kembali dana milestone ini dan semua milestone sisanya.
                </p>
                <TxButton
                  variant="danger"
                  disabled={now <= refundAt}
                  onClick={() => tx("Klaim refund (claimRefund)", (c) => c.claimRefund(order.id))}
                >
                  Klaim refund {fmtEth(order.milestones.slice(curIdx).reduce((a, m) => a + m.amount, 0n))} ETH
                </TxButton>{" "}
                {now <= refundAt && <span className="small muted">tersedia dalam <Countdown target={refundAt} now={chainNow} /></span>}
              </div>
            )}
          </>
        )}

        {cur.status === "RevisionRequested" && (
          <>
            <div className="small">
              Revisi ke-{cur.revisionCount} dari maks {order.maxRevisions}. Catatan klien: <IpfsDoc cid={revisionNotes[curIdx]} label="Catatan revisi" />
            </div>
            {isFreelancer && (
              <DocForm
                title="Kirim revisi"
                button="Kirim revisi"
                withLink
                onSubmit={async (d) => {
                  const cid = await makeDoc("work", d, { orderId: order.id, milestone: curIdx + 1, revision: cur.revisionCount });
                  return tx("Kirim revisi (submitWork)", (c) => c.submitWork(order.id, curIdx, cid));
                }}
              />
            )}
            {isClient && (
              <div className="sub-action">
                <p className="small">
                  Jendela revisi: <Countdown target={revisionEnd} now={chainNow} prefix="sisa " doneText="habis, Anda boleh menolak" />
                </p>
                {now > revisionEnd ? (
                  <DocForm
                    title="Tolak & ajukan sengketa"
                    button="Tolak hasil kerja"
                    variant="danger"
                    placeholder="Alasan penolakan…"
                    onSubmit={async (d) => {
                      const cid = await makeDoc("reject", d, { orderId: order.id, milestone: curIdx + 1 });
                      return tx("Tolak hasil kerja (rejectMilestone)", (c) => c.rejectMilestone(order.id, curIdx, cid));
                    }}
                  />
                ) : (
                  <p className="small muted">Tombol tolak aktif setelah jendela revisi habis.</p>
                )}
              </div>
            )}
          </>
        )}

        {cur.status === "Submitted" && (
          <>
            <div className="small">
              Hasil kerja terbaru: <IpfsDoc cid={cur.workCID} label="Hasil kerja" />
            </div>
            {isClient && (
              <div className="client-actions">
                <div className="sub-action">
                  <h4>Setujui</h4>
                  <p className="small">
                    Freelancer menerima <b>{fmtEth(cur.amount - cur.lateFee)} ETH</b>
                    {cur.lateFee > 0n && (
                      <>
                        , Anda menerima denda <b>{fmtEth(cur.lateFee)} ETH</b>
                      </>
                    )}
                    .
                  </p>
                  <TxButton variant="success" onClick={() => tx("Setujui milestone (approveMilestone)", (c) => c.approveMilestone(order.id, curIdx))}>
                    Setujui &amp; cairkan
                  </TxButton>
                </div>
                <div className="sub-action">
                  {cur.revisionCount < order.maxRevisions ? (
                    <DocForm
                      title={`Minta revisi (${cur.revisionCount}/${order.maxRevisions})`}
                      button="Minta revisi"
                      variant="secondary"
                      placeholder="Apa yang perlu diperbaiki…"
                      onSubmit={async (d) => {
                        const cid = await makeDoc("revision", d, { orderId: order.id, milestone: curIdx + 1 });
                        return tx("Minta revisi (requestRevision)", (c) => c.requestRevision(order.id, curIdx, cid));
                      }}
                    />
                  ) : (
                    <p className="small muted">Batas revisi ({order.maxRevisions}) sudah tercapai.</p>
                  )}
                </div>
                <div className="sub-action">
                  <DocForm
                    title="Tolak & ajukan sengketa"
                    button="Tolak hasil kerja"
                    variant="danger"
                    placeholder="Alasan penolakan (dibandingkan dengan brief)…"
                    onSubmit={async (d) => {
                      const cid = await makeDoc("reject", d, { orderId: order.id, milestone: curIdx + 1 });
                      return tx("Tolak hasil kerja (rejectMilestone)", (c) => c.rejectMilestone(order.id, curIdx, cid));
                    }}
                  />
                </div>
              </div>
            )}
            {isFreelancer && (
              <div className="sub-action">
                <p className="small">
                  Masa review klien: <Countdown target={reviewEnd} now={chainNow} prefix="sisa " doneText="habis, Anda boleh mencairkan" />
                </p>
                <TxButton
                  variant="success"
                  disabled={now <= reviewEnd}
                  onClick={() => tx("Finalisasi setelah masa review (finalizeAfterReview)", (c) => c.finalizeAfterReview(order.id, curIdx))}
                >
                  Cairkan {fmtEth(cur.amount - cur.lateFee)} ETH (klien tidak menanggapi)
                </TxButton>
              </div>
            )}
          </>
        )}

        {cur.status === "Disputed" && (
          <>
            <div className="dispute-box">
              <div>
                Sengketa dimulai {fmtDate(cur.disputeStartedAt)} · tenggat arbiter:{" "}
                <Countdown target={disputeEnd} now={chainNow} prefix="sisa " doneText="lewat, bisa dibagi 50:50" />
              </div>
              <div className="evidence">
                <div>
                  <b>Brief</b>
                  <CidLink cid={order.briefCID} label="Brief" />
                </div>
                <div>
                  <b>Hasil kerja</b>
                  <IpfsDoc cid={cur.workCID} label="Hasil kerja" />
                </div>
                <div>
                  <b>Bukti klien</b>
                  <IpfsDoc cid={cur.clientEvidenceCID} label="Bukti klien" />
                </div>
                <div>
                  <b>Bukti freelancer</b>
                  <IpfsDoc cid={cur.freelancerEvidenceCID} label="Bukti freelancer" />
                </div>
              </div>
            </div>
            {(isClient || isFreelancer) && now <= disputeEnd && (
              <DocForm
                title="Unggah bukti"
                button="Unggah bukti (submitEvidence)"
                variant="secondary"
                placeholder="Penjelasan bukti…"
                onSubmit={async (d) => {
                  const cid = await makeDoc("evidence", d, { orderId: order.id, milestone: curIdx + 1, by: isClient ? "client" : "freelancer" });
                  return tx("Unggah bukti (submitEvidence)", (c) => c.submitEvidence(order.id, curIdx, cid));
                }}
              />
            )}
            {isArbiter && now <= disputeEnd && <ResolveForm order={order} cur={cur} curIdx={curIdx} tx={tx} />}
            {(isClient || isFreelancer) && (
              <div className="sub-action">
                <TxButton
                  variant="secondary"
                  disabled={now <= disputeEnd}
                  onClick={() => tx("Selesaikan sengketa kedaluwarsa (settleDisputeTimeout)", (c) => c.settleDisputeTimeout(order.id, curIdx))}
                >
                  Bagi 50:50 (arbiter melewati tenggat)
                </TxButton>
                {now <= disputeEnd && <span className="small muted"> tersedia dalam <Countdown target={disputeEnd} now={chainNow} /></span>}
              </div>
            )}
          </>
        )}
        {!isClient && !isFreelancer && !isArbiter && <p className="muted small">Anda hanya dapat melihat pesanan ini (bukan pihak terkait).</p>}
      </div>
    );
  }

  return (
    <div className="container">
      <Link to="/" className="back">
        ← Katalog
      </Link>
      <div className="detail-head">
        <div>
          <span className={`cat cat-${(brief?.category || "x").toLowerCase()}`}>{brief?.category || "Tanpa kategori"}</span>
          <h1>
            #{order.id} · {title}
          </h1>
          <div className="parties">
            <span>
              Klien: <Addr address={order.client} />
            </span>
            <span>
              Freelancer: <Addr address={order.freelancer} />
            </span>
            {params && (
              <span>
                Arbiter: <Addr address={params.arbiter} />
              </span>
            )}
          </div>
        </div>
        <div className="detail-total">
          <OrderBadge status={order.status} />
          <div className="big">{fmtEth(order.totalAmount)} ETH</div>
        </div>
      </div>

      <div className="detail-grid">
        <div>
          <div className="card">
            <h2>Brief</h2>
            {brief ? (
              <>
                <p className="pre">{brief.description}</p>
                {brief.attachment?.cid && (
                  <p>
                    Lampiran: <CidLink cid={brief.attachment.cid} label={brief.attachment.name} />
                  </p>
                )}
              </>
            ) : (
              <p className="muted small">{briefError ? `Brief tidak dapat dimuat: ${briefError}` : "Memuat brief…"}</p>
            )}
            <div className="small">
              CID brief (tidak dapat diubah): <CidLink cid={order.briefCID} label="Brief" />
            </div>
            <div className="params">
              <span>Denda {bpsToPct(order.dailyRateBps)}/hari</span>
              <span>Maks {bpsToPct(order.capBps)}</span>
              <span>Revisi maks {order.maxRevisions}×</span>
              <span>Batas akhir {fmtContractDays(order.gracePeriod, dayLength)}</span>
            </div>
          </div>

          <div className="card">
            <h2>Timeline Milestone</h2>
            <ol className="timeline">
              {order.milestones.map((m, i) => {
                const locked = m.status === "Pending" && m.deadline === 0n;
                const st = locked ? "Locked" : m.status;
                const isCur = order.status === "Active" && i === curIdx;
                return (
                  <li key={i} className={`tl-item tl-${st.toLowerCase()} ${isCur ? "tl-current" : ""}`}>
                    <div className="tl-dot">{i + 1}</div>
                    <div className="tl-body">
                      <div className="tl-head">
                        <b>{msTitle(i)}</b>
                        <MilestoneBadge status={st} />
                        <span className="mono">{fmtEth(m.amount)} ETH</span>
                      </div>
                      <div className="tl-meta small muted">
                        Durasi {fmtContractDays(m.duration, dayLength)}
                        {m.deadline > 0n && <> · tenggat {fmtDate(m.deadline)}</>}
                        {m.firstSubmittedAt > 0n && <> · kiriman pertama {fmtDate(m.firstSubmittedAt)}</>}
                        {m.revisionCount > 0 && <> · {m.revisionCount}× revisi</>}
                        {m.firstSubmittedAt > 0n && <> · denda {fmtEth(m.lateFee)} ETH</>}
                      </div>
                      {m.workCID && !isCur && (
                        <div className="small">
                          <CidLink cid={m.workCID} label="Hasil kerja" />
                        </div>
                      )}
                      {m.resolutionCID && (
                        <div className="small">
                          Alasan arbiter: <IpfsDoc cid={m.resolutionCID} label="Keputusan" />
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <div>
          <div className="card sticky">
            <h2>Aksi</h2>
            {actions || <p className="muted">Pesanan sudah {order.status === "Completed" ? "selesai" : "ditutup"}. Tidak ada aksi lagi.</p>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-head">
          <h2>Riwayat Transaksi (event kontrak)</h2>
          <button className="btn btn-ghost btn-sm" onClick={loadHistory}>
            Muat ulang
          </button>
        </div>
        {histErr && <div className="error small">{histErr}</div>}
        <table className="history">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Kejadian</th>
              <th>Rincian</th>
              <th>Transaksi</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={i}>
                <td className="nowrap small">{fmtDate(h.timestamp)}</td>
                <td>
                  <b>{EVENT_LABEL[h.name] || h.name}</b>
                  <div className="tiny muted mono">{h.name}</div>
                </td>
                <td className="small">{eventDetail(h, dayLength)}</td>
                <td className="small">
                  {txUrl(h.txHash) ? (
                    <a href={txUrl(h.txHash)} target="_blank" rel="noreferrer">
                      Etherscan ↗
                    </a>
                  ) : (
                    <code title={h.txHash}>{h.txHash.slice(0, 10)}…</code>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {history.length === 0 && !histErr && <Empty>Memuat riwayat…</Empty>}
      </div>
    </div>
  );
}

function ResolveForm({ order, cur, curIdx, tx }) {
  const [pct, setPct] = useState(50);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const remaining = cur.amount - cur.lateFee;
  const toClient = cur.lateFee + (remaining * BigInt(pct)) / 100n;
  const toFreelancer = cur.amount - toClient;
  return (
    <div className="resolve-form">
      <h4>Keputusan arbiter (resolveDispute)</h4>
      <label>
        Persentase sisa dana untuk klien: <b>{pct}%</b>
        <input type="range" min="0" max="100" value={pct} onChange={(e) => setPct(Number(e.target.value))} />
      </label>
      <div className="split">
        <div>
          Klien: <b>{fmtEth(toClient)} ETH</b>
          {cur.lateFee > 0n && <div className="tiny muted">denda {fmtEth(cur.lateFee)} + {pct}% × {fmtEth(remaining)}</div>}
        </div>
        <div>
          Freelancer: <b>{fmtEth(toFreelancer)} ETH</b>
        </div>
        <div>
          Arbiter: <b>0 ETH</b>
        </div>
      </div>
      <textarea rows={3} placeholder="Alasan keputusan (akan diunggah ke IPFS dan CID-nya dicatat permanen di kontrak)…" value={note} onChange={(e) => setNote(e.target.value)} />
      {err && <div className="error small">{err}</div>}
      <TxButton
        variant="danger"
        onClick={async () => {
          if (!note.trim()) {
            setErr("Alasan keputusan wajib diisi.");
            return;
          }
          setErr("");
          const cid = await makeDoc("resolution", { note: note.trim() }, { orderId: order.id, milestone: curIdx + 1, clientPercent: pct });
          await tx("Putuskan sengketa (resolveDispute)", (c) => c.resolveDispute(order.id, curIdx, pct, cid));
        }}
      >
        Putuskan: {pct}% untuk klien
      </TxButton>
    </div>
  );
}
