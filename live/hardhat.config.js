// Local EVM only. Uses Hardhat's built-in, publicly known dev accounts. No real keys.
module.exports = {
  solidity: "0.8.20",
  networks: { hardhat: { chainId: 31337 } },
};
