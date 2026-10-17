// Compiles the contracts and writes web/artifacts.json (abi + bytecode). Run: node build.mjs (from gapguard/web).
// Uses the solc already installed for the live demo (gapguard/live/node_modules/solc).
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "live", "package.json"));
const solc = require("solc");
const CDIR = path.join(here, "..", "contracts");
const sources = {};
for (const f of ["Mocks.sol", "GapGuardVault.sol"]) sources[f] = { content: fs.readFileSync(path.join(CDIR, f), "utf8") };
const input = { language: "Solidity", sources,
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } };
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = (out.errors || []).filter(e => e.severity === "error");
if (errs.length) { console.error(errs.map(e => e.formattedMessage).join("\n")); process.exit(1); }
const pick = (f, n) => ({ abi: out.contracts[f][n].abi, bytecode: "0x" + out.contracts[f][n].evm.bytecode.object });
const A = { solcVersion: solc.version(),
  MockERC20: pick("Mocks.sol", "MockERC20"), MockReferenceOracle: pick("Mocks.sol", "MockReferenceOracle"),
  MockDex: pick("Mocks.sol", "MockDex"), GapGuardVault: pick("GapGuardVault.sol", "GapGuardVault") };
fs.writeFileSync(path.join(here, "artifacts.json"), JSON.stringify(A));
console.log(`wrote artifacts.json (solc ${A.solcVersion})`);
