// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
// Local integration fixture only. Deliberately small, never deployed to a public network.
contract SmartWallet {
    address public owner;
    constructor(address initialOwner) { owner = initialOwner; }
    function changeOwner(address next) external { require(msg.sender == owner); owner = next; }
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns(bytes4) {
        if (signature.length != 65) return 0xffffffff;
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(signature.offset) s := calldataload(add(signature.offset,32)) v := byte(0,calldataload(add(signature.offset,64))) }
        return ecrecover(digest,v,r,s) == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
