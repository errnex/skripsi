# PANDUAN LENGKAP: Menjalankan, Deploy, dan Demo

Panduan ini ditulis untuk pemula. Ikuti berurutan. Contoh perintah memakai **Windows + VS Code** (terminal PowerShell). Di macOS/Linux perintahnya sama, kecuali perintah salin file (lihat catatan).

Daftar isi:
1. [Instal perangkat](#1-instal-perangkat)
2. [Buka proyek dan instal dependensi](#2-buka-proyek-dan-instal-dependensi)
3. [Jalankan pengujian](#3-jalankan-pengujian)
4. [Jalankan secara lokal (tanpa ETH faucet)](#4-jalankan-secara-lokal-tanpa-eth-faucet)
5. [Siapkan MetaMask dan ETH Sepolia](#5-siapkan-metamask-dan-eth-sepolia)
6. [Deploy kontrak ke Sepolia](#6-deploy-kontrak-ke-sepolia)
7. [(Opsional) IPFS sungguhan dengan Pinata](#7-opsional-ipfs-sungguhan-dengan-pinata)
8. [Upload ke GitHub](#8-upload-ke-github)
9. [Deploy website ke Vercel](#9-deploy-website-ke-vercel)
10. [SKENARIO DEMO untuk dosen pembimbing](#10-skenario-demo-untuk-dosen-pembimbing)
11. [Mengatasi error umum](#11-mengatasi-error-umum)

---

## 1. Instal perangkat

| Perangkat | Unduh | Cek setelah instal (di terminal) |
|---|---|---|
| Node.js **LTS** (versi 20.19 atau lebih baru) | https://nodejs.org | `node -v` dan `npm -v` |
| Git | https://git-scm.com/downloads | `git --version` |
| VS Code | https://code.visualstudio.com | - |
| MetaMask (ekstensi Chrome/Brave/Edge) | https://metamask.io/download | ikon rubah muncul di browser |

Di VS Code, pasang ekstensi **Solidity (Nomic Foundation)** agar kode `.sol` berwarna. VS Code akan menawarkannya otomatis karena ada file `.vscode/extensions.json`.

> **Windows, error "running scripts is disabled on this system" saat menjalankan `npm`**
> Buka PowerShell lalu jalankan sekali: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (jawab `Y`). Atau di VS Code ganti terminal ke **Command Prompt** (panah ˅ di sebelah tanda + pada panel terminal).

## 2. Buka proyek dan instal dependensi

1. Ekstrak `freelance-escrow-dapp.zip`, misalnya ke `D:\skripsi\freelance-escrow-dapp`.
2. VS Code → **File → Open Folder…** → pilih folder `freelance-escrow-dapp`.
3. Buka terminal: **Terminal → New Terminal**.
4. Instal dependensi kontrak:
   ```bash
   cd contracts
   npm install
   ```
5. Buka terminal kedua (ikon **+**) lalu instal dependensi website:
   ```bash
   cd frontend
   npm install
   ```

`npm install` butuh internet dan bisa memakan waktu 1–3 menit. Peringatan berwarna kuning (`npm warn`, `vulnerabilities`) boleh diabaikan.

## 3. Jalankan pengujian

```bash
cd contracts
npx hardhat test
```

Hasil yang diharapkan: **`58 passing`**. Setiap judul uji diawali kode skenario Tabel 3.1 (BB-01 s.d. BB-25), jadi bisa langsung dipakai di Bab IV.

Perintah lain:

| Perintah (di folder `contracts`) | Fungsi |
|---|---|
| `npm run test:gas` | uji + laporan gas → `docs/gas-report.txt` |
| `npm run coverage` | persentase baris kode yang teruji |
| `npm test` (di folder `frontend`) | 16 uji logika website (BB-02, BB-03, BB-23, BB-24, rumus denda) |

Analisis Slither (opsional, butuh Python 3):
```bash
pip install slither-analyzer solc-select
solc-select install 0.8.28
solc-select use 0.8.28
cd contracts
slither . --filter-paths "node_modules|contracts/test"
```
Hasil yang sudah dijalankan ada di `docs/slither-report.txt`.

## 4. Jalankan secara lokal (tanpa ETH faucet)

Mode lokal memakai blockchain tiruan di laptopmu dengan akun berisi 10.000 ETH palsu. Cocok untuk latihan sebelum demo.

**Terminal 1** (biarkan tetap terbuka):
```bash
cd contracts
npx hardhat node
```

**Terminal 2**:
```bash
cd contracts
npm run deploy:local
```
Alamat kontrak otomatis ditulis ke `frontend/src/config/deployments.json`. (Opsional) `npm run e2e:local` menjalankan skenario otomatis dan membuat 4 contoh pesanan.

**Terminal 3**:
```bash
cd frontend
npm run dev:local
```
Buka **http://localhost:5173**.

### Hubungkan MetaMask ke jaringan lokal

1. Klik **Hubungkan MetaMask** di website. MetaMask akan menawarkan menambah jaringan **Hardhat Lokal** (chainId 31337, RPC `http://127.0.0.1:8545`). Setujui.
2. Impor akun uji Hardhat: MetaMask → ikon akun → **Add account or hardware wallet → Import account** → tempel kunci privat:

| Peran | Alamat | Kunci privat (PUBLIK, hanya untuk Hardhat lokal) |
|---|---|---|
| Klien (#1) | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |
| Freelancer (#2) | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` |
| Arbiter (#3) | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` |

> ⚠️ Kunci di atas diketahui semua orang. **Jangan pernah** mengirim ETH sungguhan ke alamat-alamat ini dan jangan memakainya di Sepolia/mainnet.

3. Ganti nama akun di MetaMask menjadi "Klien", "Freelancer", "Arbiter" agar mudah saat berganti peran.

### Memajukan waktu (khusus lokal)

Mode lokal memakai mode DEMO (1 hari = 60 detik). Jika tetap ingin langsung lompat waktu:
```bash
cd contracts
npm run skip -- 600     # majukan waktu blockchain 600 detik (10 "hari" demo)
```

> Setiap kali `npx hardhat node` dimatikan lalu dijalankan lagi, semua data hilang. Jalankan `npm run deploy:local` lagi, dan di MetaMask lakukan **Settings → Advanced → Clear activity tab data** (agar nonce tidak error).

## 5. Siapkan MetaMask dan ETH Sepolia

1. Di MetaMask, aktifkan jaringan uji: klik pemilih jaringan → aktifkan **Show test networks** → pilih **Sepolia**.
2. Buat **4 akun khusus testnet** (jangan pakai dompet berisi uang asli): **Deployer**, **Klien**, **Freelancer**, **Arbiter**. (Deployer boleh sama dengan Klien.)
3. Isi ETH Sepolia gratis dari faucet. Perkiraan kebutuhan:
   - Deployer: ±0,02–0,05 ETH (deploy ±3,4 juta gas)
   - Klien: ±0,05 ETH (nilai pesanan demo kecil, mis. 0,01 ETH + gas)
   - Freelancer: ±0,01–0,02 ETH (gas)
   - Arbiter: ±0,01 ETH (gas)

   Kamu juga bisa meminta faucet ke satu akun lalu **Send** ke akun lain dari MetaMask.

Faucet Sepolia (aturan faucet sering berubah, coba yang lain jika gagal):

| Faucet | Keterangan |
|---|---|
| https://faucet.quicknode.com/ethereum/sepolia | Tanpa akun, cooldown 12 jam (dicek Oktober 2026) |
| https://cloud.google.com/application/web3/faucet/ethereum/sepolia | Login akun Google (belum diverifikasi ulang) |
| https://sepolia-faucet.pk910.de | "PoW faucet": menambang di browser beberapa menit, tanpa syarat (belum diverifikasi ulang) |
| https://www.alchemy.com/faucets/ethereum-sepolia | 0,1 ETH/hari, **butuh saldo ≥0,001 ETH di mainnet** (dicek Oktober 2026) |
| https://getsepolia.2bd.net | 0,02 ETH/24 jam (belum diverifikasi, pakai dengan hati-hati) |

> Faucet tidak pernah meminta **kunci privat** atau **seed phrase**. Jika ada yang meminta, itu penipuan.

## 6. Deploy kontrak ke Sepolia

1. Di folder `contracts`, salin file contoh konfigurasi:
   - Windows PowerShell: `Copy-Item .env.example .env`
   - macOS/Linux: `cp .env.example .env`
2. Buka `contracts/.env` di VS Code lalu isi:
   ```ini
   SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
   DEPLOYER_PRIVATE_KEY=0x...        # MetaMask akun Deployer > ⋮ > Account details > Show private key
   ARBITER_ADDRESS=0x...             # alamat akun Arbiter (BUKAN Klien/Freelancer)
   DEMO_MODE=true                    # true untuk demo, false untuk pengujian final skripsi
   ```
3. Cek saldo deployer:
   ```bash
   npm run check:sepolia
   ```
4. Deploy:
   ```bash
   npm run deploy:sepolia
   ```
   Keluaran akan menampilkan alamat kontrak dan tautan Etherscan, serta **otomatis memperbarui** `frontend/src/config/deployments.json` dan ABI. Simpan alamatnya untuk skripsi.
5. Jalankan website dalam mode Sepolia:
   ```bash
   cd ../frontend
   npm run dev
   ```

Skrip deploy boleh dijalankan berulang kali. Setiap deploy membuat **kontrak baru yang kosong**, dan website otomatis memakai alamat terbaru. Jangan lupa commit dan push lagi agar Vercel ikut memakai alamat baru.

**Mode DEMO vs mode SKRIPSI**

| | `DEMO_MODE=true` | `DEMO_MODE=false` (sesuai proposal) |
|---|---|---|
| 1 "hari" untuk denda, durasi, batas akhir | 60 detik | 86.400 detik |
| Masa review (`REVIEW_PERIOD`) | 3 menit | 3 hari |
| Jendela revisi (`REVISION_WINDOW`) | 3 menit | 3 hari |
| Tenggat arbiter (`DISPUTE_TIMEOUT`) | 7 menit | 7 hari |

Nilai ini disimpan sebagai parameter constructor (`immutable`), jadi tidak bisa diubah setelah deploy. Untuk berganti mode, deploy ulang. Website menampilkan banner "Mode DEMO waktu" jika kontrak memakai mode demo.

**(Opsional) Verifikasi kode di Etherscan**, agar dosen bisa membaca kode kontrak langsung di Etherscan: buat API key di https://etherscan.io/myapikey, isi `ETHERSCAN_API_KEY` di `.env`, lalu:
```bash
# mode demo:
npx hardhat verify --network sepolia <ALAMAT_KONTRAK> <ARBITER_ADDRESS> 60 180 180 420
# mode skripsi:
npx hardhat verify --network sepolia <ALAMAT_KONTRAK> <ARBITER_ADDRESS> 86400 259200 259200 604800
```

**RPC lebih stabil (disarankan sebelum sidang):** RPC publik `publicnode` hanya menyimpan riwayat blok beberapa hari terakhir. Data pesanan tetap tampil, tetapi tabel **Riwayat Transaksi** untuk kontrak yang di-deploy lebih dari ±1 minggu sebelumnya bisa gagal dimuat jika MetaMask tidak terhubung. Solusinya: hubungkan MetaMask (website otomatis memakai RPC MetaMask untuk riwayat), atau buat RPC gratis di Alchemy/Infura lalu isi `VITE_SEPOLIA_RPC_URL` di `frontend/.env` dan di Vercel.

## 7. (Opsional) IPFS sungguhan dengan Pinata

Tanpa konfigurasi, website memakai **IPFS mode DEMO**: berkas (brief, hasil kerja, bukti, alasan) disimpan di IndexedDB browser dan CID dihitung dari hash SHA-256 isinya (format CIDv1, sama dengan yang dihasilkan Pinata untuk berkas kecil). Demo tetap jalan tanpa akun, **tetapi berkas hanya bisa dibuka di browser yang sama**. Jadi saat demo, pakai satu browser dan berganti akun di MetaMask.

Agar berkas benar-benar tersimpan di IPFS:
1. Daftar gratis di https://app.pinata.cloud.
2. Menu **API Keys → New Key**. Jangan pilih Admin; aktifkan hanya izin **Files: Write** (`org:files:write`). Beri nama, misalnya `skripsi-demo`.
3. Salin nilai **JWT** (teks panjang diawali `eyJ…`). Nilai ini hanya ditampilkan sekali.
4. (Opsional) Menu **Gateways** → salin domain gateway, misalnya `nama-kamu.mypinata.cloud`.
5. Di folder `frontend`, salin `.env.example` menjadi `.env`, lalu isi:
   ```ini
   VITE_PINATA_JWT=eyJ...
   VITE_PINATA_GATEWAY=nama-kamu.mypinata.cloud
   ```
6. Matikan `npm run dev` (Ctrl+C) lalu jalankan lagi. Banner "IPFS mode DEMO" akan hilang.

> ⚠️ Variabel berawalan `VITE_` ikut masuk ke kode website, sehingga bisa dilihat siapa pun yang membuka situsmu. Karena itu gunakan key berizin minimal dan **hapus key tersebut di Pinata setelah demo/sidang selesai**.

## 8. Upload ke GitHub

1. Buat akun di https://github.com, lalu **New repository** → nama `freelance-escrow-dapp` → (boleh Private) → **Create repository** (jangan centang "Add README").
2. Di terminal VS Code, dari folder **utama** proyek:
   ```bash
   cd ..                      # pastikan berada di folder freelance-escrow-dapp
   git init
   git add .
   git status                 # PASTIKAN tidak ada file .env di daftar!
   git commit -m "Implementasi FreelanceEscrow dApp"
   git branch -M main
   git remote add origin https://github.com/USERNAME/freelance-escrow-dapp.git
   git push -u origin main
   ```
   Saat pertama kali push, Git akan membuka jendela login GitHub.
3. Alternatif tanpa perintah: di halaman repo GitHub klik **uploading an existing file**, lalu seret isi folder hasil ekstrak zip **sebelum** menjalankan `npm install` (agar folder `node_modules` tidak ikut).

File `.gitignore` sudah mencegah `node_modules`, hasil build, dan `.env` ikut ter-upload. Jika tidak sengaja meng-upload kunci privat, anggap kunci itu bocor: buat akun MetaMask baru.

## 9. Deploy website ke Vercel

1. Login https://vercel.com memakai akun GitHub.
2. **Add New… → Project** → pilih repo `freelance-escrow-dapp` → **Import**.
3. Pengaturan:
   - **Root Directory**: klik Edit → pilih **`frontend`** (penting!)
   - Framework Preset: **Vite** (terdeteksi otomatis)
   - Build Command `npm run build`, Output Directory `dist` (default)
   - **Environment Variables**:
     - `VITE_NETWORK` = `sepolia`
     - `VITE_PINATA_JWT` = (opsional, JWT Pinata)
     - `VITE_PINATA_GATEWAY` = (opsional)
     - `VITE_SEPOLIA_RPC_URL` = (opsional, RPC Alchemy/Infura)
4. **Deploy**. Setelah ±1 menit kamu mendapat link seperti `https://freelance-escrow-dapp.vercel.app`.
5. Setiap kali kamu `git push`, Vercel otomatis build ulang. Jika kontrak di-deploy ulang, commit file `frontend/src/config/deployments.json` yang berubah lalu push.

Jika mengubah Environment Variables di Vercel, lakukan **Redeploy** agar perubahan dipakai.

## 10. SKENARIO DEMO untuk dosen pembimbing

**Persiapan (H-1):**
- Kontrak sudah di-deploy ke Sepolia dengan `DEMO_MODE=true` dan `ARBITER_ADDRESS` = akun Arbiter.
- Website sudah online di Vercel (atau `npm run dev` di laptop).
- MetaMask punya 3 akun bersaldo Sepolia: **Klien**, **Freelancer**, **Arbiter**. Salin alamat Freelancer ke Notepad.
- Uji sekali alur di bawah. Siapkan tab Etherscan.
- Cadangan jika internet/Sepolia lambat: mode lokal (bagian 4).

Waktu demo ±20–25 menit. Dalam mode DEMO, **1 hari = 1 menit**.

| # | Akun MetaMask | Langkah | Yang ditunjukkan / dijelaskan |
|---|---|---|---|
| 1 | Klien | Buka website, klik **Hubungkan MetaMask**. | Banner "Mode DEMO waktu", peran terdeteksi dari alamat dompet (Gambar 3.8). |
| 2 | Klien | Di MetaMask pindah ke **Ethereum Mainnet**. | **BB-23**: banner merah "Jaringan salah", tombol transaksi nonaktif. Klik **Ganti ke Sepolia**. |
| 3 | Klien | **Buat Pesanan** → kategori **Website** → tempel alamat Freelancer → total **0.01** ETH. Durasi: M1 = **3** hari, M2 = **1** hari, M3 = **2** hari. Denda 5%/hari, maks 50%, revisi 2, batas akhir **3** hari. | Ubah persentase M3 menjadi 10 lalu klik kirim: **BB-02** formulir menolak (Σ 90%). Kembalikan ke 20. Tunjukkan tabel simulasi denda. |
| 4 | Klien | Klik **Kunci 0.01 ETH & Buat Pesanan** → konfirmasi di MetaMask. | Notifikasi pending → sukses → **Lihat di Etherscan**. Detail pesanan berstatus **Menunggu freelancer (Funded)**, brief dan CID-nya tidak dapat diubah (**BB-25**). |
| 5 | Klien | (Cadangan refund) Buat pesanan kedua: kategori **Artikel**, total **0.006** ETH, durasi tiap bab **1** hari, batas akhir **2** hari. | Dipakai di langkah 12. |
| 6 | Freelancer | Ganti akun di MetaMask. Buka **Dashboard Freelancer**. | **BB-24**: menu dan chip peran berubah otomatis. Ada 2 pesanan masuk. |
| 7 | Freelancer | Buka pesanan Website → **Terima pesanan**. Buka pesanan Artikel → **Terima pesanan** (jangan kirim apa pun untuk pesanan ini). | Milestone 1 dibuka, hitung mundur tenggat berjalan. Jelaskan: tenggat dihitung sejak milestone dibuka. |
| 8 | Freelancer | Pesanan Website: isi catatan/tautan → **Kirim hasil kerja**. | Denda 0 karena tepat waktu (**BB-07**). |
| 9 | Klien | **Minta revisi** dengan catatan. Lalu Freelancer **Kirim revisi**. Lalu Klien **Setujui & cairkan**. | Revisi tercatat (1/2). Freelancer menerima 0,003 ETH (lihat tab *Internal Transactions* di Etherscan). Milestone 2 otomatis dibuka (**BB-10**). |
| 10 | Freelancer | **Tunggu ±2–3 menit** (M2 hanya 1 "hari"). Tunjukkan kotak **Perkiraan denda** yang naik tiap menit (5% → 10% → 15%). Lalu **Kirim hasil**. | **Denda otomatis**: rumus `V × min(⌈hari terlambat⌉ × r, c)`. Denda dikunci saat kiriman pertama. Sambil menunggu, jelaskan rumus di subbab 3.4.7. |
| 11 | Klien | **Setujui & cairkan** M2. | Freelancer menerima V − denda, Klien menerima denda. Lihat event **MilestonePaid** di Riwayat Transaksi. |
| 12 | Klien | Buka pesanan Artikel (lewat ±3 menit sejak diterima). Klik **Klaim refund**. | Sebelum tenggat + batas akhir, tombol nonaktif (**BB-12**). Setelahnya, 0,006 ETH kembali dan status **Dihentikan** (**BB-13**). |
| 13 | Freelancer | Pesanan Website M3: **Kirim hasil kerja**. | |
| 14 | Klien | **Tolak hasil kerja** dengan alasan. | Status **Sengketa (Disputed)**, tidak ada refund otomatis (**BB-17**). |
| 15 | Freelancer | **Unggah bukti**. | Bukti kedua pihak tersimpan (CID di kontrak). |
| 16 | Arbiter | Ganti akun → menu **Dashboard Arbiter** muncul (hanya untuk arbiter). Klik **Tinjau & putuskan** → geser ke **70%** → tulis alasan → **Putuskan**. | **BB-20**: Klien menerima denda + 70% sisa, Freelancer 30%, Arbiter **0 ETH**. Alasan tercatat (CID). Pesanan **Selesai**. Tunjukkan bahwa dengan akun Klien, halaman `/arbiter` menampilkan "Akses ditolak". |
| 17 | (siapa saja) | Buka tautan Etherscan kontrak (di footer website). | Semua transaksi dan event publik. Tidak ada fungsi `withdraw`/admin. Jika sudah diverifikasi, tunjukkan tab *Contract*. |

Opsional jika waktu cukup:
- **finalizeAfterReview** (**BB-16**): freelancer mengirim hasil, klien diam 3 menit, freelancer klik **Cairkan … (klien tidak menanggapi)**.
- **settleDisputeTimeout** (**BB-22**): biarkan sengketa tanpa keputusan 7 menit, lalu klien/freelancer klik **Bagi 50:50**.

Kalimat penutup yang bisa dipakai: *"Keputusan objektif berbasis waktu (pembayaran, denda, refund, timeout) dijalankan otomatis oleh kontrak. Keputusan subjektif (kualitas) diserahkan ke arbiter yang wewenangnya dibatasi kode: hanya pada milestone bersengketa, dalam 7 hari, tanpa menerima dana, dan alasannya tercatat permanen."*

## 11. Mengatasi error umum

| Gejala / pesan | Penyebab | Solusi |
|---|---|---|
| Banner merah **"Jaringan salah"**, tombol abu-abu | MetaMask tidak di Sepolia (atau tidak di Hardhat Lokal pada mode lokal) | Klik **Ganti ke …** di banner, atau pilih jaringan di MetaMask. |
| **"Saldo ETH tidak cukup"** / `insufficient funds` | Saldo tidak cukup untuk nilai pesanan + gas | Isi dari faucet atau kirim dari akun lain. Gunakan nilai pesanan kecil (0,01 ETH). |
| `nonce too high` / `Nonce too low` / transaksi macet | Biasanya setelah `npx hardhat node` di-restart | MetaMask → **Settings → Advanced → Clear activity tab data**, lalu coba lagi. |
| Banner **"Kontrak tidak ditemukan"** | Mode lokal: node di-restart sehingga kontrak hilang. Sepolia: alamat salah | Lokal: `npm run deploy:local` lagi. Sepolia: periksa `deployments.json`. |
| Banner **"Kontrak belum di-deploy ke Sepolia"** | `deployments.json` masih placeholder | Lakukan bagian 6, atau pakai mode lokal (`npm run dev:local`). |
| **"Ditolak kontrak: …"** (mis. *Masa review belum berakhir*, *Belum melewati tenggat + batas akhir*) | Aturan kontrak belum terpenuhi. Ini perilaku yang benar | Tunggu sampai hitung mundur selesai (lokal: `npm run skip -- 300`). |
| `Failed to fetch` / CORS | Hardhat node mati (lokal), RPC publik sibuk, atau upload Pinata ditolak | Pastikan terminal `npx hardhat node` berjalan. Coba lagi atau isi `VITE_SEPOLIA_RPC_URL`. Untuk Pinata cek JWT dan izin `Files: Write`. |
| Riwayat transaksi: "RPC publik tidak lagi menyimpan riwayat blok lama" | publicnode memangkas riwayat lama | Hubungkan MetaMask, atau isi `VITE_SEPOLIA_RPC_URL` dengan RPC Alchemy/Infura. |
| Berkas "tidak dapat dibuka di browser ini" / badge **DEMO lokal** | IPFS mode demo: berkas hanya ada di browser yang mengunggah | Demo dengan satu browser, atau aktifkan Pinata (bagian 7). |
| `Error HH8` atau *private key too short* saat deploy | `DEPLOYER_PRIVATE_KEY` salah format | Salin ulang dari MetaMask (64 karakter heksadesimal, boleh diawali 0x). |
| `ARBITER_ADDRESS wajib diisi` | `.env` belum diisi | Isi alamat akun Arbiter. |
| `Saldo deployer 0 ETH` | Akun deployer belum diisi | Faucet, lalu `npm run check:sepolia`. |
| `Error: listen EADDRINUSE 8545` / port 5173 dipakai | Node/website lama masih berjalan | Tutup terminal lama (Ctrl+C) atau restart VS Code. |
| Vercel: build gagal "Could not read package.json" | Root Directory belum diatur | Settings → General → Root Directory = `frontend` → Redeploy. |
| Vercel: halaman 404 saat refresh | (sudah ditangani `vercel.json`) | Pastikan `frontend/vercel.json` ikut ter-push. |
| PowerShell: *running scripts is disabled* | Kebijakan eksekusi Windows | Lihat bagian 1. |
| Waktu di website tidak sama dengan jam laptop (lokal) | Waktu blockchain sudah dimajukan dengan `skip` | Normal. Website memakai waktu blok terbaru. |
