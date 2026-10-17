// Exercises scenarios 1-5 against the running demo (npm run demo) via its /rpc proxy and asserts exact outcomes.
const { ethers } = require("ethers");
const BASE = "http://localhost:5178";
(async () => {
  const cfg = await (await fetch(BASE + "/config.json")).json();
  const provider = new ethers.JsonRpcProvider(BASE + "/rpc", 31337, { staticNetwork: true });
  const iface = new ethers.Interface(cfg.abi.vault);
  const a = cfg.addr;
  const vault = new ethers.Contract(a.vault, cfg.abi.vault, provider);
  const oracle = new ethers.Contract(a.oracle, cfg.abi.oracle, provider);
  const dex = new ethers.Contract(a.dex, cfg.abi.dex, provider);
  const usdt = new ethers.Contract(a.usdt, cfg.abi.erc20, provider);
  const P = ethers.parseEther, F = ethers.formatEther;
  const fmt = v => typeof v === "bigint" ? (v > 10n ** 15n ? F(v) : v.toString()) : String(v);
  let fails = 0;
  const check = (name, got, want) => { const ok = got === want; if (!ok) fails++; console.log(`   ${ok ? "PASS" : "FAIL"} ${name}: got ${got}${ok ? "" : ` want ${want}`}`); };
  console.log("vault", a.vault, "USDT", F(await usdt.balanceOf(a.vault)), "marketOpen", await oracle.marketOpen());

  async function run(name, c, idx, m, args) {
    c = c.connect(await provider.getSigner(idx));
    try { await c[m].staticCall(...args); }
    catch (e) {
      const p = iface.parseError(e.data);
      const s = `${p.name}(${p.args.map(fmt).join(", ")})`;
      console.log(`${name}: REVERT ${s}`);
      try { const t = await c[m](...args, { gasLimit: 500000 }); await t.wait(); }
      catch (e2) { const rc = await provider.getTransactionReceipt(e2.error.data.txHash);
        console.log(`   broadcast anyway -> mined failed tx ${rc.hash} block ${rc.blockNumber} status ${rc.status}`); }
      return "REVERT " + s;
    }
    const r = await (await c[m](...args)).wait();
    let ev = "";
    for (const lg of r.logs) { try { const x = iface.parseLog(lg); if (x && x.name === "Bought") ev = ` Bought(usdtIn=${F(x.args.usdtIn)}, tokensOut=${F(x.args.tokensOut)}, gapBps=${x.args.gapBps})`; } catch {} }
    console.log(`${name}: SUCCESS tx ${r.hash} block ${r.blockNumber} gas ${r.gasUsed}${ev}`);
    return "SUCCESS";
  }

  check("1 Saturday buy 20 bNVDA", await run("1 Saturday: agent buys 20 USDT bNVDA", vault, 1, "buy", [a.bNVDA, P("20"), "weekend DCA"]), "SUCCESS");
  await run("2a market event: DEX bNVDA -> 199", dex, 0, "setPrice", [a.bNVDA, P("199")]);
  check("2 FOMO buy", await run("2b agent FOMO-buys 30 USDT bNVDA", vault, 1, "buy", [a.bNVDA, P("30"), "FOMO"]), "REVERT PriceGapTooWide(1055, 300, false)");
  check("3 RUG", await run("3 prompt injection: 50 USDT RUG", vault, 1, "buy", [a.RUG, P("50"), "injected"]), `REVERT NotWhitelisted(${a.RUG})`);
  check("4 limit", await run("4 agent buys 90 USDT bAAPL", vault, 1, "buy", [a.bAAPL, P("90"), "big AAPL"]), "REVERT DailyLimitExceeded(90.0, 80.0)");
  await run("5a market event: marketOpen=true", oracle, 0, "setMarketOpen", [true]);
  await run("5b market event: reference NVDA -> 197", oracle, 0, "setReferencePrice", [a.bNVDA, P("197")]);
  const [gap] = await vault.currentGap(a.bNVDA);
  console.log(`   gap now ${gap} bps (${(Number(gap) / 100).toFixed(2)}%), band ${await vault.maxGapBpsOpen()} bps`);
  check("5 Monday buy", await run("5c Monday open: agent buys 30 USDT bNVDA", vault, 1, "buy", [a.bNVDA, P("30"), "Monday open"]), "SUCCESS");
  const remaining = await vault.remainingToday();
  check("spent today", F(P("100") - remaining), "50.0");
  check("vault USDT", F(await usdt.balanceOf(a.vault)), "950.0");
  const nv = new ethers.Contract(a.bNVDA, cfg.abi.erc20, provider);
  console.log(`   vault holds ${F(await nv.balanceOf(a.vault))} bNVDA`);
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
