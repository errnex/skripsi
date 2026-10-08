import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BrowserProvider } from "ethers";
import { NETWORK, IS_DEPLOYED, txUrl } from "../config";
import { fetchAllOrders, fetchParams, isContractDeployed, readProvider, writeContract } from "./contract";
import { detectRoles, isCorrectNetwork } from "./validation";
import { parseError } from "./errors";

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }) {
  // ------------------------------------------------ dompet
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const hasWallet = typeof window !== "undefined" && !!window.ethereum;
  const autoSwitchAsked = useRef(false);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: NETWORK.chainIdHex }] });
    } catch (err) {
      if (err?.code === 4902 || /Unrecognized chain|not been added/i.test(err?.message || "")) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: NETWORK.chainIdHex,
              chainName: NETWORK.name,
              rpcUrls: [NETWORK.rpcUrl],
              nativeCurrency: NETWORK.currency,
              blockExplorerUrls: NETWORK.explorer ? [NETWORK.explorer] : undefined,
            },
          ],
        });
      } else {
        throw err;
      }
    }
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      window.open("https://metamask.io/download/", "_blank");
      return;
    }
    const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
    setAccount(accs[0] || null);
    const cid = await window.ethereum.request({ method: "eth_chainId" });
    setChainId(parseInt(cid, 16));
    localStorage.setItem("fe-connected", "1");
    if (parseInt(cid, 16) !== NETWORK.chainId && !autoSwitchAsked.current) {
      autoSwitchAsked.current = true;
      switchNetwork().catch(() => {});
    }
  }, [switchNetwork]);

  const disconnect = useCallback(() => {
    setAccount(null);
    localStorage.removeItem("fe-connected");
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    const onAcc = (accs) => setAccount(accs[0] || null);
    const onChain = (cid) => setChainId(parseInt(cid, 16));
    window.ethereum.on?.("accountsChanged", onAcc);
    window.ethereum.on?.("chainChanged", onChain);
    // sambung ulang otomatis jika sebelumnya sudah terhubung
    if (localStorage.getItem("fe-connected")) {
      window.ethereum
        .request({ method: "eth_accounts" })
        .then((accs) => {
          if (accs[0]) setAccount(accs[0]);
        })
        .catch(() => {});
    }
    window.ethereum
      .request({ method: "eth_chainId" })
      .then((cid) => setChainId(parseInt(cid, 16)))
      .catch(() => {});
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAcc);
      window.ethereum.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const correctNetwork = isCorrectNetwork(chainId, NETWORK.chainId);

  // ------------------------------------------------ data kontrak
  const [params, setParams] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [contractOk, setContractOk] = useState(IS_DEPLOYED ? null : false);

  const refresh = useCallback(async () => {
    if (!IS_DEPLOYED) {
      setLoading(false);
      return;
    }
    try {
      const ok = await isContractDeployed();
      setContractOk(ok);
      if (!ok) {
        setLoading(false);
        return;
      }
      const [p, list] = await Promise.all([fetchParams(), fetchAllOrders()]);
      setParams(p);
      setOrders(list);
      setLoadError(null);
    } catch (e) {
      setLoadError(parseError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 12000);
    return () => clearInterval(t);
  }, [refresh]);

  // ------------------------------------------------ waktu blockchain
  // Di Hardhat lokal waktu blok bisa "dimajukan" (time travel), jadi hitung mundur memakai
  // selisih waktu blok terbaru terhadap jam komputer.
  const [offset, setOffset] = useState(0);
  const [nowTick, setNowTick] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNowTick(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let alive = true;
    const sync = async () => {
      try {
        const b = await readProvider.getBlock("latest");
        if (alive && b) setOffset(Math.max(0, b.timestamp - Math.floor(Date.now() / 1000)));
      } catch {
        /* abaikan */
      }
    };
    sync();
    const t = setInterval(sync, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [orders]);
  const chainNow = nowTick + offset;

  // ------------------------------------------------ peran
  const roles = useMemo(() => detectRoles(account, params?.arbiter, orders), [account, params, orders]);

  // ------------------------------------------------ transaksi
  const [toasts, setToasts] = useState([]);
  const pushToast = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((x) => [...x, { id, ...t }]);
    return id;
  }, []);
  const updateToast = useCallback((id, patch) => setToasts((x) => x.map((t) => (t.id === id ? { ...t, ...patch } : t))), []);
  const closeToast = useCallback((id) => setToasts((x) => x.filter((t) => t.id !== id)), []);

  /**
   * Menjalankan transaksi: fn(contract) harus mengembalikan promise tx dari ethers.
   * Menampilkan status pending/sukses/gagal beserta tautan Etherscan.
   */
  const runTx = useCallback(
    async (label, fn) => {
      if (!account || !correctNetwork) {
        pushToast({ label, state: "error", text: !account ? "Hubungkan dompet terlebih dahulu." : `Ganti jaringan MetaMask ke ${NETWORK.name}.` });
        return null;
      }
      const id = pushToast({ label, state: "sign", text: "Konfirmasi transaksi di MetaMask…" });
      try {
        const provider = new BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const c = writeContract(signer);
        const tx = await fn(c);
        updateToast(id, { state: "pending", text: "Menunggu transaksi ditambang…", hash: tx.hash, url: txUrl(tx.hash) });
        const rc = await tx.wait();
        updateToast(id, { state: "success", text: `Berhasil (blok ${rc.blockNumber}, gas ${rc.gasUsed.toString()})`, hash: tx.hash, url: txUrl(tx.hash) });
        setTimeout(() => closeToast(id), 15000);
        await refresh();
        return rc;
      } catch (e) {
        console.error(e);
        updateToast(id, { state: "error", text: parseError(e) });
        return null;
      }
    },
    [account, correctNetwork, pushToast, updateToast, closeToast, refresh],
  );

  const value = {
    hasWallet,
    account,
    chainId,
    correctNetwork,
    connect,
    disconnect,
    switchNetwork,
    params,
    orders,
    loading,
    loadError,
    contractOk,
    refresh,
    chainNow,
    roles,
    runTx,
    toasts,
    closeToast,
    canTransact: !!account && correctNetwork && contractOk === true,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
