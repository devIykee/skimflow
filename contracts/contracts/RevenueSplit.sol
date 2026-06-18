// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title RevenueSplit
 * @notice Atomically splits a single USDC payment (a content purchase or chunk
 *         unlock) four ways and forwards it in one transaction:
 *
 *           Creator  → 80%  (passed per call — unique per creator)
 *           Platform → 12%  (configurable treasury)
 *           Referrer →  5%  (passed per call; address(0) ⇒ folded into reserve)
 *           Reserve  →  3%  (held in-contract, owner-drainable)
 *
 *         The reserve is an on-chain USDC pool that accumulates inside this
 *         contract and is never auto-forwarded. The owner drains it manually via
 *         {withdrawReserve}. It exists for: (1) dispute/refund payouts, (2)
 *         paying integrated third-party protocols, (3) absorbing a failed
 *         creator/referrer payout so a reader is never blocked mid-content, and
 *         (4) a future on-chain treasury for creator/holder rewards.
 *
 *         Pull model: the payer approves this contract for `amount`, then calls
 *         {split}. The full amount is pulled in once, then distributed — so the
 *         reserve (and any absorbed payout) simply stays put. USDC on Arc is a
 *         6-decimal ERC-20; all amounts are in base units.
 */
contract RevenueSplit is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice USDC token this contract splits (6 decimals on Arc).
    IERC20 public immutable usdc;

    /// @notice Treasury that receives the platform fee. Updatable by the owner.
    address public platform;

    /// @notice USDC (base units) currently held as reserve, owner-drainable.
    uint256 public reserveBalance;

    uint16 public constant CREATOR_BPS = 8000; // 80%
    uint16 public constant PLATFORM_BPS = 1200; // 12%
    uint16 public constant REFERRER_BPS = 500; //  5%
    uint16 public constant RESERVE_BPS = 300; //  3%
    uint16 public constant BPS = 10000;

    /// @param payer          msg.sender that approved + paid
    /// @param creatorAmount  amount actually sent to the creator (0 if absorbed)
    /// @param referrerAmount amount actually sent to the referrer (0 if none/absorbed)
    /// @param reserveAmount  amount added to the reserve this call (incl. any absorbed legs)
    event PaymentSplit(
        address indexed payer,
        address indexed creator,
        address indexed referrer,
        uint256 amount,
        uint256 creatorAmount,
        uint256 platformAmount,
        uint256 referrerAmount,
        uint256 reserveAmount
    );

    /// @notice A payout leg failed (recipient rejected the transfer) and was absorbed into the reserve.
    event PayoutAbsorbed(address indexed recipient, uint256 amount);
    event ReserveWithdrawn(address indexed to, uint256 amount);
    event PlatformUpdated(address indexed previous, address indexed current);

    /**
     * @param _usdc     USDC token address (Arc testnet: 0x3600…0000)
     * @param _platform treasury receiving the platform fee
     * @param _owner    contract owner (can drain reserve + update platform)
     */
    constructor(address _usdc, address _platform, address _owner) Ownable(_owner) {
        require(_usdc != address(0), "usdc=0");
        require(_platform != address(0), "platform=0");
        usdc = IERC20(_usdc);
        platform = _platform;
    }

    /**
     * @notice Pull `amount` USDC from the caller (requires prior approval) and
     *         split it 80/12/5/3. A zero referrer folds the 5% into the reserve.
     *         A creator or referrer transfer that reverts is absorbed into the
     *         reserve instead of failing the whole call.
     * @param creator  destination for the 80% creator share (required)
     * @param referrer destination for the 5% referrer share, or address(0)
     * @param amount   total USDC base units to split (> 0)
     */
    function split(address creator, address referrer, uint256 amount) external nonReentrant {
        require(creator != address(0), "creator=0");
        require(amount > 0, "amount=0");

        // Pull the full amount in first, then distribute from this contract.
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        uint256 platformAmount = (amount * PLATFORM_BPS) / BPS;
        uint256 referrerShare = (amount * REFERRER_BPS) / BPS;
        uint256 reserveAmount = (amount * RESERVE_BPS) / BPS;
        // Creator gets the remainder so rounding dust is never stranded.
        uint256 creatorShare = amount - platformAmount - referrerShare - reserveAmount;

        // Platform is the owner's own treasury — a revert here is a real config
        // error, so let it bubble up rather than silently absorbing.
        usdc.safeTransfer(platform, platformAmount);

        // Referrer: fold into reserve when absent, or absorb if the transfer fails.
        uint256 referrerPaid = 0;
        if (referrer == address(0) || referrer == creator) {
            reserveAmount += referrerShare;
        } else if (_tryTransfer(referrer, referrerShare)) {
            referrerPaid = referrerShare;
        } else {
            reserveAmount += referrerShare;
            emit PayoutAbsorbed(referrer, referrerShare);
        }

        // Creator: absorb into reserve on failure so the reader is never blocked.
        uint256 creatorPaid = 0;
        if (_tryTransfer(creator, creatorShare)) {
            creatorPaid = creatorShare;
        } else {
            reserveAmount += creatorShare;
            emit PayoutAbsorbed(creator, creatorShare);
        }

        reserveBalance += reserveAmount;

        emit PaymentSplit(
            msg.sender, creator, referrer, amount, creatorPaid, platformAmount, referrerPaid, reserveAmount
        );
    }

    /// @notice Owner drains the full accumulated reserve to `to`.
    function withdrawReserve(address to) external onlyOwner nonReentrant {
        require(to != address(0), "to=0");
        uint256 amount = reserveBalance;
        require(amount > 0, "reserve empty");
        reserveBalance = 0; // checks-effects-interactions
        usdc.safeTransfer(to, amount);
        emit ReserveWithdrawn(to, amount);
    }

    /// @notice Owner updates the treasury that receives the platform fee.
    function updatePlatformAddress(address newPlatform) external onlyOwner {
        require(newPlatform != address(0), "platform=0");
        emit PlatformUpdated(platform, newPlatform);
        platform = newPlatform;
    }

    /**
     * @dev Low-level USDC transfer that returns false instead of reverting, so a
     *      hostile/contract recipient can't brick the split. Mirrors SafeERC20's
     *      success check (no return data OR a `true` return).
     */
    function _tryTransfer(address to, uint256 amount) private returns (bool) {
        if (amount == 0) return true;
        (bool ok, bytes memory ret) = address(usdc).call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        return ok && (ret.length == 0 || abi.decode(ret, (bool)));
    }
}
