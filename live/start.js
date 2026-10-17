// Weekend Gap Guard live demo: real local EVM (Hardhat node, chainId 31337) + real contracts.
// Accounts are Hardhat's default public dev accounts: 0 owner (also runs the mocks), 1 AI trading agent. No real keys.
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { ethers } = require("ethers");

const RPC_PORT = 8546, WEB_PORT = 5178;
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
const CDIR = path.join(__dirname, "..", "contracts");
const PUB = path.join(__dirname, "public");
const P = ethers.parseEther;

// ---- 1. start Hardhat node ----
const hh = spawn(process.execPath,
  [require.resolve("hardhat/internal/cli/bootstrap.js"), "node", "--hostname", "127.0.0.1", "--port", String(RPC_PORT)],
  { cwd: __dirname, env: { ...process.env, HARDHAT_DISABLE_TELEMETRY_PROMPT: "true" }, stdio: ["ignore", "pipe", "pipe"] });
hh.stdout.resume();
hh.stderr.on("data", d => process.stderr.write("[node] " + d));
hh.on("exit", c => { console.error("[node] exited", c); process.exit(1); });
const cleanup = () => { try { hh.kill(); } catch {} };
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => { cleanup(); process.exit(0); });

// ---- 2. compile ----
function compile() {
  const sources = {};
  for (const f of ["Mocks.sol", "GapGuardVault.sol"]) sources[f] = { content: fs.readFileSync(path.join(CDIR, f), "utf8") };
  const input = { language: "Solidity", sources,
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter(e => e.severity === "error");
  if (errs.length) throw new Error(errs.map(e => e.formattedMessage).join("\n"));
  const pick = (f, n) => ({ abi: out.contracts[f][n].abi, bytecode: "0x" + out.contracts[f][n].evm.bytecode.object });
  return { ERC20: pick("Mocks.sol", "MockERC20"), Oracle: pick("Mocks.sol", "MockReferenceOracle"), Dex: pick("Mocks.sol", "MockDex"),
           Vault: pick("GapGuardVault.sol", "GapGuardVault"), solcVersion: solc.version() };
}

let provider, A, accounts, state = {};

async function deploy() {
  const owner = await provider.getSigner(0);
  const dep = async (art, ...args) => { const c = await new ethers.ContractFactory(art.abi, art.bytecode, owner).deploy(...args); const r = await c.deploymentTransaction().wait(); return { c, r }; };
  const send = async p => (await (await p).wait());
  const usdt = await dep(A.ERC20, "Tether USD (mock)", "USDT");
  const nvda = await dep(A.ERC20, "Backed NVIDIA (mock)", "bNVDA");
  const aapl = await dep(A.ERC20, "Backed Apple (mock)", "bAAPL");
  const rug = await dep(A.ERC20, "Totally Real Stock", "RUG");
  const oracle = await dep(A.Oracle);
  const dex = await dep(A.Dex, await usdt.c.getAddress());
  const vault = await dep(A.Vault, accounts.agent, await usdt.c.getAddress(), await oracle.c.getAddress(), await dex.c.getAddress(), P("100"), 500, 300);
  const addr = { usdt: await usdt.c.getAddress(), bNVDA: await nvda.c.getAddress(), bAAPL: await aapl.c.getAddress(), RUG: await rug.c.getAddress(),
                 oracle: await oracle.c.getAddress(), dex: await dex.c.getAddress(), vault: await vault.c.getAddress() };
  for (const t of [nvda, aapl, rug]) await send(t.c.setMinter(addr.dex, true));
  await send(usdt.c.mint(addr.vault, P("1000")));
  await send(vault.c.setWhitelist(addr.bNVDA, true));
  await send(vault.c.setWhitelist(addr.bAAPL, true));
  await send(oracle.c.setReferencePrice(addr.bNVDA, P("180")));
  await send(oracle.c.setReferencePrice(addr.bAAPL, P("230")));
  await send(oracle.c.setMarketOpen(false));
  await send(dex.c.setPrice(addr.bNVDA, P("181")));
  await send(dex.c.setPrice(addr.bAAPL, P("231")));
  await send(dex.c.setPrice(addr.RUG, P("0.05")));
  state = { addr, deployTx: vault.r.hash, deployBlock: vault.r.blockNumber, deployedAt: new Date().toISOString() };
  console.log(`[deploy] GapGuardVault @ ${addr.vault} (block ${vault.r.blockNumber}) · 1000 USDT · limit 100/day · bands 5% open / 3% closed · market CLOSED`);
  return state;
}

async function waitRpc() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
      if (r.ok) return new ethers.JsonRpcProvider(RPC_URL, 31337, { staticNetwork: true });
    }
    catch { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error("Hardhat node did not start on " + RPC_URL);
}

function config() {
  return { ...state, chainId: 31337, rpc: "/rpc", accounts, solc: A.solcVersion,
           abi: { erc20: A.ERC20.abi, oracle: A.Oracle.abi, dex: A.Dex.abi, vault: A.Vault.abi } };
}

// ---- 3. web server ----
function serve() {
  const ETHERS = path.join(__dirname, "node_modules", "ethers", "dist", "ethers.min.js");
  http.createServer(async (req, res) => {
    try {
      const url = req.url.split("?")[0];
      if (url === "/rpc" && req.method === "POST") {   // proxy JSON-RPC to the local node
        const chunks = []; for await (const c of req) chunks.push(c);
        const r = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: Buffer.concat(chunks) });
        res.writeHead(r.status, { "content-type": "application/json" }); return res.end(await r.text());
      }
      if (url === "/config.json") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); return res.end(JSON.stringify(config())); }
      if (url === "/reset" && req.method === "POST") { await deploy(); res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(config())); }
      if (url === "/vendor/ethers.min.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(fs.readFileSync(ETHERS)); }
      if (url === "/" || url === "/index.html") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return res.end(fs.readFileSync(path.join(PUB, "index.html"))); }
      res.writeHead(404); res.end("not found");
    } catch (e) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: String(e.message || e) })); }
  }).listen(WEB_PORT, "127.0.0.1", () => console.log(`[web] Weekend Gap Guard live demo → http://localhost:${WEB_PORT}`));
}

(async () => {
  A = compile();
  console.log(`[solc] compiled MockERC20, MockReferenceOracle, MockDex, GapGuardVault with ${A.solcVersion}`);
  provider = await waitRpc();
  const list = await provider.listAccounts();
  accounts = { owner: list[0].address, agent: list[1].address };
  console.log(`[node] Hardhat EVM up at ${RPC_URL}, chainId ${(await provider.getNetwork()).chainId}`);
  await deploy();
  serve();
})().catch(e => { console.error(e); cleanup(); process.exit(1); });
