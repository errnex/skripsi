# PENJELASAN KODE

Dokumen ini menjelaskan isi kode dengan bahasa sederhana dan memetakannya ke diagram Bab III proposal. Bacalah sambil membuka `contracts/contracts/FreelanceEscrow.sol`.

## 1. Gambaran besar (Gambar 3.2 Arsitektur)

```
Pengguna ──► Website (React, Vercel) ──► MetaMask (tanda tangan) ──► Smart contract FreelanceEscrow (Sepolia)
                 │                                                        ▲
                 └──► IPFS / Pinata (brief, hasil kerja, bukti, alasan) ──┘  (kontrak hanya menyimpan CID)
                 └──► Membaca data & event kontrak (ethers.js) ──► tautan Etherscan
```

- **Tidak ada database/server.** Semua status dibaca langsung dari kontrak, dan riwayat dibaca dari event.
- **Dana disimpan oleh kontrak**, bukan oleh dompet pengembang. Kontrak tidak punya fungsi penarikan oleh admin.

## 2. Data yang disimpan kontrak (Gambar 3.9 Diagram Class)

### Variabel kontrak

| Variabel | Tipe | Arti |
|---|---|---|
| `arbiter` | `address immutable` | Dompet arbiter (admin platform). Diisi sekali saat deploy, tidak bisa diganti. |
| `DAY_LENGTH` | `uint256 immutable` | Panjang 1 "hari" dalam detik untuk denda: 86.400 (skripsi) atau 60 (demo). |
| `REVIEW_PERIOD` | `uint256 immutable` | Masa review klien setelah kiriman terakhir (skripsi 3 hari). |
| `REVISION_WINDOW` | `uint256 immutable` | Jendela revisi setelah revisi diminta (skripsi 3 hari). |
| `DISPUTE_TIMEOUT` | `uint256 immutable` | Batas waktu arbiter memutuskan (skripsi 7 hari). |
| `BPS_DENOMINATOR` | `constant` = 10.000 | Penyebut basis poin (100 bps = 1%). |
| `MAX_MILESTONES` | `constant` = 20 | Batas jumlah milestone per pesanan (mencegah transaksi kehabisan gas). |
| `orderCount` | `uint256` | Jumlah pesanan. ID pesanan dimulai dari 1. |
| `orders` | `mapping(uint256 => Order)` | Data pesanan per ID. |
| `milestones` | `mapping(uint256 => Milestone[])` | Daftar milestone per pesanan. |

### `struct Order`

| Field | Arti |
|---|---|
| `client`, `freelancer` | Alamat klien dan freelancer. |
| `briefCID` | CID brief di IPFS. **Tidak ada fungsi untuk mengubahnya** (BB-25). |
| `totalAmount` | Total nilai yang disetor (wei). |
| `dailyRateBps` | Tarif denda per hari (bps). 500 = 5%. |
| `capBps` | Batas maksimum denda (bps). 5000 = 50%. |
| `maxRevisions` | Batas revisi per milestone. |
| `gracePeriod` | Batas akhir setelah tenggat (detik) sebelum klien boleh `claimRefund()`. |
| `currentMilestone` | Indeks milestone yang sedang berjalan (0 = milestone pertama). |
| `status` | `OrderStatus`. |

### `struct Milestone`

| Field | Arti |
|---|---|
| `amount` | Nilai milestone V (wei). |
| `duration` | Durasi pengerjaan (detik), dihitung sejak milestone dibuka. |
| `deadline` | `t_buka + duration`. Bernilai 0 jika milestone belum dibuka. |
| `firstSubmittedAt` | Waktu kiriman pertama, dasar perhitungan denda. |
| `lastSubmittedAt` | Waktu kiriman terakhir, dasar masa review. |
| `workCID` | CID hasil kerja terbaru. |
| `revisionCount` | Jumlah revisi yang sudah diminta. |
| `lateFee` | Denda yang ditetapkan pada kiriman pertama. |
| `disputeStartedAt` | Waktu sengketa dimulai. |
| `clientEvidenceCID`, `freelancerEvidenceCID` | CID bukti kedua pihak. Alasan penolakan klien otomatis menjadi bukti klien awal. |
| `resolutionCID` | CID alasan keputusan arbiter. |
| `revisionRequestedAt` | **Tambahan implementasi**: waktu revisi diminta, untuk menghitung jendela revisi. |
| `status` | `MilestoneStatus`. |

## 3. Status dan transisinya (Gambar 3.6 dan 3.7)

### Status pesanan (`OrderStatus`)

| Dari | Fungsi | Syarat | Ke |
|---|---|---|---|
| (awal) | `createOrder()` | `msg.value` = total milestone | **Funded** (0) |
| Funded | `cancelOrder()` | pemanggil = klien | **Cancelled** (3), refund penuh |
| Funded | `acceptOrder()` | pemanggil = freelancer | **Active** (1), milestone 1 dibuka |
| Active | milestone terakhir Paid/Resolved | otomatis | **Completed** (2) |
| Active | `claimRefund()` | milestone berjalan belum pernah dikirim dan `now > tenggat + gracePeriod` | **Terminated** (4) |

### Status milestone (`MilestoneStatus`)

| Dari | Fungsi | Syarat | Ke |
|---|---|---|---|
| (dibuka) | `_openMilestone()` | otomatis saat accept/milestone sebelumnya selesai | **Pending** (0), `deadline = now + duration` |
| Pending | `submitWork(CID)` | freelancer | **Submitted** (1), denda dihitung |
| Pending | `claimRefund()` | klien, `now > deadline + grace` | **Refunded** (6), beserta semua milestone sisa |
| Submitted | `approveMilestone()` | klien | **Paid** (4) |
| Submitted | `finalizeAfterReview()` | freelancer, `now > lastSubmittedAt + REVIEW_PERIOD` | **Paid** (4) |
| Submitted | `requestRevision(CID)` | klien, `revisionCount < maxRevisions` | **RevisionRequested** (2) |
| RevisionRequested | `submitWork(CID)` | freelancer (kirim ulang, denda tidak berubah) | **Submitted** (1) |
| Submitted | `rejectMilestone(CID)` | klien | **Disputed** (3) |
| RevisionRequested | `rejectMilestone(CID)` | klien, jendela revisi sudah habis | **Disputed** (3) |
| Disputed | `resolveDispute(p, CID)` | arbiter, `now ≤ disputeStartedAt + DISPUTE_TIMEOUT`, `p ≤ 100` | **Resolved** (5) |
| Disputed | `settleDisputeTimeout()` | klien/freelancer, `now > disputeStartedAt + DISPUTE_TIMEOUT` | **Resolved** (5), 50:50 |

Di website, milestone yang `deadline = 0` ditampilkan sebagai **"Belum dibuka"**. Di kontrak statusnya tetap `Pending`.

## 4. Penjelasan setiap fungsi

Setiap fungsi yang mengubah data memeriksa **siapa pemanggilnya** (modifier `onlyClient`, `onlyFreelancer`, `onlyArbiter`) dan **status asal** (`require`). Jika syarat tidak terpenuhi, transaksi **dibatalkan (revert)** dengan pesan berbahasa Indonesia yang tampil di website.

### `constructor(arbiter, dayLength, reviewPeriod, revisionWindow, disputeTimeout)`
Dijalankan sekali saat deploy. Menyimpan alamat arbiter dan parameter waktu. Menolak alamat arbiter kosong dan periode 0.

### `createOrder(freelancer, briefCID, amounts[], durations[], dailyRateBps, capBps, maxRevisions, gracePeriod)` — *payable*, use case "Membuat pesanan dan menyetor dana"
- **Pemeriksaan:** alamat freelancer valid dan ≠ klien; klien dan freelancer ≠ arbiter (BB-03); CID brief tidak kosong; 1–20 milestone; panjang `amounts` = panjang `durations`; `capBps ≤ 10.000`; setiap nilai dan durasi > 0; **`msg.value` = jumlah semua `amounts`** (BB-01).
- **Efek:** menyimpan pesanan dengan status Funded dan semua milestone Pending (belum dibuka).
- **Event:** `OrderCreated(orderId, client, freelancer, totalAmount, milestoneCount, briefCID)`.
- Kategori jasa (Website/Artikel) dan judul milestone disimpan di **brief JSON di IPFS**, bukan di kontrak (proposal subbab 1.3 butir 2 dan 3.4.6).

### `cancelOrder(orderId)` — klien
Hanya saat status Funded. Status menjadi Cancelled, lalu seluruh dana dikirim kembali ke klien (BB-04). Setelah diterima freelancer, fungsi ini ditolak (BB-05).

### `acceptOrder(orderId)` — freelancer
Funded → Active, lalu membuka milestone pertama (`deadline = now + duration`). Event `OrderAccepted` dan `MilestoneOpened`. Selain freelancer ditolak (BB-06).

### `submitWork(orderId, milestoneId, workCID)` — freelancer
- Hanya untuk **milestone yang sedang berjalan** (milestone dikerjakan berurutan) dengan status Pending atau RevisionRequested.
- **Kiriman pertama** (dari Pending): mencatat `firstSubmittedAt` dan menghitung denda `lateFee` (BB-07, BB-08, BB-09).
- **Kiriman revisi** (dari RevisionRequested): denda **tidak dihitung ulang**, jadi revisi tidak menambah denda.
- Selalu memperbarui `lastSubmittedAt`, sehingga masa review dihitung dari kiriman terakhir.
- Freelancer masih boleh mengirim setelah batas akhir **selama klien belum `claimRefund()`** (usulan di subbab 3.4.7).
- Event `WorkSubmitted(orderId, milestoneId, workCID, lateFee, isRevision)`.

### `approveMilestone(orderId, milestoneId)` — klien
Status Submitted → Paid. Freelancer menerima `V − denda`, klien menerima `denda`. Lalu milestone berikutnya dibuka, atau pesanan menjadi Completed (BB-10). Event `MilestonePaid(…, byReviewTimeout=false)`.

### `requestRevision(orderId, milestoneId, noteCID)` — klien
Hanya dari Submitted dan jika `revisionCount < maxRevisions` (BB-11). Mencatat `revisionRequestedAt`. CID catatan revisi disimpan di event `RevisionRequested`, tidak di storage, supaya hemat gas.

### `rejectMilestone(orderId, milestoneId, reasonCID)` — klien
Dari Submitted, atau dari RevisionRequested setelah jendela revisi habis. Status menjadi **Disputed**, `disputeStartedAt = now`, dan alasan disimpan sebagai bukti klien. **Tidak ada refund otomatis** (BB-17). Ini mencegah klien curang yang menolak hasil bagus supaya tidak membayar.

### `finalizeAfterReview(orderId, milestoneId)` — freelancer
Jika klien diam lebih lama dari `REVIEW_PERIOD` sejak kiriman terakhir, freelancer bisa mencairkan sendiri. Pembayarannya sama persis dengan `approveMilestone` (BB-15, BB-16). Event `MilestonePaid(…, byReviewTimeout=true)`.

### `claimRefund(orderId)` — klien
- Syarat: pesanan Active, milestone berjalan **berstatus Pending** (belum pernah dikirim), dan `now > deadline + gracePeriod` (BB-12, BB-14).
- Efek: milestone berjalan dan **semua milestone sesudahnya** menjadi Refunded, nilainya dikembalikan ke klien, dan pesanan menjadi Terminated. Milestone yang sudah Paid tidak berubah (BB-13).
- Event `RefundClaimed(orderId, fromMilestoneId, refundAmount)`.

### `submitEvidence(orderId, milestoneId, evidenceCID)` — klien atau freelancer
Selama Disputed, menyimpan CID bukti sesuai pengirimnya. Pihak lain, termasuk arbiter, ditolak. Event `EvidenceSubmitted`.

### `resolveDispute(orderId, milestoneId, clientPercent, reasonCID)` — arbiter
- Syarat: pemanggil = arbiter (BB-18), status Disputed, belum lewat `DISPUTE_TIMEOUT`, `clientPercent ≤ 100` (BB-19), dan CID alasan wajib diisi.
- Pembagian: `sisa = V − denda`; **klien = denda + sisa × p / 100**; **freelancer = V − bagian klien**; **arbiter = 0** (BB-20).
- Alasan keputusan disimpan di `resolutionCID`. Event `DisputeResolved(…, byTimeout=false)`.

### `settleDisputeTimeout(orderId, milestoneId)` — klien atau freelancer
Jika arbiter tidak memutuskan dalam `DISPUTE_TIMEOUT`, sisa dana dibagi 50:50 (denda tetap ke klien) (BB-21, BB-22). Event `DisputeResolved(…, clientPercent=50, byTimeout=true)`.

### Fungsi baca (*view*, gratis, tanpa transaksi)
- `calculateLateFee(orderId, milestoneId)`: jika sudah dikirim, mengembalikan denda yang terkunci. Jika belum, mengembalikan perkiraan denda bila dikirim sekarang.
- `getOrder`, `getMilestones`, `getMilestone`, `milestoneCount`: dipakai website untuk menampilkan data.

### Fungsi internal
- `_currentMilestone`: memastikan pesanan Active dan milestone yang dimaksud adalah milestone berjalan.
- `_openMilestone`: mengisi `deadline` dan memancarkan `MilestoneOpened`.
- `_lateFeeAt`: rumus denda (lihat bagian 5).
- `_payMilestone` dan `_settleDispute`: menghitung pembagian, mengubah status, lalu mengirim ETH.
- `_advance`: membuka milestone berikutnya atau menandai pesanan Completed.
- `_send`: mengirim ETH dengan `call` dan membatalkan transaksi jika gagal.

## 5. Rumus denda di kode (subbab 3.4.7)

```solidity
function _lateFeeAt(uint256 orderId, Milestone storage m, uint256 t) internal view returns (uint256) {
    if (t <= m.deadline) return 0;                                   // d = 0 jika tepat waktu
    uint256 daysLate = Math.ceilDiv(t - m.deadline, DAY_LENGTH);     // d = ⌈(t_kirim − t_tenggat) / 86.400⌉
    uint256 pct = daysLate * o.dailyRateBps;                         // d × r
    if (pct > o.capBps) pct = o.capBps;                              // min(d × r, c)
    return (m.amount * pct) / BPS_DENOMINATOR;                       // V × … / 10.000
}
```

Contoh BB-08: V = 0,5 ETH, terlambat 2 hari 3 jam = 183.600 detik → `ceilDiv(183600, 86400) = 3` → `3 × 500 = 1500 bps (15%)` → `0,5 × 1500 / 10000 = 0,075 ETH`.

Website memakai rumus yang **sama persis** di `frontend/src/lib/lateFee.js` untuk pratinjau denda yang berjalan live.

## 6. Daftar event

| Event | Kapan | Data penting |
|---|---|---|
| `OrderCreated` | pesanan dibuat | client & freelancer (indexed), total, jumlah milestone, briefCID |
| `OrderCancelled` | dibatalkan | jumlah refund |
| `OrderAccepted` | diterima freelancer | freelancer |
| `MilestoneOpened` | milestone dibuka | tenggat |
| `WorkSubmitted` | hasil dikirim | workCID, denda, apakah revisi |
| `RevisionRequested` | revisi diminta | noteCID, revisi ke-n |
| `MilestonePaid` | dibayar | bagian freelancer, bagian klien (denda), otomatis/tidak |
| `MilestoneDisputed` | ditolak | reasonCID |
| `EvidenceSubmitted` | bukti diunggah | pengirim, evidenceCID |
| `DisputeResolved` | sengketa selesai | persen klien, bagian masing-masing, reasonCID, karena timeout/tidak |
| `RefundClaimed` | refund | mulai milestone ke-, jumlah |
| `OrderCompleted` | semua selesai | - |

Semua event memakai `orderId` sebagai parameter indexed pertama, sehingga website bisa mengambil seluruh riwayat satu pesanan dengan satu filter. Riwayat ini juga terlihat di tab *Events* Etherscan.

## 7. Keamanan

1. **Tidak ada admin withdraw.** Fungsi yang mengubah data hanya 12 fungsi di atas. Ini dicek oleh uji "tidak ada fungsi penarikan dana oleh admin" dan BB-25.
2. **Re-entrancy.** Semua fungsi yang mengirim ETH memakai `nonReentrant` dari OpenZeppelin, dan **status diubah sebelum ETH dikirim** (checks → effects → interactions). Uji `ReentrancyAttacker` membuktikan freelancer jahat tidak bisa mencairkan milestone dua kali.
3. **Kontrol akses** per peran dengan modifier, dan arbiter tidak bisa menjadi klien/freelancer.
4. **Kontrak menolak ETH nyasar.** Tidak ada `receive()`, jadi ETH hanya masuk lewat `createOrder`.
5. **`block.timestamp`.** Validator hanya bisa menggeser waktu beberapa detik, sedangkan satuan denda dan periode adalah hari, jadi dampaknya tidak berarti. Slither melaporkannya sebagai *Low* dan sudah dijustifikasi di `docs/slither-report.txt`.
6. **Keterbatasan:** pembayaran dikirim langsung (*push*). Jika klien/freelancer adalah kontrak yang sengaja menolak ETH, pencairan milestone itu akan gagal. Untuk pengguna dompet biasa (MetaMask) hal ini tidak terjadi. Pola *pull payment* bisa ditulis sebagai saran pengembangan.

## 8. Peta kode website (`frontend/src`)

| File | Isi |
|---|---|
| `config/index.js` | Memilih jaringan (`VITE_NETWORK`), alamat kontrak, dan tautan Etherscan. |
| `config/deployments.json`, `FreelanceEscrow.abi.json` | **Ditulis otomatis** oleh `contracts/scripts/deploy.ts`. |
| `lib/AppContext.jsx` | Koneksi MetaMask, cek & ganti jaringan (BB-23), memuat data kontrak tiap 12 detik, deteksi peran (BB-24), dan menjalankan transaksi beserta notifikasi + tautan Etherscan. |
| `lib/contract.js` | Membaca `getOrder`/`getMilestones` dan mengambil riwayat event per pesanan. |
| `lib/ipfs.js` | Upload ke Pinata (jika `VITE_PINATA_JWT` diisi) atau **mode DEMO** (CID dihitung dari SHA-256, berkas disimpan di IndexedDB). |
| `lib/lateFee.js` | Rumus denda yang sama dengan kontrak. |
| `lib/validation.js` | Validasi formulir (BB-02, BB-03), `isCorrectNetwork` (BB-23), `detectRoles` (BB-24), pembagian nilai milestone. |
| `pages/Beranda.jsx` | Penjelasan singkat, peran yang terdeteksi, statistik, dan katalog semua pesanan dengan filter kategori/status. |
| `pages/BuatPesanan.jsx` | Formulir klien: alamat freelancer, kategori, brief + lampiran, milestone builder, parameter denda, simulasi denda. |
| `pages/DetailPesanan.jsx` | Timeline milestone, panel aksi sesuai peran dan status, hitung mundur, pratinjau denda live, form arbiter, dan riwayat transaksi. |
| `pages/Dashboards.jsx` | Dashboard Klien, Freelancer, dan Arbiter (hanya dompet arbiter). |

**Deteksi peran:** alamat dompet dibandingkan dengan `arbiter()` di kontrak serta `client`/`freelancer` setiap pesanan (data yang sama dengan isi event `OrderCreated`, tetapi dibaca dari storage kontrak agar tetap jalan walau RPC publik memangkas riwayat event).

**Waktu:** hitung mundur memakai waktu blok terbaru, bukan hanya jam laptop, sehingga tetap benar di Hardhat lokal yang waktunya dimajukan.

## 9. Perbedaan implementasi dengan proposal (perlu disesuaikan di skripsi)

| # | Proposal | Implementasi | Alasan / tindakan |
|---|---|---|---|
| 1 | `REVIEW_PERIOD`, `REVISION_WINDOW`, `DISPUTE_TIMEOUT` bertanda «constant» (Gambar 3.9) | «immutable», diisi lewat constructor, ditambah `DAY_LENGTH` (86.400 di mode skripsi) | Agar bisa demo dengan periode singkat. Mode skripsi tetap 3/3/7 hari dan 86.400 detik. Perbarui diagram class. |
| 2 | Struct Milestone (Gambar 3.9) | Tambah field `revisionRequestedAt` | Dibutuhkan untuk menegakkan aturan jendela revisi (Gambar 3.7). |
| 3 | Event contoh: OrderCreated, WorkSubmitted, MilestonePaid, RevisionRequested, MilestoneDisputed, DisputeResolved, RefundClaimed | Ditambah `OrderCancelled`, `OrderAccepted`, `MilestoneOpened`, `EvidenceSubmitted`, `OrderCompleted` | Proposal menulis "misalnya". Cantumkan daftar lengkap di Bab IV. |
| 4 | Diagram class hanya mencantumkan fungsi utama | Tambah fungsi baca `getOrder`, `getMilestones`, `getMilestone`, `milestoneCount` serta konstanta `BPS_DENOMINATOR`, `MAX_MILESTONES` (maks 20 milestone) | Kebutuhan antarmuka dan batas gas. |
| 5 | Validasi `capBps ≤ 10.000` | Juga `dailyRateBps ≤ 10.000` | Mencegah input tidak masuk akal. |
| 6 | 3.4.2: peran dari event `OrderCreated` | Dari `getOrder()` (data sama) | RPC publik memangkas riwayat event lama. Bisa ditulis sebagai detail implementasi. |
| 7 | 3.4.8: formulir pesanan di Dashboard Klien | Halaman terpisah **Buat Pesanan**, dan Beranda berisi katalog semua pesanan | Navigasi lebih jelas. Perbarui rancangan antarmuka/wireframe. |
| 8 | Alasan penolakan (`rejectMilestone(CID)`) | Disimpan sebagai `clientEvidenceCID` awal | Klien tetap bisa memperbarui lewat `submitEvidence`. |
| 9 | Slither: "dibandingkan sebelum dan sesudah perbaikan" | Sebelum: 1 Medium (*divide-before-multiply*, sebenarnya disengaja oleh rumus). Sesudah: 0 Medium dengan `Math.ceilDiv` | Bisa langsung dipakai di subbab 3.5.3/Bab IV. |
| 10 | IPFS via Pinata | Pinata v3 (JWT di frontend) **atau** mode DEMO tanpa Pinata | Mode demo hanya untuk presentasi. Untuk pengujian final gunakan Pinata. |

## 10. Pertanyaan dosen tentang kode (dan jawabannya)

1. **"Di mana uangnya disimpan? Siapa yang bisa mengambil?"**
   Di alamat kontrak. Uang hanya bisa keluar lewat `cancelOrder`, `approveMilestone`, `finalizeAfterReview`, `claimRefund`, `resolveDispute`, dan `settleDisputeTimeout`, dan semuanya hanya mengirim ke klien atau freelancer pesanan itu. Tidak ada fungsi `withdraw` atau `owner`.

2. **"Bagaimana kontrak tahu freelancer terlambat?"**
   Saat `submitWork`, kontrak membandingkan `block.timestamp` dengan `deadline`, menghitung hari terlambat dengan pembulatan ke atas, lalu menyimpan dendanya. Revisi tidak menghitung ulang denda.

3. **"Kenapa basis poin, bukan persen?"**
   Solidity tidak punya bilangan desimal. Dengan bps (1% = 100), tarif seperti 2,5% bisa ditulis 250 tanpa kehilangan presisi.

4. **"Bagaimana mencegah satu milestone dibayar dua kali?"**
   Status diubah menjadi Paid/Resolved **sebelum** ETH dikirim, dan fungsi pencairan memakai `nonReentrant`. Ada uji serangan re-entrancy yang membuktikannya.

5. **"Arbiter bisa curang?"**
   Arbiter hanya bisa memilih persentase 0–100 pada milestone bersengketa, dalam 7 hari, dan dana hanya ke klien/freelancer. Arbiter tidak menerima dana, dan alasannya tercatat permanen (CID). Jika arbiter diam, kedua pihak bisa membagi 50:50. Multisig/Kleros menjadi saran pengembangan.

6. **"Kenapa ada mode demo? Apakah hasil pengujian valid?"**
   Logika kontrak identik. Hanya panjang "hari" yang menjadi parameter constructor. Seluruh uji unit memakai mode skripsi (86.400 detik), dengan waktu dimajukan menggunakan `time.increase`, dan ada satu uji khusus untuk mode demo.

7. **"Kenapa file tidak disimpan di blockchain?"**
   Mahal. Kontrak hanya menyimpan CID, yaitu hash isi berkas, sehingga isi berkas tidak bisa diganti diam-diam (proposal [17]).

8. **"Bagaimana kalau klien tidak pernah merespons?"**
   Setelah masa review, freelancer memanggil `finalizeAfterReview()`, jadi dana tidak terkunci.

9. **"Bagaimana kalau freelancer menghilang?"**
   Setelah tenggat + batas akhir tanpa kiriman, klien memanggil `claimRefund()` dan menerima dana milestone berjalan serta semua sisanya.

10. **"Berapa biaya gas-nya?"**
    Lihat `docs/gas-report.txt`. Contoh: deploy ±3,41 juta gas, `createOrder` 3 milestone ±312 ribu gas, 6 milestone ±455 ribu gas, `approveMilestone` ±62–75 ribu gas. Untuk Bab IV, ukur ulang di Sepolia dari receipt.

11. **"Apa yang diuji dan bagaimana?"**
    58 uji unit Hardhat (BB-01–BB-25 + keamanan), 16 uji logika website (vitest), skenario end-to-end lokal, dan Slither.

12. **"Kenapa Solidity 0.8.28?"**
    Sejak 0.8.x, overflow/underflow otomatis dibatalkan, dan versi ini kompatibel dengan OpenZeppelin 5.
