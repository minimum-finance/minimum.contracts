// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12;

/*
 * @dev Interface for StakingHelper contracts used with rebasing tokens.
 * @author minimum.finance
 */
interface IRebaseStaker {
    function stake(uint256 _amount) external;
}
