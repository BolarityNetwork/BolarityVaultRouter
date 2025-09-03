// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IRegistry.sol";

contract Registry is IRegistry, Ownable {
    mapping(address => mapping(bytes32 => address)) private vaults;
    mapping(address => bytes32) private preferredMarkets;

    constructor() Ownable(msg.sender) {}

    function registerVault(
        address asset,
        bytes32 market,
        address vault
    ) external onlyOwner {
        require(asset != address(0), "Registry: Invalid asset");
        require(market != bytes32(0), "Registry: Invalid market");
        require(vault != address(0), "Registry: Invalid vault");
        require(vaults[asset][market] == address(0), "Registry: Vault already registered");

        vaults[asset][market] = vault;
        emit VaultRegistered(asset, market, vault);
    }

    function setPreferredMarket(address asset, bytes32 market) external onlyOwner {
        require(asset != address(0), "Registry: Invalid asset");
        require(market != bytes32(0), "Registry: Invalid market");
        require(vaults[asset][market] != address(0), "Registry: Vault not registered");

        preferredMarkets[asset] = market;
        emit PreferredMarketSet(asset, market);
    }

    function getVault(address asset, bytes32 market) external view returns (address) {
        return vaults[asset][market];
    }

    function getPreferredMarket(address asset) external view returns (bytes32) {
        return preferredMarkets[asset];
    }
}