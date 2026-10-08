import { useEffect, useState } from "react";
import { fetchFile } from "../lib/ipfs";
import { CidLink } from "./ui";

/**
 * Menampilkan dokumen IPFS buatan aplikasi ini (JSON berisi catatan/tautan/lampiran) secara ringkas.
 * Jika bukan JSON aplikasi, cukup tampilkan tautan berkas.
 */
export default function IpfsDoc({ cid, label }) {
  const [doc, setDoc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setDoc(null);
    setFailed(false);
    if (!cid) return;
    fetchFile(cid)
      .then(async (f) => {
        if (!f.type?.includes("json") && !f.type?.includes("text")) return;
        const txt = await f.blob.text();
        try {
          const j = JSON.parse(txt);
          if (alive && j && j.app === "freelance-escrow") setDoc({ ...j, _source: f.source });
        } catch {
          if (alive && f.type?.includes("text")) setDoc({ note: txt, _source: f.source });
        }
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [cid]);

  if (!cid) return <span className="muted">-</span>;
  return (
    <div className="ipfs-doc">
      <div className="small">
        <CidLink cid={cid} label={label} />
      </div>
      {doc && (
        <div className="doc-body">
          {doc.note && <p className="doc-note">“{doc.note}”</p>}
          {doc.link && (
            <div>
              Tautan:{" "}
              <a href={doc.link} target="_blank" rel="noreferrer">
                {doc.link}
              </a>
            </div>
          )}
          {doc.attachment?.cid && (
            <div>
              Lampiran: <CidLink cid={doc.attachment.cid} label={doc.attachment.name} />
            </div>
          )}
        </div>
      )}
      {failed && <div className="tiny muted">Isi berkas tidak dapat dimuat (berkas DEMO dari browser lain atau gateway IPFS lambat).</div>}
    </div>
  );
}
