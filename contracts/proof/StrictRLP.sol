// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
library StrictRLP {
    error InvalidRLP();
    struct Item {
        uint256 start;
        uint256 size;
        uint256 payload;
        uint256 length;
        bool list;
    }
    function item(
        bytes memory d,
        uint256 s
    ) internal pure returns (Item memory o) {
        if (s >= d.length) revert InvalidRLP();
        uint256 b = uint8(d[s]);
        o.start = s;
        if (b < 128) {
            o.payload = s;
            o.length = 1;
            o.size = 1;
            return o;
        }
        uint256 p;
        if (b <= 183) {
            p = 1;
            o.length = b - 128;
        } else if (b <= 191) {
            p = 1 + b - 183;
            o.length = longLength(d, s + 1, p - 1);
            if (o.length < 56) revert InvalidRLP();
        } else if (b <= 247) {
            p = 1;
            o.length = b - 192;
            o.list = true;
        } else {
            p = 1 + b - 247;
            o.length = longLength(d, s + 1, p - 1);
            if (o.length < 56) revert InvalidRLP();
            o.list = true;
        }
        if (p > d.length - s || o.length > d.length - s - p)
            revert InvalidRLP();
        o.payload = s + p;
        o.size = p + o.length;
        if (!o.list && o.length == 1 && uint8(d[o.payload]) < 128)
            revert InvalidRLP();
    }
    function longLength(
        bytes memory d,
        uint256 a,
        uint256 n
    ) private pure returns (uint256 v) {
        if (n == 0 || n > 8 || a >= d.length || n > d.length - a || d[a] == 0)
            revert InvalidRLP();
        for (uint256 i; i < n; ++i) v = (v << 8) | uint8(d[a + i]);
    }
    function children(
        bytes memory d,
        uint256 max
    ) internal pure returns (Item[] memory out) {
        Item memory top = item(d, 0);
        if (!top.list || top.size != d.length) revert InvalidRLP();
        out = new Item[](max);
        uint256 c = top.payload;
        uint256 end = c + top.length;
        uint256 n;
        while (c < end) {
            if (n == max) revert InvalidRLP();
            Item memory x = item(d, c);
            if (x.size > end - c) revert InvalidRLP();
            out[n++] = x;
            c += x.size;
        }
        if (c != end) revert InvalidRLP();
        assembly {
            mstore(out, n)
        }
    }
    function scalar(
        bytes memory d,
        Item memory p
    ) internal pure returns (uint256 v) {
        if (p.list || p.length > 32 || (p.length > 0 && d[p.payload] == 0))
            revert InvalidRLP();
        for (uint256 i; i < p.length; ++i)
            v = (v << 8) | uint8(d[p.payload + i]);
    }
    function hash32(
        bytes memory d,
        Item memory p
    ) internal pure returns (bytes32 v) {
        if (p.list || p.length != 32) revert InvalidRLP();
        uint256 a = p.payload;
        assembly {
            v := mload(add(add(d, 32), a))
        }
    }
    function slice(
        bytes memory d,
        uint256 a,
        uint256 n
    ) internal pure returns (bytes memory out) {
        if (a > d.length || n > d.length - a) revert InvalidRLP();
        out = new bytes(n);
        for (uint256 i; i < n; ++i) out[i] = d[a + i];
    }
}
