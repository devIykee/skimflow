/* eslint-disable no-console */
/**
 * Testnet-only safety guard. Every deploy script calls this so the contracts
 * can never be pushed to a known mainnet by accident — this project uses Arc
 * TESTNET and test USDC only.
 */
const MAINNET_CHAIN_IDS = new Set([
  1, // Ethereum
  10, // Optimism
  56, // BNB
  137, // Polygon
  8453, // Base
  42161, // Arbitrum One
  43114, // Avalanche C
  324, // zkSync Era
  59144, // Linea
  534352, // Scroll
]);

async function assertTestnet(hre) {
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  if (MAINNET_CHAIN_IDS.has(chainId)) {
    throw new Error(
      `Refusing to deploy: chainId ${chainId} is a known MAINNET. ` +
        `This project is Arc TESTNET only. Point ARC_RPC_URL/ARC_CHAIN_ID at the Arc testnet.`
    );
  }
  console.log(`  ✓ testnet check passed (chainId ${chainId}, network ${hre.network.name})`);
  return chainId;
}

module.exports = { assertTestnet };
