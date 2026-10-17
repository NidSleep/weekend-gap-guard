/**
 * Two-cycle demo of the Studio-scaffolded agent against GapGuardVault on the
 * local Hardhat chain started by ../../../../../live/start.js. Our code.
 *
 *   OBSERVE (read-only chain reads) -> DECIDE (decide.ts) -> EXECUTE
 *   (signing.ts executeVaultBuy, key from Studio's evm-local getWallet()).
 *
 * Cycle A: Saturday, bNVDA DEX 181 vs ref 180 -> BUY -> vault allows it.
 * Cycle B: weekend pump, owner sets DEX bNVDA to 199 -> BUY -> vault reverts
 *          PriceGapTooWide(gapBps, maxBps, marketOpen).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@bnbagent/studio-runtime/config";
import { getWallet } from "@bnbagent/studio-runtime/wallet";
import { type Abi, createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { executeVaultBuy } from "../signing.js";
import { decide, type Observation } from "./decide.js";

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.resolve(here, "../../../../.studio/.env.local")); // WALLET_PASSWORD for the evm-local keystore

const CONFIG_URL = process.env.GAPGUARD_CONFIG_URL ?? "http://localhost:5178/config.json";
const RPC_URL = process.env.GAPGUARD_RPC ?? "http://127.0.0.1:8546";
const CHAIN_ID = 31337;

async function main() {
  const cfg = await (await fetch(CONFIG_URL)).json();
  const a = cfg.addr;
  const vaultAbi = cfg.abi.vault as Abi, dexAbi = cfg.abi.dex as Abi, oracleAbi = cfg.abi.oracle as Abi;
  const pub = createPublicClient({ transport: http(RPC_URL) });
  const wallet = getWallet();
  console.log(`[studio] wallet kind=evm-local address=${wallet.address} (Hardhat dev account 1, public test key)`);
  console.log(`[chain ] ${RPC_URL} chainId=${await pub.getChainId()} vault=${a.vault} vault.agent=${cfg.accounts.agent}`);

  let prev: number | null = null;
  async function observe(): Promise<Observation> {
    const [dex, ref, open] = await Promise.all([
      pub.readContract({ address: a.dex, abi: dexAbi, functionName: "price", args: [a.bNVDA] }) as Promise<bigint>,
      pub.readContract({ address: a.oracle, abi: oracleAbi, functionName: "referencePrice", args: [a.bNVDA] }) as Promise<bigint>,
      pub.readContract({ address: a.oracle, abi: oracleAbi, functionName: "marketOpen" }) as Promise<boolean>,
    ]);
    const o = { symbol: "bNVDA", dexPrice: Number(formatEther(dex)), refPrice: Number(formatEther(ref)), prevDexPrice: prev, marketOpen: open };
    prev = o.dexPrice;
    return o;
  }

  async function cycle(label: string) {
    console.log(`\n=== ${label} ===`);
    const o = await observe();
    console.log(`[observe] bNVDA dex=${o.dexPrice} ref=${o.refPrice} marketOpen=${o.marketOpen}`);
    const d = await decide(o);
    console.log(`[decide ] ${d.action} ${d.usdtAmount} USDT  source=${d.source}  reason="${d.reason}"`);
    if (d.action !== "BUY") return null;
    const r = await executeVaultBuy({ rpcUrl: RPC_URL, chainId: CHAIN_ID, vault: a.vault, vaultAbi },
      a.bNVDA, parseEther(String(d.usdtAmount)), `studio-agent: ${d.reason}`);
    console.log(`[execute] GapGuardVault.buy -> ${r.status.toUpperCase()} tx=${r.txHash} block=${r.blockNumber} gas=${r.gasUsed}` +
      (r.error ? `\n          decoded revert: ${r.error}` : ""));
    return r;
  }

  const r1 = await cycle("Cycle A: Saturday, normal weekend signal");

  // Market event (owner = Hardhat account 0, unlocked on the local node): weekend pump to $199.
  const owner = createWalletClient({ account: cfg.accounts.owner, transport: http(RPC_URL) });
  const h = await owner.writeContract({ address: a.dex, abi: dexAbi, functionName: "setPrice", args: [a.bNVDA, parseEther("199")], chain: null, account: cfg.accounts.owner });
  await pub.waitForTransactionReceipt({ hash: h });
  console.log(`\n[market ] owner sets MockDex bNVDA price -> 199 (tx ${h})`);

  const r2 = await cycle("Cycle B: weekend pump to $199");

  const ok = r1?.status === "success" && r2?.status === "reverted" && /^PriceGapTooWide/.test(r2.error ?? "");
  console.log(`\nRESULT: ${ok ? "PASS" : "FAIL"} (A=${r1?.status}, B=${r2?.status} ${r2?.error ?? ""})`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
