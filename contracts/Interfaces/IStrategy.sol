// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12;

import "./IDERC20.sol";

interface IStrategy {
    function want() external view returns (IDERC20);

    function output() external view returns (IDERC20);

    function totalBalance() external view returns (uint256);

    function beforeDeposit() external;

    function deposit() external;

    function claim() external returns (uint256);

    function reserve(uint256 _amount, address _address) external;

    function claim(address _claimer) external returns (uint256);

    function readyToClaim(address _claimer) external view returns (uint256);

    function claimOfReserves(address _claimer)
        external
        view
        returns (
            uint256 amount,
            uint256 index,
            uint256 reservePeriod
        );

    function reservePeriods(uint256 _period)
        external
        view
        returns (bool fullyVested, uint256 warmupExpiry);

    function isBonding() external view returns (bool);

    function warmedUp() external view returns (bool);

    function blocksLeftInReservePeriod(uint256 _period)
        external
        view
        returns (uint256);

    function currentReservePeriod() external view returns (uint256);

    function vault() external view returns (address);

    function retireStrat() external;

    function minDeposit() external view returns (uint256);
}
