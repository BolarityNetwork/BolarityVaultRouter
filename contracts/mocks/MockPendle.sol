// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./MockERC20.sol";

contract MockPendlePT is ERC20 {
    using SafeERC20 for IERC20;
    
    address public underlying;
    uint256 public maturity;
    bool public expired;
    
    constructor(address _underlying, uint256 _maturity) 
        ERC20("Mock Pendle PT", "mPT") {
        underlying = _underlying;
        maturity = _maturity;
        expired = false;
    }
    
    function isExpired() external view returns (bool) {
        return expired || block.timestamp >= maturity;
    }
    
    function setExpired(bool _expired) external {
        expired = _expired;
    }
    
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
    function redeemPY(address receiver, uint256 amount) external returns (uint256) {
        require(this.isExpired(), "MockPendlePT: Not expired");
        _burn(msg.sender, amount);
        MockERC20(underlying).mint(receiver, amount);
        return amount;
    }
}

contract MockPendleRouter {
    using SafeERC20 for IERC20;
    
    // Simulate PT trading with discount (e.g., 100 USDC -> 108 PT)
    uint256 public constant PT_DISCOUNT_RATE = 108; // 8% discount
    
    // Mapping from market to PT token
    mapping(address => address) public marketToPT;
    
    // Function to set market to PT mapping for testing
    function setMarketToPT(address market, address pt) external {
        marketToPT[market] = pt;
    }
    
    enum SwapType {
        NONE,
        KYBERSWAP,
        ONE_INCH,
        ETH_WETH
    }
    
    struct SwapData {
        SwapType swapType;
        address extRouter;
        bytes extCalldata;
        bool needScale;
    }
    
    struct ApproxParams {
        uint256 guessMin;
        uint256 guessMax;
        uint256 guessOffchain;
        uint256 maxIteration;
        uint256 eps;
    }
    
    struct TokenInput {
        address tokenIn;
        uint256 netTokenIn;
        address tokenMintSy;
        address pendleSwap;
        SwapData swapData;
    }
    
    struct TokenOutput {
        address tokenOut;
        uint256 minTokenOut;
        address tokenRedeemSy;
        address pendleSwap;
        SwapData swapData;
    }
    
    struct Order {
        uint256 salt;
        uint256 expiry;
        uint256 nonce;
        uint8 orderType;
        address token;
        address YT;
        address maker;
        address receiver;
        uint256 makingAmount;
        uint256 lnImpliedRate;
        uint256 failSafeRate;
        bytes permit;
    }
    
    struct FillOrderParams {
        Order order;
        bytes signature;
        uint256 makingAmount;
    }
    
    struct LimitOrderData {
        address limitRouter;
        uint256 epsSkipMarket;
        FillOrderParams[] normalFills;
        FillOrderParams[] flashFills;
        bytes optData;
    }
    
    function swapExactTokenForPt(
        address receiver,
        address market,
        uint256 minPtOut,
        ApproxParams memory approxParams,
        TokenInput memory input,
        LimitOrderData memory limit
    ) external returns (uint256 netPtOut, uint256 netSyFee, uint256 netSyInterm) {
        // Transfer tokens from caller to this contract
        IERC20(input.tokenIn).safeTransferFrom(msg.sender, address(this), input.netTokenIn);
        
        // Calculate PT output with discount
        netPtOut = (input.netTokenIn * PT_DISCOUNT_RATE) / 100;
        
        require(netPtOut >= minPtOut, "MockPendleRouter: Insufficient PT output");
        
        // Get the PT token associated with this market
        // In the test, market is not used, but we have the mapping
        // For simplicity, we'll get PT from the marketToPT mapping
        address ptAddress = marketToPT[market];
        require(ptAddress != address(0), "MockPendleRouter: PT not found for market");
        
        MockPendlePT pt = MockPendlePT(ptAddress);
        pt.mint(receiver, netPtOut);
        
        netSyFee = 0;
        netSyInterm = 0;
    }
    
    function swapExactPtForToken(
        address receiver,
        address market,
        uint256 exactPtIn,
        TokenOutput memory output,
        LimitOrderData memory limit
    ) external returns (uint256 netTokenOut, uint256 netSyFee, uint256 netSyInterm) {
        // Get PT address from market
        address ptAddress = marketToPT[market];
        require(ptAddress != address(0), "MockPendleRouter: PT not found for market");
        MockPendlePT pt = MockPendlePT(ptAddress);
        
        // Transfer PT tokens from caller
        IERC20(ptAddress).safeTransferFrom(msg.sender, address(this), exactPtIn);
        
        // Calculate underlying output (reverse of discount)
        netTokenOut = (exactPtIn * 100) / PT_DISCOUNT_RATE;
        
        require(netTokenOut >= output.minTokenOut, "MockPendleRouter: Insufficient output");
        
        // Verify tokenRedeemSy is the expected asset (underlying)
        require(output.tokenRedeemSy == pt.underlying(), "MockPendleRouter: Invalid tokenRedeemSy");
        
        // Get the underlying token and mint to receiver
        address underlying = pt.underlying();
        // In a real router, tokens would come from liquidity pools
        // For testing, we mint to simulate the swap
        MockERC20(underlying).mint(receiver, netTokenOut);
        
        netSyFee = 0;
        netSyInterm = 0;
    }
}

contract MockPendleOracle {
    mapping(address => uint256) public ptRates;
    
    function getPtToAssetRate(address market, uint32 duration) external view returns (uint256) {
        uint256 rate = ptRates[market];
        // Default to the same rate as the router uses: 100/108 ≈ 0.9259
        return rate > 0 ? rate : 925925925925925926; // More precise: 100/108 * 1e18
    }
    
    function setPtToAssetRate(address market, uint256 rate) external {
        ptRates[market] = rate;
    }
}