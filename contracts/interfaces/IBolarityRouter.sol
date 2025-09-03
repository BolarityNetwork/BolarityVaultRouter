// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IBolarityRouter {
    // Write functions
    function deposit(
        address asset,
        bytes32 market,
        uint256 assets,
        address receiver
    ) external returns (uint256 shares);

    function withdraw(
        address asset,
        bytes32 market,
        uint256 assets,
        address receiver,
        address owner
    ) external returns (uint256 shares);

    function mint(
        address asset,
        bytes32 market,
        uint256 shares,
        address receiver
    ) external returns (uint256 assets);

    function redeem(
        address asset,
        bytes32 market,
        uint256 shares,
        address receiver,
        address owner
    ) external returns (uint256 assets);

    // Read functions
    function vaultFor(address asset, bytes32 market) external view returns (address);

    function previewDeposit(
        address asset,
        bytes32 market,
        uint256 assets
    ) external view returns (uint256 shares);

    function previewWithdraw(
        address asset,
        bytes32 market,
        uint256 assets
    ) external view returns (uint256 shares);

    function previewMint(
        address asset,
        bytes32 market,
        uint256 shares
    ) external view returns (uint256 assets);

    function previewRedeem(
        address asset,
        bytes32 market,
        uint256 shares
    ) external view returns (uint256 assets);

    // Optional convenience function for migration
    function migrate(
        address asset,
        bytes32 marketFrom,
        bytes32 marketTo,
        uint256 shares,
        address receiver
    ) external returns (uint256 newShares);
}