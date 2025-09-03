// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IRegistry {
    event VaultRegistered(address indexed asset, bytes32 indexed market, address indexed vault);
    event PreferredMarketSet(address indexed asset, bytes32 indexed market);

    function registerVault(address asset, bytes32 market, address vault) external;
    function setPreferredMarket(address asset, bytes32 market) external;
    function getVault(address asset, bytes32 market) external view returns (address);
    function getPreferredMarket(address asset) external view returns (bytes32);
}