/**
 * Deploy FreelanceEscrow lalu menulis alamat + ABI ke frontend/src/config secara otomatis.
 *
 *   Lokal  : npx hardhat run scripts/deploy.ts --network localhost   (atau: npm run deploy:local)
 *   Sepolia: npx hardhat run scripts/deploy.ts --network sepolia     (atau: npm run deploy:sepolia)
 *
 * Variabel lingkungan (file contracts/.env, lihat .env.example):
 *   SEPOLIA_RPC_URL       URL RPC Sepolia (default: publicnode)
 *   DEPLOYER_PRIVATE_KEY  kunci privat dompet deployer (hanya untuk Sepolia, JANGAN di-commit)
 *   ARBITER_ADDRESS       alamat dompet arbiter (wajib di Sepolia; di lokal default akun Hardhat #3)
 *   DEMO_MODE             "true" = periode singkat untuk demo (1 hari = 60 detik), "false" = mode skripsi (86.400 detik)
 *
 * Skrip ini aman dijalankan berulang kali: setiap deploy membuat kontrak baru dan menimpa
 * konfigurasi jaringan yang sama di frontend/src/config/deployments.json.
 */
import { ethers, network, artifacts } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DAY = 86_400;

function periods(demo: boolean) {
  if (demo) {
    // Mode DEMO: 1 "hari" = 60 detik. Review 3 "hari" = 3 menit, revisi 3 menit, arbiter 7 menit.
    return { dayLength: 60, reviewPeriod: 180, revisionWindow: 180, disputeTimeout: 420 };
  }
  // Mode SKRIPSI (sesuai proposal): 1 hari = 86.400 detik, review 3 hari, revisi 3 hari, arbiter 7 hari.
  return { dayLength: DAY, reviewPeriod: 3 * DAY, revisionWindow: 3 * DAY, disputeTimeout: 7 * DAY };
}

async function main() {
  const isLocal = network.name === "localhost" || network.name === "hardhat";
  const demo = (process.env.DEMO_MODE ?? "true").toLowerCase() !== "false";
  const p = periods(demo);

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("Tidak ada akun deployer. Isi DEPLOYER_PRIVATE_KEY di contracts/.env");
  }
  const deployer = signers[0];

  let arbiter = process.env.ARBITER_ADDRESS?.trim() || "";
  if (!arbiter) {
    if (isLocal) {
      arbiter = signers[3].address; // akun Hardhat #3 = Arbiter
    } else {
      throw new Error("ARBITER_ADDRESS wajib diisi di contracts/.env untuk jaringan " + network.name);
    }
  }
  if (!ethers.isAddress(arbiter)) throw new Error("ARBITER_ADDRESS tidak valid: " + arbiter);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Jaringan      :", network.name, `(chainId ${network.config.chainId})`);
  console.log("Deployer      :", deployer.address, `saldo ${ethers.formatEther(balance)} ETH`);
  console.log("Arbiter       :", arbiter);
  console.log("Mode          :", demo ? "DEMO (1 hari = 60 detik)" : "SKRIPSI (1 hari = 86.400 detik)");
  console.log("Periode (dtk) :", p);
  if (balance === 0n) {
    throw new Error("Saldo deployer 0 ETH. Isi dulu dari faucet Sepolia (lihat PANDUAN.md).");
  }

  const Escrow = await ethers.getContractFactory("FreelanceEscrow");
  const escrow = await Escrow.deploy(arbiter, p.dayLength, p.reviewPeriod, p.revisionWindow, p.disputeTimeout);
  const deployTx = escrow.deploymentTransaction();
  console.log("Tx deploy     :", deployTx?.hash);
  await escrow.waitForDeployment();
  const receipt = await deployTx!.wait(isLocal ? 1 : 2);
  const address = await escrow.getAddress();
  console.log("Kontrak       :", address, `(blok ${receipt!.blockNumber}, gas ${receipt!.gasUsed})`);

  // ---- tulis konfigurasi frontend ----
  const configDir = path.resolve(__dirname, "../../frontend/src/config");
  fs.mkdirSync(configDir, { recursive: true });

  const artifact = await artifacts.readArtifact("FreelanceEscrow");
  fs.writeFileSync(path.join(configDir, "FreelanceEscrow.abi.json"), JSON.stringify(artifact.abi, null, 2) + "\n");

  const deploymentsFile = path.join(configDir, "deployments.json");
  const all = fs.existsSync(deploymentsFile) ? JSON.parse(fs.readFileSync(deploymentsFile, "utf8")) : {};
  const key = isLocal ? "localhost" : network.name;
  all[key] = {
    chainId: Number(network.config.chainId),
    address,
    deployBlock: receipt!.blockNumber,
    arbiter,
    demoMode: demo,
    ...p,
    deployer: deployer.address,
    txHash: deployTx?.hash,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(deploymentsFile, JSON.stringify(all, null, 2) + "\n");
  console.log("Konfigurasi frontend diperbarui:", path.relative(process.cwd(), deploymentsFile));

  if (network.name === "sepolia") {
    console.log("Etherscan     :", `https://sepolia.etherscan.io/address/${address}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
