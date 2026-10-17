// Starts ../live/start.js (local Hardhat chain + GapGuardVault deploy) unless it is
// already serving config, runs the Studio agent's two-cycle demo, then stops what it started.
const { spawn } = require("child_process");
const path = require("path");
const CONFIG = "http://localhost:5178/config.json";
const up = async () => { try { return (await fetch(CONFIG)).ok; } catch { return false; } };
(async () => {
  let live = null;
  if (!(await up())) {
    console.log("[demo] starting ../live/start.js ...");
    live = spawn(process.execPath, [path.join(__dirname, "..", "live", "start.js")], { stdio: ["ignore", "inherit", "inherit"] });
    for (let i = 0; i < 120 && !(await up()); i++) await new Promise(r => setTimeout(r, 500));
    if (!(await up())) { live.kill(); throw new Error("live/start.js did not come up"); }
  } else {
    // Reusing someone's running demo server: redeploy fresh contracts (POST /reset) so the run is deterministic.
    console.log("[demo] reusing running live/start.js at", CONFIG, "-> POST /reset (fresh deploy)");
    await fetch("http://localhost:5178/reset", { method: "POST" });
  }
  const agentDir = path.join(__dirname, "gapguardagent", "app", "agent");
  const tsx = path.join(agentDir, "node_modules", "tsx", "dist", "cli.mjs");
  const code = await new Promise(res => spawn(process.execPath, [tsx, "src/gapguard/demo.ts"], { cwd: agentDir, stdio: "inherit" }).on("exit", res));
  if (live) { live.kill(); console.log("[demo] stopped live/start.js"); }
  else { await fetch("http://localhost:5178/reset", { method: "POST" }); console.log("[demo] POST /reset again: shared demo server left in its initial state"); }
  process.exit(code ?? 1);
})().catch(e => { console.error(e); process.exit(1); });
