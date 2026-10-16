/**
 * Sets up the TEST wallet used for on-chain anchoring.
 *   npm run anchor:wallet
 *
 * First run: creates a brand-new wallet, saves its private key into .env (never printed,
 * never overwrites an existing key) and shows its public address.
 * Later runs: show the address and how much test ETH it has.
 *
 * This wallet is for the test network only. Never send real money to it.
 */
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, formatEther, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";

const envFile = path.resolve(import.meta.dirname, "../../../.env");

// Reject: no .env yet (copy .env.example first)
if (!fs.existsSync(envFile)) {
  console.error("No .env file. Copy .env.example to .env first.");
  process.exit(1);
}

let env = fs.readFileSync(envFile, "utf8");
const existing = /^ANCHOR_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m.exec(env)?.[1] as Hex | undefined;

let key: Hex;
if (existing) {
  key = existing;
  console.log("Using the wallet already in .env.");
} else {
  // A new random key, written straight into .env (replacing an empty ANCHOR_PRIVATE_KEY= line, or added)
  key = generatePrivateKey();
  env = /^ANCHOR_PRIVATE_KEY=.*$/m.test(env) ? env.replace(/^ANCHOR_PRIVATE_KEY=.*$/m, `ANCHOR_PRIVATE_KEY=${key}`) : `${env.trimEnd()}\nANCHOR_PRIVATE_KEY=${key}\n`;
  fs.writeFileSync(envFile, env);
  console.log("Created a new TEST wallet and saved its key in .env (git-ignored; not shown here).");
}

const useSepolia = /^ANCHOR_CHAIN=sepolia\s*$/m.test(env);
const chain = useSepolia ? sepolia : baseSepolia;
const address = privateKeyToAccount(key).address;
const balance = await createPublicClient({ chain, transport: http() }).getBalance({ address });

console.log(`\nNetwork: ${chain.name} (a free test network)`);
console.log(`Wallet address: ${address}`);
console.log(`Test ETH: ${formatEther(balance)}`);
if (balance === 0n) {
  console.log(`\nNext: get free test ETH for this address from a ${chain.name} faucet`);
  console.log("(search \"base sepolia faucet\"; paste the address above). A tiny amount is plenty.");
  console.log("Then restart the API: it anchors automatically every 15 minutes, or on POST /api/audit/anchor.");
}
console.log("\nOn Render: add ANCHOR_PRIVATE_KEY from your .env to the service's environment.");
