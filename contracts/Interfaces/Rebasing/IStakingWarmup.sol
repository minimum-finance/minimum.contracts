// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12;

/*
 * @dev Interface for StakingWarmup contracts used with rebasing tokens.
 * @author minimum.finance
 */
interface IStakingWarmup {
    function retrieve(address _staker, uint256 _amount) external;
}
