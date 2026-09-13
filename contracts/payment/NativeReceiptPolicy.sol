// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {StrictRLP} from "../proof/StrictRLP.sol";
library NativeReceiptPolicy {
    struct Log {
        address emitter;
        bytes32[] topics;
        bytes data;
    }
    bytes32 constant USED = keccak256("AuthorizationUsed(address,bytes32)");
    bytes32 constant CANCELED =
        keccak256("AuthorizationCanceled(address,bytes32)");
    bytes32 constant TRANSFER = keccak256("Transfer(address,address,uint256)");
    bytes32 constant UPGRADED = keccak256("Upgraded(address)");
    error UnknownReceipt();
    function decode(
        bytes memory raw
    ) internal pure returns (uint256 status, Log[] memory logs) {
        if (raw.length == 0 || raw.length > 131072) revert UnknownReceipt();
        if (uint8(raw[0]) < 128) {
            uint256 kind = uint8(raw[0]);
            if (kind == 0 || kind > 4) revert UnknownReceipt();
            raw = StrictRLP.slice(raw, 1, raw.length - 1);
        }
        StrictRLP.Item[] memory f = StrictRLP.children(raw, 4);
        if (f.length != 4 || !f[3].list || f[2].list || f[2].length != 256)
            revert UnknownReceipt();
        status = StrictRLP.scalar(raw, f[0]);
        if (status > 1) revert UnknownReceipt();
        StrictRLP.scalar(raw, f[1]);
        bytes memory logList = StrictRLP.slice(raw, f[3].start, f[3].size);
        StrictRLP.Item[] memory ls = StrictRLP.children(logList, 1024);
        logs = new Log[](ls.length);
        for (uint256 i; i < ls.length; ++i) {
            bytes memory entry = StrictRLP.slice(
                logList,
                ls[i].start,
                ls[i].size
            );
            StrictRLP.Item[] memory parts = StrictRLP.children(entry, 3);
            if (
                parts.length != 3 ||
                parts[0].list ||
                parts[0].length != 20 ||
                !parts[1].list ||
                parts[2].list
            ) revert UnknownReceipt();
            bytes memory addr = StrictRLP.slice(entry, parts[0].payload, 20);
            address emitter;
            assembly {
                emitter := shr(96, mload(add(addr, 32)))
            }
            logs[i].emitter = emitter;
            bytes memory topicList = StrictRLP.slice(
                entry,
                parts[1].start,
                parts[1].size
            );
            StrictRLP.Item[] memory ts = StrictRLP.children(topicList, 4);
            logs[i].topics = new bytes32[](ts.length);
            for (uint256 j; j < ts.length; ++j)
                logs[i].topics[j] = StrictRLP.hash32(topicList, ts[j]);
            logs[i].data = StrictRLP.slice(
                entry,
                parts[2].payload,
                parts[2].length
            );
        }
    }
    function hasUpgrade(
        Log[] memory logs,
        address proxy
    ) internal pure returns (bool) {
        for (uint256 i; i < logs.length; ++i)
            if (
                logs[i].emitter == proxy &&
                logs[i].topics.length > 0 &&
                logs[i].topics[0] == UPGRADED
            ) return true;
        return false;
    }
    function classify(
        bytes memory raw,
        address token,
        address authorizer,
        bytes32 nonce,
        address recipient,
        uint256 amount,
        uint64 time,
        uint64 afterTime,
        uint64 beforeTime
    ) internal pure returns (uint8) {
        (uint256 status, Log[] memory logs) = decode(raw);
        if (
            status != 1 ||
            recipient == address(0) ||
            recipient == authorizer ||
            recipient == token
        ) revert UnknownReceipt();
        uint256 matches;
        uint256 selected;
        for (uint256 i; i < logs.length; ++i) {
            Log memory l = logs[i];
            if (
                l.emitter == token &&
                l.topics.length == 3 &&
                l.topics[1] == bytes32(uint256(uint160(authorizer))) &&
                l.topics[2] == nonce &&
                (l.topics[0] == USED || l.topics[0] == CANCELED)
            ) {
                ++matches;
                selected = i;
            }
        }
        if (matches != 1 || logs[selected].data.length != 0)
            revert UnknownReceipt();
        if (logs[selected].topics[0] == CANCELED) return 3;
        if (selected + 1 >= logs.length) revert UnknownReceipt();
        Log memory transfer = logs[selected + 1];
        if (
            transfer.emitter != token ||
            transfer.topics.length != 3 ||
            transfer.topics[0] != TRANSFER ||
            transfer.topics[1] != bytes32(uint256(uint160(authorizer))) ||
            transfer.data.length != 32
        ) revert UnknownReceipt();
        bool qualifies = transfer.topics[2] ==
            bytes32(uint256(uint160(recipient))) &&
            abi.decode(transfer.data, (uint256)) == amount &&
            time > afterTime &&
            time < beforeTime;
        return qualifies ? 1 : 4;
    }
}
