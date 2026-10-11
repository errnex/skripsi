/**
 * Konfigurasi jaringan dan kontrak.
 * deployments.json dan FreelanceEscrow.abi.json DITULIS OTOMATIS oleh contracts/scripts/deploy.ts.
 */
import deployments from "./deployments.json";
import abi from "./FreelanceEscrow.abi.json";

export const ABI = abi;

const NETWORKS = {
  sepolia: {
    key: "sepolia",
    name: "Sepolia",
    chainId: 11155111,
    chainIdHex: "0xaa36a7",
    rpcUrl: import.meta.env.VITE_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
    // RPC khusus membaca riwayat event (eth_getLogs) dari blok deploy. publicnode memangkas riwayat lama,
    // Alchemy gratis hanya 10 blok per permintaan; gateway publik Tenderly menyimpan riwayat lengkap.
    logsRpcUrl: import.meta.env.VITE_SEPOLIA_LOGS_RPC_URL || "https://sepolia.gateway.tenderly.co",
    explorer: "https://sepolia.etherscan.io",
    currency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  },
  localhost: {
    key: "localhost",
    name: "Hardhat Lokal",
    chainId: 31337,
    chainIdHex: "0x7a69",
    rpcUrl: "http://127.0.0.1:8545",
    logsRpcUrl: null,
    explorer: null,
    currency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
};

const selected = (import.meta.env.VITE_NETWORK || "sepolia").toLowerCase();
export const NETWORK = NETWORKS[selected] || NETWORKS.sepolia;

const dep = deployments[NETWORK.key] || {};
export const ZERO = "0x0000000000000000000000000000000000000000";
export const CONTRACT_ADDRESS = dep.address || ZERO;
export const DEPLOY_BLOCK = dep.deployBlock || 0;
export const DEPLOYMENT = dep;
export const IS_DEPLOYED = CONTRACT_ADDRESS.toLowerCase() !== ZERO;

export function txUrl(hash) {
  return NETWORK.explorer ? `${NETWORK.explorer}/tx/${hash}` : null;
}
export function addressUrl(addr) {
  return NETWORK.explorer ? `${NETWORK.explorer}/address/${addr}` : null;
}

/** Akun bawaan Hardhat (mode lokal saja) agar label peran mudah dikenali saat uji coba. */
export const HARDHAT_LABELS = {
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266": "Hardhat #0 (Deployer)",
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8": "Hardhat #1 (Klien)",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc": "Hardhat #2 (Freelancer)",
  "0x90f79bf6eb2c4f870365e785982e1f101e93b906": "Hardhat #3 (Arbiter)",
};
