// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12;

/*
 * @dev Interface for OlympusStaking contracts used with rebasing tokens.
 * @author minimum.finance
 */
interface IStakingManager {
    function unstake(uint256 _amount, bool _trigger) external;

    function rebase() external;
}
