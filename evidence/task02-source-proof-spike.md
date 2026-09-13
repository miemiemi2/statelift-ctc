# Task 2 evidence — 源链证明可导出性 spike

命令: node --test tests/fixtures/source-proof.spike.test.cjs
时间: 2026-09-13T07:09:13Z
结论: 通过，无退化。真实源链执行 -> eth_getProof -> CTC 侧真实 MPT 验证 全链路成立。

## 原始输出
```



✔ real source-chain storage is verified on the CTC side through real MPT proofs (2547.633779ms)
✔ real source-chain receipt is verified on the CTC side and its trie root matches the header (1678.459688ms)
✔ a source block that was never anchored cannot be used as a fact source (301.716141ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 23089.160704
```
