import type { Address } from "viem";

/**
 * Contract addresses — set these in apps/web/.env.local after deploying.
 * They are read at build/runtime; NEXT_PUBLIC_ vars are exposed to the browser.
 */
export const MARKETPLACE_ADDRESS = (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as Address;

export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as Address;

export const marketplaceConfigured =
  MARKETPLACE_ADDRESS !== "0x0000000000000000000000000000000000000000" &&
  USDC_ADDRESS !== "0x0000000000000000000000000000000000000000";

/** ABI for AgentMarketplace.sol — matches the deployed contract exactly. */
export const AGENT_MARKETPLACE_ABI = [
  {
    type: "function",
    name: "contentCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "usdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "hasPurchased",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "hasAccess",
    stateMutability: "view",
    inputs: [
      { name: "_id", type: "uint256" },
      { name: "_user", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getContent",
    stateMutability: "view",
    inputs: [{ name: "_id", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: CONTENT_COMPONENTS() }],
  },
  {
    type: "function",
    name: "getAllContent",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "list", type: "tuple[]", components: CONTENT_COMPONENTS() }],
  },
  {
    type: "function",
    name: "publishContent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_cid", type: "string" },
      { name: "_title", type: "string" },
      { name: "_description", type: "string" },
      { name: "_price", type: "uint256" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "buyContent",
    stateMutability: "nonpayable",
    inputs: [{ name: "_id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setActive",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_id", type: "uint256" },
      { name: "_active", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "ContentPublished",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "author", type: "address", indexed: true },
      { name: "cid", type: "string", indexed: false },
      { name: "title", type: "string", indexed: false },
      { name: "price", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ContentPurchased",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "author", type: "address", indexed: true },
      { name: "price", type: "uint256", indexed: false },
    ],
  },
] as const;

/** Tuple shape for the Content struct (kept in one place to stay in sync). */
function CONTENT_COMPONENTS() {
  return [
    { name: "id", type: "uint256" },
    { name: "author", type: "address" },
    { name: "cid", type: "string" },
    { name: "title", type: "string" },
    { name: "description", type: "string" },
    { name: "price", type: "uint256" },
    { name: "active", type: "bool" },
    { name: "createdAt", type: "uint256" },
    { name: "sales", type: "uint256" },
  ] as const;
}

/** Minimal ERC-20 ABI for USDC (approve / allowance / balance / decimals). */
export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "faucet",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** Decoded Content record (matches the struct). */
export interface ContentRecord {
  id: bigint;
  author: Address;
  cid: string;
  title: string;
  description: string;
  price: bigint;
  active: boolean;
  createdAt: bigint;
  sales: bigint;
}
