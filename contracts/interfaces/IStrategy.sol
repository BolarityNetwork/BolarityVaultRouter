// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IStrategy {
    function underlying() external view returns (address);
    function totalUnderlying() external view returns (uint256);
    function invest(uint256 amount) external;
    function divest(uint256 amount) external;
    function emergencyWithdraw(uint256 amount) external;
}