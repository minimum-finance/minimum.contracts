// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12;

import "../../Interfaces/Rebasing/IRebaseStaker.sol";
import "../../Interfaces/Rebasing/IStakingManager.sol";
import "../../Interfaces/Uniswap/IUniswapRouterEth.sol";
import "../../Interfaces/Uniswap/IUniswapV2Pair.sol";
import "../../Interfaces/Rebasing/IBondDepository.sol";

import "../Common/FeeManager.sol";
import "../Common/StratManager.sol";

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/Math.sol";

/*
 __    __     __     __   __      ______   __
/\ "-./  \   /\ \   /\ "-.\ \    /\  ___\ /\ \
\ \ \-./\ \  \ \ \  \ \ \-.  \   \ \  __\ \ \ \
 \ \_\ \ \_\  \ \_\  \ \_\\"\_\   \ \_\    \ \_\
  \/_/  \/_/   \/_/   \/_/ \/_/    \/_/     \/_/
*/

/**
 * @dev Rebasing DAO yield optimizer for FantOHM DAO
 * @author minimum.finance
 */
contract StrategyFantOHM is StratManager, FeeManager {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    /**
     * @dev Super secret Discord link
     */
    string public discordLink;

    /**
     * @dev Tokens:
     * {rebaseToken}        - The rebase protocol's token
     * {stakedRebaseToken}  - The staked version of {rebaseToken}
     */
    address public constant rebaseToken =
        0xfa1FBb8Ef55A4855E5688C0eE13aC3f202486286; // FHM
    address public constant stakedRebaseToken =
        0x5E983ff70DE345de15DbDCf0529640F14446cDfa; // sFHM

    /**
     * @dev Bonds:
     * {bonds}              - Exhaustive list of the strategy's accepted bonds
     * {indexOfBond}        - Index of each bond in {bonds}
     * {currentBond}        - The current bond being used (0 address if not bonding)
     */
    address[] public bonds;
    mapping(address => uint256) indexOfBond; // 1-based to avoid default value
    address public currentBond;

    /**
     * @dev RebasingDAO Contracts:
     * {rebaseStaker}       - The rebase StakingHelper contract
     * {stakeManager}       - The rebase OlympusStaking contract
     */
    address public rebaseStaker;
    address public stakeManager;

    struct ReservePeriod {
        bool fullyVested;
        uint256 warmupExpiry;
    }

    struct Claim {
        uint256 amount;
        uint256 index;
        uint256 reservePeriod;
    }

    /**
     * @dev Withdrawal:
     * {claimOfReserves}     - how much a user owns of the reserves in {rebaseToken}
     * {reserves}            - {rebaseToken} reserved for withdrawal use so that it cannot be bonded
     * {claimers}            - list of users who can claim -- for forcePayoutChunk
     */
    mapping(address => Claim) public claimOfReserves;
    mapping(uint256 => ReservePeriod) public reservePeriods;
    uint256 public currentReservePeriod;
    uint256 public reserves;
    address[] public claimers;

    // Utilities
    IUniswapV2Pair public constant rebaseTokenDaiPair =
        IUniswapV2Pair(0xd77fc9c4074b56Ecf80009744391942FBFDDd88b); // Used to get price of rebaseToken in USD

    /**
     * @dev Events:
     * Deposit          - Emitted when funds are deposited into the strategy
     * Reserve          - Emitted when funds are reserved from the strategy
     * Stake            - Emitted when {rebaseToken} is staked
     * Unstake          - Emitted when {rebaseToken} is unstaked
     * Bond             - Emitted when {rebaseToken} is bonded
     * BondAdded        - Emitted when a bondDepository is added to {bonds}
     * BondRemoved      - Emitted when a bondDepository is removed from {bonds}
     * Redeem           - Emitted when the keeper redeems a bond
     * RedeemFinal      - Emitted when the keeper executes the final redemption for a bond
     *
     * @notice trl - Total Rebasing Locked
     */
    event Deposit(uint256 trl);
    event Reserve(uint256 trl, uint256 payout);
    event Stake(uint256 totalStaked, uint256 totalWarmup, uint256 totalBonded);
    event Unstake(
        uint256 totalUnstaked,
        uint256 totalStaked,
        uint256 totalWarmup,
        uint256 totalBonded
    );
    event Bond(
        uint256 rebaseTokenPrice,
        uint256 bondPrice,
        uint256 totalUnstaked,
        uint256 totalStaked,
        uint256 totalWarmup,
        uint256 totalBonded,
        address bondDepository
    );
    event BondAdded(address[] bonds);
    event BondRemoved(address[] bonds);
    event Redeem(
        uint256 totalUnstaked,
        uint256 totalStaked,
        uint256 totalWarmup,
        uint256 totalBonded,
        uint256 trl
    );
    event RedeemFinal(
        uint256 totalUnstaked,
        uint256 totalStaked,
        uint256 totalWarmup,
        uint256 trl
    );
    event ChargeFees(uint256 feeAmount);

    constructor(
        address _vault,
        address _rebaseStaker,
        address _stakeManager,
        address _keeper,
        address _unirouter,
        address _serviceFeeRecipient,
        uint256 _minDeposit,
        string memory _discordLink
    )
        public
        StratManager(
            _keeper,
            _unirouter,
            _vault,
            _serviceFeeRecipient,
            _minDeposit
        )
    {
        require(
            _rebaseStaker != address(0) && _stakeManager != address(0),
            "!0 Address"
        );

        rebaseStaker = _rebaseStaker;
        stakeManager = _stakeManager;
        discordLink = _discordLink;
    }

    /* ======== VIEW FUNCTIONS ======== */

    /**
     * @dev Interface method for interoperability with vault
     */
    function want() external pure returns (address) {
        return stakedRebaseToken;
    }

    /**
     * @dev Interface method for interoperability with vault
     */
    function output() external pure returns (address) {
        return rebaseToken;
    }

    /**
     * @dev Total staked and unstaked {rebaseToken} locked
     */
    function totalRebasing() public view returns (uint256) {
        return unstakedRebasing().add(stakedRebasing());
    }

    /**
     * @dev Total unstaked {rebaseToken} locked
     */
    function unstakedRebasing() public view returns (uint256) {
        return IERC20(rebaseToken).balanceOf(address(this));
    }

    /**
     * @dev Total staked {rebaseToken} locked
     */
    function stakedRebasing() public view returns (uint256) {
        return IERC20(stakedRebaseToken).balanceOf(address(this));
    }

    /**
     * @dev Total balance warming up from staking.
     */
    function warmupBalance() public view returns (uint256 _warmupBal) {
        (_warmupBal, , , ) = IStakingManager(stakeManager).warmupInfo(
            address(this)
        );
    }

    /**
     * @dev Total available staked and unstaked {rebaseToken} locked
     */
    function availableRebaseToken() public view returns (uint256) {
        return reserves < totalRebasing() ? totalRebasing().sub(reserves) : 0;
    }

    /**
     * @dev Get the current amount of rebase bonded, pending payout
     */
    function rebaseBonded() public view returns (uint256 _rebaseBonded) {
        if (isBonding())
            (_rebaseBonded, , , ) = IBondDepository(currentBond).bondInfo(
                address(this)
            );
    }

    /**
     * @dev Total staked, unstaked, and bonded {rebaseToken} locked
     */
    function totalBalance() public view returns (uint256) {
        uint256 rebaseAmount = totalRebasing().add(rebaseBonded()).add(
            warmupBalance()
        );

        return reserves < rebaseAmount ? rebaseAmount.sub(reserves) : 0;
    }

    /**
     * @dev Whether or not the strategy is currently bonding
     */
    function isBonding() public view returns (bool) {
        return currentBond != address(0);
    }

    /**
     * @dev Number of validated bonds
     */
    function numBonds() external view returns (uint256) {
        return bonds.length;
    }

    /**
     * @dev Check whether a bond is validated
     * @param _bondDepository BondDepository address
     */
    function isBondValid(address _bondDepository) public view returns (bool) {
        return indexOfBond[_bondDepository] != 0;
    }

    /* ======== USER FUNCTIONS ======== */

    /**
     * @dev Deposit available {rebaseToken} into FantOHM
     * @notice Emits Deposit(trl)
     */
    function deposit() external whenNotPaused {
        _claimStake(false);

        emit Deposit(totalBalance());
    }

    /**
     * @dev Reserves funds from staked {rebaseToken} to be paid out when bonding is over
     * @param _amount The amount of {rebaseToken} to reserve
     * @param _claimer The address whose funds need to be reserved
     * @notice Emits Reserve()
     * @notice If not currently bonding, sends funds immediately
     */
    function reserve(uint256 _amount, address _claimer) external {
        require(msg.sender == vault, "!Vault");

        _amount = _amount.sub(
            _amount.mul(withdrawalFee).div(WITHDRAWAL_FEE_DIVISOR)
        );

        _claimStake(false);

        if (isBonding() || !warmedUp()) {
            // If we're currently bonding/warming up, user will vest for the bond period + warmup
            Claim memory previousClaim = claimOfReserves[_claimer];
            if (previousClaim.index == 0) claimers.push(_claimer);

            claimOfReserves[_claimer] = Claim({
                amount: previousClaim.amount.add(_amount),
                index: previousClaim.index == 0
                    ? claimers.length
                    : previousClaim.index,
                reservePeriod: currentReservePeriod // Notice that users should claim before reserving again
            });

            reserves = reserves.add(_amount);
        } else {
            // If we're not bonding and warmed up pay right away
            if (_amount > totalRebasing()) _amount = totalRebasing();

            _pay(_claimer, _amount);
        }

        emit Reserve(totalBalance(), _amount);
    }

    /**
     * @dev Claim vested out position
     * @param _claimer The address of the claimer
     * @return The amount of {rebaseToken} claimed
     */
    function claim(address _claimer) external returns (uint256) {
        require(msg.sender == vault, "!Vault");
        require(claimerVested(_claimer), "!fullyVested");
        return _claim(_claimer);
    }

    /* ======== BOND FUNCTIONS ======== */

    /**
     * @dev Add a bond to the list of valid bonds
     * @param _bondDepository Bond to validate
     */
    function addBond(address _bondDepository) external onlyOwner {
        require(!isBondValid(_bondDepository), "!invalid bond");
        bonds.push(_bondDepository);
        indexOfBond[_bondDepository] = bonds.length; // 1 based indexing

        emit BondAdded(bonds);
    }

    /**
     * @dev Remove a bond from the list of valid bonds
     * @param _bondDepository Bond to invalidate
     */
    function removeBond(address _bondDepository) external onlyOwner {
        uint256 index = indexOfBond[_bondDepository]; // Starting from 1
        require(index <= bonds.length && index > 0, "!valid bond");

        if (bonds.length > 1) {
            bonds[index - 1] = bonds[bonds.length - 1]; // Replace with last element
        }
        // Remove last element as we have it saved in deleted slot
        bonds.pop();
        delete indexOfBond[_bondDepository];

        emit BondRemoved(bonds);
    }

    /**
     * @dev Move all sFHM from staking to bonding funds in a single token bond
     * @param bondDepository address of BondDepository to use
     * @param rebaseToPrincipleRoute the route from {rebaseToken} to bond principle
     */
    function stakeToBondSingleAll(
        IBondDepository bondDepository,
        address[] calldata rebaseToPrincipleRoute
    ) external {
        stakeToBondSingle(
            availableRebaseToken(),
            bondDepository,
            rebaseToPrincipleRoute
        );
    }

    /**
     * @dev Move all sFHM from staking to bonding funds in an LP token bond
     * @param bondDepository address of BondDepository to use
     * @param rebaseToToken0Route route from {rebaseToken} to token0 in the LP
     * @param rebaseToToken1Route route from {rebaseToken} to token1 in the LP
     */
    function stakeToBondLPAll(
        IBondDepository bondDepository,
        address[] calldata rebaseToToken0Route,
        address[] calldata rebaseToToken1Route
    ) external {
        stakeToBondLP(
            availableRebaseToken(),
            bondDepository,
            rebaseToToken0Route,
            rebaseToToken1Route
        );
    }

    /**
     * @dev Move from staking to bonding funds in a single token bond
     * @param _amount of sFHM to withdraw and bond
     * @param bondDepository BondDepository of the bond to use
     * @param rebaseToPrincipleRoute The route to take from {rebaseToken} to the bond principle token
     */
    function stakeToBondSingle(
        uint256 _amount,
        IBondDepository bondDepository,
        address[] calldata rebaseToPrincipleRoute
    ) public onlyManager {
        require(!isBonding(), "Already bonding!");
        require(_amount > 0, "amount <= 0!");
        require(isBondValid(address(bondDepository)), "Unapproved bond!");
        require(warmedUp(), "!warmedUp");
        require(
            reservePeriodFinished(currentReservePeriod),
            "!reservePeriodFinished"
        );
        require(
            rebaseToPrincipleRoute.length > 0 &&
                rebaseToPrincipleRoute[0] == rebaseToken,
            "Route must start with rebaseToken!"
        );
        require(
            rebaseToPrincipleRoute[rebaseToPrincipleRoute.length - 1] ==
                bondDepository.principle(),
            "Route must end with bond principle!"
        );
        require(bondIsPositive(bondDepository), "!bondIsPositive");

        _beginNewReservePeriod(false, 0);
        currentBond = address(bondDepository);

        uint256 maxBondableRebase = maxBondSize(bondDepository);

        _claimStake(false);

        if (_amount > availableRebaseToken()) _amount = availableRebaseToken();
        if (_amount > maxBondableRebase) _amount = maxBondableRebase;

        uint256 unstaked = unstakedRebasing();
        if (_amount > unstaked) _unstake(_amount.sub(unstaked)); // gets FHM to this strategy

        _amount = _chargeFees(_amount);

        _bondSingleToken(_amount, bondDepository, rebaseToPrincipleRoute);
    }

    /**
     * @dev Move from staking to bonding funds in an LP token bond
     * @param _amount of sFHM to withdraw and bond
     * @param bondDepository BondDepository of the bond to use
     * @param rebaseToToken0Route route from {rebaseToken} to token0 in the LP
     * @param rebaseToToken1Route route from {rebaseToken} to token1 in the LP
     */
    function stakeToBondLP(
        uint256 _amount,
        IBondDepository bondDepository,
        address[] calldata rebaseToToken0Route,
        address[] calldata rebaseToToken1Route
    ) public onlyManager {
        require(!isBonding(), "Already bonding!");
        require(_amount > 0, "amount <= 0!");
        require(isBondValid(address(bondDepository)), "Unapproved bond!");
        require(warmedUp(), "!warmedUp");
        require(
            reservePeriodFinished(currentReservePeriod),
            "!reservePeriodFinished"
        );
        require(
            rebaseToToken0Route.length > 0 &&
                rebaseToToken1Route.length > 0 &&
                rebaseToToken0Route[0] == rebaseToken &&
                rebaseToToken1Route[0] == rebaseToken,
            "Routes must start with {rebaseToken}!"
        );
        require(
            rebaseToToken0Route[rebaseToToken0Route.length - 1] ==
                IUniswapV2Pair(bondDepository.principle()).token0() &&
                rebaseToToken1Route[rebaseToToken1Route.length - 1] ==
                IUniswapV2Pair(bondDepository.principle()).token1(),
            "Routes must end with their respective tokens!"
        );
        require(bondIsPositive(bondDepository), "!bondIsPositive");

        _beginNewReservePeriod(false, 0);
        currentBond = address(bondDepository);

        uint256 maxBondableRebase = maxBondSize(bondDepository);

        _claimStake(false);

        if (_amount > availableRebaseToken()) _amount = availableRebaseToken();
        if (_amount > maxBondableRebase) _amount = maxBondableRebase;

        uint256 unstaked = unstakedRebasing();
        if (_amount > unstaked) _unstake(_amount.sub(unstaked)); // gets FHM to this strategy

        _amount = _chargeFees(_amount);

        _bondLPToken(
            _amount,
            bondDepository,
            rebaseToToken0Route,
            rebaseToToken1Route
        );
    }

    /**
     * @dev Redeem and stake rewards from a bond
     */
    function redeemAndStake() external onlyManager {
        require(isBonding(), "!Bonding");
        _redeem(false);
    }

    /**
     * @dev Force push payout to claimer
     * @param _claimer The address of the claimer to payout
     * @return amount of {rebaseToken} claimed.
     */
    function forcePayout(address _claimer)
        external
        onlyOwner
        returns (uint256)
    {
        require(claimerVested(_claimer), "!fullyVested");
        return _claim(_claimer);
    }

    /**
     * @dev Force push payout to all claimers (in chunks to avoid gas limit)
     * @notice Necessary to be able to upgrade the strategy
     * @return Whether or not all claimers are paid out
     */
    function forcePayoutChunk() external onlyOwner returns (bool) {
        require(!isBonding(), "Cannot force payout chunk during bond!");
        require(warmedUp(), "Must be warmed up!");
        require(
            reservePeriodFinished(currentReservePeriod),
            "!reservePeriodFinished"
        );
        _claimStake(false);
        uint256 chunkSize = Math.min(50, claimers.length);
        uint256 totalRebaseToken = totalRebasing();
        uint256 tempReserves = reserves;

        for (uint256 i = 0; i < chunkSize; i++) {
            address _claimer = claimers[i];
            Claim memory userClaim = claimOfReserves[_claimer];

            delete claimOfReserves[_claimer];

            // If for some reason we can't fulfill reserves, pay as much as we can to everyone
            uint256 _amount = reserves > totalRebaseToken
                ? userClaim.amount.mul(totalRebaseToken).div(reserves)
                : userClaim.amount;

            tempReserves = tempReserves.sub(_amount);

            _pay(_claimer, _amount);
        }

        for (uint256 i = 0; i < chunkSize; i++) {
            if (claimers.length > 1)
                claimers[i] = claimers[claimers.length - 1];
            claimers.pop();
        }

        reserves = claimers.length == 0 ? 0 : tempReserves; // Ensure no dust left in reserves

        return claimers.length == 0;
    }

    /* ======== INTERNAL HELPER FUNCTIONS ======== */

    /**
     * @dev Claim a user's vested out position
     * @param _claimer The address of the claimer
     */
    function _claim(address _claimer) internal returns (uint256) {
        Claim memory userClaim = claimOfReserves[_claimer];
        delete claimOfReserves[_claimer];

        _claimStake(false);

        // If for some reason we can't fulfill reserves, pay as much as we can to everyone
        uint256 _amount = reserves > totalRebasing()
            ? userClaim.amount.mul(totalRebasing()).div(reserves)
            : userClaim.amount;

        reserves = reserves.sub(_amount);

        if (claimers.length > 1)
            claimers[userClaim.index - 1] = claimers[claimers.length - 1];
        claimers.pop();

        _pay(_claimer, _amount);

        return _amount;
    }

    /**
     * @dev Send {rebaseToken} to the claimer
     * @param _claimer The address to send {rebaseToken} to
     * @param _amount The amount of {rebaseToken} to send
     */
    function _pay(address _claimer, uint256 _amount) internal {
        if (_amount > unstakedRebasing())
            _unstake(_amount.sub(unstakedRebasing()));

        IERC20(rebaseToken).safeTransfer(_claimer, _amount);
    }

    /**
     * @dev Claim from warmup and then stake all of the strategy's
     * {rebaseToken}, only if it won't extend the warmup period.
     * @param extend Whether or not to stake if it will extend the warmup
     */
    function _stake(bool extend) internal {
        uint256 _amount = unstakedRebasing();
        if (_amount < minDeposit) return;

        _claimStake(false);
        if (extend || safeToStake()) {
            IERC20(rebaseToken).safeIncreaseAllowance(rebaseStaker, _amount);
            _setStakeLock(false);
            IRebaseStaker(rebaseStaker).stake(_amount);
            _setStakeLock(true);
        }

        emit Stake(stakedRebasing(), warmupBalance(), rebaseBonded());
    }

    /**
     * @dev Claim rewards from staking warmup
     * @param forfeit Whether or not to forfeit if not warmed up
     */
    function _claimStake(bool forfeit) internal {
        if (IStakingManager(stakeManager).warmupPeriod() == 0) return;
        if (warmedUp()) IStakingManager(stakeManager).claim(address(this));
        else if (forfeit) IStakingManager(stakeManager).forfeit();
    }

    /**
     * @dev Unstake {stakedRebasingToken}
     * @param _amount of {stakedRebasingToken} to unstake
     * @notice if _amount exceeds the strategy's balance of
     * {stakedRebasingToken}, unstake all {stakedRebasingToken}
     */
    function _unstake(uint256 _amount) internal {
        if (_amount <= 0) return;
        if (_amount > stakedRebasing()) _amount = stakedRebasing();

        IERC20(stakedRebaseToken).safeIncreaseAllowance(stakeManager, _amount);
        IStakingManager(stakeManager).unstake(_amount, true);

        emit Unstake(
            unstakedRebasing(),
            stakedRebasing(),
            warmupBalance(),
            rebaseBonded()
        );
    }

    /**
     * @dev Swap {rebaseToken} for {_outputToken}
     * @param _rebaseAmount The amount of {rebaseToken} to swap for {_outputToken}
     * @param rebaseToTokenRoute Route to swap from {rebaseToken} to the output
     * @notice If {_rebaseAmount} is greater than the available {rebaseToken}
     *         swaps all available {rebaseToken}
     * @notice Make sure to unstake {stakedRebaseToken} before calling!
     */
    function _swapRebaseForToken(
        uint256 _rebaseAmount,
        address[] memory rebaseToTokenRoute
    ) internal {
        require(
            rebaseToTokenRoute[0] == rebaseToken,
            "Route must start with rebaseToken!"
        );
        if (rebaseToTokenRoute[rebaseToTokenRoute.length - 1] == rebaseToken)
            return;

        IUniswapRouterETH(unirouter).swapExactTokensForTokens(
            _rebaseAmount > unstakedRebasing()
                ? unstakedRebasing()
                : _rebaseAmount,
            0,
            rebaseToTokenRoute,
            address(this),
            now
        );
    }

    /**
     * @dev Swap for token0 and token1 and provide liquidity to receive LP tokens
     * @param _amount The amount of {rebaseToken} to use to provide liquidity
     * @param token0 The first token in the LP
     * @param token1 The second token in the LP
     * @param rebaseToToken0Route The route to swap from {rebaseToken} to token0
     * @param rebaseToToken1Route The route to swap from {rebaseToken} to token1
     * @notice Make sure to unstake the desired amount of {stakedRebaseToken} before calling!
     */
    function _provideLiquidity(
        uint256 _amount,
        address token0,
        address token1,
        address[] memory rebaseToToken0Route,
        address[] memory rebaseToToken1Route
    ) internal {
        uint256 token0Before = IERC20(token0).balanceOf(address(this));
        uint256 token1Before = IERC20(token1).balanceOf(address(this));

        IERC20(rebaseToken).safeIncreaseAllowance(unirouter, _amount);

        if (rebaseToToken0Route.length > 1)
            _swapRebaseForToken(_amount.div(2), rebaseToToken0Route);
        if (rebaseToToken1Route.length > 1)
            _swapRebaseForToken(_amount.div(2), rebaseToToken1Route);

        uint256 token0After = IERC20(token0).balanceOf(address(this));
        uint256 token1After = IERC20(token1).balanceOf(address(this));

        uint256 token0Amount = token0After > token0Before
            ? token0After.sub(token0Before)
            : token0Before.sub(token0After);

        uint256 token1Amount = token1After > token1Before
            ? token1After.sub(token1Before)
            : token1Before.sub(token1After);

        IERC20(token0).safeIncreaseAllowance(unirouter, token0Amount);
        IERC20(token1).safeIncreaseAllowance(unirouter, token1Amount);

        IUniswapRouterETH(unirouter).addLiquidity(
            token0,
            token1,
            token0Amount,
            token1Amount,
            0,
            0,
            address(this),
            now
        );
    }

    /**
     * @dev Deposit into single sided bond
     * @param _amount of FHM to swap to single token and bond
     * @param bondDepository BondDepository address
     * @param rebaseToPrincipleRoute The route to swap from {rebaseToken} to the bond principle token
     */
    function _bondSingleToken(
        uint256 _amount,
        IBondDepository bondDepository,
        address[] memory rebaseToPrincipleRoute
    ) internal {
        address bondToken = rebaseToPrincipleRoute[
            rebaseToPrincipleRoute.length - 1
        ];
        uint256 bondTokenBalanceBefore = IERC20(bondToken).balanceOf(
            address(this)
        );

        uint256 rebaseTokenPrice = rebaseTokenPriceInUSD(1e9);

        // Swap allowance
        IERC20(rebaseToken).safeIncreaseAllowance(unirouter, _amount);

        _swapRebaseForToken(_amount, rebaseToPrincipleRoute);

        uint256 bondTokenObtained = IERC20(bondToken)
            .balanceOf(address(this))
            .sub(bondTokenBalanceBefore);

        _bondTokens(
            bondDepository,
            bondTokenObtained,
            bondToken,
            rebaseTokenPrice
        );
    }

    /**
     * @dev Deposit into LP bond
     * @param _amount of FHM to swap to LP token and bond
     * @param bondDepository BondDepository address
     * @param rebaseToToken0Route route from {rebaseToken} to token0 in the LP
     * @param rebaseToToken1Route route from {rebaseToken} to token1 in the LP
     */
    function _bondLPToken(
        uint256 _amount,
        IBondDepository bondDepository,
        address[] memory rebaseToToken0Route,
        address[] memory rebaseToToken1Route
    ) internal {
        address bondToken = bondDepository.principle();
        address token0 = rebaseToToken0Route[rebaseToToken0Route.length - 1];
        address token1 = rebaseToToken1Route[rebaseToToken1Route.length - 1];

        uint256 bondTokenBalanceBefore = IERC20(bondToken).balanceOf(
            address(this)
        );

        uint256 rebaseTokenPrice = rebaseTokenPriceInUSD(1e9);

        _provideLiquidity(
            _amount,
            token0,
            token1,
            rebaseToToken0Route,
            rebaseToToken1Route
        );

        uint256 bondTokenObtained = IERC20(bondToken)
            .balanceOf(address(this))
            .sub(bondTokenBalanceBefore);

        _bondTokens(
            bondDepository,
            bondTokenObtained,
            bondToken,
            rebaseTokenPrice
        );
    }

    /**
     * @dev Bond tokens into the bond depository
     * @param bondDepository bond depository to bond into
     * @param _amount amount of principle to bond
     */
    function _bondTokens(
        IBondDepository bondDepository,
        uint256 _amount,
        address bondToken,
        uint256 rebaseTokenPrice
    ) internal {
        uint256 acceptedSlippage = 5; // 0.5%
        uint256 maxPremium = bondDepository
            .bondPrice()
            .mul(acceptedSlippage.add(1000))
            .div(1000);

        // Update BondDepository allowances
        IERC20(bondToken).safeIncreaseAllowance(
            address(bondDepository),
            _amount
        );

        emit Bond(
            rebaseTokenPrice,
            bondDepository.bondPriceInUSD(),
            unstakedRebasing(),
            stakedRebasing(),
            warmupBalance(),
            rebaseBonded(),
            address(bondDepository)
        );

        // Bond principle tokens
        bondDepository.deposit(_amount, maxPremium, address(this));
        _stake(false);
    }

    /**
     * @dev Claim redeem rewards from a bond and payout reserves if the bond is over.
     * @notice Stakes redeem rewards
     * @notice Performs final redeem in the case of an empty BondInfo
     */
    function _redeem(bool forceEnd) internal {
        IBondDepository(currentBond).redeem(address(this), false);
        _stake(true);

        // If this is final redemption, remove currentBond and update claimOfReserves
        if (
            rebaseBonded() <= 0 ||
            (forceEnd && reserves <= totalRebasing().add(warmupBalance()))
        ) {
            uint256 warmupExpiry = currentWarmupExpiry();
            currentBond = address(0);
            reservePeriods[currentReservePeriod] = ReservePeriod({
                fullyVested: true,
                warmupExpiry: warmupExpiry
            });

            emit RedeemFinal(
                unstakedRebasing(),
                stakedRebasing(),
                warmupBalance(),
                totalBalance()
            );
        } else
            emit Redeem(
                unstakedRebasing(),
                stakedRebasing(),
                warmupBalance(),
                rebaseBonded(),
                totalBalance()
            );
    }

    /**
     * @dev Charge performance fees
     * @param _amount to fee
     */
    function _chargeFees(uint256 _amount) internal returns (uint256) {
        uint256 fee = _amount.mul(serviceFee).div(SERVICE_FEE_DIVISOR);
        IStakingManager(stakeManager).claim(serviceFeeRecipient);
        IERC20(rebaseToken).safeIncreaseAllowance(stakeManager, fee);
        IStakingManager(stakeManager).stake(fee, serviceFeeRecipient);

        emit ChargeFees(fee);

        return _amount.sub(fee);
    }

    /**
     * @dev Begin new ReservePeriod
     * @param vested If false, new epoch includes bond vesting period
     * @param warmupExpiry Warmup expiry for the new ReservePeriod
     */
    function _beginNewReservePeriod(bool vested, uint256 warmupExpiry)
        internal
    {
        currentReservePeriod = currentReservePeriod.add(1);
        reservePeriods[currentReservePeriod] = ReservePeriod({
            fullyVested: vested,
            warmupExpiry: warmupExpiry
        });
    }

    /**
     * @dev Set the strat's staking lock
     * @param forceLock the lock state (false -> unlocked) to force
     */
    function _setStakeLock(bool forceLock) internal {
        bool currentLock;
        (, , , currentLock) = IStakingManager(stakeManager).warmupInfo(
            address(this)
        );
        if ((forceLock && !currentLock) || (!forceLock && currentLock))
            IStakingManager(stakeManager).toggleDepositLock();
    }

    /* ======== STRATEGY UPGRADE FUNCTIONS ======== */

    /**
     * @dev Retire strategy
     * @notice Called as part of strat migration.
     * @notice Sends all the available funds back to the vault
     */
    function retireStrat() external {
        require(msg.sender == vault, "!vault");
        require(reserves <= 0, "Reserves must be empty!");
        require(!isBonding(), "Cannot retire while bonding!");
        require(warmedUp(), "Must be warmed up!");

        if (!paused()) _pause();
        _claimStake(true);
        _unstake(stakedRebasing());

        IERC20(rebaseToken).safeTransfer(vault, unstakedRebasing());
    }

    /* ======== EMERGENCY CONTROL FUNCTIONS ======== */

    /**
     * @dev Pauses deposits and withdraws all funds from third party systems
     */
    function panic() external onlyOwner {
        if (!paused()) _pause();
        if (isBonding()) _redeem(false);
        _claimStake(true);
        _unstake(stakedRebasing());
    }

    /**
     * @dev Pauses deposits
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpauses deposits
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Stakes all unstaked {rebaseToken} locked
     */
    function stake() external onlyOwner {
        if (reservePeriodFinished(currentReservePeriod))
            _beginNewReservePeriod(true, newWarmupExpiry());
        else
            reservePeriods[currentReservePeriod]
                .warmupExpiry = newWarmupExpiry();
        _stake(true);
    }

    /**
     * @dev Unstakes all staked {rebaseToken} locked
     */
    function unstakeAll() external onlyOwner {
        _unstake(stakedRebasing());
    }

    /**
     * @dev Unstakes _amount of staked {rebaseToken}
     * @param _amount of staked {rebaseToken} to unstake
     */
    function unstake(uint256 _amount) external onlyOwner {
        _unstake(_amount);
    }

    /**
     * @dev Claims any warmed up funds.
     */
    function claimStake() external onlyManager {
        _claimStake(false);
    }

    /**
     * @dev Toggle staking lock in case it gets out of sync
     */
    function toggleStakingLock() external onlyOwner {
        IStakingManager(stakeManager).toggleDepositLock();
    }

    function redeemForBond(IBondDepository bondDepository) external onlyOwner {
        bondDepository.redeem(address(this), false);
    }

    function forceFinalRedeem() external onlyOwner {
        _redeem(true);
    }

    /**
     * @dev Rescues random funds stuck that the strat can't handle
     * @param _token address of the token to rescue
     */
    function inCaseTokensGetStuck(address _token) external onlyOwner {
        require(_token != rebaseToken && _token != stakedRebaseToken, "!token");

        uint256 amount = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransfer(msg.sender, amount);
    }

    /* ======== UTILITY FUNCTIONS ======== */

    /**
     * @dev Whether or not the strategy's stake is warmed up
     */
    function warmedUp() public view returns (bool) {
        return currentEpochNumber() >= currentWarmupExpiry();
    }

    /**
     * @dev Returns true if staking during the current epoch will not extend the warmupExpiry
     */
    function safeToStake() public view returns (bool) {
        uint256 warmupExpiry = currentWarmupExpiry();
        return warmupExpiry == 0 || newWarmupExpiry() <= warmupExpiry;
    }

    /**
     * @dev Computes the new warmupExpiry if the strategy were to stake this epoch
     */
    function newWarmupExpiry() public view returns (uint256) {
        uint256 warmupPeriod = IStakingManager(stakeManager).warmupPeriod();
        return currentEpochNumber().add(warmupPeriod);
    }

    /**
     * @dev Whether or not a claimer's position is fully vested
     */
    function claimerVested(address _claimer) public view returns (bool) {
        ReservePeriod memory userReservePeriod = reservePeriods[
            claimOfReserves[_claimer].reservePeriod
        ];
        return
            userReservePeriod.fullyVested &&
            currentEpochNumber() >= userReservePeriod.warmupExpiry;
    }

    /**
     * @dev Whether the supplied epoch is finished
     * @param _epochNum The epoch to examine
     */
    function reservePeriodFinished(uint256 _epochNum)
        public
        view
        returns (bool)
    {
        ReservePeriod memory reservePeriod = reservePeriods[_epochNum];
        return
            _epochNum == 0 ||
            (reservePeriod.fullyVested &&
                reservePeriod.warmupExpiry <= currentEpochNumber());
    }

    /**
     * @dev The current warmupExpiry of this strat
     */
    function currentWarmupExpiry() public view returns (uint256 _warmupExpiry) {
        (, , _warmupExpiry, ) = IStakingManager(stakeManager).warmupInfo(
            address(this)
        );
    }

    /**
     * @dev The current epoch number from the stakeManager
     */
    function currentEpochNumber() public view returns (uint256 _epoch) {
        (, _epoch, , ) = IStakingManager(stakeManager).epoch();
    }

    /**
     * @dev Returns the max amount of FHM that can be bonded into the given bond
     * @param bondDepository BondDepository to calculate the max bond size for
     */
    function maxBondSize(IBondDepository bondDepository)
        public
        view
        returns (uint256)
    {
        return
            bondDepository.bondPriceInUSD().mul(bondDepository.maxPayout()).div(
                rebaseTokenPriceInUSD(1e9)
            );
    }

    /**
     * @dev Whether or not a bond is positive
     * @param bondDepository The bond to examine
     */
    function bondIsPositive(IBondDepository bondDepository)
        public
        view
        returns (bool)
    {
        return bondDepository.bondPriceInUSD() < rebaseTokenPriceInUSD(1e9);
    }

    /**
     * @dev Blocks remaining for the current bond vesting period
     * @param _period The ReservePeriod to check
     */
    function blocksLeftInReservePeriod(uint256 _period)
        external
        view
        returns (uint256 _blocks)
    {
        ReservePeriod memory reservePeriod = reservePeriods[_period];
        uint256 epochLength;
        (epochLength, , , ) = IStakingManager(stakeManager).epoch();
        uint256 warmupEpochs = reservePeriod.warmupExpiry > currentEpochNumber()
            ? reservePeriod.warmupExpiry.sub(currentEpochNumber())
            : 0;
        if (reservePeriod.fullyVested || currentBond == address(0)) {
            _blocks = warmupEpochs.mul(epochLength);
        } else {
            uint256 _vesting;
            uint256 _lastBlock;
            (, _vesting, _lastBlock, ) = IBondDepository(currentBond).bondInfo(
                address(this)
            );
            uint256 blockDiff = block.number.sub(_lastBlock);
            _blocks = warmupEpochs.mul(epochLength).add(1).add(
                _vesting > blockDiff ? _vesting.sub(blockDiff) : 0
            );
        }
    }

    /**
     * @dev Get amount required in to receive an amount out
     * @param _amountOut Exact amount out
     * @param _inToOutRoute Route to swap from in to out
     * @notice Includes price impact
     */
    function getAmountIn(uint256 _amountOut, address[] calldata _inToOutRoute)
        external
        view
        returns (uint256)
    {
        return
            IUniswapRouterETH(unirouter).getAmountsIn(
                _amountOut,
                _inToOutRoute
            )[0];
    }

    /**
     * @dev Get amount received out from an exact amount in
     * @param _amountIn Exact amount in
     * @param _inToOutRoute Route to swap from in to out
     * @notice Includes price impact
     */
    function getAmountOut(uint256 _amountIn, address[] calldata _inToOutRoute)
        external
        view
        returns (uint256)
    {
        return
            IUniswapRouterETH(unirouter).getAmountsOut(
                _amountIn,
                _inToOutRoute
            )[_inToOutRoute.length - 1];
    }

    /**
     * @dev Get {rebaseToken} price in USD denomination
     * @param _amount of {rebaseToken}
     * @notice Does not include price impact
     */
    function rebaseTokenPriceInUSD(uint256 _amount)
        public
        view
        returns (uint256)
    {
        (uint256 Res0, uint256 Res1, ) = rebaseTokenDaiPair.getReserves();

        // return # of Dai needed to buy _amount of rebaseToken
        return _amount.mul(Res0).div(Res1);
    }
}
