const $ = (s) => document.querySelector(s);
for (const button of document.querySelectorAll("[data-page]"))
  button.addEventListener("click", () => {
    for (const b of document.querySelectorAll("[data-page]"))
      b.removeAttribute("aria-current");
    button.setAttribute("aria-current", "page");
    for (const p of document.querySelectorAll(".page"))
      p.hidden = p.id !== button.dataset.page;
  });
const cases = {
  paid: [
    "已付款，就不能把预算退掉。",
    "指定 nonce、收款人、金额与授权窗口共同确定是否按约履约。证明迟到不会改变已经发生的付款。",
    "固定交付方取得 CTC 结算款",
  ],
  unused: [
    "先证明未付款，再释放预算。",
    "在已认证源时间达到授权截止后，正确 nonce 的完整状态证明仍为零。旧授权无法再执行，剩余预算才可用于新尝试。",
    "预算可退或在授权范围内用于新报价",
  ],
  upgrade: [
    "版本不确定，就不能擅自清账。",
    "即使块末 implementation 指针正确，同块升级也可能改变执行语义。完整回执检查发现升级事件时，直接验证路径拒绝自动判断。",
    "保留待定，继续取得版本与执行证据",
  ],
};
for (const b of document.querySelectorAll("[data-case]"))
  b.addEventListener("click", () => {
    const [title, copy, result] = cases[b.dataset.case];
    $("#case-title").textContent = title;
    $("#case-copy").textContent = copy;
    $("#case-result").textContent = result;
    for (const x of document.querySelectorAll("[data-case]"))
      x.setAttribute("aria-pressed", String(x === b));
  });
function field(dl, label, value) {
  const div = document.createElement("div"),
    dt = document.createElement("dt"),
    dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  div.append(dt, dd);
  dl.append(div);
}
try {
  const r = await fetch("/api/evidence");
  if (!r.ok) throw Error("无法读取证据文件");
  const d = await r.json();
  $("#test-status").textContent = d.tests
    ? `${d.tests.passed} 项本地工程测试通过 · ${d.tests.observedAt.slice(0, 10)}`
    : "本轮总报告尚未生成";
  field(
    $("#attest-data"),
    "目标链 / 预编译",
    `${d.attest.targetChainId} / 0x000…0FD2`,
  );
  field($("#attest-data"), "源交易", d.attest.txHash);
  field($("#attest-data"), "观察时间", d.attest.observedAt);
  field(
    $("#attest-data"),
    "结果",
    d.attest.originalVerified
      ? "原始证明通过；篡改状态与 emitter 被拒绝"
      : "当前材料未完成成功验证",
  );
  field($("#usdc-data"), "USDC 代理", d.usdc.proxy);
  field($("#usdc-data"), "匹配的实现", d.usdc.implementation);
  field(
    $("#usdc-data"),
    "状态快照",
    `Ethereum #${d.usdc.height} · authorization mapping slot ${d.usdc.mappingSlot}`,
  );
  field(
    $("#usdc-data"),
    "nonce 见证",
    `已消费：${d.usdc.used}；未使用：${d.usdc.unused}`,
  );
} catch (e) {
  $("#load-error").hidden = false;
  $("#load-error").textContent =
    `${e.message}。请从项目目录运行 npm start，并刷新页面。`;
  $("#test-status").textContent = "运行记录不可用";
}
const input = $("#bundle-file"),
  button = $("#verify-bundle"),
  output = $("#bundle-result");
input.addEventListener("change", () => {
  button.disabled = !input.files.length;
  output.hidden = true;
});
button.addEventListener("click", async () => {
  button.disabled = true;
  button.textContent = "正在核验…";
  output.hidden = false;
  output.classList.remove("error");
  output.textContent = "正在读取文件并校验签名。";
  try {
    const f = input.files[0];
    if (f.size > 1048576) throw Error("恢复包超过 1 MB，请使用原始订单 JSON");
    const content = await f.text();
    JSON.parse(content);
    const r = await fetch("/api/verify-bundle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: content,
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error ?? "核验失败");
    output.textContent = JSON.stringify(d, null, 2);
  } catch (e) {
    output.classList.add("error");
    output.textContent = `核验未通过：${e.message}\n请检查是否包含完整订单、签名报价和原始摘要。`;
  } finally {
    button.disabled = false;
    button.textContent = "核验恢复包";
  }
});
