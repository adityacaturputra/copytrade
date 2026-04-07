/**
 * copytrade-proxy — Reverse proxy for OKX & MEXC APIs.
 *
 * Provides a static outbound IP so exchange API whitelisting works.
 * Deploy on Oracle Cloud Free Tier VPS.
 *
 * Routes:
 *   /okx/*  → https://www.okx.com/*
 *   /mexc/* → https://contract.mexc.com/*
 *
 * Env vars (via .env or system):
 *   PORT          — listen port (default: 3000)
 *   OKX_TARGET    — OKX base URL (default: https://www.okx.com)
 *   MEXC_TARGET   — MEXC base URL (default: https://contract.mexc.com)
 *   ALLOWED_IPS   — comma-separated IPs allowed to connect (default: allow all)
 *   API_SECRET    — if set, requests must include ?secret=<value> or header x-proxy-secret
 */

require("dotenv").config();

const http = require("http");
const https = require("https");
const { URL } = require("url");

// ─── Config ────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3000", 10);
const OKX_TARGET = process.env.OKX_TARGET || "https://www.okx.com";
const MEXC_TARGET = process.env.MEXC_TARGET || "https://contract.mexc.com";
const API_SECRET = process.env.API_SECRET || "";
const ALLOWED_IPS = process.env.ALLOWED_IPS
  ? process.env.ALLOWED_IPS.split(",").map((s) => s.trim())
  : [];

const ROUTES = {
  "/okx": OKX_TARGET,
  "/mexc": MEXC_TARGET,
};

// ─── Logging ───────────────────────────────────────────────────────────────
function log(method, url, status, duration) {
  const ts = new Date().toISOString();
  console.log(`${ts} ${method} ${url} → ${status} (${duration}ms)`);
}

// ─── Auth middleware ────────────────────────────────────────────────────────
function isAllowed(req) {
  // Check IP whitelist
  if (ALLOWED_IPS.length > 0) {
    const clientIP =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket.remoteAddress;
    if (!ALLOWED_IPS.includes(clientIP)) {
      return false;
    }
  }

  // Check API secret
  if (API_SECRET) {
    const querySecret = new URL(req.url, "http://localhost").searchParams.get(
      "secret"
    );
    const headerSecret = req.headers["x-proxy-secret"];
    if (querySecret !== API_SECRET && headerSecret !== API_SECRET) {
      return false;
    }
  }

  return true;
}

// ─── Proxy handler ──────────────────────────────────────────────────────────
function proxyRequest(req, res) {
  const start = Date.now();

  // Auth check
  if (!isAllowed(req)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden" }));
    return;
  }

  // Parse the path to find matching route
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  let targetBase = null;
  let prefix = "";

  for (const [routePrefix, target] of Object.entries(ROUTES)) {
    if (pathname.startsWith(routePrefix + "/") || pathname === routePrefix) {
      targetBase = target;
      prefix = routePrefix;
      break;
    }
  }

  if (!targetBase) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Not found",
        routes: Object.keys(ROUTES).map((r) => `${r}/*`),
      })
    );
    return;
  }

  // Build target URL: strip the prefix, keep the rest
  const targetPath = pathname.slice(prefix.length) || "/";
  const targetUrl = new URL(targetPath, targetBase);
  // Preserve query params (but strip 'secret' if present)
  const searchParams = parsedUrl.searchParams;
  searchParams.delete("secret");
  targetUrl.search = searchParams.toString();

  // Build request options
  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || 443,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetUrl.hostname,
    },
  };

  // Remove proxy-specific headers
  delete options.headers["x-forwarded-for"];
  delete options.headers["x-forwarded-host"];
  delete options.headers["x-forwarded-proto"];
  delete options.headers["x-proxy-secret"];
  delete options.headers["connection"];

  // Make the proxied request
  const proxyReq = https.request(options, (proxyRes) => {
    const status = proxyRes.statusCode;
    const duration = Date.now() - start;
    log(req.method, pathname, status, duration);

    // Forward status and headers
    const responseHeaders = { ...proxyRes.headers };
    // Add CORS headers for debugging
    responseHeaders["x-proxy-id"] = "copytrade-proxy";
    res.writeHead(status, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
 const duration = Date.now() - start;
    log(req.method, pathname, 502, duration);
    console.error(`  Error: ${err.message}`);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Bad Gateway", message: err.message }));
  });

  // Pipe request body (for POST/PUT)
  req.pipe(proxyReq);
}

// ─── Start server ───────────────────────────────────────────────────────────
const server = http.createServer(proxyRequest);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 copytrade-proxy running on port ${PORT}`);
  console.log(`   Routes:`);
  for (const [prefix, target] of Object.entries(ROUTES)) {
    console.log(`   ${prefix}/* → ${target}/*`);
  }
  if (API_SECRET) console.log(`   Auth: API_SECRET enabled`);
  if (ALLOWED_IPS.length > 0)
    console.log(`   IP whitelist: ${ALLOWED_IPS.join(", ")}`);
  console.log(`\n   Static IP whitelist this server's IP on your exchange dashboard.\n`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\nShutting down...");
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.close(() => process.exit(0));
});
