/**
 * DECIDE step — our code (NOT Studio-generated).
 *
 * DEFAULT: a deterministic momentum rule, clearly a STUB standing in for the
 * LLM. Reason: Studio's default LLM (Pieverse `auto/free`) needs
 * `bag llm activate`, which does a SIWE login with the agent wallet and
 * creates a Pieverse API key on an external service. We did not do that with
 * a publicly-known Hardhat dev key. See ../../../../../DEVEX-NOTES.md.
 *
 * OPTIONAL (untested, set GAPGUARD_LLM=1 after `bag llm activate`): asks the
 * Studio-built model (`buildModel()` from the generated model.ts) for a
 * BUY/HOLD verdict. Either way the decision can only REQUEST a buy; signing
 * is fixed code in signing.ts and the vault enforces the guard on-chain.
 *
 * Note the stub is deliberately naive: it chases momentum, exactly the
 * FOMO behaviour GapGuardVault exists to stop.
 */
export interface Observation {
  symbol: string;
  dexPrice: number;   // USDT per token on the (mock) DEX
  refPrice: number;   // last regular-session close from the oracle
  prevDexPrice: number | null;
  marketOpen: boolean;
}
export interface Decision {
  action: "BUY" | "HOLD";
  usdtAmount: number;
  reason: string;
  source: "deterministic-stub" | "studio-llm";
}

const BUY_SIZE_USDT = 30;

export function decideStub(o: Observation): Decision {
  const prev = o.prevDexPrice ?? o.refPrice;
  const momentum = (o.dexPrice - prev) / prev;
  if (momentum > 0) {
    return { action: "BUY", usdtAmount: BUY_SIZE_USDT, source: "deterministic-stub",
      reason: `${o.symbol} momentum +${(momentum * 100).toFixed(2)}% (${prev} -> ${o.dexPrice}); buy ${BUY_SIZE_USDT} USDT` };
  }
  return { action: "HOLD", usdtAmount: 0, source: "deterministic-stub",
    reason: `${o.symbol} no upward momentum (${prev} -> ${o.dexPrice})` };
}

export async function decide(o: Observation): Promise<Decision> {
  if (process.env.GAPGUARD_LLM !== "1") return decideStub(o);
  // Untested path: requires `bag llm activate` (Pieverse key) first.
  const { buildModel } = await import("../model.js");
  const { generateText } = await import("ai");
  const { text } = await generateText({
    model: buildModel(),
    prompt:
      `You are a weekend trading agent for tokenized stocks. Observation: ${JSON.stringify(o)}. ` +
      `Rule: if price is rising, buy ${BUY_SIZE_USDT} USDT. Reply with exactly BUY or HOLD.`,
  });
  const buy = /\bBUY\b/i.test(text);
  return { action: buy ? "BUY" : "HOLD", usdtAmount: buy ? BUY_SIZE_USDT : 0, reason: text.trim(), source: "studio-llm" };
}
