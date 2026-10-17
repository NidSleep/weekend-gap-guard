// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}
interface IReferenceOracle {
    function referencePrice(address token) external view returns (uint256);
    function marketOpen() external view returns (bool);
}
interface IDex {
    function price(address token) external view returns (uint256);
    function swapExactUSDTForToken(address token, uint256 usdtIn, uint256 minOut, address to) external returns (uint256);
}

/// @title GapGuardVault
/// @notice USDT vault for an AI trading agent buying tokenized stocks 24/7.
///         The agent can buy, but the contract refuses trades that are off-whitelist, over the daily
///         budget, or where the DEX price has drifted too far from the reference price.
///         When the real market is closed (weekend) the reference is frozen at Friday close, so the band is tighter.
contract GapGuardVault {
    address public immutable owner;
    address public agent;
    IERC20 public immutable usdt;
    IReferenceOracle public oracle;
    IDex public dex;

    mapping(address => bool) public whitelist;   // allowed stock tokens
    uint256 public dailyLimit;                   // USDT (18 dec) per UTC day
    uint256 public currentDay;                   // block.timestamp / 1 days
    uint256 public spentToday;
    uint256 public maxGapBpsOpen;                // e.g. 500 = 5% while market is open
    uint256 public maxGapBpsClosed;              // e.g. 300 = 3% while market is closed
    bool public frozen;

    error NotOwner();
    error NotAgent();
    error VaultFrozen();
    error NotWhitelisted(address token);
    error DailyLimitExceeded(uint256 requested, uint256 remaining);
    error NoReferencePrice(address token);
    error PriceGapTooWide(uint256 gapBps, uint256 maxBps, bool marketOpen);
    error TransferFailed();

    event Bought(address indexed token, uint256 usdtIn, uint256 tokensOut, uint256 dexPrice, uint256 refPrice, uint256 gapBps, string memo);
    event WhitelistUpdated(address indexed token, bool allowed);
    event DailyLimitUpdated(uint256 limit);
    event GapBandsUpdated(uint256 openBps, uint256 closedBps);
    event AgentUpdated(address agent);
    event Frozen(bool frozen);
    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor(address _agent, IERC20 _usdt, IReferenceOracle _oracle, IDex _dex, uint256 _dailyLimit, uint256 _openBps, uint256 _closedBps) {
        owner = msg.sender;
        agent = _agent;
        usdt = _usdt;
        oracle = _oracle;
        dex = _dex;
        dailyLimit = _dailyLimit;
        maxGapBpsOpen = _openBps;
        maxGapBpsClosed = _closedBps;
        currentDay = block.timestamp / 1 days;
    }

    // ---------------- agent ----------------

    function buy(address token, uint256 usdtAmount, string calldata memo) external returns (uint256 tokensOut) {
        if (msg.sender != agent) revert NotAgent();
        if (frozen) revert VaultFrozen();
        if (!whitelist[token]) revert NotWhitelisted(token);

        _rollDay();
        uint256 remaining = dailyLimit > spentToday ? dailyLimit - spentToday : 0;
        if (usdtAmount > remaining) revert DailyLimitExceeded(usdtAmount, remaining);

        (uint256 gapBps, uint256 dexPrice, uint256 refPrice) = _checkGap(token);

        spentToday += usdtAmount; // effects before interaction
        tokensOut = _swap(token, usdtAmount, dexPrice);
        emit Bought(token, usdtAmount, tokensOut, dexPrice, refPrice, gapBps, memo);
    }

    /// Reverts if the DEX price is outside the active band (tighter while the real market is closed).
    function _checkGap(address token) internal view returns (uint256 gapBps, uint256 dexPrice, uint256 refPrice) {
        bool open;
        (gapBps, dexPrice, refPrice, open) = currentGap(token);
        uint256 maxBps = open ? maxGapBpsOpen : maxGapBpsClosed;
        if (gapBps > maxBps) revert PriceGapTooWide(gapBps, maxBps, open);
    }

    function _swap(address token, uint256 usdtAmount, uint256 dexPrice) internal returns (uint256) {
        if (!usdt.approve(address(dex), usdtAmount)) revert TransferFailed();
        uint256 minOut = usdtAmount * 1e18 / dexPrice * 99 / 100; // 1% slippage guard
        return dex.swapExactUSDTForToken(token, usdtAmount, minOut, address(this));
    }

    // ---------------- views ----------------

    /// gapBps = |dexPrice - refPrice| * 10000 / refPrice
    function currentGap(address token) public view returns (uint256 gapBps, uint256 dexPrice, uint256 refPrice, bool open) {
        refPrice = oracle.referencePrice(token);
        if (refPrice == 0) revert NoReferencePrice(token);
        dexPrice = dex.price(token);
        open = oracle.marketOpen();
        uint256 diff = dexPrice > refPrice ? dexPrice - refPrice : refPrice - dexPrice;
        gapBps = diff * 10000 / refPrice;
    }

    function remainingToday() external view returns (uint256) {
        uint256 spent = (block.timestamp / 1 days == currentDay) ? spentToday : 0;
        return dailyLimit > spent ? dailyLimit - spent : 0;
    }

    // ---------------- owner ----------------

    function deposit(uint256 amount) external onlyOwner {
        if (!usdt.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        emit Deposited(msg.sender, amount);
    }
    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        if (!IERC20(token).transfer(to, amount)) revert TransferFailed();
        emit Withdrawn(token, to, amount);
    }
    function setWhitelist(address token, bool allowed) external onlyOwner { whitelist[token] = allowed; emit WhitelistUpdated(token, allowed); }
    function setDailyLimit(uint256 limit) external onlyOwner { dailyLimit = limit; emit DailyLimitUpdated(limit); }
    function setGapBands(uint256 openBps, uint256 closedBps) external onlyOwner { maxGapBpsOpen = openBps; maxGapBpsClosed = closedBps; emit GapBandsUpdated(openBps, closedBps); }
    function setAgent(address a) external onlyOwner { agent = a; emit AgentUpdated(a); }
    function freeze() external onlyOwner { frozen = true; emit Frozen(true); }
    function unfreeze() external onlyOwner { frozen = false; emit Frozen(false); }

    function _rollDay() internal {
        uint256 today = block.timestamp / 1 days;
        if (today != currentDay) { currentDay = today; spentToday = 0; }
    }
}
