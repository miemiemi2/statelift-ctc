import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBundle } from "../lib/bundle.js";
const here = path.dirname(fileURLToPath(import.meta.url)),
  root = path.dirname(here),
  port = Number(process.env.STATELIFT_PORT ?? 4178);
const files = {
  attest: "research/sdk/receipt-binding-fresh-result.json",
  usdc: "research/usdc/manifest-probe.json",
  report: "research/engineering-test-report.json",
};
const json = (file) =>
  JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
function send(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/api/evidence") {
      const a = json(files.attest),
        u = json(files.usdc);
      let tests = null;
      try {
        tests = json(files.report);
      } catch {}
      return send(res, 200, {
        tests,
        attest: {
          targetChainId: parseInt(a.chain.result, 16),
          txHash: a.txHash,
          observedAt: a.observedAt,
          originalVerified:
            a.observations.find((x) => x.label === "original")?.verified ===
            true,
        },
        usdc: {
          proxy: u.proxy,
          implementation: u.implementation,
          height: parseInt(u.block.number, 16),
          mappingSlot: u.authorizationMappingSlot,
          used: u.values[1].value,
          unused: u.values[2].value,
        },
      });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/download/")) {
      const key = url.pathname.split("/").at(-1);
      if (!files[key] || !fs.existsSync(path.join(root, files[key])))
        return send(res, 404, { error: "evidence report not available" });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="statelift-${key}.json"`,
      });
      return fs.createReadStream(path.join(root, files[key])).pipe(res);
    }
    if (req.method === "POST" && url.pathname === "/api/verify-bundle") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 1048576)
          return send(res, 413, { error: "file too large" });
      }
      try {
        return send(res, 200, verifyBundle(JSON.parse(body)));
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
    }
    if (req.method !== "GET")
      return send(res, 405, { error: "method not allowed" });
    const map = {
      "/": "index.html",
      "/style.css": "style.css",
      "/app.js": "app.js",
      "/assets/ibm-plex-sans.ttf": "assets/ibm-plex-sans.ttf",
    };
    const relative = map[url.pathname];
    if (!relative) return send(res, 404, { error: "not found" });
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".ttf": "font/ttf",
    };
    res.writeHead(200, {
      "Content-Type": types[path.extname(relative)],
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    fs.createReadStream(path.join(here, relative)).pipe(res);
  } catch (e) {
    if (!res.headersSent)
      send(res, 500, {
        error:
          "Evidence unavailable; run the documented verification commands.",
      });
    else res.end();
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`StateLift engineering workspace: http://127.0.0.1:${port}`),
);
