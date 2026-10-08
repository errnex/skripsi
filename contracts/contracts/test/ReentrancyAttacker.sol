// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IFreelanceEscrow {
    function acceptOrder(uint256 orderId) external;
    function submitWork(uint256 orderId, uint256 milestoneId, string calldata workCID) external;
    function finalizeAfterReview(uint256 orderId, uint256 milestoneId) external;
}

/**
 * @dev KONTRAK KHUSUS PENGUJIAN (tidak di-deploy ke Sepolia).
 *      Berperan sebagai freelancer jahat yang mencoba memanggil ulang (re-entrancy)
 *      finalizeAfterReview() saat menerima ETH. Serangan harus gagal karena nonReentrant
 *      dan status milestone sudah diubah sebelum ETH dikirim.
 */
contract ReentrancyAttacker {
    IFreelanceEscrow public immutable escrow;
    uint256 public targetOrder;
    uint256 public targetMilestone;
    uint256 public reentryAttempts;
    bool public reentrySucceeded;

    constructor(address _escrow) {
        escrow = IFreelanceEscrow(_escrow);
    }

    function accept(uint256 orderId) external {
        escrow.acceptOrder(orderId);
    }

    function submit(uint256 orderId, uint256 milestoneId) external {
        escrow.submitWork(orderId, milestoneId, "bafy-attacker");
    }

    function attack(uint256 orderId, uint256 milestoneId) external {
        targetOrder = orderId;
        targetMilestone = milestoneId;
        escrow.finalizeAfterReview(orderId, milestoneId);
    }

    receive() external payable {
        if (reentryAttempts == 0) {
            reentryAttempts++;
            // Coba cairkan milestone yang sama sekali lagi. Harus gagal.
            try escrow.finalizeAfterReview(targetOrder, targetMilestone) {
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        }
    }
}
