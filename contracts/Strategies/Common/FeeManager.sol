// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

import "./StratManager.sol";

abstract contract FeeManager is StratManager {
    uint256 public constant SERVICE_FEE_CAP = 100; // 1%
    uint256 public constant SERVICE_FEE_DIVISOR = 10000;
    uint256 public constant WITHDRAWAL_FEE_CAP = 100; // 1%
    uint256 public constant WITHDRAWAL_FEE_DIVISOR = 10000;

    /**
     * @dev Events emitted:
     * {SetServiceFee}          - Emitted when the service fee is changed
     * {SetWithdrawalFee}       - Emitted when the withdrawal fee is changed
     */
    event SetServiceFee(uint256 serviceFee);
    event SetWithdrawalFee(uint256 withdrawalFee);

    uint256 public serviceFee = 70; // .7%
    uint256 public withdrawalFee = 50; // .5%

    function setServiceFee(uint256 _fee) external onlyManager {
        require(_fee <= SERVICE_FEE_CAP, "!cap");

        serviceFee = _fee;

        emit SetServiceFee(withdrawalFee);
    }

    function setWithdrawalFee(uint256 _fee) external onlyManager {
        require(_fee <= WITHDRAWAL_FEE_CAP, "!cap");

        withdrawalFee = _fee;

        emit SetWithdrawalFee(withdrawalFee);
    }
}
