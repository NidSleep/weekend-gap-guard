// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// Minimal ERC20 for the demo (USDT, bNVDA, bAAPL, RUG). 18 decimals. Owner and approved minters can mint.
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    address public owner;
    mapping(address => bool) public minter;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol) { name = _name; symbol = _symbol; owner = msg.sender; minter[msg.sender] = true; }

    function setMinter(address m, bool on) external { require(msg.sender == owner, "owner"); minter[m] = on; }
    function mint(address to, uint256 amount) external {
        require(minter[msg.sender], "minter");
        totalSupply += amount; balanceOf[to] += amount; emit Transfer(address(0), to, amount);
    }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount; emit Approval(msg.sender, spender, amount); return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) { _move(msg.sender, to, amount); return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        _move(from, to, amount); return true;
    }
    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount; balanceOf[to] += amount; emit Transfer(from, to, amount);
    }
}

/// Reference price feed for tokenized stocks.
/// In production this is the BNB RWA Data API / Ondo / xStocks reference feed:
/// the underlying stock price (frozen at Friday close on weekends) plus market status.
contract MockReferenceOracle {
    address public owner;
    bool public marketOpen;
    mapping(address => uint256) public referencePrice; // USD, 1e18

    event ReferencePriceSet(address indexed token, uint256 price);
    event MarketStatusSet(bool open);

    constructor() { owner = msg.sender; }
    modifier onlyOwner() { require(msg.sender == owner, "owner"); _; }

    function setReferencePrice(address token, uint256 price) external onlyOwner { referencePrice[token] = price; emit ReferencePriceSet(token, price); }
    function setMarketOpen(bool open) external onlyOwner { marketOpen = open; emit MarketStatusSet(open); }
}

/// Fixed-price DEX stand-in (in production: a PancakeSwap pool for the tokenized stock).
contract MockDex {
    address public owner;
    MockERC20 public immutable usdt;
    mapping(address => uint256) public price; // USDT per token, 1e18

    event PriceSet(address indexed token, uint256 price);
    event Swapped(address indexed token, uint256 usdtIn, uint256 tokensOut, address indexed to);

    constructor(MockERC20 _usdt) { owner = msg.sender; usdt = _usdt; }

    function setPrice(address token, uint256 p) external { require(msg.sender == owner, "owner"); price[token] = p; emit PriceSet(token, p); }

    function swapExactUSDTForToken(address token, uint256 usdtIn, uint256 minOut, address to) external returns (uint256 out) {
        uint256 p = price[token];
        require(p > 0, "no pool");
        out = usdtIn * 1e18 / p;
        require(out >= minOut, "slippage");
        require(usdt.transferFrom(msg.sender, address(this), usdtIn), "pull");
        MockERC20(token).mint(to, out);
        emit Swapped(token, usdtIn, out, to);
    }
}
