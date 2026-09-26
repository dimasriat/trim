// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { ISwapVM } from "@1inch/swap-vm/contracts/interfaces/ISwapVM.sol";

import { TrimSwapVMRouter } from "../src/TrimSwapVMRouter.sol";
import { TrimOrders } from "../src/TrimOrders.sol";
import { TrimAaveVault } from "../src/TrimAaveVault.sol";
import { TrimFiller } from "../src/TrimFiller.sol";
import { IAavePool } from "../src/interfaces/aave/IAavePool.sol";
import { IAaveOracle } from "../src/interfaces/aave/IAaveOracle.sol";

contract TrimFillerForkTest is Test {
    IAavePool constant POOL = IAavePool(0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2);
    IAaveOracle constant ORACLE = IAaveOracle(0x54586bE62E3c3580375aE3723C145253060Ca0C2);
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    Aqua aqua;
    TrimSwapVMRouter router;
    TrimAaveVault vault;
    TrimFiller filler;
    ISwapVM.Order order;
    address owner = makeAddr("owner");
    address bot = makeAddr("bot");

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("mainnet"), 26_050_000);
        aqua = Aqua(0x499943E74FB0cE105688beeE8Ef2ABec5D936d31);
        router = new TrimSwapVMRouter(address(aqua), WETH, address(this), "Trim", "1");
        vault = new TrimAaveVault(POOL, ORACLE, aqua, address(router), WETH, USDC, 1.5e18, owner);
        filler = new TrimFiller(aqua, ISwapVM(address(router)), bot);
        uint256 price = ORACLE.getAssetPrice(WETH);

        deal(WETH, owner, 10e18);
        vm.startPrank(owner);
        IERC20(WETH).approve(address(vault), 10e18);
        vault.open(10e18, 10 * price * 8_300 / 16_000 / 100);
        order = TrimOrders.build(address(vault), WETH, USDC, true, 500, 0.3e18);
        vault.ship(order, 10e18);
        vm.stopPrank();

        vm.mockCall(address(ORACLE), abi.encodeCall(IAaveOracle.getAssetPrice, (WETH)), abi.encode(price * 80 / 100));
        deal(USDC, address(filler), 5_000e6);
    }

    function test_QuoteMatchesFill() public {
        (, uint256 quoted) = filler.quote(order, USDC, WETH, 2_000e6);

        vm.prank(bot);
        (uint256 amountIn, uint256 amountOut) = filler.fill(order, USDC, WETH, 2_000e6, quoted);

        assertEq(amountIn, 2_000e6);
        assertEq(amountOut, quoted);
        assertEq(IERC20(WETH).balanceOf(address(filler)), quoted);
    }

    function test_FillRespectsMinimumOut() public {
        (, uint256 quoted) = filler.quote(order, USDC, WETH, 2_000e6);

        vm.prank(bot);
        vm.expectRevert();
        filler.fill(order, USDC, WETH, 2_000e6, quoted + 1);
    }

    function test_OnlyOperatorFills() public {
        vm.expectRevert(TrimFiller.TrimFillerNotOperator.selector);
        filler.fill(order, USDC, WETH, 2_000e6, 0);
    }

    function test_OperatorWithdrawsProceeds() public {
        vm.startPrank(bot);
        filler.fill(order, USDC, WETH, 2_000e6, 0);
        filler.withdraw(WETH, bot);
        vm.stopPrank();

        assertGt(IERC20(WETH).balanceOf(bot), 0);
        assertEq(IERC20(WETH).balanceOf(address(filler)), 0);
    }
}
