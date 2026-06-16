// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AgentMarketplace
 * @notice A decentralized marketplace for text-based AI agent content — skills,
 *         prompts, and knowledge bases. Authors publish a pointer (IPFS CID) to
 *         their content with a USDC price; buyers (human or AI agent) pay in
 *         USDC and gain on-chain access. AI agents listen to the events to
 *         discover new skills dynamically.
 *
 * Settlement is in USDC (an ERC-20, 6 decimals) on Circle's Arc testnet.
 * Funds move buyer -> author directly via `transferFrom`; the contract never
 * custodies USDC. Access is recorded on-chain in `hasPurchased`.
 *
 * Security:
 *  - SafeERC20 for the token transfer (tolerates non-standard ERC-20s).
 *  - ReentrancyGuard on the paid path.
 *  - Checks-Effects-Interactions: access is granted only after a successful
 *    pull of funds, and the buyer cannot re-purchase.
 */
contract AgentMarketplace is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice USDC token used for all payments (6 decimals on Arc).
    IERC20 public immutable usdc;

    struct Content {
        uint256 id;
        address author;
        string cid;          // IPFS CID (or pointer) to the (encrypted) content
        string title;
        string description;
        uint256 price;       // in USDC base units (6 decimals)
        bool active;         // author can delist
        uint256 createdAt;   // block timestamp
        uint256 sales;       // number of purchases (discovery signal)
    }

    /// @notice Auto-incrementing id of the last published item; ids start at 1.
    uint256 public contentCount;

    /// @notice id => Content
    mapping(uint256 => Content) private _contents;

    /// @notice contentId => buyer => purchased?
    mapping(uint256 => mapping(address => bool)) public hasPurchased;

    event ContentPublished(
        uint256 indexed id,
        address indexed author,
        string cid,
        string title,
        uint256 price
    );

    event ContentPurchased(
        uint256 indexed id,
        address indexed buyer,
        address indexed author,
        uint256 price
    );

    event ContentStatusChanged(uint256 indexed id, bool active);

    error InvalidUsdc();
    error EmptyCid();
    error EmptyTitle();
    error ZeroPrice();
    error ContentNotFound();
    error ContentInactive();
    error AlreadyPurchased();
    error AuthorCannotBuyOwnContent();
    error NotAuthor();

    constructor(address _usdc) {
        if (_usdc == address(0)) revert InvalidUsdc();
        usdc = IERC20(_usdc);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Publish
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Publish a piece of content. Stores the metadata + IPFS pointer and
     *         emits {ContentPublished} so agents can discover it.
     * @param _cid IPFS CID of the (encrypted) content body.
     * @param _title Human-readable title.
     * @param _description Short description / preview.
     * @param _price Price in USDC base units (6 decimals). Must be > 0.
     * @return id The new content id.
     */
    function publishContent(
        string calldata _cid,
        string calldata _title,
        string calldata _description,
        uint256 _price
    ) external returns (uint256 id) {
        if (bytes(_cid).length == 0) revert EmptyCid();
        if (bytes(_title).length == 0) revert EmptyTitle();
        if (_price == 0) revert ZeroPrice();

        id = ++contentCount;
        _contents[id] = Content({
            id: id,
            author: msg.sender,
            cid: _cid,
            title: _title,
            description: _description,
            price: _price,
            active: true,
            createdAt: block.timestamp,
            sales: 0
        });

        emit ContentPublished(id, msg.sender, _cid, _title, _price);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Purchase
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Buy access to content `_id`. Pulls `price` USDC from the buyer to
     *         the author (requires prior ERC-20 `approve`) and records access.
     * @dev Reverts if inactive, already purchased, or buyer is the author.
     */
    function buyContent(uint256 _id) external nonReentrant {
        Content storage c = _contents[_id];
        if (c.id == 0) revert ContentNotFound();
        if (!c.active) revert ContentInactive();
        if (msg.sender == c.author) revert AuthorCannotBuyOwnContent();
        if (hasPurchased[_id][msg.sender]) revert AlreadyPurchased();

        // Effects first.
        hasPurchased[_id][msg.sender] = true;
        c.sales += 1;

        // Interaction: pull funds buyer -> author. Reverts on failure.
        usdc.safeTransferFrom(msg.sender, c.author, c.price);

        emit ContentPurchased(_id, msg.sender, c.author, c.price);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Author controls
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice List/delist content. Only the author.
    function setActive(uint256 _id, bool _active) external {
        Content storage c = _contents[_id];
        if (c.id == 0) revert ContentNotFound();
        if (msg.sender != c.author) revert NotAuthor();
        c.active = _active;
        emit ContentStatusChanged(_id, _active);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views (gas-free reads for the frontend / agents)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice True if `_user` is the author or has purchased `_id`.
    function hasAccess(uint256 _id, address _user) external view returns (bool) {
        Content storage c = _contents[_id];
        if (c.id == 0) return false;
        return _user == c.author || hasPurchased[_id][_user];
    }

    /// @notice Fetch a single content record.
    function getContent(uint256 _id) external view returns (Content memory) {
        if (_contents[_id].id == 0) revert ContentNotFound();
        return _contents[_id];
    }

    /// @notice Fetch every content record (newest ids last). For the feed.
    function getAllContent() external view returns (Content[] memory list) {
        list = new Content[](contentCount);
        for (uint256 i = 0; i < contentCount; i++) {
            list[i] = _contents[i + 1];
        }
    }

    /// @notice Paginated fetch: returns up to `_limit` items starting at `_offset` (1-indexed).
    function getContentPage(uint256 _offset, uint256 _limit)
        external
        view
        returns (Content[] memory list)
    {
        if (_offset == 0) _offset = 1;
        uint256 end = _offset + _limit - 1;
        if (end > contentCount) end = contentCount;
        if (_offset > contentCount) return new Content[](0);
        uint256 n = end - _offset + 1;
        list = new Content[](n);
        for (uint256 i = 0; i < n; i++) {
            list[i] = _contents[_offset + i];
        }
    }
}
