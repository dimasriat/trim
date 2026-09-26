// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { ISwapVM } from "@1inch/swap-vm/contracts/interfaces/ISwapVM.sol";
import { MakerTraits } from "@1inch/swap-vm/contracts/libs/MakerTraits.sol";

import { TrimSwapVMRouter } from "../src/TrimSwapVMRouter.sol";
import { TrimOrders } from "../src/TrimOrders.sol";
import { TrimAaveVault } from "../src/TrimAaveVault.sol";
import { TrimFiller } from "../src/TrimFiller.sol";
import { IAavePool } from "../src/interfaces/aave/IAavePool.sol";
import { IAaveOracle } from "../src/interfaces/aave/IAaveOracle.sol";

interface IWETH {
    function deposit() external payable;
}

contract DeployDemo is Script {
    IAavePool constant POOL = IAavePool(0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2);
    IAaveOracle constant ORACLE = IAaveOracle(0x54586bE62E3c3580375aE3723C145253060Ca0C2);
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    uint256 constant COLLATERAL = 10e18;
    uint256 constant OPEN_HF = 1.6e18;
    uint256 constant TARGET_HF = 1.5e18;
    uint16 constant MAX_DISCOUNT_BPS = 100;
    uint64 constant FULL_DEVIATION = 0.2e18;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_KEY");
        uint256 ownerKey = vm.envUint("OWNER_KEY");
        address owner = vm.addr(ownerKey);
        address operator = vm.addr(vm.envUint("FILLER_KEY"));

        vm.startBroadcast(deployerKey);
        Aqua aqua = Aqua(0x499943E74FB0cE105688beeE8Ef2ABec5D936d31);
        TrimSwapVMRouter router = new TrimSwapVMRouter(address(aqua), WETH, vm.addr(deployerKey), "Trim", "1");
        TrimAaveVault vault = new TrimAaveVault(POOL, ORACLE, aqua, address(router), WETH, USDC, TARGET_HF, owner);
        TrimFiller filler = new TrimFiller(aqua, ISwapVM(address(router)), operator);
        vm.stopBroadcast();

        uint256 debt = _debtFor(COLLATERAL, OPEN_HF);
        ISwapVM.Order memory order = TrimOrders.build(address(vault), WETH, USDC, true, MAX_DISCOUNT_BPS, FULL_DEVIATION);

        vm.startBroadcast(ownerKey);
        IWETH(WETH).deposit{ value: COLLATERAL }();
        IERC20(WETH).approve(address(vault), COLLATERAL);
        vault.open(COLLATERAL, debt);
        vault.ship(order, COLLATERAL);
        IERC20(USDC).transfer(address(filler), debt / 2);
        vm.stopBroadcast();

        string memory json = "demo";
        vm.serializeAddress(json, "aqua", address(aqua));
        vm.serializeAddress(json, "router", address(router));
        vm.serializeAddress(json, "vault", address(vault));
        vm.serializeAddress(json, "filler", address(filler));
        vm.serializeAddress(json, "owner", owner);
        vm.serializeAddress(json, "operator", operator);
        vm.serializeAddress(json, "oracle", address(ORACLE));
        vm.serializeAddress(json, "weth", WETH);
        vm.serializeAddress(json, "usdc", USDC);
        vm.serializeUint(json, "maxDiscountBps", MAX_DISCOUNT_BPS);
        vm.serializeUint(json, "fullDeviation", FULL_DEVIATION);
        vm.serializeUint(json, "targetHealthFactor", TARGET_HF);
        vm.serializeAddress(json, "orderMaker", order.maker);
        vm.serializeUint(json, "orderTraits", uint256(MakerTraits.unwrap(order.traits)));
        string memory out = vm.serializeBytes(json, "orderData", order.data);
        vm.writeJson(out, vm.envOr("DEPLOYMENTS_PATH", string("./deployments/anvil.json")));
    }

    function _debtFor(uint256 collateral, uint256 healthFactor) internal view returns (uint256) {
        uint256 collateralBase = collateral * ORACLE.getAssetPrice(WETH) / 1e18;
        uint256 debtBase = collateralBase * 8_300 * 1e18 / (10_000 * healthFactor);
        return debtBase * 1e6 / ORACLE.getAssetPrice(USDC);
    }
}
