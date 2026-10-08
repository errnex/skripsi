import { useEffect, useState } from "react";
import { fetchJSON } from "./ipfs";

const cache = new Map();

/** Memuat brief (JSON di IPFS) sebuah pesanan. */
export function useBrief(cid) {
  const [state, setState] = useState(() => (cache.has(cid) ? { brief: cache.get(cid), loading: false } : { loading: !!cid }));
  useEffect(() => {
    if (!cid) return;
    if (cache.has(cid)) {
      setState({ brief: cache.get(cid), loading: false });
      return;
    }
    let alive = true;
    fetchJSON(cid)
      .then((b) => {
        cache.set(cid, b);
        if (alive) setState({ brief: b, loading: false });
      })
      .catch((e) => alive && setState({ error: e.message, loading: false }));
    return () => {
      alive = false;
    };
  }, [cid]);
  return state;
}
