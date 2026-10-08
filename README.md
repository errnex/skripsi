# FreelanceEscrow dApp

Implementasi skripsi **"Rancang Bangun Sistem Pembayaran Jasa Freelance Berbasis Smart Contract Ethereum dengan Mekanisme Escrow per Milestone dan Denda Keterlambatan Otomatis"**.

Klien menyetor seluruh nilai pesanan ke smart contract (escrow). Dana dicairkan **per milestone** setelah hasil kerja disetujui. Keterlambatan dikenai **denda otomatis** berdasarkan `block.timestamp` (dengan batas maksimum). Hasil kerja yang tidak pernah dikirim dapat di-**refund**, dan sengketa kualitas diputus **arbiter** yang tidak menerima dana (atau dibagi 50:50 jika arbiter tidak memutuskan dalam 7 hari).

Studi kasus: **jasa pembuatan website** (3 milestone: 30/50/20%) dan **penulisan artikel per bab** (6 milestone).

## Isi folder

```
freelance-escrow-dapp/
├── contracts/                 # Smart contract (Hardhat + Solidity 0.8.28 + OpenZeppelin)
│   ├── contracts/FreelanceEscrow.sol     # kontrak utama
│   ├── contracts/test/ReentrancyAttacker.sol  # kontrak penyerang, khusus uji keamanan
│   ├── test/FreelanceEscrow.test.ts      # 58 uji unit (BB-01 s.d. BB-25 + keamanan)
│   ├── scripts/deploy.ts                 # deploy + menulis alamat/ABI ke frontend otomatis
│   ├── scripts/e2e-local.ts              # skenario end-to-end di Hardhat lokal
│   ├── scripts/check-balance.ts          # cek saldo deployer Sepolia
│   ├── hardhat.config.ts
│   └── .env.example                      # contoh konfigurasi (salin menjadi .env)
├── frontend/                  # Website dApp (Vite + React + ethers v6)
│   ├── src/pages/             # Beranda, Buat Pesanan, Dashboard Klien/Freelancer/Arbiter, Detail Pesanan
│   ├── src/lib/               # koneksi kontrak, MetaMask, IPFS (Pinata / mode demo), rumus denda
│   ├── src/config/            # deployments.json + ABI (ditulis otomatis oleh deploy.ts)
│   ├── vercel.json
│   └── .env.example
├── docs/
│   ├── gas-report.txt         # laporan gas per fungsi
│   ├── slither-report.txt     # laporan analisis keamanan Slither (sebelum & sesudah perbaikan)
│   ├── e2e-local-log.txt      # log skenario end-to-end lokal
│   └── screenshots/           # tangkapan layar website (bisa dipakai di Bab IV)
├── README.md                  # file ini
├── PANDUAN.md                 # panduan langkah demi langkah (instal, jalankan, deploy, demo)
└── PENJELASAN_KODE.md         # penjelasan setiap fungsi, status, event + pertanyaan dosen
```

## Mulai cepat (mode lokal, tanpa ETH faucet)

Butuh Node.js LTS, Git, VS Code, dan MetaMask. Detail lengkap ada di **[PANDUAN.md](PANDUAN.md)**.

```bash
# Terminal 1: blockchain lokal
cd contracts
npm install
npx hardhat node

# Terminal 2: uji + deploy lokal
cd contracts
npx hardhat test          # 58 uji harus lulus
npm run deploy:local      # alamat kontrak otomatis ditulis ke frontend

# Terminal 3: website
cd frontend
npm install
npm run dev:local         # buka http://localhost:5173
```

Impor akun uji Hardhat #1 (Klien), #2 (Freelancer), #3 (Arbiter) ke MetaMask (kunci privatnya ada di PANDUAN.md).

## Mode Sepolia (untuk demo online / Vercel)

```bash
cd contracts
cp .env.example .env      # isi DEPLOYER_PRIVATE_KEY dan ARBITER_ADDRESS
npm run check:sepolia     # cek saldo
npm run deploy:sepolia    # alamat Sepolia otomatis ditulis ke frontend/src/config/deployments.json
cd ../frontend
npm run dev               # atau deploy ke Vercel (Root Directory = frontend)
```

## Mode DEMO waktu

Di proposal, masa review = 3 hari, jendela revisi = 3 hari, tenggat arbiter = 7 hari, dan denda dihitung per 86.400 detik. Agar demo di depan dosen tidak perlu menunggu berhari-hari, nilai ini menjadi **parameter constructor**. Dengan `DEMO_MODE=true` (default di `.env.example`), **1 "hari" = 60 detik**: review 3 menit, revisi 3 menit, arbiter 7 menit, dan durasi/batas akhir yang diisi dalam "hari" di formulir juga dihitung per 60 detik. Untuk pengujian final skripsi, deploy ulang dengan `DEMO_MODE=false`. Logika kontraknya sama; hanya panjang "hari" yang berbeda.

## Hasil pengujian

| Pengujian | Hasil |
|---|---|
| Uji unit kontrak (`npx hardhat test`) | 58 lulus, mencakup BB-01 s.d. BB-25 (kecuali BB-23 yang merupakan perilaku website) |
| Uji unit website (`npm test` di frontend) | 16 lulus (BB-02, BB-03, BB-23, BB-24, rumus denda) |
| Skenario end-to-end lokal | 17 pemeriksaan lulus (lihat `docs/e2e-local-log.txt`) |
| Slither | 0 High, 0 Medium (lihat `docs/slither-report.txt`) |

## Keamanan

- Tidak ada fungsi penarikan dana oleh admin/deployer. Dana hanya keluar lewat aturan kontrak.
- Arbiter `immutable`, tidak boleh sama dengan klien/freelancer, dan tidak pernah menerima dana.
- `nonReentrant` (OpenZeppelin) + pola checks-effects-interactions di semua fungsi yang mengirim ETH.
- **Jangan pernah meng-commit file `.env`** (sudah diabaikan `.gitignore`). Gunakan dompet khusus testnet.

Lisensi: MIT. Hanya untuk jaringan uji (testnet).
