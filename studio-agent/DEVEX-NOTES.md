# BNB Agent Studio developer-experience notes (raw, factual)

Environment: Windows 11, Git Bash, Node v24.12.0, no global pnpm, no Docker. Studio CLI `@bnbagent/studio-cli@0.0.15`, published the day before we used it (52 versions on npm). Date: 2026-10-17. Total time from `npm view` to a passing demo was about 20 min.

## Timeline

| Step | Time | Notes |
| --- | --- | --- |
| `npm view @bnbagent/studio-cli` | <1 min | Package exists. Its description says **"Skills-first toolkit and bag CLI for BNB Chain seller agents: ERC-8004 identity, ERC-8183 escrowed commerce, and x402 payments"** |
| `npm i -D @bnbagent/studio-cli` (local) | 50 s | 283 packages. One warning: `npm warn deprecated prebuild-install@7.1.3: No longer maintained.` |
| `bag init gapguardagent --no-onboard --no-install ...` | 3 s | Worked first try |
| `npx -y pnpm@10.24.0 install` (workspace) | 34 s | Warning box: `Ignored build scripts: esbuild. Run "pnpm approve-builds"...`. `tsx` still worked |
| `bag wallet new --private-key -` (import dev key via stdin) | seconds | Worked first try |
| `bag doctor` | ~10 s | Useful output (see below) |
| Writing glue (`signing.ts` addition, decide, demo) | ~8 min | |
| First demo run | — | Failed on the Hardhat revert behaviour (ours to handle, not Studio's; see below) |
| Second demo run | 14 s | PASS |

## Friction and observations

1. **Studio is a seller-agent framework, not a generic trading-agent one.** The workshop pitch is "describe the agent in plain English". In practice `bag init` always scaffolds an ERC-8183/x402 *seller* (`sellerCore.ts` `runWork`, `signQuote`/`submitResult`/`settle`). No recipe or template fits "an agent that watches prices and trades" (`bag recipe list` lists `agent, mpp-buyer, tools-chain, wallet, x402-buyer`). We had to add our own write op next to the generated ones in `signing.ts`.
2. **The skills-first install defaults to global scope.** The README's primary path is `npm install --global` followed by `bag skills install`, and the scripted example is `--target both --scope user`. We wanted nothing global, so we skipped the skill and drove `bag` directly. A local `npm i -D` plus `npx bag` / `node_modules/.bin/bag` works fine.
3. **`bag init` writes outside the project anyway.** It creates `~/.bnbagent-studio/projects.toml` (the global agent registry). Neither `--no-onboard` nor `--no-install` stops this.
4. **pnpm is required.** The README says "Corepack and pnpm 10". `bag init` without `--no-install` runs `pnpm install`. On a machine without pnpm the clean answer is `npx -y pnpm@10.24.0 install`. Enabling Corepack would modify the Node install, which we avoided.
5. **Project names are strict.** `<name>` must be "ASCII alphanumerics only, ... ≤23 chars. Names with '-'/'_'/'.' are rejected". So `gapguard-agent` is rejected and we used `gapguardagent`. The rule is documented in `--help`, but it is surprising for an npm-style project name.
6. **`bag init --help` is about 110 lines of flags.** Runtime, destination, protocols, payment protocol, rails, three price flags (two legacy), LLM, wallet, storage, IDE, auto-topup and more. A bare TTY `bag init` would prompt interactively, but under an agent or CI you have to work out the flag set yourself.
7. **The generated `studio.toml` has untranslated Chinese comments** in `[payments.seller]`, for example `# 所有 Seller rail 与已配置资产共用同一个 USD 标价；"0" 表示 FREE。` Every other comment is English.
8. **The `--rails b402` intent is unclear.** We passed `--rails b402`, but the generated `[payments.seller]` comment still talks about the ERC-8183 contract stack, and `signing.ts` still contains the full ERC-8183 quote/submit/settle code. We did not dig further.
9. **The wallet import UX is good.** `bag wallet new --private-key -` reads the key from stdin and refuses an inline key on argv. `--save-password` takes `WALLET_PASSWORD` from the environment and writes it to `.studio/.env.local` (0600). It also updates `studio.toml [wallet].address` automatically. The keystore lands at the workspace root `.studio/wallets/`, which is already gitignored by the scaffold.
10. **`getWallet()` signs arbitrary chains.** `EVMWalletProvider.signTransaction({ ..., chainId: 31337 })` signed a legacy transaction for our local Hardhat chain with no policy complaint. The `SigningPolicy` only gates EIP-712 typed data. This is why we could plug a non-BSC contract into the Studio wallet in about 30 lines. Whether that is intended is worth a doc line, because a "bounded signing" story usually implies chain or contract allowlists for transactions too.
11. **WALLET_PASSWORD loading outside `bag` is manual.** `bag` auto-loads `.studio/.env.local`, but a plain `tsx` script does not. We had to call `loadEnv(<workspace>/.studio/.env.local)` from `@bnbagent/studio-runtime/config` ourselves, and the path is relative to `app/agent/`.
12. **The free LLM is not zero-step.** `auto/free` is "$0/token", but `bag llm test` prints `skipped: PIEVERSE_LLM_API_KEY not set (provider=pieverse-llm, model=auto/free)`. You need `bag llm activate` first: "SIWE + create key + initial allocation". That means an account on Pieverse tied to the wallet (`[llm.pieverse].network = "bsc-mainnet"`). We did not do this with a publicly known dev key, so our DECIDE step is a labelled deterministic stub. Also note: the generated `model.ts` throws `[llm.pieverse].key_hash is missing in studio.toml` when auto-renew is on and the key is absent, so even the "free" default fails at runtime until activation.
13. **`bag doctor` is the best part.** It gave clear PASS/WARN/FAIL lines, with exact fixes and faucet instructions. With a fresh scaffold and an imported wallet it reported:
    - `[FAIL] x402 credentials — PAID mode needs the four B402 merchant credentials; without them the rail starts dormant.` The default price is $0.10 PAID, so a fresh scaffold starts with a FAIL. A FREE default for local dev would be friendlier.
    - `[WARN] wallet BNB balance — 0 wei ... need ≥ 0.02 BNB on bsc-testnet for 8183 escrow / ERC-8004 register`
    - `[WARN] deploy: AWS credentials — not configured`, plus `docker — not found` and `twak CLI — not found`. These WARNs appear even though the project uses `evm-local`, not twak.
    - It made outbound calls to `https://bsc-testnet-rpc.publicnode.com`. Fine, but there is no offline mode flag in the output.
14. **This one is not Studio's fault, but you hit it when you bring your own contract.** The Hardhat node *mines* a reverting tx, but answers `eth_sendRawTransaction` with JSON-RPC error `-32603` (`reverted with an unrecognized custom error (return data: 0xc8c34f3b...)`) carrying `data.txHash`. viem surfaces this as `InternalRpcError`. We recover the hash from the error and decode the custom error with the vault ABI.
15. **The default deploy path is not neutral.** The "Next steps" printed by `bag init` end with `bag deploy --provider aws`, even with `--destination self`. The README says every deploy asks for a provider explicitly, which matches. The managed-trial path (`--destination platform`) transmits the wallet key to the operator. `--help` says so clearly, but it is easy to miss.

## Not attempted

- `bag skills install` / the `/bnbagent-studio` skill. It would write to the user's Claude Code or Cursor directories, which we did not want.
- `bag dev`, `bag deploy`, `bag erc8004 register`, `bag llm activate`, `bag platform login`. These need a funded testnet wallet, a Pieverse account, or a GitHub login, which require user action and a non-public key.
