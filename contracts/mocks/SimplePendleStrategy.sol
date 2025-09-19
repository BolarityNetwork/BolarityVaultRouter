// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IStrategy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SimplePendleStrategy is IStrategy {
    
    function investDelegate(
        address asset,
        uint256 amountIn,
        bytes calldata data
    ) external override returns (uint256 accounted, uint256 entryGain) {
        // Just return the amount with a 10% gain
        accounted = amountIn;
        entryGain = amountIn / 10;
        return (accounted, entryGain);
    }
    
    function divestDelegate(
        address asset,
        uint256 amountOut,
        bytes calldata data
    ) external override returns (uint256 accountedOut, uint256 exitGain) {
        return (amountOut, 0);
    }
    
    function totalUnderlying(address vault) external view override returns (uint256) {
        return 0;
    }
    
    function previewInvest(
        address asset,
        uint256 amountIn
    ) external view override returns (uint256 accounted, uint256 entryGain) {
        accounted = amountIn;
        entryGain = amountIn / 10;
        return (accounted, entryGain);
    }
}