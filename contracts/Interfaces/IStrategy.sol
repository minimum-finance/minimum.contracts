// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12;

import "./IDERC20.sol";

interface IStrategy {
    function want() external view returns (IDERC20);

    function totalBalance() external view returns (uint256);

    function beforeDeposit() external;

    function deposit() external;

    function claim() external returns (uint256);

    function reserve(uint256 _amount, address _address) external;

    function claim(address _claimer) external returns (uint256);

    function readyToClaim(address _claimer) external view returns (uint256);

    function isBonding() external view returns (bool);

    function vault() external view returns (address);

    function retireStrat() external;

    function minDeposit() external view returns (uint256);
}
