// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title  FreelanceEscrow
 * @notice Sistem pembayaran jasa freelance berbasis smart contract Ethereum dengan
 *         mekanisme escrow per milestone dan denda keterlambatan otomatis.
 *
 *         Rancangan mengikuti Bab III proposal skripsi:
 *         - Gambar 3.6 (state machine pesanan)   : Funded -> Active -> Completed / Cancelled / Terminated
 *         - Gambar 3.7 (state machine milestone) : Pending -> Submitted -> Paid / RevisionRequested / Disputed -> Resolved, Pending -> Refunded
 *         - Gambar 3.9 (diagram class)           : struct Order, struct Milestone, enum OrderStatus, enum MilestoneStatus
 *         - Subbab 3.4.7 (formula denda)         : denda = V * min(ceil(hari terlambat) * r, c)
 *
 *         Catatan keamanan:
 *         - Dana hanya bisa keluar lewat fungsi di bawah ini. TIDAK ADA fungsi penarikan oleh admin/deployer.
 *         - Arbiter ditetapkan sekali saat deploy (immutable) dan tidak pernah menerima dana.
 *         - Semua fungsi yang mengirim ETH memakai nonReentrant dan pola checks-effects-interactions.
 */
contract FreelanceEscrow is ReentrancyGuard {
    // ------------------------------------------------------------------
    // Enum dan struct (Gambar 3.9)
    // ------------------------------------------------------------------

    enum OrderStatus {
        Funded,     // 0: dana terkunci, menunggu freelancer menerima
        Active,     // 1: milestone sedang dikerjakan
        Completed,  // 2: semua milestone Paid/Resolved
        Cancelled,  // 3: dibatalkan klien sebelum diterima
        Terminated  // 4: dihentikan karena claimRefund()
    }

    enum MilestoneStatus {
        Pending,           // 0: menunggu kiriman (atau belum dibuka jika deadline = 0)
        Submitted,         // 1: hasil kerja dikirim, menunggu keputusan klien
        RevisionRequested, // 2: klien meminta revisi
        Disputed,          // 3: sengketa, menunggu arbiter
        Paid,              // 4: dibayar (disetujui / masa review habis)
        Resolved,          // 5: sengketa diputus arbiter atau kedaluwarsa (50:50)
        Refunded           // 6: dana dikembalikan ke klien (claimRefund)
    }

    struct Order {
        address client;
        address freelancer;
        string briefCID;
        uint256 totalAmount;
        uint16 dailyRateBps; // tarif denda harian, basis poin (1% = 100 bps)
        uint16 capBps;       // batas maksimum denda, basis poin (<= 10.000)
        uint8 maxRevisions;  // batas jumlah revisi per milestone
        uint32 gracePeriod;  // batas akhir pengiriman setelah tenggat (detik)
        uint8 currentMilestone;
        OrderStatus status;
    }

    struct Milestone {
        uint256 amount;            // V, nilai milestone (wei)
        uint32 duration;           // durasi pengerjaan (detik) sejak milestone dibuka
        uint64 deadline;           // t_tenggat = t_buka + durasi (0 = belum dibuka)
        uint64 firstSubmittedAt;   // t_kirim pertama (dasar perhitungan denda)
        uint64 lastSubmittedAt;    // kiriman terakhir (dasar masa review)
        string workCID;            // CID hasil kerja terakhir
        uint8 revisionCount;
        uint256 lateFee;           // denda yang ditetapkan pada kiriman pertama
        uint64 disputeStartedAt;
        string clientEvidenceCID;
        string freelancerEvidenceCID;
        string resolutionCID;      // CID alasan keputusan arbiter
        uint64 revisionRequestedAt; // tambahan implementasi: awal jendela revisi
        MilestoneStatus status;
    }

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------

    /// @notice Alamat arbiter (admin platform). Ditetapkan sekali saat deploy.
    address public immutable arbiter;

    /// @notice Panjang satu "hari" dalam detik untuk perhitungan denda (86.400 pada mode skripsi).
    uint256 public immutable DAY_LENGTH;
    /// @notice Masa review klien setelah kiriman terakhir (skripsi: 3 hari).
    uint256 public immutable REVIEW_PERIOD;
    /// @notice Jendela revisi setelah revisi diminta (skripsi: 3 hari).
    uint256 public immutable REVISION_WINDOW;
    /// @notice Tenggat keputusan arbiter sejak sengketa dimulai (skripsi: 7 hari).
    uint256 public immutable DISPUTE_TIMEOUT;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_MILESTONES = 20;

    uint256 public orderCount;
    mapping(uint256 => Order) private orders;
    mapping(uint256 => Milestone[]) private milestones;

    // ------------------------------------------------------------------
    // Event (orderId selalu parameter indexed pertama agar riwayat mudah difilter)
    // ------------------------------------------------------------------

    event OrderCreated(
        uint256 indexed orderId,
        address indexed client,
        address indexed freelancer,
        uint256 totalAmount,
        uint256 milestoneCount,
        string briefCID
    );
    event OrderCancelled(uint256 indexed orderId, uint256 refundAmount);
    event OrderAccepted(uint256 indexed orderId, address indexed freelancer);
    event MilestoneOpened(uint256 indexed orderId, uint256 indexed milestoneId, uint256 deadline);
    event WorkSubmitted(
        uint256 indexed orderId,
        uint256 indexed milestoneId,
        string workCID,
        uint256 lateFee,
        bool isRevision
    );
    event RevisionRequested(uint256 indexed orderId, uint256 indexed milestoneId, string noteCID, uint256 revisionCount);
    event MilestonePaid(
        uint256 indexed orderId,
        uint256 indexed milestoneId,
        uint256 freelancerAmount,
        uint256 clientAmount,
        bool byReviewTimeout
    );
    event MilestoneDisputed(uint256 indexed orderId, uint256 indexed milestoneId, string reasonCID);
    event EvidenceSubmitted(uint256 indexed orderId, uint256 indexed milestoneId, address indexed by, string evidenceCID);
    event DisputeResolved(
        uint256 indexed orderId,
        uint256 indexed milestoneId,
        uint256 clientPercent,
        uint256 clientAmount,
        uint256 freelancerAmount,
        string reasonCID,
        bool byTimeout
    );
    event RefundClaimed(uint256 indexed orderId, uint256 indexed fromMilestoneId, uint256 refundAmount);
    event OrderCompleted(uint256 indexed orderId);

    // ------------------------------------------------------------------
    // Modifier per peran
    // ------------------------------------------------------------------

    modifier orderExists(uint256 orderId) {
        require(orderId > 0 && orderId <= orderCount, "Pesanan tidak ditemukan");
        _;
    }

    modifier onlyClient(uint256 orderId) {
        require(msg.sender == orders[orderId].client, "Hanya klien pesanan ini");
        _;
    }

    modifier onlyFreelancer(uint256 orderId) {
        require(msg.sender == orders[orderId].freelancer, "Hanya freelancer pesanan ini");
        _;
    }

    modifier onlyArbiter() {
        require(msg.sender == arbiter, "Hanya arbiter");
        _;
    }

    // ------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------

    /**
     * @param _arbiter         alamat arbiter (admin platform)
     * @param _dayLength       panjang 1 hari dalam detik (skripsi: 86400; demo: mis. 60)
     * @param _reviewPeriod    masa review dalam detik (skripsi: 3 hari)
     * @param _revisionWindow  jendela revisi dalam detik (skripsi: 3 hari)
     * @param _disputeTimeout  tenggat arbiter dalam detik (skripsi: 7 hari)
     */
    constructor(
        address _arbiter,
        uint256 _dayLength,
        uint256 _reviewPeriod,
        uint256 _revisionWindow,
        uint256 _disputeTimeout
    ) {
        require(_arbiter != address(0), "Arbiter tidak valid");
        require(_dayLength > 0 && _reviewPeriod > 0 && _revisionWindow > 0 && _disputeTimeout > 0, "Periode tidak valid");
        arbiter = _arbiter;
        DAY_LENGTH = _dayLength;
        REVIEW_PERIOD = _reviewPeriod;
        REVISION_WINDOW = _revisionWindow;
        DISPUTE_TIMEOUT = _disputeTimeout;
    }

    // ------------------------------------------------------------------
    // Pesanan
    // ------------------------------------------------------------------

    /**
     * @notice Klien membuat pesanan dan menyetor seluruh nilai milestone sekaligus (escrow).
     * @param freelancer   alamat dompet freelancer yang telah disepakati
     * @param briefCID     CID brief di IPFS (tidak dapat diubah setelahnya)
     * @param amounts      nilai setiap milestone (wei)
     * @param durations    durasi setiap milestone (detik), dihitung sejak milestone dibuka
     * @param dailyRateBps tarif denda per hari (bps)
     * @param capBps       batas maksimum denda (bps, <= 10.000)
     * @param maxRevisions batas jumlah revisi per milestone
     * @param gracePeriod  batas akhir pengiriman setelah tenggat (detik) sebelum klien boleh claimRefund()
     */
    function createOrder(
        address freelancer,
        string calldata briefCID,
        uint256[] calldata amounts,
        uint32[] calldata durations,
        uint16 dailyRateBps,
        uint16 capBps,
        uint8 maxRevisions,
        uint32 gracePeriod
    ) external payable returns (uint256 orderId) {
        require(freelancer != address(0), "Alamat freelancer tidak valid");
        require(freelancer != msg.sender, "Freelancer tidak boleh sama dengan klien");
        require(msg.sender != arbiter && freelancer != arbiter, "Arbiter tidak boleh menjadi klien/freelancer");
        require(bytes(briefCID).length > 0, "CID brief wajib diisi");
        require(amounts.length > 0 && amounts.length <= MAX_MILESTONES, "Jumlah milestone tidak valid");
        require(amounts.length == durations.length, "Panjang nilai dan durasi berbeda");
        require(capBps <= BPS_DENOMINATOR, "Batas denda maksimal 10000 bps");
        require(dailyRateBps <= BPS_DENOMINATOR, "Tarif denda maksimal 10000 bps");

        orderId = ++orderCount;
        uint256 total = _pushMilestones(orderId, amounts, durations);
        require(msg.value == total, "Nilai ETH harus sama dengan total milestone");

        Order storage o = orders[orderId];
        o.client = msg.sender;
        o.freelancer = freelancer;
        o.briefCID = briefCID;
        o.totalAmount = total;
        o.dailyRateBps = dailyRateBps;
        o.capBps = capBps;
        o.maxRevisions = maxRevisions;
        o.gracePeriod = gracePeriod;
        o.currentMilestone = 0;
        o.status = OrderStatus.Funded;

        _emitOrderCreated(orderId);
    }

    function _pushMilestones(uint256 orderId, uint256[] calldata amounts, uint32[] calldata durations)
        internal
        returns (uint256 total)
    {
        Milestone[] storage ms = milestones[orderId];
        for (uint256 i = 0; i < amounts.length; i++) {
            require(amounts[i] > 0, "Nilai milestone harus > 0");
            require(durations[i] > 0, "Durasi milestone harus > 0");
            total += amounts[i];
            Milestone storage m = ms.push();
            m.amount = amounts[i];
            m.duration = durations[i];
            m.status = MilestoneStatus.Pending;
        }
    }

    function _emitOrderCreated(uint256 orderId) internal {
        Order storage o = orders[orderId];
        emit OrderCreated(orderId, o.client, o.freelancer, o.totalAmount, milestones[orderId].length, o.briefCID);
    }

    /// @notice Klien membatalkan pesanan sebelum diterima freelancer; seluruh dana kembali.
    function cancelOrder(uint256 orderId) external nonReentrant orderExists(orderId) onlyClient(orderId) {
        Order storage o = orders[orderId];
        require(o.status == OrderStatus.Funded, "Pesanan sudah diterima/tidak aktif");

        // effects
        o.status = OrderStatus.Cancelled;
        uint256 refund = o.totalAmount;
        emit OrderCancelled(orderId, refund);

        // interaction
        _send(o.client, refund);
    }

    /// @notice Freelancer menerima pesanan; milestone pertama dibuka dan tenggatnya mulai dihitung.
    function acceptOrder(uint256 orderId) external orderExists(orderId) onlyFreelancer(orderId) {
        Order storage o = orders[orderId];
        require(o.status == OrderStatus.Funded, "Pesanan tidak menunggu persetujuan");
        o.status = OrderStatus.Active;
        emit OrderAccepted(orderId, msg.sender);
        _openMilestone(orderId, 0);
    }

    // ------------------------------------------------------------------
    // Milestone
    // ------------------------------------------------------------------

    /// @notice Freelancer mengirim CID hasil kerja. Denda ditetapkan pada kiriman pertama.
    function submitWork(uint256 orderId, uint256 milestoneId, string calldata workCID)
        external
        orderExists(orderId)
        onlyFreelancer(orderId)
    {
        Milestone storage m = _currentMilestone(orderId, milestoneId);
        require(bytes(workCID).length > 0, "CID hasil kerja wajib diisi");
        require(
            m.status == MilestoneStatus.Pending || m.status == MilestoneStatus.RevisionRequested,
            "Milestone tidak menunggu kiriman"
        );

        bool isRevision = m.status == MilestoneStatus.RevisionRequested;
        if (!isRevision) {
            // kiriman pertama: catat waktu dan tetapkan denda (revisi tidak menambah denda)
            m.firstSubmittedAt = uint64(block.timestamp);
            m.lateFee = _lateFeeAt(orderId, m, block.timestamp);
        }
        m.lastSubmittedAt = uint64(block.timestamp);
        m.workCID = workCID;
        m.status = MilestoneStatus.Submitted;

        emit WorkSubmitted(orderId, milestoneId, workCID, m.lateFee, isRevision);
    }

    /// @notice Klien menyetujui hasil kerja: (V - denda) ke freelancer, denda ke klien.
    function approveMilestone(uint256 orderId, uint256 milestoneId)
        external
        nonReentrant
        orderExists(orderId)
        onlyClient(orderId)
    {
        Milestone storage m = _currentMilestone(orderId, milestoneId);
        require(m.status == MilestoneStatus.Submitted, "Milestone belum dikirim");
        _payMilestone(orderId, milestoneId, false);
    }

    /// @notice Klien meminta revisi (selama jumlah revisi belum mencapai batas).
    function requestRevision(uint256 orderId, uint256 milestoneId, string calldata noteCID)
        external
        orderExists(orderId)
        onlyClient(orderId)
    {
        Order storage o = orders[orderId];
        Milestone storage m = _currentMilestone(orderId, milestoneId);
        require(m.status == MilestoneStatus.Submitted, "Milestone belum dikirim");
        require(m.revisionCount < o.maxRevisions, "Batas revisi tercapai");

        m.revisionCount += 1;
        m.revisionRequestedAt = uint64(block.timestamp);
        m.status = MilestoneStatus.RevisionRequested;

        emit RevisionRequested(orderId, milestoneId, noteCID, m.revisionCount);
    }

    /**
     * @notice Klien menolak hasil kerja -> status Disputed (tidak ada refund otomatis).
     *         Dari RevisionRequested hanya boleh jika jendela revisi sudah habis.
     */
    function rejectMilestone(uint256 orderId, uint256 milestoneId, string calldata reasonCID)
        external
        orderExists(orderId)
        onlyClient(orderId)
    {
        Milestone storage m = _currentMilestone(orderId, milestoneId);
        require(bytes(reasonCID).length > 0, "CID alasan wajib diisi");
        if (m.status == MilestoneStatus.RevisionRequested) {
            require(
                block.timestamp > uint256(m.revisionRequestedAt) + REVISION_WINDOW,
                "Jendela revisi belum habis"
            );
        } else {
            require(m.status == MilestoneStatus.Submitted, "Milestone belum dikirim");
        }

        m.status = MilestoneStatus.Disputed;
        m.disputeStartedAt = uint64(block.timestamp);
        m.clientEvidenceCID = reasonCID;

        emit MilestoneDisputed(orderId, milestoneId, reasonCID);
    }

    /// @notice Freelancer mencairkan pembayaran jika klien tidak menanggapi selama masa review.
    function finalizeAfterReview(uint256 orderId, uint256 milestoneId)
        external
        nonReentrant
        orderExists(orderId)
        onlyFreelancer(orderId)
    {
        Milestone storage m = _currentMilestone(orderId, milestoneId);
        require(m.status == MilestoneStatus.Submitted, "Milestone belum dikirim");
        require(block.timestamp > uint256(m.lastSubmittedAt) + REVIEW_PERIOD, "Masa review belum berakhir");
        _payMilestone(orderId, milestoneId, true);
    }

    /**
     * @notice Klien menarik kembali dana milestone berjalan yang TIDAK PERNAH dikirim
     *         beserta seluruh milestone sisanya, setelah tenggat + batas akhir (grace period).
     */
    function claimRefund(uint256 orderId) external nonReentrant orderExists(orderId) onlyClient(orderId) {
        Order storage o = orders[orderId];
        require(o.status == OrderStatus.Active, "Pesanan tidak aktif");
        uint256 idx = o.currentMilestone;
        Milestone storage m = milestones[orderId][idx];
        require(m.status == MilestoneStatus.Pending, "Hasil kerja sudah dikirim");
        require(block.timestamp > uint256(m.deadline) + o.gracePeriod, "Belum melewati tenggat + batas akhir");

        // effects
        uint256 refund = 0;
        Milestone[] storage ms = milestones[orderId];
        for (uint256 i = idx; i < ms.length; i++) {
            refund += ms[i].amount;
            ms[i].status = MilestoneStatus.Refunded;
        }
        o.status = OrderStatus.Terminated;
        emit RefundClaimed(orderId, idx, refund);

        // interaction
        _send(o.client, refund);
    }

    // ------------------------------------------------------------------
    // Sengketa
    // ------------------------------------------------------------------

    /// @notice Klien atau freelancer mengunggah CID bukti selama status Disputed.
    function submitEvidence(uint256 orderId, uint256 milestoneId, string calldata evidenceCID)
        external
        orderExists(orderId)
    {
        Order storage o = orders[orderId];
        Milestone storage m = _currentMilestone(orderId, milestoneId);
        require(m.status == MilestoneStatus.Disputed, "Milestone tidak dalam sengketa");
        require(bytes(evidenceCID).length > 0, "CID bukti wajib diisi");

        if (msg.sender == o.client) {
            m.clientEvidenceCID = evidenceCID;
        } else if (msg.sender == o.freelancer) {
            m.freelancerEvidenceCID = evidenceCID;
        } else {
            revert("Hanya klien/freelancer pesanan ini");
        }
        emit EvidenceSubmitted(orderId, milestoneId, msg.sender, evidenceCID);
    }

    /**
     * @notice Arbiter memutuskan sengketa dalam DISPUTE_TIMEOUT.
     *         Klien menerima denda + clientPercent% dari sisa (V - denda); freelancer menerima sisanya.
     *         Arbiter tidak menerima dana apa pun.
     */
    function resolveDispute(uint256 orderId, uint256 milestoneId, uint256 clientPercent, string calldata reasonCID)
        external
        nonReentrant
        orderExists(orderId)
        onlyArbiter
    {
        Milestone storage m = _currentMilestone(orderId, milestoneId);
        require(m.status == MilestoneStatus.Disputed, "Milestone tidak dalam sengketa");
        require(block.timestamp <= uint256(m.disputeStartedAt) + DISPUTE_TIMEOUT, "Tenggat arbiter sudah lewat");
        require(clientPercent <= 100, "Persentase klien maksimal 100");
        require(bytes(reasonCID).length > 0, "CID alasan wajib diisi");

        m.resolutionCID = reasonCID;
        _settleDispute(orderId, milestoneId, clientPercent, reasonCID, false);
    }

    /// @notice Jika arbiter tidak memutuskan dalam DISPUTE_TIMEOUT, klien/freelancer membagi sisa dana 50:50.
    function settleDisputeTimeout(uint256 orderId, uint256 milestoneId) external nonReentrant orderExists(orderId) {
        Order storage o = orders[orderId];
        require(msg.sender == o.client || msg.sender == o.freelancer, "Hanya klien/freelancer pesanan ini");
        Milestone storage m = _currentMilestone(orderId, milestoneId);
        require(m.status == MilestoneStatus.Disputed, "Milestone tidak dalam sengketa");
        require(block.timestamp > uint256(m.disputeStartedAt) + DISPUTE_TIMEOUT, "Tenggat arbiter belum lewat");

        _settleDispute(orderId, milestoneId, 50, "", true);
    }

    // ------------------------------------------------------------------
    // View
    // ------------------------------------------------------------------

    /**
     * @notice Denda milestone. Jika sudah pernah dikirim, mengembalikan denda yang sudah ditetapkan;
     *         jika belum, mengembalikan perkiraan denda bila dikirim sekarang.
     */
    function calculateLateFee(uint256 orderId, uint256 milestoneId)
        external
        view
        orderExists(orderId)
        returns (uint256)
    {
        require(milestoneId < milestones[orderId].length, "Milestone tidak ditemukan");
        Milestone storage m = milestones[orderId][milestoneId];
        if (m.firstSubmittedAt != 0) return m.lateFee;
        if (m.deadline == 0) return 0; // belum dibuka
        return _lateFeeAt(orderId, m, block.timestamp);
    }

    function getOrder(uint256 orderId) external view orderExists(orderId) returns (Order memory) {
        return orders[orderId];
    }

    function getMilestones(uint256 orderId) external view orderExists(orderId) returns (Milestone[] memory) {
        return milestones[orderId];
    }

    function getMilestone(uint256 orderId, uint256 milestoneId)
        external
        view
        orderExists(orderId)
        returns (Milestone memory)
    {
        require(milestoneId < milestones[orderId].length, "Milestone tidak ditemukan");
        return milestones[orderId][milestoneId];
    }

    function milestoneCount(uint256 orderId) external view orderExists(orderId) returns (uint256) {
        return milestones[orderId].length;
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _currentMilestone(uint256 orderId, uint256 milestoneId) internal view returns (Milestone storage) {
        Order storage o = orders[orderId];
        require(o.status == OrderStatus.Active, "Pesanan tidak aktif");
        require(milestoneId == o.currentMilestone, "Bukan milestone berjalan");
        return milestones[orderId][milestoneId];
    }

    function _openMilestone(uint256 orderId, uint256 milestoneId) internal {
        Order storage o = orders[orderId];
        Milestone storage m = milestones[orderId][milestoneId];
        o.currentMilestone = uint8(milestoneId);
        m.deadline = uint64(block.timestamp + m.duration);
        emit MilestoneOpened(orderId, milestoneId, m.deadline);
    }

    /// @dev denda = V * min(ceil((t - tenggat) / DAY_LENGTH) * r, c) / 10.000
    function _lateFeeAt(uint256 orderId, Milestone storage m, uint256 t) internal view returns (uint256) {
        if (t <= m.deadline) return 0;
        Order storage o = orders[orderId];
        // pembulatan ke atas: (selisih + DAY_LENGTH - 1) / DAY_LENGTH  (sengaja dibulatkan dulu, lalu dikali tarif)
        uint256 daysLate = Math.ceilDiv(t - m.deadline, DAY_LENGTH);
        uint256 pct = daysLate * o.dailyRateBps;
        if (pct > o.capBps) pct = o.capBps;
        return (m.amount * pct) / BPS_DENOMINATOR;
    }

    /// @dev Pembayaran milestone (approve atau masa review habis). Dipanggil dari fungsi nonReentrant.
    function _payMilestone(uint256 orderId, uint256 milestoneId, bool byReviewTimeout) internal {
        Order storage o = orders[orderId];
        Milestone storage m = milestones[orderId][milestoneId];

        // effects
        uint256 fee = m.lateFee;
        uint256 toFreelancer = m.amount - fee;
        m.status = MilestoneStatus.Paid;
        emit MilestonePaid(orderId, milestoneId, toFreelancer, fee, byReviewTimeout);
        _advance(orderId, milestoneId);

        // interactions
        _send(o.freelancer, toFreelancer);
        _send(o.client, fee);
    }

    /// @dev Penyelesaian sengketa: denda ke klien dahulu, sisa (V - denda) dibagi sesuai persentase.
    function _settleDispute(
        uint256 orderId,
        uint256 milestoneId,
        uint256 clientPercent,
        string memory reasonCID,
        bool byTimeout
    ) internal {
        Order storage o = orders[orderId];
        Milestone storage m = milestones[orderId][milestoneId];

        // effects
        uint256 remaining = m.amount - m.lateFee;
        uint256 toClient = m.lateFee + (remaining * clientPercent) / 100;
        uint256 toFreelancer = m.amount - toClient;
        m.status = MilestoneStatus.Resolved;
        emit DisputeResolved(orderId, milestoneId, clientPercent, toClient, toFreelancer, reasonCID, byTimeout);
        _advance(orderId, milestoneId);

        // interactions
        _send(o.client, toClient);
        _send(o.freelancer, toFreelancer);
    }

    /// @dev Membuka milestone berikutnya atau menyelesaikan pesanan.
    function _advance(uint256 orderId, uint256 milestoneId) internal {
        if (milestoneId + 1 < milestones[orderId].length) {
            _openMilestone(orderId, milestoneId + 1);
        } else {
            orders[orderId].status = OrderStatus.Completed;
            emit OrderCompleted(orderId);
        }
    }

    function _send(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "Transfer ETH gagal");
    }
}
