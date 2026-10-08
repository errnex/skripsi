/**
 * Mengecek alamat dan saldo dompet deployer di Sepolia sebelum deploy.
 *   npm run check:sepolia
 */
import { ethers, network } from "hardhat";

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    console.log("DEPLOYER_PRIVATE_KEY belum diisi di contracts/.env");
    process.exitCode = 1;
    return;
  }
  const addr = signers[0].address;
  const bal = await ethers.provider.getBalance(addr);
  console.log(`Jaringan : ${network.name}`);
  console.log(`Deployer : ${addr}`);
  console.log(`Saldo    : ${ethers.formatEther(bal)} ETH`);
  if (bal < ethers.parseEther("0.01")) {
    console.log("Saldo kurang. Deploy butuh sekitar 0,005-0,02 ETH Sepolia (tergantung harga gas). Isi dari faucet.");
  } else {
    console.log("Saldo cukup untuk deploy. Lanjutkan: npm run deploy:sepolia");
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
