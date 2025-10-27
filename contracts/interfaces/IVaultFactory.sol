// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IVaultFactory {
    function createVault(
        address asset,
        bytes32 market,
        address strategy,
        address feeCollector,
        uint256 performanceFeeBps,
        string memory name,
        string memory symbol
    ) external returns (address vault);
    
    function getVault(address asset, bytes32 market) external view returns (address);
    function registry() external view returns (address);
    function owner() external view returns (address);
}