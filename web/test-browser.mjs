// Headless Chrome test of the static site (serve web/ on :5190 first: npm run serve). Clicks ①..⑦ and asserts outcomes.
// Usage: node test-browser.mjs [url]   (CHROME env var overrides the Chrome path)
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const URL = process.argv[2] || "http://127.0.0.1:5190/";
const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", e => errs.push(String(e)));
page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
const t0 = Date.now();
await page.goto(URL);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
console.log(`booted+deployed in ${Date.now() - t0} ms`);
const rug = await page.evaluate(() => document.querySelector("#tbl").innerText);
console.log("table:\n" + rug);
let fails = 0;
async function click(n, want) {
  await page.click(`button[data-s="${n}"]`);
  await page.waitForFunction(() => window.__busy === false, null, { timeout: 60000 });
  const got = await page.evaluate(() => window.__lastOutcome);
  const ok = want instanceof RegExp ? want.test(got) : got === want;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}: ${got}`);
}
await click(1, "SUCCESS");
await click(2, "REVERT PriceGapTooWide(1055, 300, false)");
await click(3, "REVERT NotWhitelisted(RUG)");
await click(4, "REVERT DailyLimitExceeded(90, 80)");
await click(5, "SUCCESS");
const st = await page.evaluate(() => ({ bal: document.querySelector("#bal").innerText, spent: document.querySelector("#spent").innerText }));
console.log("after 5:", JSON.stringify(st));
await click(6, "REVERT VaultFrozen()");
const vaultBefore = await page.evaluate(() => document.querySelector("#addr").innerText);
await click(7, null);
const after7 = await page.evaluate(() => ({ vault: document.querySelector("#addr").innerText, bal: document.querySelector("#bal").innerText, spent: document.querySelector("#spent").innerText, status: document.querySelector("#status").innerText, market: document.querySelector("#market").innerText }));
console.log("reset:", vaultBefore, "->", JSON.stringify(after7));
if (after7.vault === vaultBefore) { fails++; console.log("FAIL reset did not redeploy"); }
await click(1, "SUCCESS");
const logTxt = await page.evaluate(() => document.querySelector("#log").innerText);
const mined = logTxt.split("\n").filter(l => l.includes("mined as FAILED"));
console.log(`mined-failed lines: ${mined.length}\n  ` + mined.join("\n  "));
if (mined.length < 4) { fails++; console.log("FAIL expected mined failed txs"); }

console.log("page errors:", errs.length ? errs : "none");
await browser.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
