// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice A 6-decimal ERC-20 standing in for USDC when a canonical USDC isn't
 *         available on your target testnet. Includes an open faucet so anyone
 *         (a demo judge, an agent) can mint test funds. DO NOT deploy to mainnet.
 *
 * If your network already has a real USDC, skip this and pass that address to
 * the AgentMarketplace deploy script instead.
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin (Test)", "USDC") {
        _mint(msg.sender, 1_000_000 * 10 ** 6); // 1,000,000 USDC to deployer
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Open faucet — mint test USDC to any address. Testnet only.
    function faucet(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
