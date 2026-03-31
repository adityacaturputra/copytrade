/**
 * reset-all.ts — Reset script for copytrade testing
 *
 * Usage:
 *   npx tsx scripts/reset-all.ts                  # Reset everything (DB + exchange)
 *   npx tsx scripts/reset-all.ts --dry-run         # Preview changes without executing
 *   npx tsx scripts/reset-all.ts --skip-exchange   # Only reset database
 *   npx tsx scripts/reset-all.ts --skip-db         # Only reset exchange positions
 *   npx tsx scripts/reset-all.ts --reset-funds     # Also reset demo account funds
 *   npx tsx scripts/reset-all.ts --reset-funds-only # Only reset demo account funds
 *
 * What it does:
 *   1. (DB)       Drops all MongoDB collections (ProcessedMessage, Position, TradeLog, DraftTrade, TradingMode, RiskSettings)
 *                NOTE: DiscordSource is preserved (contains your channel configs & tokens)
 *   2. (Exchange) Closes all open positions on the exchange
 *   3. (Exchange) Cancels all pending algo orders (TP/SL) on the exchange
 *   4. (Funds)    Resets demo trading account to initial balance (OKX simulated only)
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { ExchangeFactory } from "../src/lib/exchange/ExchangeFactory";

// Load .env
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// Parse args
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipExchange = args.includes("--skip-exchange");
const skipDb = args.includes("--skip-db");
const resetFunds = args.includes("--reset-funds");
const resetFundsOnly = args.includes("--reset-funds-only");

// Colors
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const CRESET = "\x1b[0m";

function log(msg: string) { console.log(CYAN + "[RESET]" + CRESET + " " + msg); }
function warn(msg: string) { console.log(YELLOW + "[RESET]" + CRESET + " " + msg); }
function error(msg: string) { console.log(RED + "[RESET]" + CRESET + " " + msg); }
function success(msg: string) { console.log(GREEN + "[RESET]" + CRESET + " " + msg); }

// Collections to clear
const COLLECTIONS_TO_CLEAR = [
  "processedmessages",
  "positions",
  "tradelogs",
  "drafttrades",
  "tradingmodes",
  "risksettings",
];
const PRESERVED_COLLECTIONS = ["discordsources"];

// Main
async function main() {
  console.log();
  console.log(BOLD + CYAN + "=".repeat(55) + CRESET);
  console.log(BOLD + CYAN + "          COPYTRADE RESET SCRIPT" + CRESET);
  console.log(BOLD + CYAN + "=".repeat(55) + CRESET);
  console.log();

  if (dryRun) {
    warn(BOLD + "DRY RUN MODE - No changes will be made" + CRESET);
    console.log();
  }

  // Step 1: Reset Database
  if (!skipDb && !resetFundsOnly) {
    log(BOLD + "Step 1: Resetting Database..." + CRESET);
    const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/copytrade";
    log("  Connecting to: " + uri);

    try {
      await mongoose.connect(uri);
      success("  Connected to MongoDB");
      const db = mongoose.connection.db;
      if (!db) { error("  Failed to get database reference"); process.exit(1); }

      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map((c) => c.name);
      log("  Found " + collectionNames.length + " collections: " + (collectionNames.join(", ") || "(none)"));
      console.log();

      for (const colName of COLLECTIONS_TO_CLEAR) {
        if (collectionNames.includes(colName)) {
          const count = await db.collection(colName).countDocuments();
          if (dryRun) {
            warn("  [DRY] Would drop: " + colName + " (" + count + " documents)");
          } else {
            await db.collection(colName).drop();
            success("  Dropped: " + colName + " (" + count + " documents)");
          }
        } else {
          log("  Skipped: " + colName + " (does not exist)");
        }
      }

      for (const colName of PRESERVED_COLLECTIONS) {
        if (collectionNames.includes(colName)) {
          const count = await db.collection(colName).countDocuments();
          log("  Preserved: " + colName + " (" + count + " documents)");
        }
      }

      await mongoose.disconnect();
      success("  Disconnected from MongoDB");
    } catch (err) {
      error("  Database error: " + (err instanceof Error ? err.message : String(err)));
    }
    console.log();
  } else if (!resetFundsOnly) {
    log(BOLD + "Step 1: Skipped (--skip-db)" + CRESET);
    console.log();
  }

  // Step 2: Close Exchange Positions
  if (!skipExchange && !resetFundsOnly) {
    log(BOLD + "Step 2: Resetting Exchange Positions..." + CRESET);
    const provider = process.env.EXCHANGE_PROVIDER || "paper";
    log("  Exchange provider: " + provider);

    if (provider === "paper") {
      warn("  Paper exchange detected - positions are in-memory and reset on server restart");
      console.log();
    } else {
      try {
        const exchange = ExchangeFactory.getClient();

        log("  Fetching account info...");
        try {
          const account = await exchange.getAccountInfo();
          log("  Balance: $" + account.totalBalance.toFixed(2) + " (available: $" + account.availableBalance.toFixed(2) + ", unrealized PnL: $" + account.unrealizedPnl.toFixed(2) + ")");
        } catch { warn("  Could not fetch account info"); }

        log("  Fetching open positions...");
        const positions = await exchange.getOpenPositions();
        log("  Open positions: " + positions.length);
        for (const pos of positions) {
          log("     - " + pos.symbol + " " + pos.side + " | qty: " + pos.quantity + " | entry: " + pos.entryPrice + " | PnL: $" + pos.unrealizedPnl.toFixed(2));
        }

        if (positions.length === 0) {
          success("  No open positions to close");
        } else if (dryRun) {
          warn("  [DRY] Would close " + positions.length + " position(s): " + positions.map((p) => p.symbol).join(", "));
        } else {
          const result = await exchange.closeAllPositions();
          if (result.closed.length > 0) success("  Closed positions: " + result.closed.join(", "));
          if (result.errors.length > 0) error("  Errors: " + result.errors.join(", "));
        }

        if (provider === "okx") {
          log("  Cancelling algo orders (TP/SL)...");
          if (dryRun) { warn("  [DRY] Would cancel all pending algo orders"); }
          else { await cancelOkxAlgoOrders(); }
        }

        if (!dryRun) {
          log("  Fetching updated account info...");
          try {
            const account = await exchange.getAccountInfo();
            success("  Updated balance: $" + account.totalBalance.toFixed(2) + " (available: $" + account.availableBalance.toFixed(2) + ")");
          } catch { warn("  Could not fetch updated account info"); }
        }
      } catch (err) {
        error("  Exchange error: " + (err instanceof Error ? err.message : String(err)));
      }
      console.log();
    }
  } else if (!resetFundsOnly) {
    log(BOLD + "Step 2: Skipped (--skip-exchange)" + CRESET);
    console.log();
  }

  // Step 3: Reset Demo Funds
  if (resetFunds || resetFundsOnly) {
    log(BOLD + "Step 3: Resetting Demo Account Funds..." + CRESET);
    const provider = process.env.EXCHANGE_PROVIDER || "paper";
    const simulated = process.env.OKX_SIMULATED === "true";

    if (provider !== "okx") {
      warn("  Fund reset only works with OKX exchange (current: " + provider + ")");
    } else if (!simulated) {
      warn("  Fund reset only works with OKX Simulated Trading (set OKX_SIMULATED=true)");
      warn("  Cannot reset funds on a real OKX account - that would be real money!");
    } else {
      if (dryRun) {
        warn("  [DRY] Would reset demo account to initial balance via OKX API");
      } else {
        await resetOkxDemoFunds();
      }
    }
    console.log();
  }

  // Summary
  console.log(BOLD + CYAN + "=".repeat(55) + CRESET);
  if (dryRun) {
    warn(BOLD + "DRY RUN COMPLETE - No changes were made" + CRESET);
    warn(BOLD + "   Remove --dry-run to execute the reset" + CRESET);
  } else {
    success(BOLD + "RESET COMPLETE" + CRESET);
  }
  console.log(BOLD + CYAN + "=".repeat(55) + CRESET);
  console.log();
}

// OKX Algo Order Cancellation
async function cancelOkxAlgoOrders() {
  try {
    const axios = (await import("axios")).default;
    const CryptoJS = (await import("crypto-js")).default;
    const apiKey = process.env.OKX_API_KEY;
    const secretKey = process.env.OKX_SECRET_KEY;
    const passphrase = process.env.OKX_PASSPHRASE;
    if (!apiKey || !secretKey || !passphrase) { warn("  OKX credentials not configured, skipping"); return; }
    const sk: string = secretKey;
    const ak: string = apiKey;
    const pp: string = passphrase;

    const simulated = process.env.OKX_SIMULATED === "true";
    const baseUrl = process.env.OKX_BASE_URL || "https://www.okx.com";
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
    const method = "POST";
    const requestPath = "/api/v5/trade/cancel-algos";
    const body = JSON.stringify({ ordType: "conditional" });
    const message = timestamp + method + requestPath + body;
    const sign = CryptoJS.HmacSHA256(message, sk).toString(CryptoJS.enc.Base64);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "OK-ACCESS-KEY": ak,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": pp,
    };
    if (simulated) headers["x-simulated-trading"] = "1";

    const response = await axios.post(baseUrl + requestPath, body, { headers });
    const data = response.data;
    if (data.code === "0") {
      success("  Cancelled algo orders: " + JSON.stringify(data.data));
    } else {
      warn("  Algo order cancellation: " + (data.msg || "no pending algo orders"));
    }
  } catch (err) {
    warn("  Could not cancel algo orders: " + (err instanceof Error ? err.message : String(err)));
  }
}

// OKX Demo Fund Reset
async function resetOkxDemoFunds() {
  try {
    const axios = (await import("axios")).default;
    const CryptoJS = (await import("crypto-js")).default;
    const apiKey = process.env.OKX_API_KEY;
    const secretKey = process.env.OKX_SECRET_KEY;
    const passphrase = process.env.OKX_PASSPHRASE;
    const baseUrl = process.env.OKX_BASE_URL || "https://www.okx.com";
    if (!apiKey || !secretKey || !passphrase) { error("  OKX credentials not configured"); return; }
    const sk: string = secretKey;
    const ak: string = apiKey;
    const pp: string = passphrase;

    function sign(ts: string, m: string, rp: string, b?: string): string {
      const message = ts + m + rp + (b || "");
      return CryptoJS.HmacSHA256(message, sk).toString(CryptoJS.enc.Base64);
    }
    function getTimestamp(): string {
      return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
    }
    function authHeaders(method: string, requestPath: string, body?: string): Record<string, string> {
      const ts = getTimestamp();
      return {
        "Content-Type": "application/json",
        "OK-ACCESS-KEY": ak,
        "OK-ACCESS-SIGN": sign(ts, method, requestPath, body),
        "OK-ACCESS-TIMESTAMP": ts,
        "OK-ACCESS-PASSPHRASE": pp,
        "x-simulated-trading": "1",
      };
    }

    // Show current balance
    log("  Fetching current demo balance...");
    try {
      const balPath = "/api/v5/account/balance";
      const balResp = await axios.get(baseUrl + balPath, { headers: authHeaders("GET", balPath) });
      const bal = balResp.data.data && balResp.data.data[0];
      if (bal) log("  Current equity: $" + parseFloat(bal.totalEq).toFixed(2));
    } catch { warn("  Could not fetch current balance"); }

    // Try reset endpoints
    log("  Resetting demo account to initial state...");
    const endpoints = [
      "/api/v5/trade-account/reset-demo-acct",
      "/api/v5/account/reset-demo-acct",
    ];
    let resetOk = false;
    for (const ep of endpoints) {
      try {
        const resetBody = JSON.stringify({});
        const resetHeaders = authHeaders("POST", ep, resetBody);
        const response = await axios.post(baseUrl + ep, resetBody, { headers: resetHeaders });
        const data = response.data;
        if (data.code === "0") {
          success("  Demo account reset via " + ep + ": " + JSON.stringify(data.data));
          resetOk = true;
          break;
        } else {
          warn("  " + ep + " failed: " + (data.msg || data.code));
        }
      } catch (err) {
        warn("  " + ep + " error: " + (err instanceof Error ? err.message : String(err)));
      }
    }

    if (!resetOk) {
      error("  All demo reset endpoints failed");
      error("  You can also reset manually at: https://www.okx.com/trade-demo");
      return;
    }

    // Verify new balance
    log("  Verifying new balance...");
    try {
      const balPath = "/api/v5/account/balance";
      const balResp = await axios.get(baseUrl + balPath, { headers: authHeaders("GET", balPath) });
      const bal = balResp.data.data && balResp.data.data[0];
      if (bal) success("  New equity: $" + parseFloat(bal.totalEq).toFixed(2));
    } catch { warn("  Could not verify new balance"); }
  } catch (err) {
    error("  Demo fund reset error: " + (err instanceof Error ? err.message : String(err)));
    error("  You can also reset manually at: https://www.okx.com/trade-demo");
  }
}

// Run
main().catch((err) => {
  error("Fatal error: " + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
