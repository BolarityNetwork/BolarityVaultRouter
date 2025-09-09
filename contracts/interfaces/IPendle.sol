// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IPendleRouter
 * @notice Interface for Pendle Router V3
 */
interface IPendleRouter {
    struct TokenInput {
        address tokenIn;
        uint256 netTokenIn;
        address tokenMintSy;
        address pendleSwap;
        SwapData swapData;
    }
    
    struct SwapData {
        SwapType swapType;
        address extRouter;
        bytes extCalldata;
        bool needScale;
    }
    
    enum SwapType {
        NONE,
        KYBERSWAP,
        ONE_INCH,
        ETH_WETH
    }
    
    struct ApproxParams {
        uint256 guessMin;
        uint256 guessMax;
        uint256 guessOffchain;
        uint256 maxIteration;
        uint256 eps;
    }
    
    /**
     * @notice Swap exact tokens for PT
     * @param receiver Address to receive PT
     * @param market Pendle market address
     * @param minPtOut Minimum PT to receive
     * @param input Token input details
     * @return netPtOut Amount of PT received
     * @return netSyFee Amount of SY fee
     */
    function swapExactTokenForPt(
        address receiver,
        address market,
        uint256 minPtOut,
        ApproxParams calldata guessPtOut,
        TokenInput calldata input
    ) external returns (uint256 netPtOut, uint256 netSyFee);
    
    /**
     * @notice Swap PT for exact tokens
     * @param receiver Address to receive tokens
     * @param market Pendle market address
     * @param exactPtIn Exact amount of PT to swap
     * @param output Token output details
     * @return netTokenOut Amount of tokens received
     * @return netSyFee Amount of SY fee
     */
    function swapExactPtForToken(
        address receiver,
        address market,
        uint256 exactPtIn,
        TokenOutput calldata output
    ) external returns (uint256 netTokenOut, uint256 netSyFee);
    
    struct TokenOutput {
        address tokenOut;
        uint256 minTokenOut;
        address tokenRedeemSy;
        address pendleSwap;
        SwapData swapData;
    }
}

/**
 * @title IPendleMarket
 * @notice Interface for Pendle Market
 */
interface IPendleMarket is IERC20 {
    /**
     * @notice Get the PT token address
     * @return _SY Address of SY token
     * @return _PT Address of PT token
     * @return _YT Address of YT token
     */
    function readTokens() external view returns (
        address _SY,
        address _PT,
        address _YT
    );
    
    /**
     * @notice Get market expiry timestamp
     * @return Expiry timestamp
     */
    function expiry() external view returns (uint256);
    
    /**
     * @notice Check if market has expired
     * @return True if expired
     */
    function isExpired() external view returns (bool);
    
    /**
     * @notice Get current market exchange rate
     * @return syReserve SY token reserves
     * @return ptReserve PT token reserves
     */
    function getReserves() external view returns (uint256 syReserve, uint256 ptReserve);
}

/**
 * @title IPendlePT
 * @notice Interface for Pendle Principal Token
 */
interface IPendlePT is IERC20 {
    /**
     * @notice Get the SY token address
     * @return Address of SY token
     */
    function SY() external view returns (address);
    
    /**
     * @notice Get the YT token address
     * @return Address of YT token
     */
    function YT() external view returns (address);
    
    /**
     * @notice Get maturity timestamp
     * @return Maturity timestamp
     */
    function expiry() external view returns (uint256);
    
    /**
     * @notice Check if PT has matured
     * @return True if matured
     */
    function isExpired() external view returns (bool);
    
    /**
     * @notice Redeem PT for underlying after maturity
     * @param receiver Address to receive underlying
     * @param amountPTIn Amount of PT to redeem
     * @return amountOut Amount of underlying received
     */
    function redeemPY(address receiver, uint256 amountPTIn) external returns (uint256 amountOut);
}

/**
 * @title IPendleSY
 * @notice Interface for Pendle Standardized Yield Token
 */
interface IPendleSY is IERC20 {
    /**
     * @notice Get the underlying asset
     * @return Address of underlying asset
     */
    function asset() external view returns (address);
    
    /**
     * @notice Deposit underlying for SY
     * @param receiver Address to receive SY
     * @param tokenIn Address of token to deposit
     * @param amountTokenIn Amount of token to deposit
     * @param minSharesOut Minimum SY shares to receive
     * @return amountSharesOut Amount of SY shares received
     */
    function deposit(
        address receiver,
        address tokenIn,
        uint256 amountTokenIn,
        uint256 minSharesOut
    ) external returns (uint256 amountSharesOut);
    
    /**
     * @notice Redeem SY for underlying
     * @param receiver Address to receive underlying
     * @param amountSharesToRedeem Amount of SY shares to redeem
     * @param tokenOut Address of token to receive
     * @param minAmountTokenOut Minimum amount of token to receive
     * @return amountTokenOut Amount of token received
     */
    function redeem(
        address receiver,
        uint256 amountSharesToRedeem,
        address tokenOut,
        uint256 minAmountTokenOut,
        bool burnFromInternalBalance
    ) external returns (uint256 amountTokenOut);
    
    /**
     * @notice Preview deposit
     * @param tokenIn Address of token to deposit
     * @param amountTokenIn Amount of token to deposit
     * @return amountSharesOut Amount of SY shares that would be received
     */
    function previewDeposit(
        address tokenIn,
        uint256 amountTokenIn
    ) external view returns (uint256 amountSharesOut);
    
    /**
     * @notice Preview redeem
     * @param tokenOut Address of token to receive
     * @param amountSharesToRedeem Amount of SY shares to redeem
     * @return amountTokenOut Amount of token that would be received
     */
    function previewRedeem(
        address tokenOut,
        uint256 amountSharesToRedeem
    ) external view returns (uint256 amountTokenOut);
    
    /**
     * @notice Get exchange rate
     * @return Exchange rate
     */
    function exchangeRate() external view returns (uint256);
}

/**
 * @title IPendleOracle
 * @notice Interface for Pendle Oracle
 */
interface IPendleOracle {
    /**
     * @notice Get PT price in asset
     * @param market Pendle market address
     * @param duration TWAP duration
     * @return ptRate PT price in asset
     */
    function getPtToAssetRate(
        address market,
        uint32 duration
    ) external view returns (uint256 ptRate);
}