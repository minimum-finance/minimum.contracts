// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12;

/*
 * @dev Interface for OlympusStaking contracts used with rebasing tokens.
 * @author minimum.finance
 */
interface IStakingManager {
    function unstake(uint256 _amount, bool _trigger) external;

    function rebase() external;

    function epoch()
        external
        view
        returns (
            uint256 length,
            uint256 number,
            uint256 endBlock,
            uint256 distribute
        );

    function warmupInfo(address _warmee)
        external
        view
        returns (
            uint256 deposit,
            uint256 gons,
            uint256 expiry,
            bool lock // prevents malicious delays
        );

    function warmupPeriod() external view returns (uint256);

    function claim(address _recipient) external;

    function forfeit() external;

    function manager() external view returns (address);

    function setWarmup(uint256 _warmup) external;

    function stake(uint256 _amount, address _recipient) external;

    function toggleDepositLock() external;
}
