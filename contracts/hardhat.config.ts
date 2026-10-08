import { HardhatUserConfig, task, types } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config({ quiet: true });

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
// kunci privat boleh ditulis dengan atau tanpa awalan 0x
const rawKey = (process.env.DEPLOYER_PRIVATE_KEY || "").trim();
const DEPLOYER_PRIVATE_KEY = rawKey ? (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) : "";

/**
 * Khusus jaringan LOKAL: memajukan waktu blockchain agar tidak perlu menunggu tenggat.
 *   npx hardhat time-skip --seconds 600 --network localhost
 */
task("time-skip", "Memajukan waktu blok Hardhat lokal")
  .addParam("seconds", "Jumlah detik", 60, types.int)
  .setAction(async ({ seconds }, hre) => {
    if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
      throw new Error("time-skip hanya untuk jaringan lokal (--network localhost)");
    }
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine", []);
    const b = await hre.ethers.provider.getBlock("latest");
    console.log(`Waktu blok dimajukan ${seconds} detik. Waktu blok sekarang: ${new Date(b!.timestamp * 1000).toLocaleString("id-ID")}`);
  });

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      chainId: 11155111,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    noColors: true,
    outputFile: process.env.GAS_REPORT_FILE || undefined,
    excludeContracts: ["ReentrancyAttacker"],
    reportFormat: "legacy",
    darkMode: false,
  },
  mocha: {
    timeout: 120000,
  },
};

export default config;
