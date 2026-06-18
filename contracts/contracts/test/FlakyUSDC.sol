// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title FlakyUSDC
 * @notice TEST-ONLY 6-decimal ERC-20 that can be told to revert any transfer to
 *         a specific address — used to exercise RevenueSplit's failed-payout
 *         absorb path (a creator/referrer wallet that rejects transfers). Never
 *         deploy outside tests.
 */
contract FlakyUSDC is ERC20 {
    mapping(address => bool) public rejects;

    constructor() ERC20("Flaky USDC", "fUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setReject(address who, bool on) external {
        rejects[who] = on;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!rejects[to], "recipient rejects transfer");
        super._update(from, to, value);
    }
}
