require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: "../.env" });

/**
 * Hardhat config — TESTNET ONLY.
 *
 * Every contract in this repo is meant for Circle's **Arc testnet**. The USDC
 * used is **test USDC** (or the bundled MockUSDC faucet token) with no real-world
 * value. There is no mainnet network defined here on purpose.
 *
 *   cd contracts && npm install
 *   npm run deploy:mock-usdc            # test USDC (if your testnet has none)
 *   USDC_ADDRESS=<usdc> npm run deploy:marketplace
 *   npm run deploy                       # RevenueSplit
 *
 * Provision the Arc testnet RPC + a funded testnet key via the ARC CLI:
 *   uv tool install git+https://github.com/the-canteen-dev/ARC-cli
 * then set ARC_RPC_URL / ARC_CHAIN_ID / DEPLOYER_PRIVATE_KEY in ../.env
 */
const ARC_RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = Number(process.env.ARC_CHAIN_ID || "5042002");

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  defaultNetwork: "hardhat",
  networks: {
    // Local in-memory chain for tests / dry-run deploys (…:local scripts).
    hardhat: {},
    // Circle Arc testnet — the real deploy target.
    arcTestnet: {
      url: ARC_RPC_URL,
      chainId: ARC_CHAIN_ID,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};
