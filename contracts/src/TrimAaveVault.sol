// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/contracts/interfaces/ISwapVM.sol";
import { IMakerHooks } from "@1inch/swap-vm/contracts/interfaces/IMakerHooks.sol";

import { ITrimSource } from "./interfaces/ITrimSource.sol";
import { IAavePool } from "./interfaces/aave/IAavePool.sol";
import { IAaveOracle } from "./interfaces/aave/IAaveOracle.sol";

contract TrimAaveVault is ITrimSource, IMakerHooks, Ownable {
    using SafeERC20 for IERC20;

    error TrimNotOwnOrder();
    error TrimWrongDirection();
    error TrimOvershoot(uint256 healthFactorAfter);
    error TrimOrderMakerMismatch(address maker);

    uint256 constant VARIABLE_RATE = 2;
    uint256 constant PERCENT = 10_000;

    IAavePool public immutable pool;
    IAaveOracle public immutable oracle;
    IAqua public immutable aqua;
    address public immutable router;
    IERC20 public immutable collateral;
    IERC20 public immutable debt;
    uint256 public immutable targetHealthFactor;
    uint256 immutable collateralUnit;
    uint256 immutable debtUnit;

    bytes32 public orderHash;

    constructor(
        IAavePool pool_,
        IAaveOracle oracle_,
        IAqua aqua_,
        address router_,
        address collateral_,
        address debt_,
        uint256 targetHealthFactor_,
        address owner_
    ) Ownable(owner_) {
        pool = pool_;
        oracle = oracle_;
        aqua = aqua_;
        router = router_;
        collateral = IERC20(collateral_);
        debt = IERC20(debt_);
        targetHealthFactor = targetHealthFactor_;
        collateralUnit = 10 ** IERC20Metadata(collateral_).decimals();
        debtUnit = 10 ** IERC20Metadata(debt_).decimals();
    }

    function open(uint256 collateralAmount, uint256 debtAmount) external onlyOwner {
        collateral.safeTransferFrom(msg.sender, address(this), collateralAmount);
        collateral.forceApprove(address(pool), collateralAmount);
        pool.supply(address(collateral), collateralAmount, address(this), 0);
        pool.borrow(address(debt), debtAmount, VARIABLE_RATE, 0, address(this));
        debt.safeTransfer(msg.sender, debtAmount);
    }

    function ship(ISwapVM.Order calldata order, uint256 collateralLimit) external onlyOwner returns (bytes32) {
        require(order.maker == address(this), TrimOrderMakerMismatch(order.maker));
        orderHash = ISwapVM(router).hash(order);
        collateral.forceApprove(address(aqua), type(uint256).max);
        address[] memory tokens = new address[](2);
        tokens[0] = address(debt);
        tokens[1] = address(collateral);
        uint256[] memory amounts = new uint256[](2);
        amounts[1] = collateralLimit;
        return aqua.ship(router, abi.encode(order), tokens, amounts);
    }

    function healthFactor() public view returns (uint256 value) {
        (,,,,, value) = pool.getUserAccountData(address(this));
    }

    function deviation() external view returns (uint256) {
        uint256 current = healthFactor();
        if (current >= targetHealthFactor) return 0;
        return (targetHealthFactor - current) * 1e18 / targetHealthFactor;
    }

    function deviationAfter(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut) external view returns (uint256) {
        _requireDeleverage(tokenIn, tokenOut);
        (uint256 collateralBase, uint256 debtBase,, uint256 liquidationThreshold,,) = pool.getUserAccountData(address(this));
        uint256 repaidBase = amountIn * oracle.getAssetPrice(address(debt)) / debtUnit;
        uint256 withdrawnBase = amountOut * oracle.getAssetPrice(address(collateral)) / collateralUnit;
        require(repaidBase < debtBase, TrimOvershoot(type(uint256).max));
        uint256 after_ = (collateralBase - withdrawnBase) * liquidationThreshold * 1e18 / (PERCENT * (debtBase - repaidBase));
        require(after_ <= targetHealthFactor, TrimOvershoot(after_));
        return (targetHealthFactor - after_) * 1e18 / targetHealthFactor;
    }

    function fairAmountOut(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256) {
        _requireDeleverage(tokenIn, tokenOut);
        return amountIn * oracle.getAssetPrice(address(debt)) * collateralUnit / (oracle.getAssetPrice(address(collateral)) * debtUnit);
    }

    function fairAmountIn(address tokenIn, address tokenOut, uint256 amountOut) external view returns (uint256) {
        _requireDeleverage(tokenIn, tokenOut);
        return Math.ceilDiv(amountOut * oracle.getAssetPrice(address(collateral)) * debtUnit, oracle.getAssetPrice(address(debt)) * collateralUnit);
    }

    function preTransferIn(address, address, address, address, uint256, uint256, bytes32, bytes calldata, bytes calldata) external pure {
        revert TrimNotOwnOrder();
    }

    function postTransferIn(
        address maker,
        address,
        address,
        address,
        uint256 amountIn,
        uint256,
        uint256 feeIn,
        bytes32 orderHash_,
        bytes calldata,
        bytes calldata
    ) external {
        _requireOwnOrder(maker, orderHash_);
        uint256 amount = amountIn - feeIn;
        debt.forceApprove(address(pool), amount);
        pool.repay(address(debt), amount, VARIABLE_RATE, address(this));
    }

    function preTransferOut(
        address maker,
        address,
        address,
        address,
        uint256,
        uint256 amountOut,
        bytes32 orderHash_,
        bytes calldata,
        bytes calldata
    ) external {
        _requireOwnOrder(maker, orderHash_);
        pool.withdraw(address(collateral), amountOut, address(this));
    }

    function postTransferOut(address, address, address, address, uint256, uint256, uint256, bytes32, bytes calldata, bytes calldata) external pure {
        revert TrimNotOwnOrder();
    }

    function _requireOwnOrder(address maker, bytes32 orderHash_) internal view {
        require(msg.sender == router && maker == address(this) && orderHash_ == orderHash, TrimNotOwnOrder());
    }

    function _requireDeleverage(address tokenIn, address tokenOut) internal view {
        require(tokenIn == address(debt) && tokenOut == address(collateral), TrimWrongDirection());
    }
}
