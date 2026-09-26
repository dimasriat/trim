// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
import { SwapVM } from "@1inch/swap-vm/contracts/SwapVM.sol";
import { Context } from "@1inch/swap-vm/contracts/libs/VM.sol";
import { AquaOpcodes } from "@1inch/swap-vm/contracts/opcodes/AquaOpcodes.sol";

import { TrimSkew } from "./instructions/TrimSkew.sol";

/// @title TrimSwapVMRouter
/// @notice The Aqua SwapVM router with the TrimSkew instruction added to its opcode dispatch.
contract TrimSwapVMRouter is Simulator, SwapVM, AquaOpcodes {
    /// @param aqua Aqua instance.
    /// @param weth WETH address.
    /// @param owner Router owner.
    /// @param name EIP-712 domain name.
    /// @param version EIP-712 domain version.
    constructor(address aqua, address weth, address owner, string memory name, string memory version)
        SwapVM(aqua, weth, owner, name, version)
    { }

    /// @dev Routes TrimSkew's opcode to TrimSkew.exec; every other opcode to the Aqua opcode set.
    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        if (opcode == uint8(TrimSkew.opcode)) TrimSkew.exec(ctx, args);
        else _runOpcode(ctx, opcode, args);
    }
}
