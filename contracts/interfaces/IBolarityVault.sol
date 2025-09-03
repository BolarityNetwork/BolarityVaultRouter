// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/interfaces/IERC4626.sol";

interface IBolarityVault is IERC4626 {
    event FeeCrystallized(
        uint256 P0,
        uint256 P1,
        uint256 dP,
        uint16 perfFeeBps,
        uint256 feeShares
    );
    event StrategyChanged(address oldStrategy, address newStrategy);
    event Invested(address strategy, uint256 amount);
    event Divested(address strategy, uint256 amount);

    function setStrategy(address newStrategy) external;
    function setPerfFeeBps(uint16 newBps) external;
    function setFeeCollector(address newCollector) external;
    function pause() external;
    function unpause() external;
    function emergencyWithdraw(uint256 amount) external;
    function perfFeeBps() external view returns (uint16);
    function feeCollector() external view returns (address);
    function strategy() external view returns (address);
    function lastP() external view returns (uint256);
}