// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IStrategy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockStrategy is IStrategy {
    // Track funds for simulation
    mapping(address => uint256) public vaultFunds;
    
    // This simulates receiving funds during deposit
    function receiveFunds(address asset, uint256 amount) external {
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        vaultFunds[msg.sender] += amount;
    }
    
    // This simulates returning funds during withdrawal
    function returnFunds(address asset, address to, uint256 amount) external {
        require(vaultFunds[msg.sender] >= amount, "Insufficient funds");
        vaultFunds[msg.sender] -= amount;
        IERC20(asset).transfer(to, amount);
    }
    
    function investDelegate(
        address,
        uint256 amountIn,
        bytes calldata
    ) external pure override returns (uint256 accounted, uint256 entryGain) {
        // In delegatecall context, funds stay in vault
        return (amountIn, 0);
    }

    function divestDelegate(
        address,
        uint256 amountOut,
        bytes calldata
    ) external pure override returns (uint256 accountedOut, uint256 exitGain) {
        // In delegatecall context, funds stay in vault
        return (amountOut, 0);
    }

    function emergencyWithdrawDelegate(
        address,
        uint256,
        bytes calldata
    ) external pure override returns (uint256) {
        return 0;
    }

    function totalUnderlying(address vault) external view override returns (uint256) {
        return vaultFunds[vault];
    }
    
    function previewInvest(
        address,
        uint256 amountIn
    ) external pure override returns (uint256 accounted, uint256 entryGain) {
        return (amountIn, 0);
    }
}