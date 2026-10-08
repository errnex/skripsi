/**
 * Pengujian unit FreelanceEscrow.
 * Setiap blok `describe("BB-xx ...")` memetakan satu skenario pada Tabel 3.1 (Pengujian Black Box) proposal.
 * Nilai acuan sesuai Tabel 3.1: V = 0,5 ETH, r = 5%/hari (500 bps), c = 50% (5000 bps), g = 7 hari.
 * Kondisi waktu diuji dengan memajukan waktu blok (time travel) di jaringan lokal Hardhat.
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

const DAY = 86_400;
const HOUR = 3_600;
const eth = (v: string) => ethers.parseEther(v);

// Status enum (urutan sama dengan kontrak)
const OrderStatus = { Funded: 0n, Active: 1n, Completed: 2n, Cancelled: 3n, Terminated: 4n };
const MS = { Pending: 0n, Submitted: 1n, RevisionRequested: 2n, Disputed: 3n, Paid: 4n, Resolved: 5n, Refunded: 6n };

// Parameter studi kasus website (subbab 3.4.7): 0,3 / 0,5 / 0,2 ETH
const WEBSITE_AMOUNTS = [eth("0.3"), eth("0.5"), eth("0.2")];
const WEBSITE_DURATIONS = [5 * DAY, 10 * DAY, 4 * DAY];
const WEBSITE_TOTAL = eth("1");
const RATE_BPS = 500; // 5% per hari
const CAP_BPS = 5000; // 50%
const MAX_REV = 2;
const GRACE = 7 * DAY;
const BRIEF = "bafkreibriefwebsitecompanyprofile";

async function deployFixture() {
  const [deployer, client, freelancer, arbiter, stranger] = await ethers.getSigners();
  const Escrow = await ethers.getContractFactory("FreelanceEscrow");
  // Mode skripsi: 1 hari = 86.400 detik, review 3 hari, jendela revisi 3 hari, tenggat arbiter 7 hari
  const escrow = await Escrow.deploy(arbiter.address, DAY, 3 * DAY, 3 * DAY, 7 * DAY);
  await escrow.waitForDeployment();
  return { escrow, deployer, client, freelancer, arbiter, stranger };
}

async function websiteOrderFixture() {
  const f = await deployFixture();
  await f.escrow
    .connect(f.client)
    .createOrder(f.freelancer.address, BRIEF, WEBSITE_AMOUNTS, WEBSITE_DURATIONS, RATE_BPS, CAP_BPS, MAX_REV, GRACE, {
      value: WEBSITE_TOTAL,
    });
  return { ...f, orderId: 1n };
}

async function activeOrderFixture() {
  const f = await websiteOrderFixture();
  await f.escrow.connect(f.freelancer).acceptOrder(f.orderId);
  return f;
}

/** Pesanan aktif dengan milestone 1 sudah dibayar, sehingga milestone 2 (V = 0,5 ETH) sedang berjalan. */
async function milestone2Fixture() {
  const f = await activeOrderFixture();
  await f.escrow.connect(f.freelancer).submitWork(f.orderId, 0, "bafkrei-desain");
  await f.escrow.connect(f.client).approveMilestone(f.orderId, 0);
  const m2 = await f.escrow.getMilestone(f.orderId, 1);
  return { ...f, deadline2: m2.deadline };
}

/** Milestone 2 dikirim tepat waktu lalu ditolak klien -> Disputed. */
async function disputedFixture() {
  const f = await milestone2Fixture();
  await f.escrow.connect(f.freelancer).submitWork(f.orderId, 1, "bafkrei-website-v1");
  await f.escrow.connect(f.client).rejectMilestone(f.orderId, 1, "bafkrei-alasan-tolak");
  const m = await f.escrow.getMilestone(f.orderId, 1);
  return { ...f, disputeStartedAt: m.disputeStartedAt };
}

/** Milestone 2 dikirim 2 hari 3 jam terlambat (denda 0,075 ETH) lalu ditolak -> Disputed. */
async function lateDisputedFixture() {
  const f = await milestone2Fixture();
  await time.setNextBlockTimestamp(f.deadline2 + BigInt(2 * DAY + 3 * HOUR));
  await f.escrow.connect(f.freelancer).submitWork(f.orderId, 1, "bafkrei-website-late");
  await f.escrow.connect(f.client).rejectMilestone(f.orderId, 1, "bafkrei-alasan-tolak");
  const m = await f.escrow.getMilestone(f.orderId, 1);
  return { ...f, disputeStartedAt: m.disputeStartedAt };
}

describe("FreelanceEscrow", function () {
  describe("Deployment", function () {
    it("menyimpan arbiter immutable dan parameter waktu mode skripsi (3/3/7 hari)", async function () {
      const { escrow, arbiter } = await loadFixture(deployFixture);
      expect(await escrow.arbiter()).to.equal(arbiter.address);
      expect(await escrow.DAY_LENGTH()).to.equal(DAY);
      expect(await escrow.REVIEW_PERIOD()).to.equal(3 * DAY);
      expect(await escrow.REVISION_WINDOW()).to.equal(3 * DAY);
      expect(await escrow.DISPUTE_TIMEOUT()).to.equal(7 * DAY);
      expect(await escrow.orderCount()).to.equal(0);
    });

    it("menolak arbiter address(0) dan periode 0", async function () {
      const [, , , arbiter] = await ethers.getSigners();
      const Escrow = await ethers.getContractFactory("FreelanceEscrow");
      await expect(Escrow.deploy(ethers.ZeroAddress, DAY, DAY, DAY, DAY)).to.be.revertedWith("Arbiter tidak valid");
      await expect(Escrow.deploy(arbiter.address, 0, DAY, DAY, DAY)).to.be.revertedWith("Periode tidak valid");
    });
  });

  describe("createOrder (alur normal)", function () {
    it("menyimpan pesanan Funded, mengunci dana, dan memancarkan OrderCreated", async function () {
      const { escrow, client, freelancer } = await loadFixture(deployFixture);
      const tx = escrow
        .connect(client)
        .createOrder(freelancer.address, BRIEF, WEBSITE_AMOUNTS, WEBSITE_DURATIONS, RATE_BPS, CAP_BPS, MAX_REV, GRACE, {
          value: WEBSITE_TOTAL,
        });
      await expect(tx)
        .to.emit(escrow, "OrderCreated")
        .withArgs(1n, client.address, freelancer.address, WEBSITE_TOTAL, 3n, BRIEF);
      await expect(tx).to.changeEtherBalances([client, escrow], [-WEBSITE_TOTAL, WEBSITE_TOTAL]);

      const o = await escrow.getOrder(1);
      expect(o.client).to.equal(client.address);
      expect(o.freelancer).to.equal(freelancer.address);
      expect(o.briefCID).to.equal(BRIEF);
      expect(o.totalAmount).to.equal(WEBSITE_TOTAL);
      expect(o.dailyRateBps).to.equal(RATE_BPS);
      expect(o.capBps).to.equal(CAP_BPS);
      expect(o.maxRevisions).to.equal(MAX_REV);
      expect(o.gracePeriod).to.equal(GRACE);
      expect(o.status).to.equal(OrderStatus.Funded);
      const ms = await escrow.getMilestones(1);
      expect(ms.length).to.equal(3);
      expect(ms[1].amount).to.equal(eth("0.5"));
      expect(ms[0].deadline).to.equal(0); // belum dibuka sebelum acceptOrder
    });

    it("studi kasus artikel: 6 milestone (Bab 1-6) masing-masing 0,1 ETH", async function () {
      const { escrow, client, freelancer } = await loadFixture(deployFixture);
      const amounts = Array(6).fill(eth("0.1"));
      const durations = Array(6).fill(3 * DAY);
      await escrow
        .connect(client)
        .createOrder(freelancer.address, "bafkrei-brief-artikel", amounts, durations, RATE_BPS, CAP_BPS, 1, GRACE, {
          value: eth("0.6"),
        });
      expect(await escrow.milestoneCount(1)).to.equal(6);
    });

    it("menolak parameter tidak valid lain (milestone kosong, nilai 0, capBps > 10.000, CID kosong)", async function () {
      const { escrow, client, freelancer } = await loadFixture(deployFixture);
      const c = escrow.connect(client);
      await expect(
        c.createOrder(freelancer.address, BRIEF, [], [], RATE_BPS, CAP_BPS, MAX_REV, GRACE, { value: 0 }),
      ).to.be.revertedWith("Jumlah milestone tidak valid");
      await expect(
        c.createOrder(freelancer.address, BRIEF, [0n], [DAY], RATE_BPS, CAP_BPS, MAX_REV, GRACE, { value: 0 }),
      ).to.be.revertedWith("Nilai milestone harus > 0");
      await expect(
        c.createOrder(freelancer.address, BRIEF, [eth("1")], [0], RATE_BPS, CAP_BPS, MAX_REV, GRACE, { value: eth("1") }),
      ).to.be.revertedWith("Durasi milestone harus > 0");
      await expect(
        c.createOrder(freelancer.address, BRIEF, [eth("1")], [DAY], RATE_BPS, 10_001, MAX_REV, GRACE, { value: eth("1") }),
      ).to.be.revertedWith("Batas denda maksimal 10000 bps");
      await expect(
        c.createOrder(freelancer.address, "", [eth("1")], [DAY], RATE_BPS, CAP_BPS, MAX_REV, GRACE, { value: eth("1") }),
      ).to.be.revertedWith("CID brief wajib diisi");
      await expect(
        c.createOrder(freelancer.address, BRIEF, [eth("1")], [DAY, DAY], RATE_BPS, CAP_BPS, MAX_REV, GRACE, {
          value: eth("1"),
        }),
      ).to.be.revertedWith("Panjang nilai dan durasi berbeda");
    });
  });

  describe("BB-01 createOrder() dengan nilai ETH tidak sama dengan total milestone", function () {
    it("revert dengan pesan kesalahan (kurang maupun lebih)", async function () {
      const { escrow, client, freelancer } = await loadFixture(deployFixture);
      const c = escrow.connect(client);
      await expect(
        c.createOrder(freelancer.address, BRIEF, WEBSITE_AMOUNTS, WEBSITE_DURATIONS, RATE_BPS, CAP_BPS, MAX_REV, GRACE, {
          value: eth("0.9"),
        }),
      ).to.be.revertedWith("Nilai ETH harus sama dengan total milestone");
      await expect(
        c.createOrder(freelancer.address, BRIEF, WEBSITE_AMOUNTS, WEBSITE_DURATIONS, RATE_BPS, CAP_BPS, MAX_REV, GRACE, {
          value: eth("1.1"),
        }),
      ).to.be.revertedWith("Nilai ETH harus sama dengan total milestone");
    });
  });

  describe("BB-02 Persentase milestone tidak berjumlah 100%", function () {
    it("divalidasi di formulir frontend (lihat frontend/src/lib/validation.test.ts); di kontrak, nilai yang tidak cocok tetap ditolak lewat BB-01", async function () {
      // Kontrak menerima nilai (wei), bukan persentase. Persentase hanya ada di formulir.
      // Jika formulir dilewati dan jumlah nilai != msg.value, kontrak tetap menolak.
      const { escrow, client, freelancer } = await loadFixture(deployFixture);
      await expect(
        escrow
          .connect(client)
          .createOrder(freelancer.address, BRIEF, [eth("0.3"), eth("0.5")], [DAY, DAY], RATE_BPS, CAP_BPS, MAX_REV, GRACE, {
            value: eth("1"),
          }),
      ).to.be.revertedWith("Nilai ETH harus sama dengan total milestone");
    });
  });

  describe("BB-03 Alamat freelancer = klien, atau klien/freelancer = arbiter", function () {
    it("ditolak untuk ketiga kasus dan untuk address(0)", async function () {
      const { escrow, client, freelancer, arbiter } = await loadFixture(deployFixture);
      const args = [BRIEF, WEBSITE_AMOUNTS, WEBSITE_DURATIONS, RATE_BPS, CAP_BPS, MAX_REV, GRACE] as const;
      await expect(
        escrow.connect(client).createOrder(client.address, ...args, { value: WEBSITE_TOTAL }),
      ).to.be.revertedWith("Freelancer tidak boleh sama dengan klien");
      await expect(
        escrow.connect(client).createOrder(arbiter.address, ...args, { value: WEBSITE_TOTAL }),
      ).to.be.revertedWith("Arbiter tidak boleh menjadi klien/freelancer");
      await expect(
        escrow.connect(arbiter).createOrder(freelancer.address, ...args, { value: WEBSITE_TOTAL }),
      ).to.be.revertedWith("Arbiter tidak boleh menjadi klien/freelancer");
      await expect(
        escrow.connect(client).createOrder(ethers.ZeroAddress, ...args, { value: WEBSITE_TOTAL }),
      ).to.be.revertedWith("Alamat freelancer tidak valid");
    });
  });

  describe("BB-04 cancelOrder() sebelum pesanan diterima", function () {
    it("status Cancelled dan seluruh dana kembali ke klien", async function () {
      const { escrow, client, orderId } = await loadFixture(websiteOrderFixture);
      const tx = escrow.connect(client).cancelOrder(orderId);
      await expect(tx).to.emit(escrow, "OrderCancelled").withArgs(orderId, WEBSITE_TOTAL);
      await expect(tx).to.changeEtherBalances([client, escrow], [WEBSITE_TOTAL, -WEBSITE_TOTAL]);
      expect((await escrow.getOrder(orderId)).status).to.equal(OrderStatus.Cancelled);
    });

    it("hanya klien yang boleh membatalkan dan tidak bisa dibatalkan dua kali", async function () {
      const { escrow, client, freelancer, orderId } = await loadFixture(websiteOrderFixture);
      await expect(escrow.connect(freelancer).cancelOrder(orderId)).to.be.revertedWith("Hanya klien pesanan ini");
      await escrow.connect(client).cancelOrder(orderId);
      await expect(escrow.connect(client).cancelOrder(orderId)).to.be.revertedWith("Pesanan sudah diterima/tidak aktif");
      await expect(escrow.connect(freelancer).acceptOrder(orderId)).to.be.revertedWith(
        "Pesanan tidak menunggu persetujuan",
      );
    });
  });

  describe("BB-05 cancelOrder() setelah acceptOrder()", function () {
    it("transaksi ditolak", async function () {
      const { escrow, client, orderId } = await loadFixture(activeOrderFixture);
      await expect(escrow.connect(client).cancelOrder(orderId)).to.be.revertedWith("Pesanan sudah diterima/tidak aktif");
    });
  });

  describe("BB-06 Alamat selain freelancer memanggil acceptOrder() atau submitWork()", function () {
    it("acceptOrder() oleh klien/orang lain ditolak", async function () {
      const { escrow, client, stranger, orderId } = await loadFixture(websiteOrderFixture);
      await expect(escrow.connect(client).acceptOrder(orderId)).to.be.revertedWith("Hanya freelancer pesanan ini");
      await expect(escrow.connect(stranger).acceptOrder(orderId)).to.be.revertedWith("Hanya freelancer pesanan ini");
    });
    it("submitWork() oleh klien/orang lain ditolak", async function () {
      const { escrow, client, stranger, orderId } = await loadFixture(activeOrderFixture);
      await expect(escrow.connect(client).submitWork(orderId, 0, "bafkrei-x")).to.be.revertedWith(
        "Hanya freelancer pesanan ini",
      );
      await expect(escrow.connect(stranger).submitWork(orderId, 0, "bafkrei-x")).to.be.revertedWith(
        "Hanya freelancer pesanan ini",
      );
    });
  });

  describe("acceptOrder() membuka milestone pertama", function () {
    it("status Active, tenggat = waktu buka + durasi, event OrderAccepted & MilestoneOpened", async function () {
      const { escrow, freelancer, orderId } = await loadFixture(websiteOrderFixture);
      const tx = await escrow.connect(freelancer).acceptOrder(orderId);
      const rc = await tx.wait();
      const block = await ethers.provider.getBlock(rc!.blockNumber);
      const expectedDeadline = BigInt(block!.timestamp + WEBSITE_DURATIONS[0]);
      await expect(tx).to.emit(escrow, "OrderAccepted").withArgs(orderId, freelancer.address);
      await expect(tx).to.emit(escrow, "MilestoneOpened").withArgs(orderId, 0n, expectedDeadline);
      expect((await escrow.getOrder(orderId)).status).to.equal(OrderStatus.Active);
      expect((await escrow.getMilestone(orderId, 0)).deadline).to.equal(expectedDeadline);
      expect((await escrow.getMilestone(orderId, 1)).deadline).to.equal(0); // milestone 2 belum dibuka
    });

    it("milestone harus dikerjakan berurutan", async function () {
      const { escrow, freelancer, orderId } = await loadFixture(activeOrderFixture);
      await expect(escrow.connect(freelancer).submitWork(orderId, 1, "bafkrei-x")).to.be.revertedWith(
        "Bukan milestone berjalan",
      );
    });
  });

  describe("BB-07 submitWork() sebelum tenggat", function () {
    it("denda = 0 dan status Submitted", async function () {
      const { escrow, freelancer, orderId } = await loadFixture(activeOrderFixture);
      await expect(escrow.connect(freelancer).submitWork(orderId, 0, "bafkrei-desain"))
        .to.emit(escrow, "WorkSubmitted")
        .withArgs(orderId, 0n, "bafkrei-desain", 0n, false);
      const m = await escrow.getMilestone(orderId, 0);
      expect(m.status).to.equal(MS.Submitted);
      expect(m.lateFee).to.equal(0);
      expect(m.workCID).to.equal("bafkrei-desain");
      expect(m.firstSubmittedAt).to.be.greaterThan(0);
    });

    it("submitWork() tepat pada detik tenggat juga denda = 0", async function () {
      const { escrow, freelancer, orderId } = await loadFixture(activeOrderFixture);
      const m0 = await escrow.getMilestone(orderId, 0);
      await time.setNextBlockTimestamp(m0.deadline);
      await escrow.connect(freelancer).submitWork(orderId, 0, "bafkrei-desain");
      expect((await escrow.getMilestone(orderId, 0)).lateFee).to.equal(0);
    });
  });

  describe("BB-08 submitWork() 2 hari 3 jam setelah tenggat", function () {
    it("d = ceil(2,125) = 3 hari, denda = 0,5 x 15% = 0,075 ETH", async function () {
      const { escrow, freelancer, orderId, deadline2 } = await loadFixture(milestone2Fixture);
      await time.setNextBlockTimestamp(deadline2 + BigInt(2 * DAY + 3 * HOUR));
      await expect(escrow.connect(freelancer).submitWork(orderId, 1, "bafkrei-website"))
        .to.emit(escrow, "WorkSubmitted")
        .withArgs(orderId, 1n, "bafkrei-website", eth("0.075"), false);
      expect((await escrow.getMilestone(orderId, 1)).lateFee).to.equal(eth("0.075"));
    });

    it("calculateLateFee() memberi pratinjau yang sama sebelum dikirim, dan 1 detik terlambat = 1 hari", async function () {
      const { escrow, orderId, deadline2 } = await loadFixture(milestone2Fixture);
      expect(await escrow.calculateLateFee(orderId, 1)).to.equal(0);
      await time.increaseTo(deadline2 + 1n);
      expect(await escrow.calculateLateFee(orderId, 1)).to.equal(eth("0.025")); // 1 hari x 5%
      await time.increaseTo(deadline2 + BigInt(2 * DAY + 3 * HOUR));
      expect(await escrow.calculateLateFee(orderId, 1)).to.equal(eth("0.075"));
      expect(await escrow.calculateLateFee(orderId, 2)).to.equal(0); // milestone 3 belum dibuka
    });
  });

  describe("BB-09 submitWork() 11 hari setelah tenggat (klien belum klaim refund)", function () {
    it("denda dibatasi 50% = 0,25 ETH; setelah disetujui freelancer menerima 0,25 ETH", async function () {
      const { escrow, client, freelancer, orderId, deadline2 } = await loadFixture(milestone2Fixture);
      await time.setNextBlockTimestamp(deadline2 + BigInt(11 * DAY));
      await escrow.connect(freelancer).submitWork(orderId, 1, "bafkrei-website");
      expect((await escrow.getMilestone(orderId, 1)).lateFee).to.equal(eth("0.25"));
      await expect(escrow.connect(client).approveMilestone(orderId, 1)).to.changeEtherBalances(
        [freelancer, client, escrow],
        [eth("0.25"), eth("0.25"), -eth("0.5")],
      );
    });
  });

  describe("BB-10 approveMilestone() oleh klien", function () {
    it("freelancer menerima V - denda, klien menerima denda, status Paid, milestone berikutnya dibuka", async function () {
      const { escrow, client, freelancer, orderId, deadline2 } = await loadFixture(milestone2Fixture);
      await time.setNextBlockTimestamp(deadline2 + BigInt(2 * DAY + 3 * HOUR));
      await escrow.connect(freelancer).submitWork(orderId, 1, "bafkrei-website");
      const tx = escrow.connect(client).approveMilestone(orderId, 1);
      await expect(tx).to.changeEtherBalances([freelancer, client, escrow], [eth("0.425"), eth("0.075"), -eth("0.5")]);
      await expect(tx).to.emit(escrow, "MilestonePaid").withArgs(orderId, 1n, eth("0.425"), eth("0.075"), false);
      await expect(tx).to.emit(escrow, "MilestoneOpened").withArgs(orderId, 2n, anyValue);
      expect((await escrow.getMilestone(orderId, 1)).status).to.equal(MS.Paid);
      const o = await escrow.getOrder(orderId);
      expect(o.currentMilestone).to.equal(2);
      expect((await escrow.getMilestone(orderId, 2)).deadline).to.be.greaterThan(0);
    });

    it("milestone terakhir disetujui -> pesanan Completed dan saldo kontrak nol", async function () {
      const { escrow, client, freelancer, orderId } = await loadFixture(milestone2Fixture);
      await escrow.connect(freelancer).submitWork(orderId, 1, "bafkrei-website");
      await escrow.connect(client).approveMilestone(orderId, 1);
      await escrow.connect(freelancer).submitWork(orderId, 2, "bafkrei-online");
      await expect(escrow.connect(client).approveMilestone(orderId, 2))
        .to.emit(escrow, "OrderCompleted")
        .withArgs(orderId);
      expect((await escrow.getOrder(orderId)).status).to.equal(OrderStatus.Completed);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
    });

    it("tidak bisa disetujui oleh selain klien, sebelum dikirim, atau dua kali", async function () {
      const { escrow, client, freelancer, orderId } = await loadFixture(activeOrderFixture);
      await expect(escrow.connect(client).approveMilestone(orderId, 0)).to.be.revertedWith("Milestone belum dikirim");
      await escrow.connect(freelancer).submitWork(orderId, 0, "bafkrei-desain");
      await expect(escrow.connect(freelancer).approveMilestone(orderId, 0)).to.be.revertedWith("Hanya klien pesanan ini");
      await escrow.connect(client).approveMilestone(orderId, 0);
      await expect(escrow.connect(client).approveMilestone(orderId, 0)).to.be.revertedWith("Bukan milestone berjalan");
    });
  });

  describe("BB-11 requestRevision() ketika jumlah revisi sudah mencapai batas", function () {
    it("revisi ke-1 dan ke-2 diterima, revisi ke-3 ditolak (maxRevisions = 2)", async function () {
      const { escrow, client, freelancer, orderId } = await loadFixture(activeOrderFixture);
      await escrow.connect(freelancer).submitWork(orderId, 0, "bafkrei-v1");
      await expect(escrow.connect(client).requestRevision(orderId, 0, "bafkrei-catatan-1"))
        .to.emit(escrow, "RevisionRequested")
        .withArgs(orderId, 0n, "bafkrei-catatan-1", 1n);
      expect((await escrow.getMilestone(orderId, 0)).status).to.equal(MS.RevisionRequested);
      await expect(escrow.connect(freelancer).submitWork(orderId, 0, "bafkrei-v2"))
        .to.emit(escrow, "WorkSubmitted")
        .withArgs(orderId, 0n, "bafkrei-v2", 0n, true);
      await escrow.connect(client).requestRevision(orderId, 0, "bafkrei-catatan-2");
      await escrow.connect(freelancer).submitWork(orderId, 0, "bafkrei-v3");
      await expect(escrow.connect(client).requestRevision(orderId, 0, "bafkrei-catatan-3")).to.be.revertedWith(
        "Batas revisi tercapai",
      );
      expect((await escrow.getMilestone(orderId, 0)).revisionCount).to.equal(2);
    });

    it("revisi tidak menambah denda: denda tetap dari kiriman pertama", async function () {
      const { escrow, client, freelancer, orderId, deadline2 } = await loadFixture(milestone2Fixture);
      await time.setNextBlockTimestamp(deadline2 + BigInt(2 * DAY + 3 * HOUR));
      await escrow.connect(freelancer).submitWork(orderId, 1, "bafkrei-v1");
      await escrow.connect(client).requestRevision(orderId, 1, "bafkrei-catatan");
      await time.increase(5 * DAY); // kiriman ulang jauh lebih terlambat
      await escrow.connect(freelancer).submitWork(orderId, 1, "bafkrei-v2");
      const m = await escrow.getMilestone(orderId, 1);
      expect(m.lateFee).to.equal(eth("0.075"));
      expect(m.workCID).to.equal("bafkrei-v2");
      expect(m.lastSubmittedAt).to.be.greaterThan(m.firstSubmittedAt);
    });

    it("requestRevision() hanya oleh klien dan hanya saat Submitted", async function () {
      const { escrow, client, freelancer, orderId } = await loadFixture(activeOrderFixture);
      await expect(escrow.connect(client).requestRevision(orderId, 0, "x")).to.be.revertedWith("Milestone belum dikirim");
      await escrow.connect(freelancer).submitWork(orderId, 0, "bafkrei-v1");
      await expect(escrow.connect(freelancer).requestRevision(orderId, 0, "x")).to.be.revertedWith(
        "Hanya klien pesanan ini",
      );
    });
  });

  describe("BB-12 claimRefund() sebelum tenggat + batas akhir", function () {
    it("transaksi ditolak (sebelum tenggat, dan tepat pada tenggat + g)", async function () {
      const { escrow, client, orderId, deadline2 } = await loadFixture(milestone2Fixture);
      await expect(escrow.connect(client).claimRefund(orderId)).to.be.revertedWith(
        "Belum melewati tenggat + batas akhir",
      );
      await time.setNextBlockTimestamp(deadline2 + BigInt(GRACE));
      await expect(escrow.connect(client).claimRefund(orderId)).to.be.revertedWith(
        "Belum melewati tenggat + batas akhir",
      );
    });
  });

  describe("BB-13 claimRefund() setelah tenggat + batas akhir tanpa kiriman", function () {
    it("milestone berjalan dan sisanya (0,5 + 0,2 = 0,7 ETH) kembali; milestone Paid tidak berubah; pesanan Terminated", async function () {
      const { escrow, client, freelancer, orderId, deadline2 } = await loadFixture(milestone2Fixture);
      await time.setNextBlockTimestamp(deadline2 + BigInt(8 * DAY)); // hari ke-8 setelah tenggat
      const tx = escrow.connect(client).claimRefund(orderId);
      await expect(tx).to.changeEtherBalances([client, freelancer, escrow], [eth("0.7"), 0n, -eth("0.7")]);
      await expect(tx).to.emit(escrow, "RefundClaimed").withArgs(orderId, 1n, eth("0.7"));
      const ms = await escrow.getMilestones(orderId);
      expect(ms[0].status).to.equal(MS.Paid);
      expect(ms[1].status).to.equal(MS.Refunded);
      expect(ms[2].status).to.equal(MS.Refunded);
      expect((await escrow.getOrder(orderId)).status).to.equal(OrderStatus.Terminated);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
    });

    it("hanya klien yang dapat claimRefund(), dan setelah Terminated freelancer tidak bisa mengirim", async function () {
      const { escrow, client, freelancer, orderId, deadline2 } = await loadFixture(milestone2Fixture);
      await time.increaseTo(deadline2 + BigInt(8 * DAY));
      await expect(escrow.connect(freelancer).claimRefund(orderId)).to.be.revertedWith("Hanya klien pesanan ini");
      await escrow.connect(client).claimRefund(orderId);
      await expect(escrow.connect(freelancer).submitWork(orderId, 1, "bafkrei-late")).to.be.revertedWith(
        "Pesanan tidak aktif",
      );
      await expect(escrow.connect(client).claimRefund(orderId)).to.be.revertedWith("Pesanan tidak aktif");
    });

    it("claimRefund() tidak berlaku sebelum pesanan diterima (gunakan cancelOrder)", async function () {
      const { escrow, client, orderId } = await loadFixture(websiteOrderFixture);
      await expect(escrow.connect(client).claimRefund(orderId)).to.be.revertedWith("Pesanan tidak aktif");
    });
  });

  describe("BB-14 claimRefund() setelah hasil kerja dikirim", function () {
    it("transaksi ditolak (Submitted maupun RevisionRequested)", async function () {
      const { escrow, client, freelancer, orderId, deadline2 } = await loadFixture(milestone2Fixture);
      await time.setNextBlockTimestamp(deadline2 + BigInt(9 * DAY)); // dikirim setelah batas akhir
      await escrow.connect(freelancer).submitWork(orderId, 1, "bafkrei-website");
      await expect(escrow.connect(client).claimRefund(orderId)).to.be.revertedWith("Hasil kerja sudah dikirim");
      await escrow.connect(client).requestRevision(orderId, 1, "bafkrei-catatan");
      await time.increase(10 * DAY);
      await expect(escrow.connect(client).claimRefund(orderId)).to.be.revertedWith("Hasil kerja sudah dikirim");
    });
  });

  describe("BB-15 finalizeAfterReview() sebelum masa review berakhir", function () {
    it("transaksi ditolak (termasuk tepat pada batas 3 hari)", async function () {
      const { escrow, freelancer, orderId } = await loadFixture(activeOrderFixture);
      await escrow.connect(freelancer).submitWork(orderId, 0, "bafkrei-desain");
      const m = await escrow.getMilestone(orderId, 0);
      await expect(escrow.connect(freelancer).finalizeAfterReview(orderId, 0)).to.be.revertedWith(
        "Masa review belum berakhir",
      );
      await time.setNextBlockTimestamp(m.lastSubmittedAt + BigInt(3 * DAY));
      await expect(escrow.connect(freelancer).finalizeAfterReview(orderId, 0)).to.be.revertedWith(
        "Masa review belum berakhir",
      );
    });

    it("masa review dihitung ulang dari kiriman terakhir setelah revisi", async function () {
      const { escrow, client, freelancer, orderId } = await loadFixture(activeOrderFixture);
      await escrow.connect(freelancer).submitWork(orderId, 0, "bafkrei-v1");
      await time.increase(2 * DAY);
      await escrow.connect(client).requestRevision(orderId, 0, "bafkrei-catatan");
      await escrow.connect(freelancer).submitWork(orderId, 0, "bafkrei-v2");
      await time.increase(2 * DAY); // 4 hari sejak kiriman pertama, 2 hari sejak kiriman terakhir
      await expect(escrow.connect(freelancer).finalizeAfterReview(orderId, 0)).to.be.revertedWith(
        "Masa review belum berakhir",
      );
    });
  });

  describe("BB-16 finalizeAfterReview() setelah masa review tanpa tanggapan klien", function () {
    it("status Paid; pembayaran sama dengan approveMilestone()", async function () {
      const { escrow, client, freelancer, orderId, deadline2 } = await loadFixture(milestone2Fixture);
      await time.setNextBlockTimestamp(deadline2 + BigInt(2 * DAY + 3 * HOUR));
      await escrow.connect(freelancer).submitWork(orderId, 1, "bafkrei-website");
      await time.increase(3 * DAY + 1);
      const tx = escrow.connect(freelancer).finalizeAfterReview(orderId, 1);
      await expect(tx).to.changeEtherBalances([freelancer, client, escrow], [eth("0.425"), eth("0.075"), -eth("0.5")]);
      await expect(tx).to.emit(escrow, "MilestonePaid").withArgs(orderId, 1n, eth("0.425"), eth("0.075"), true);
      expect((await escrow.getMilestone(orderId, 1)).status).to.equal(MS.Paid);
      expect((await escrow.getOrder(orderId)).currentMilestone).to.equal(2);
    });

    it("hanya freelancer yang dapat memanggil finalizeAfterReview()", async function () {
      const { escrow, client, freelancer, orderId } = await loadFixture(activeOrderFixture);
      await escrow.connect(freelancer).submitWork(orderId, 0, "bafkrei-desain");
      await time.increase(3 * DAY + 1);
      await expect(escrow.connect(client).finalizeAfterReview(orderId, 0)).to.be.revertedWith(
        "Hanya freelancer pesanan ini",
      );
    });
  });

  describe("BB-17 rejectMilestone() oleh klien", function () {
    it("status Disputed; tidak ada refund otomatis; CID alasan tercatat sebagai bukti klien", async function () {
      const { escrow, client, freelancer, orderId } = await loadFixture(milestone2Fixture);
      await escrow.connect(freelancer).submitWork(orderId, 1, "bafkrei-website");
      const tx = escrow.connect(client).rejectMilestone(orderId, 1, "bafkrei-alasan");
      await expect(tx).to.emit(escrow, "MilestoneDisputed").withArgs(orderId, 1n, "bafkrei-alasan");
      await expect(tx).to.changeEtherBalances([client, freelancer, escrow], [0n, 0n, 0n]);
      const m = await escrow.getMilestone(orderId, 1);
      expect(m.status).to.equal(MS.Disputed);
      expect(m.clientEvidenceCID).to.equal("bafkrei-alasan");
      expect(m.disputeStartedAt).to.be.greaterThan(0);
      // selama sengketa, approve/revisi/finalize tidak berlaku
      await expect(escrow.connect(client).approveMilestone(orderId, 1)).to.be.revertedWith("Milestone belum dikirim");
      await time.increase(4 * DAY);
      await expect(escrow.connect(freelancer).finalizeAfterReview(orderId, 1)).to.be.revertedWith(
        "Milestone belum dikirim",
      );
    });

    it("dari RevisionRequested hanya boleh setelah jendela revisi (3 hari) habis", async function () {
      const { escrow, client, freelancer, orderId } = await loadFixture(activeOrderFixture);
      await escrow.connect(freelancer).submitWork(orderId, 0, "bafkrei-v1");
      await escrow.connect(client).requestRevision(orderId, 0, "bafkrei-catatan");
      const m = await escrow.getMilestone(orderId, 0);
      await expect(escrow.connect(client).rejectMilestone(orderId, 0, "bafkrei-alasan")).to.be.revertedWith(
        "Jendela revisi belum habis",
      );
      await time.setNextBlockTimestamp(m.revisionRequestedAt + BigInt(3 * DAY + 1));
      await expect(escrow.connect(client).rejectMilestone(orderId, 0, "bafkrei-alasan")).to.emit(
        escrow,
        "MilestoneDisputed",
      );
    });

    it("tidak bisa menolak milestone yang belum dikirim, dan hanya klien", async function () {
      const { escrow, client, freelancer, orderId } = await loadFixture(activeOrderFixture);
      await expect(escrow.connect(client).rejectMilestone(orderId, 0, "bafkrei-alasan")).to.be.revertedWith(
        "Milestone belum dikirim",
      );
      await escrow.connect(freelancer).submitWork(orderId, 0, "bafkrei-v1");
      await expect(escrow.connect(freelancer).rejectMilestone(orderId, 0, "bafkrei-alasan")).to.be.revertedWith(
        "Hanya klien pesanan ini",
      );
    });

    it("kedua pihak dapat mengunggah bukti (submitEvidence), pihak lain ditolak", async function () {
      const { escrow, client, freelancer, stranger, arbiter, orderId } = await loadFixture(disputedFixture);
      await expect(escrow.connect(freelancer).submitEvidence(orderId, 1, "bafkrei-bukti-freelancer"))
        .to.emit(escrow, "EvidenceSubmitted")
        .withArgs(orderId, 1n, freelancer.address, "bafkrei-bukti-freelancer");
      await escrow.connect(client).submitEvidence(orderId, 1, "bafkrei-bukti-klien");
      const m = await escrow.getMilestone(orderId, 1);
      expect(m.freelancerEvidenceCID).to.equal("bafkrei-bukti-freelancer");
      expect(m.clientEvidenceCID).to.equal("bafkrei-bukti-klien");
      await expect(escrow.connect(stranger).submitEvidence(orderId, 1, "x")).to.be.revertedWith(
        "Hanya klien/freelancer pesanan ini",
      );
      await expect(escrow.connect(arbiter).submitEvidence(orderId, 1, "x")).to.be.revertedWith(
        "Hanya klien/freelancer pesanan ini",
      );
    });
  });

  describe("BB-18 Alamat selain arbiter memanggil resolveDispute()", function () {
    it("transaksi ditolak (klien, freelancer, deployer, orang lain)", async function () {
      const { escrow, client, freelancer, deployer, stranger, orderId } = await loadFixture(disputedFixture);
      for (const s of [client, freelancer, deployer, stranger]) {
        await expect(escrow.connect(s).resolveDispute(orderId, 1, 70, "bafkrei-alasan")).to.be.revertedWith(
          "Hanya arbiter",
        );
      }
    });
  });

  describe("BB-19 resolveDispute() dengan persenKlien > 100", function () {
    it("transaksi ditolak", async function () {
      const { escrow, arbiter, orderId } = await loadFixture(disputedFixture);
      await expect(escrow.connect(arbiter).resolveDispute(orderId, 1, 101, "bafkrei-alasan")).to.be.revertedWith(
        "Persentase klien maksimal 100",
      );
    });
    it("resolveDispute() juga ditolak tanpa CID alasan atau jika milestone tidak bersengketa", async function () {
      const { escrow, arbiter, freelancer, orderId } = await loadFixture(milestone2Fixture);
      await escrow.connect(freelancer).submitWork(orderId, 1, "bafkrei-website");
      await expect(escrow.connect(arbiter).resolveDispute(orderId, 1, 50, "bafkrei-alasan")).to.be.revertedWith(
        "Milestone tidak dalam sengketa",
      );
      const d = await loadFixture(disputedFixture);
      await expect(d.escrow.connect(d.arbiter).resolveDispute(d.orderId, 1, 50, "")).to.be.revertedWith(
        "CID alasan wajib diisi",
      );
    });
  });

  describe("BB-20 resolveDispute() dengan persenKlien = 70", function () {
    it("klien: denda + 70% sisa; freelancer: 30% sisa; arbiter: 0; CID alasan tercatat; status Resolved", async function () {
      // milestone 2 terlambat 2 hari 3 jam -> denda 0,075; sisa 0,425
      // klien = 0,075 + 0,7 x 0,425 = 0,3725 ; freelancer = 0,3 x 0,425 = 0,1275
      const { escrow, client, freelancer, arbiter, orderId } = await loadFixture(lateDisputedFixture);
      const tx = escrow.connect(arbiter).resolveDispute(orderId, 1, 70, "bafkrei-alasan-arbiter");
      await expect(tx).to.changeEtherBalances(
        [client, freelancer, arbiter, escrow],
        [eth("0.3725"), eth("0.1275"), 0n, -eth("0.5")],
      );
      await expect(tx)
        .to.emit(escrow, "DisputeResolved")
        .withArgs(orderId, 1n, 70n, eth("0.3725"), eth("0.1275"), "bafkrei-alasan-arbiter", false);
      const m = await escrow.getMilestone(orderId, 1);
      expect(m.status).to.equal(MS.Resolved);
      expect(m.resolutionCID).to.equal("bafkrei-alasan-arbiter");
      expect((await escrow.getOrder(orderId)).currentMilestone).to.equal(2); // lanjut ke milestone berikutnya
    });

    it("tanpa denda: persen 0 dan 100 membagi seluruh nilai", async function () {
      const { escrow, client, freelancer, arbiter, orderId } = await loadFixture(disputedFixture);
      await expect(escrow.connect(arbiter).resolveDispute(orderId, 1, 100, "bafkrei-alasan")).to.changeEtherBalances(
        [client, freelancer],
        [eth("0.5"), 0n],
      );
    });

    it("resolveDispute() tetap sah tepat pada hari ke-7, ditolak setelahnya", async function () {
      const { escrow, arbiter, orderId, disputeStartedAt } = await loadFixture(disputedFixture);
      await time.setNextBlockTimestamp(disputeStartedAt + BigInt(7 * DAY + 1));
      await expect(escrow.connect(arbiter).resolveDispute(orderId, 1, 70, "bafkrei-alasan")).to.be.revertedWith(
        "Tenggat arbiter sudah lewat",
      );
    });

    it("sengketa pada milestone terakhir -> pesanan Completed", async function () {
      const { escrow, client, freelancer, arbiter, orderId } = await loadFixture(milestone2Fixture);
      await escrow.connect(freelancer).submitWork(orderId, 1, "bafkrei-website");
      await escrow.connect(client).approveMilestone(orderId, 1);
      await escrow.connect(freelancer).submitWork(orderId, 2, "bafkrei-online");
      await escrow.connect(client).rejectMilestone(orderId, 2, "bafkrei-alasan");
      await expect(escrow.connect(arbiter).resolveDispute(orderId, 2, 40, "bafkrei-keputusan")).to.emit(
        escrow,
        "OrderCompleted",
      );
      expect((await escrow.getOrder(orderId)).status).to.equal(OrderStatus.Completed);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
    });
  });

  describe("BB-21 settleDisputeTimeout() sebelum 7 hari sejak sengketa", function () {
    it("transaksi ditolak (termasuk tepat 7 hari)", async function () {
      const { escrow, client, orderId, disputeStartedAt } = await loadFixture(disputedFixture);
      await expect(escrow.connect(client).settleDisputeTimeout(orderId, 1)).to.be.revertedWith(
        "Tenggat arbiter belum lewat",
      );
      await time.setNextBlockTimestamp(disputeStartedAt + BigInt(7 * DAY));
      await expect(escrow.connect(client).settleDisputeTimeout(orderId, 1)).to.be.revertedWith(
        "Tenggat arbiter belum lewat",
      );
    });
  });

  describe("BB-22 settleDisputeTimeout() setelah 7 hari tanpa keputusan", function () {
    it("sisa dana dibagi 50:50 (denda tetap ke klien); status Resolved", async function () {
      // denda 0,075; sisa 0,425 -> masing-masing 0,2125; klien total 0,2875
      const { escrow, client, freelancer, arbiter, orderId, disputeStartedAt } = await loadFixture(lateDisputedFixture);
      await time.setNextBlockTimestamp(disputeStartedAt + BigInt(7 * DAY + 1));
      const tx = escrow.connect(freelancer).settleDisputeTimeout(orderId, 1);
      await expect(tx).to.changeEtherBalances(
        [client, freelancer, arbiter, escrow],
        [eth("0.2875"), eth("0.2125"), 0n, -eth("0.5")],
      );
      await expect(tx)
        .to.emit(escrow, "DisputeResolved")
        .withArgs(orderId, 1n, 50n, eth("0.2875"), eth("0.2125"), "", true);
      expect((await escrow.getMilestone(orderId, 1)).status).to.equal(MS.Resolved);
    });

    it("klien juga dapat memicu; pihak lain (termasuk arbiter) ditolak", async function () {
      const { escrow, client, stranger, arbiter, orderId } = await loadFixture(disputedFixture);
      await time.increase(7 * DAY + 1);
      await expect(escrow.connect(stranger).settleDisputeTimeout(orderId, 1)).to.be.revertedWith(
        "Hanya klien/freelancer pesanan ini",
      );
      await expect(escrow.connect(arbiter).settleDisputeTimeout(orderId, 1)).to.be.revertedWith(
        "Hanya klien/freelancer pesanan ini",
      );
      await expect(escrow.connect(client).settleDisputeTimeout(orderId, 1)).to.changeEtherBalances(
        [client],
        [eth("0.25")],
      );
    });
  });

  // BB-23 (dompet di jaringan selain Sepolia) adalah perilaku website, bukan kontrak.
  // Diuji di frontend: frontend/src/lib/validation.test.ts (fungsi isCorrectNetwork) dan uji UI Playwright.

  describe("BB-24 Dompet arbiter, klien, dan freelancer masuk ke website", function () {
    it("data peran tersedia dari kontrak: arbiter() dan event OrderCreated (indexed client/freelancer)", async function () {
      const { escrow, client, freelancer, arbiter, stranger } = await loadFixture(websiteOrderFixture);
      expect(await escrow.arbiter()).to.equal(arbiter.address);
      const asClient = await escrow.queryFilter(escrow.filters.OrderCreated(undefined, client.address));
      const asFreelancer = await escrow.queryFilter(escrow.filters.OrderCreated(undefined, undefined, freelancer.address));
      const strangerOrders = await escrow.queryFilter(escrow.filters.OrderCreated(undefined, stranger.address));
      expect(asClient.length).to.equal(1);
      expect(asFreelancer.length).to.equal(1);
      expect(strangerOrders.length).to.equal(0);
      // penentuan dashboard di website diuji di frontend/src/lib/validation.test.ts
    });
  });

  describe("BB-25 Upaya mengubah CID brief setelah pesanan dibuat", function () {
    it("tidak ada fungsi pengubah brief; CID brief tetap sampai pesanan selesai", async function () {
      const { escrow, client, freelancer, orderId } = await loadFixture(activeOrderFixture);
      const mutating = escrow.interface.fragments
        .filter((f) => f.type === "function")
        .map((f) => f as any)
        .filter((f) => f.stateMutability !== "view" && f.stateMutability !== "pure")
        .map((f) => f.name)
        .sort();
      expect(mutating).to.deep.equal(
        [
          "acceptOrder",
          "approveMilestone",
          "cancelOrder",
          "claimRefund",
          "createOrder",
          "finalizeAfterReview",
          "rejectMilestone",
          "requestRevision",
          "resolveDispute",
          "settleDisputeTimeout",
          "submitEvidence",
          "submitWork",
        ].sort(),
      );
      // jalankan seluruh pesanan, brief tetap sama
      for (let i = 0; i < 3; i++) {
        await escrow.connect(freelancer).submitWork(orderId, i, `bafkrei-hasil-${i}`);
        await escrow.connect(client).approveMilestone(orderId, i);
      }
      expect((await escrow.getOrder(orderId)).briefCID).to.equal(BRIEF);
    });
  });

  describe("Keamanan", function () {
    it("tidak ada fungsi penarikan dana oleh admin/deployer (withdraw, owner, dll.)", async function () {
      const { escrow } = await loadFixture(deployFixture);
      const names = escrow.interface.fragments.filter((f) => f.type === "function").map((f: any) => f.name);
      for (const forbidden of ["withdraw", "owner", "transferOwnership", "emergencyWithdraw", "setArbiter", "setBrief"]) {
        expect(names).to.not.include(forbidden);
      }
    });

    it("kontrak menolak ETH yang dikirim langsung (tanpa createOrder)", async function () {
      const { escrow, stranger } = await loadFixture(deployFixture);
      await expect(stranger.sendTransaction({ to: await escrow.getAddress(), value: eth("1") })).to.be.reverted;
    });

    it("re-entrancy: freelancer jahat tidak bisa mencairkan milestone dua kali", async function () {
      const { escrow, client } = await loadFixture(deployFixture);
      const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
      const attacker = await Attacker.deploy(await escrow.getAddress());
      await escrow
        .connect(client)
        .createOrder(await attacker.getAddress(), BRIEF, [eth("0.5"), eth("0.5")], [DAY, DAY], RATE_BPS, CAP_BPS, 0, GRACE, {
          value: eth("1"),
        });
      await attacker.accept(1);
      await attacker.submit(1, 0);
      await time.increase(3 * DAY + 1);
      await attacker.attack(1, 0);
      expect(await attacker.reentryAttempts()).to.equal(1);
      expect(await attacker.reentrySucceeded()).to.equal(false);
      expect(await ethers.provider.getBalance(await attacker.getAddress())).to.equal(eth("0.5"));
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(eth("0.5"));
    });

    it("dana beberapa pesanan terpisah: saldo kontrak = jumlah dana yang belum cair", async function () {
      const { escrow, client, freelancer, stranger } = await loadFixture(deployFixture);
      await escrow
        .connect(client)
        .createOrder(freelancer.address, BRIEF, [eth("1")], [DAY], RATE_BPS, CAP_BPS, 0, GRACE, { value: eth("1") });
      await escrow
        .connect(stranger)
        .createOrder(freelancer.address, BRIEF, [eth("2")], [DAY], RATE_BPS, CAP_BPS, 0, GRACE, { value: eth("2") });
      await escrow.connect(client).cancelOrder(1);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(eth("2"));
      await expect(escrow.connect(client).cancelOrder(2)).to.be.revertedWith("Hanya klien pesanan ini");
    });

    it("pesanan yang tidak ada ditolak", async function () {
      const { escrow, client } = await loadFixture(deployFixture);
      await expect(escrow.connect(client).cancelOrder(99)).to.be.revertedWith("Pesanan tidak ditemukan");
      await expect(escrow.getOrder(0)).to.be.revertedWith("Pesanan tidak ditemukan");
    });
  });

  describe("Mode DEMO (periode singkat untuk presentasi)", function () {
    it("1 hari = 60 detik: terlambat 2 menit 30 detik = 3 hari denda, review 3 menit, arbiter 7 menit", async function () {
      const [, client, freelancer, arbiter] = await ethers.getSigners();
      const Escrow = await ethers.getContractFactory("FreelanceEscrow");
      const demo = await Escrow.deploy(arbiter.address, 60, 180, 180, 420);
      await demo
        .connect(client)
        .createOrder(freelancer.address, BRIEF, [eth("0.5")], [120], RATE_BPS, CAP_BPS, 1, 420, { value: eth("0.5") });
      await demo.connect(freelancer).acceptOrder(1);
      const m = await demo.getMilestone(1, 0);
      await time.setNextBlockTimestamp(m.deadline + 150n);
      await demo.connect(freelancer).submitWork(1, 0, "bafkrei-demo");
      expect((await demo.getMilestone(1, 0)).lateFee).to.equal(eth("0.075"));
      await time.increase(181);
      await expect(demo.connect(freelancer).finalizeAfterReview(1, 0)).to.changeEtherBalances(
        [freelancer, client],
        [eth("0.425"), eth("0.075")],
      );
    });
  });

  describe("Skenario end-to-end studi kasus website (subbab 3.4.7)", function () {
    it("M1 tepat waktu (0,3), M2 terlambat 2 hari 3 jam (0,425 + denda 0,075), M3 tepat waktu (0,2)", async function () {
      const { escrow, client, freelancer, orderId } = await loadFixture(activeOrderFixture);
      const fBefore = await ethers.provider.getBalance(freelancer.address);
      await escrow.connect(freelancer).submitWork(orderId, 0, "bafkrei-desain");
      await escrow.connect(client).approveMilestone(orderId, 0);
      const m2 = await escrow.getMilestone(orderId, 1);
      await time.setNextBlockTimestamp(m2.deadline + BigInt(2 * DAY + 3 * HOUR));
      await escrow.connect(freelancer).submitWork(orderId, 1, "bafkrei-website");
      await escrow.connect(client).approveMilestone(orderId, 1);
      await escrow.connect(freelancer).submitWork(orderId, 2, "bafkrei-online");
      await escrow.connect(client).approveMilestone(orderId, 2);
      const events = await escrow.queryFilter(escrow.filters.MilestonePaid(orderId));
      const toFreelancer = events.reduce((s, e) => s + e.args.freelancerAmount, 0n);
      const toClient = events.reduce((s, e) => s + e.args.clientAmount, 0n);
      expect(toFreelancer).to.equal(eth("0.925"));
      expect(toClient).to.equal(eth("0.075"));
      expect(await ethers.provider.getBalance(freelancer.address)).to.be.greaterThan(fBefore + eth("0.92"));
      expect((await escrow.getOrder(orderId)).status).to.equal(OrderStatus.Completed);
    });
  });
});
