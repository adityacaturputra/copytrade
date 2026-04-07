import axios, { AxiosInstance } from "axios";
import CryptoJS from "crypto-js";
import {
  ExchangeClient,
  OrderParams,
  PositionInfo,
  AccountInfo,
  KlineData,
  OrderResult,
  OpenOrderInfo,
  AlgoOrderInfo,
  HistoricalOrder,
  InstrumentSpecs,
} from "./types";
import { getProxyAgent } from "../proxy/ProxyFactory";

// ==================== OKX Exchange Adapter ====================

const BASE_URL =
  process.env.OKX_PROXY_URL ||
  process.env.OKX_BASE_URL ||
  "https://www.okx.com";

/**
 * OKX V5 API — ExchangeClient implementation.
 *
 * Auth docs: https://www.okx.com/docs-v5/en/#rest-api-authentication
 * Trade docs: https://www.okx.com/docs-v5/en/#rest-api-trade
 * Account docs: https://www.okx.com/docs-v5/en/#rest-api-account
 *
 * Env vars used:
 *   OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE
 *   OKX_SIMULATED (optional, set to "true" for demo/testnet)
 *   OKX_BASE_URL (optional, e.g. https://aws.okx.com)
 */
export class OkxExchange implements ExchangeClient {
  readonly name = "okx";

  private apiKey: string;
  private secretKey: string;
  private passphrase: string;
  private simulated: boolean;
  private client: AxiosInstance;

  /** Cache instrument specs to avoid repeated API calls */
  private specsCache = new Map<
    string,
    { specs: InstrumentSpecs; ts: number }
  >();
  private static SPECS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  constructor(
    apiKey: string,
    secretKey: string,
    passphrase: string,
    simulated: boolean = false,
  ) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.passphrase = passphrase;
    this.simulated = simulated;
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // ─── Proxy: attach httpsProxyAgent for Webshare static IP ────────
    this.client.interceptors.request.use(async (config) => {
      try {
        const agent = await getProxyAgent();
        if (agent) {
          config.httpsAgent = agent;
          config.httpAgent = agent;
        }
      } catch (err) {
        console.warn(
          "[OKX] ⚠️ Proxy agent not available, using direct connection:",
          err instanceof Error ? err.message : err,
        );
      }
      return config;
    });

    // ─── Error-only request/response logging ──────────────────────────
    this.client.interceptors.response.use(
      (response) => {
        // Check if OKX returned a business-level error (code !== "0")
        const data = response.data;
        if (data && data.code !== undefined && data.code !== "0") {
          const method = (response.config.method || "GET").toUpperCase();
          console.error(
            `[OKX] ❌ ${method} ${response.config.url}\n` +
              `       ➡️  Request body: ${response.config.data || "(no body)"}\n` +
              `       ⬅️  Response (${response.status}): ${JSON.stringify(data)}`,
          );
        }
        return response;
      },
      (error) => {
        if (axios.isAxiosError(error) && error.response) {
          const method = (error.config?.method || "GET").toUpperCase();
          console.error(
            `[OKX] ❌ ${method} ${error.config?.url} — HTTP ${error.response.status}\n` +
              `       ➡️  Request body: ${error.config?.data || "(no body)"}\n` +
              `       ⬅️  Response body: ${JSON.stringify(error.response.data)}`,
          );
        }
        return Promise.reject(error);
      },
    );
  }

  // ─── Auth helpers ──────────────────────────────────────────────────

  private sign(
    timestamp: string,
    method: string,
    path: string,
    body?: string,
  ): string {
    const message = timestamp + method + path + (body || "");
    return CryptoJS.HmacSHA256(message, this.secretKey).toString(
      CryptoJS.enc.Base64,
    );
  }

  private getTimestamp(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
  }

  private authHeaders(
    method: string,
    path: string,
    body?: string,
  ): Record<string, string> {
    const timestamp = this.getTimestamp();
    const sign = this.sign(timestamp, method, path, body);
    const headers: Record<string, string> = {
      "OK-ACCESS-KEY": this.apiKey,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": this.passphrase,
    };
    if (this.simulated) {
      headers["x-simulated-trading"] = "1";
    }
    return headers;
  }

  // ─── Instrument helpers ────────────────────────────────────────────

  /**
   * Convert standard symbol (e.g. "BTCUSDT") to OKX instrument ID ("BTC-USDT-SWAP").
   * OKX uses: BASE-QUOTE-SWAP for perpetuals.
   */
  private toOkxSymbol(symbol: string): string {
    // If already in OKX format, return as-is
    if (symbol.includes("-")) return symbol;
    // Try to split at USDT, USD, BTC, ETH boundaries
    const quote = symbol.endsWith("USDT")
      ? "USDT"
      : symbol.endsWith("USD")
        ? "USD"
        : null;
    if (quote) {
      const base = symbol.slice(0, -quote.length);
      return `${base}-${quote}-SWAP`;
    }
    // Fallback: assume USDT perpetual
    return `${symbol}-USDT-SWAP`;
  }

  /** Convert OKX instId back to standard symbol like "BTCUSDT" */
  private fromOkxSymbol(instId: string): string {
    return instId.replace(/-/g, "").replace("SWAP", "");
  }

  /**
   * Validate that an instrument exists on OKX and get its details.
   * Returns the instrument info or throws if not found.
   *
   * Docs: https://www.okx.com/docs-v5/en/#rest-api-public-data-get-instruments
   */
  async validateInstrument(symbol: string): Promise<{
    instId: string;
    baseCcy: string;
    quoteCcy: string;
    ctVal: string;
    ctValCcy: string;
    ctMult: string;
    ctType: string;
    lotSz: string;
    minSz: string;
    tickSz: string;
    state: string;
    instType: string;
  }> {
    const instId = this.toOkxSymbol(symbol);
    const path = `/api/v5/public/instruments?instType=SWAP&instId=${instId}`;

    console.log(`[OKX] 🔍 Validating instrument: ${instId}...`);

    try {
      const response = await this.client.get(path);
      const data = response.data;

      if (data.code === "0" && data.data?.[0]) {
        const inst = data.data[0];
        console.log(
          `[OKX] ✅ Instrument validated: ${instId} (state=${inst.state}, ctVal=${inst.ctVal}, lotSz=${inst.lotSz}, minSz=${inst.minSz})`,
        );
        return inst;
      }

      // Instrument not found — try to suggest alternatives
      console.warn(
        `[OKX] ⚠️ Instrument ${instId} not found. Searching for alternatives...`,
      );

      // Search by underlying
      const baseCcy = instId.split("-")[0];
      const searchPath = `/api/v5/public/instruments?instType=SWAP`;
      const searchResp = await this.client.get(searchPath);
      const searchData = searchResp.data;

      if (searchData.code === "0" && searchData.data) {
        const matches = searchData.data.filter(
          (i: { baseCcy: string; quoteCcy: string; state: string }) =>
            i.baseCcy === baseCcy && i.state === "live",
        );
        if (matches.length > 0) {
          const suggestions = matches
            .map(
              (m: { instId: string; quoteCcy: string }) =>
                `${m.instId} (${m.quoteCcy})`,
            )
            .join(", ");
          throw new Error(
            `Instrument "${instId}" not found. Did you mean one of: ${suggestions}?`,
          );
        }
      }

      throw new Error(
        `Instrument "${instId}" not found on OKX. No alternatives available for ${baseCcy}.`,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        throw error;
      }
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to validate instrument ${instId}: ${errMsg}`);
    }
  }

  // ─── Account Configuration ──────────────────────────────────────────

  /**
   * Set OKX account mode.
   * 1 = Simple (cash), 2 = Single-currency margin, 3 = Multi-currency margin, 4 = Portfolio margin
   * Futures/swap trading requires mode 2+.
   *
   * Docs: https://www.okx.com/docs-v5/en/#rest-api-account-set-account-mode
   */
  async setAccountMode(
    accountMode: "1" | "2" | "3" | "4" = "2",
  ): Promise<void> {
    const path = "/api/v5/account/set-account-mode";
    const body = JSON.stringify({ acctMode: accountMode });
    const headers = this.authHeaders("POST", path, body);

    console.log(
      `[OKX] Setting account mode to ${accountMode} (${accountMode === "2" ? "Single-currency margin" : accountMode === "3" ? "Multi-currency margin" : "mode " + accountMode})...`,
    );

    try {
      const response = await this.client.post(path, body, { headers });
      const data = response.data;

      if (data.code === "0") {
        console.log(`[OKX] ✅ Account mode set to ${accountMode}`);
        return;
      }

      console.error(
        `[OKX] ❌ Failed to set account mode: code=${data.code}, msg=${data.msg}`,
      );
      throw new Error(
        `Failed to set OKX account mode: ${data.msg || "Unknown error"} (code: ${data.code})`,
      );
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        console.warn(
          `[OKX] ⚠️ set-account-mode endpoint returned 404 — this is normal for simulated trading or when account mode is already correct`,
        );
        throw new Error(
          "set-account-mode not available (simulated trading or already configured)",
        );
      }
      throw error;
    }
  }

  /**
   * Set position mode for an instrument.
   * "long_short_mode" = hedged (supports posSide: long/short)
   * "net_mode" = net position (no posSide needed)
   *
   * Docs: https://www.okx.com/docs-v5/en/#rest-api-account-set-position-mode
   */
  async setPositionMode(
    symbol: string,
    positionMode: "long_short_mode" | "net_mode" = "long_short_mode",
  ): Promise<void> {
    const path = "/api/v5/account/set-position-mode";
    const body = JSON.stringify({ posMode: positionMode });
    const headers = this.authHeaders("POST", path, body);

    console.log(`[OKX] Setting position mode to "${positionMode}"...`);

    const response = await this.client.post(path, body, { headers });
    const data = response.data;

    if (data.code === "0") {
      console.log(`[OKX] ✅ Position mode set to ${positionMode}`);
    } else {
      console.error(
        `[OKX] ❌ Failed to set position mode: code=${data.code}, msg=${data.msg}`,
      );
      throw new Error(
        `Failed to set OKX position mode: ${data.msg || "Unknown error"} (code: ${data.code})`,
      );
    }
  }

  /**
   * Ensure the account is configured correctly for futures/swap trading.
   * Sets account mode to Single-currency margin and position mode to long_short_mode.
   */
  async ensureAccountConfigured(symbol: string): Promise<void> {
    // Try to set account mode (may fail gracefully for simulated trading)
    try {
      await this.setAccountMode("2");
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[OKX] ⚠️ Could not set account mode (may already be correct): ${errMsg}`,
      );
    }

    // Try to set position mode to long_short_mode
    try {
      await this.setPositionMode(symbol, "long_short_mode");
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[OKX] ⚠️ Could not set position mode (may already be correct): ${errMsg}`,
      );
    }
  }

  // ─── Account ────────────────────────────────────────────────────────

  async getAccountInfo(): Promise<AccountInfo> {
    const path = "/api/v5/account/balance";
    const headers = this.authHeaders("GET", path);

    const response = await this.client.get(path, { headers });
    const data = response.data;

    if (data.code === "0" && data.data?.[0]) {
      const account = data.data[0];
      const usdtDetail = account.details?.find(
        (d: { ccy: string }) => d.ccy === "USDT",
      );
      return {
        totalBalance: parseFloat(account.totalEq || "0"),
        availableBalance: parseFloat(
          usdtDetail?.availBal || usdtDetail?.cashBal || "0",
        ),
        unrealizedPnl: parseFloat(usdtDetail?.upl || "0"),
        currency: "USD",
      };
    }
    throw new Error(`OKX API error: ${data.msg || "Unknown error"}`);
  }

  // ─── Market Data ────────────────────────────────────────────────────

  async getTickerPrice(symbol: string): Promise<number> {
    const instId = this.toOkxSymbol(symbol);
    const path = `/api/v5/market/ticker?instId=${instId}`;
    const response = await this.client.get(path);
    const data = response.data;

    if (data.code === "0" && data.data?.[0]) {
      return parseFloat(data.data[0].last);
    }
    throw new Error(`Failed to get price for ${symbol} (${instId})`);
  }

  async getKlines(
    symbol: string,
    interval: string = "1H",
    limit: number = 24,
  ): Promise<KlineData[]> {
    const instId = this.toOkxSymbol(symbol);
    const path = `/api/v5/market/candles?instId=${instId}&bar=${interval}&limit=${limit}`;
    const response = await this.client.get(path);
    const data = response.data;

    if (data.code === "0" && data.data) {
      // OKX returns newest first, reverse to match standard chronologic order
      return data.data.reverse().map((k: string[]) => ({
        time: Math.floor(parseFloat(k[0]) / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
    }
    return [];
  }

  // ─── Positions ──────────────────────────────────────────────────────

  async getOpenPositions(): Promise<PositionInfo[]> {
    const path = "/api/v5/account/positions";
    const headers = this.authHeaders("GET", path);

    const response = await this.client.get(path, { headers });
    const data = response.data;

    if (data.code === "0") {
      return (data.data || []).map(
        (pos: {
          instId: string;
          pos: string;
          posSide: string;
          lever: string;
          margin: string;
          avgPx: string;
          upl: string;
          liqPx: string;
          markPx: string;
          mgnMode: string;
          posId: string;
        }) => ({
          symbol: this.fromOkxSymbol(pos.instId),
          positionId: pos.posId || pos.instId,
          side: pos.posSide === "long" ? ("LONG" as const) : ("SHORT" as const),
          leverage: parseFloat(pos.lever),
          marginType:
            pos.mgnMode === "isolated" ? "isolated" : ("cross" as const),
          entryPrice: parseFloat(pos.avgPx),
          quantity: Math.abs(parseFloat(pos.pos)),
          margin: parseFloat(pos.margin),
          unrealizedPnl: parseFloat(pos.upl),
          liquidationPrice: parseFloat(pos.liqPx) || 0,
          markPrice: parseFloat(pos.markPx),
          raw: pos,
        }),
      );
    }
    if (data.code === "51001") {
      // No positions
      return [];
    }
    throw new Error(
      `Failed to get OKX positions: ${data.msg || "Unknown error"}`,
    );
  }

  // ─── Leverage ───────────────────────────────────────────────────────

  /**
   * Set leverage for a symbol.
   *
   * IMPORTANT: When account is in long_short_mode (hedged), OKX requires
   * posSide parameter. We set leverage for BOTH long and short sides.
   *
   * Docs: https://www.okx.com/docs-v5/en/#rest-api-account-set-leverage
   */
  async setLeverage(
    symbol: string,
    leverage: number,
    marginType: "isolated" | "cross" = "isolated",
    side?: "BUY" | "SELL",
  ): Promise<void> {
    const instId = this.toOkxSymbol(symbol);
    const path = "/api/v5/account/set-leverage";

    // In long_short_mode, we need to set leverage for each posSide separately
    // If side is specified, set for that side only; otherwise set for both
    const sides: Array<{ posSide: string; label: string }> =
      side === "BUY"
        ? [{ posSide: "long", label: "long" }]
        : side === "SELL"
          ? [{ posSide: "short", label: "short" }]
          : [
              { posSide: "long", label: "long" },
              { posSide: "short", label: "short" },
            ];

    for (const { posSide, label } of sides) {
      const body = JSON.stringify({
        instId,
        lever: String(leverage),
        mgnMode: marginType,
        posSide,
      });

      const headers = this.authHeaders("POST", path, body);

      console.log(
        `[OKX] 🔧 Setting leverage for ${instId} ${label}: ${leverage}x (${marginType})...`,
      );

      try {
        const response = await this.client.post(path, body, { headers });
        const data = response.data;

        if (data.code !== "0") {
          console.warn(
            `[OKX] ⚠️ Failed to set leverage for ${instId} ${label}: code=${data.code}, msg=${data.msg}`,
          );
        } else {
          console.log(
            `[OKX] ✅ Leverage set for ${instId} ${label}: ${leverage}x`,
          );
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.warn(
          `[OKX] ⚠️ Error setting leverage for ${instId} ${label}: ${errMsg}`,
        );
      }
    }
  }

  // ─── Orders ─────────────────────────────────────────────────────────

  /**
   * Place an order on OKX.
   *
   * Flow:
   *   1. Validate the instrument exists on OKX
   *   2. Set leverage for the position side
   *   3. Place the order
   *   4. Auto-retry with account fix if error 51010
   *
   * Docs: https://www.okx.com/docs-v5/en/#rest-api-trade-place-order
   */
  /**
   * Round a quantity to the nearest lot size.
   * OKX requires sz to be a multiple of lotSz and >= minSz.
   */
  private roundToLotSize(
    quantity: number,
    lotSz: string,
    minSz: string,
  ): number {
    const lot = parseFloat(lotSz);
    const min = parseFloat(minSz);
    if (lot <= 0) return quantity;

    // Round down to nearest lot size
    let rounded = Math.floor(quantity / lot) * lot;

    // Handle floating point precision (e.g. 0.01 * 1 = 0.010000000000000002)
    const decimals = lotSz.includes(".") ? lotSz.split(".")[1].length : 0;
    rounded = parseFloat(rounded.toFixed(decimals));

    // Enforce minimum size
    if (rounded < min) {
      console.warn(
        `[OKX] ⚠️ Rounded quantity ${rounded} is below minSz ${min}, using minSz`,
      );
      rounded = min;
    }

    return rounded;
  }

  async placeOrder(orderParams: OrderParams): Promise<OrderResult> {
    const instId = this.toOkxSymbol(orderParams.symbol);
    const isBuy = orderParams.side === "BUY";
    const posSide = isBuy ? "long" : "short";

    // Step 1: Validate instrument and get lot size info
    let instrumentInfo: Awaited<ReturnType<typeof this.validateInstrument>>;
    try {
      instrumentInfo = await this.validateInstrument(orderParams.symbol);
    } catch (validationError) {
      const errMsg =
        validationError instanceof Error
          ? validationError.message
          : String(validationError);
      console.error(`[OKX] ❌ Instrument validation failed: ${errMsg}`);
      throw validationError;
    }

    // Step 2: Convert quantity from base currency to contracts
    // OKX swap contracts use sz = number of contracts, not base currency amount
    // Each contract = ctVal base currency (e.g., 0.01 BTC for BTC-USDT-SWAP)
    const ctVal = parseFloat(instrumentInfo.ctVal || "1");
    const contracts = orderParams.quantity / ctVal;

    // Step 3: Round contracts to lot size
    const roundedQty = this.roundToLotSize(
      contracts,
      instrumentInfo.lotSz,
      instrumentInfo.minSz,
    );

    if (contracts !== roundedQty) {
      console.log(
        `[OKX] 🔢 Quantity: ${orderParams.quantity} base → ${contracts.toFixed(4)} contracts → ${roundedQty} contracts (ctVal=${ctVal}, lotSz=${instrumentInfo.lotSz}, minSz=${instrumentInfo.minSz})`,
      );
    }

    if (roundedQty <= 0) {
      throw new Error(
        `Order quantity too small: ${orderParams.quantity} base → ${contracts.toFixed(6)} contracts → ${roundedQty} after lot size rounding (ctVal=${ctVal}, lotSz=${instrumentInfo.lotSz}, minSz=${instrumentInfo.minSz})`,
      );
    }

    // Step 4: Set leverage (with posSide for long_short_mode)
    if (orderParams.leverage) {
      await this.setLeverage(
        orderParams.symbol,
        orderParams.leverage,
        "isolated",
        orderParams.side,
      );
    }

    // Step 5: Build and place order
    const orderBody: Record<string, string> = {
      instId,
      tdMode: "isolated",
      side: isBuy ? "buy" : "sell",
      ordType: orderParams.type === "LIMIT" ? "limit" : "market",
      sz: String(roundedQty),
      posSide,
    };

    if (orderParams.type === "LIMIT" && orderParams.price) {
      orderBody.px = String(orderParams.price);
    }

    const body = JSON.stringify(orderBody);
    const path = "/api/v5/trade/order";
    const headers = this.authHeaders("POST", path, body);

    console.log(
      `[OKX] 📤 Placing order: ${isBuy ? "BUY" : "SELL"} ${orderParams.quantity} ${instId} (posSide=${posSide})...`,
    );

    let response;
    try {
      response = await this.client.post(path, body, { headers });
    } catch (axiosError) {
      // Axios-level error (network, 4xx, 5xx)
      const errMsg =
        axiosError instanceof Error ? axiosError.message : String(axiosError);
      console.error(`[OKX] ❌ Order request failed: ${errMsg}`);

      if (axios.isAxiosError(axiosError) && axiosError.response?.data) {
        const errorData = axiosError.response.data;
        console.error(
          `[OKX] 📄 Response body:`,
          JSON.stringify(errorData, null, 2),
        );

        // Check for 51010 in axios error
        const sCode = errorData?.data?.[0]?.sCode;
        if (sCode === "51010" || errorData?.code === "51010") {
          return await this.handle51010AndRetry(orderBody, orderParams, path);
        }
      }
      throw axiosError;
    }

    const data = response.data;

    // Check for error 51010 in ANY response (can come with data.code "0" or "1")
    if (data.data?.[0]?.sCode === "51010") {
      console.warn(
        `[OKX] ⚠️ Detected error 51010 in order response — account mode incompatible`,
      );
      return await this.handle51010AndRetry(orderBody, orderParams, path);
    }

    if (data.code === "0" && data.data?.[0]) {
      const result = data.data[0];
      if (result.sCode === "0") {
        const price =
          orderParams.price || (await this.getTickerPrice(orderParams.symbol));
        console.log(
          `[OKX] ✅ Order placed: orderId=${result.ordId}, price=${price}`,
        );
        return {
          orderId: result.ordId,
          price,
          quantity: roundedQty,
          status: "submitted",
        };
      }

      console.error(
        `[OKX] ❌ Order rejected: sCode=${result.sCode}, sMsg=${result.sMsg}`,
      );
      throw new Error(`OKX order rejected: [${result.sCode}] ${result.sMsg}`);
    }

    // Even when top-level code !== "0", check data[0] for specific error
    const specificError = data.data?.[0];
    if (specificError?.sMsg) {
      console.error(
        `[OKX] ❌ Failed to place order: sCode=${specificError.sCode}, sMsg=${specificError.sMsg}`,
      );
      throw new Error(
        `OKX order failed: [${specificError.sCode}] ${specificError.sMsg}`,
      );
    }

    console.error(
      `[OKX] ❌ Failed to place order: code=${data.code}, msg=${data.msg}`,
    );
    throw new Error(
      `Failed to place OKX order: [${data.code}] ${data.msg || "Unknown error"}`,
    );
  }

  /**
   * Handle error 51010: auto-fix account configuration and retry the order.
   */
  private async handle51010AndRetry(
    orderBody: Record<string, string>,
    orderParams: OrderParams,
    path: string,
  ): Promise<OrderResult> {
    console.warn(
      `[OKX] ⚠️ Error 51010: Account mode incompatible. Auto-fixing account configuration...`,
    );
    await this.ensureAccountConfigured(orderParams.symbol);

    // Re-set leverage with posSide after account fix
    if (orderParams.leverage) {
      await this.setLeverage(
        orderParams.symbol,
        orderParams.leverage,
        "isolated",
        orderParams.side,
      );
    }

    // Retry the order
    console.log(`[OKX] 🔄 Retrying order after account fix...`);
    const retryBody = JSON.stringify(orderBody);
    const retryHeaders = this.authHeaders("POST", path, retryBody);

    try {
      const retryResponse = await this.client.post(path, retryBody, {
        headers: retryHeaders,
      });
      const retryData = retryResponse.data;

      if (
        retryData.code === "0" &&
        retryData.data?.[0] &&
        retryData.data[0].sCode === "0"
      ) {
        const retryResult = retryData.data[0];
        const price =
          orderParams.price || (await this.getTickerPrice(orderParams.symbol));
        console.log(
          `[OKX] ✅ Order succeeded after auto-fix: orderId=${retryResult.ordId}`,
        );
        return {
          orderId: retryResult.ordId,
          price,
          quantity: orderParams.quantity,
          status: "submitted",
        };
      }

      // Retry also failed — log full details
      console.error(
        `[OKX] ❌ Order still failed after auto-fix:`,
        JSON.stringify(retryData, null, 2),
      );
      const retryErrMsg =
        retryData.data?.[0]?.sMsg || retryData.msg || "Unknown error";
      const retryErrCode = retryData.data?.[0]?.sCode || retryData.code;
      throw new Error(
        `OKX order failed after auto-fix: [${retryErrCode}] ${retryErrMsg}`,
      );
    } catch (retryError) {
      if (axios.isAxiosError(retryError) && retryError.response?.data) {
        console.error(
          `[OKX] ❌ Retry request failed with status ${retryError.response.status}:`,
          JSON.stringify(retryError.response.data, null, 2),
        );
      }
      throw retryError;
    }
  }

  async closePosition(
    symbol: string,
    positionId?: string,
    quantity?: number,
  ): Promise<void> {
    const instId = this.toOkxSymbol(symbol);

    // First get the position to know the side and margin mode
    const positions = await this.getOpenPositions();
    const pos = positions.find(
      (p) => p.symbol === symbol || p.positionId === positionId,
    );

    if (!pos) {
      throw new Error(`No open position found for ${symbol}`);
    }

    const posSide = pos.side === "LONG" ? "long" : "short";
    const mgnMode = pos.marginType || "isolated";

    // Try close-position endpoint first
    const closeBody = JSON.stringify({
      instId,
      mgnMode,
      posSide,
      type: "market",
      sz: String(quantity || pos.quantity),
      side: pos.side === "LONG" ? "sell" : "buy",
      tdMode: mgnMode,
    });

    const closePath = "/api/v5/trade/close-position";
    const closeHeaders = this.authHeaders("POST", closePath, closeBody);

    console.log(
      `[OKX] 📤 Closing position: ${instId} ${posSide} (${mgnMode}) qty=${quantity || pos.quantity}...`,
    );

    try {
      const response = await this.client.post(closePath, closeBody, {
        headers: closeHeaders,
      });
      const data = response.data;

      if (data.code === "0" && data.data?.[0]?.sCode === "0") {
        console.log(`[OKX] ✅ Position closed: ${instId}`);
        return;
      }

      console.warn(
        `[OKX] ⚠️ close-position failed (${mgnMode}): code=${data.code}, msg=${data.msg}. Trying opposite order...`,
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[OKX] ⚠️ close-position request failed: ${errMsg}. Trying opposite order...`,
      );
    }

    // Fallback: place opposite order
    const fallbackBody = JSON.stringify({
      instId,
      tdMode: mgnMode,
      side: pos.side === "LONG" ? "sell" : "buy",
      posSide,
      ordType: "market",
      sz: String(quantity || pos.quantity),
      reduceOnly: "true",
    });

    const orderPath = "/api/v5/trade/order";
    const fallbackHeaders = this.authHeaders("POST", orderPath, fallbackBody);

    console.log(
      `[OKX] 📤 Placing opposite order to close: ${instId} (${mgnMode})...`,
    );

    const fallbackResp = await this.client.post(orderPath, fallbackBody, {
      headers: fallbackHeaders,
    });

    const fallbackData = fallbackResp.data;
    if (fallbackData.code !== "0" || fallbackData.data?.[0]?.sCode !== "0") {
      console.error(
        `[OKX] ❌ Failed to close position:`,
        JSON.stringify(fallbackData, null, 2),
      );
      throw new Error(
        `Failed to close OKX position: ${fallbackData.msg || fallbackData.data?.[0]?.sMsg || "Unknown error"}`,
      );
    }

    console.log(`[OKX] ✅ Position closed via opposite order: ${instId}`);
  }

  async closeAllPositions(): Promise<{ closed: string[]; errors: string[] }> {
    const closed: string[] = [];
    const errors: string[] = [];

    try {
      const positions = await this.getOpenPositions();

      for (const pos of positions) {
        try {
          await this.closePosition(pos.symbol, pos.positionId, pos.quantity);
          closed.push(pos.symbol);
        } catch (error) {
          errors.push(
            `${pos.symbol}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }
    } catch (error) {
      errors.push(
        `Failed to fetch positions: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    return { closed, errors };
  }

  // ─── Stop Loss / Take Profit ────────────────────────────────────────

  async placeStopLoss(
    symbol: string,
    triggerPrice: number,
    executePrice: number,
    side: "BUY" | "SELL",
    quantity: number,
  ): Promise<string> {
    const instId = this.toOkxSymbol(symbol);

    // `side` is the CLOSING direction passed from the executor:
    //   SELL → closing a LONG position → posSide="long", side="sell"
    //   BUY  → closing a SHORT position → posSide="short", side="buy"
    const posSide = side === "SELL" ? "long" : "short";
    const okxSide = side === "BUY" ? "buy" : "sell";

    const body = JSON.stringify({
      instId,
      tdMode: "isolated",
      side: okxSide,
      posSide,
      ordType: "conditional",
      sz: String(quantity),
      slTriggerPx: String(triggerPrice),
      slOrdPx: String(executePrice || triggerPrice),
    });

    const path = "/api/v5/trade/order-algo";
    const headers = this.authHeaders("POST", path, body);

    const response = await this.client.post(path, body, { headers });
    const data = response.data;

    if (data.code === "0" && data.data?.[0]?.algoId) {
      return data.data[0].algoId;
    }
    throw new Error(
      `Failed to place OKX stop loss: ${data.msg || data.data?.[0]?.sMsg || "Unknown error"}`,
    );
  }

  async placeTakeProfit(
    symbol: string,
    triggerPrice: number,
    executePrice: number,
    side: "BUY" | "SELL",
    quantity: number,
  ): Promise<string> {
    const instId = this.toOkxSymbol(symbol);

    // `side` is the CLOSING direction passed from the executor:
    //   SELL → closing a LONG position → posSide="long", side="sell"
    //   BUY  → closing a SHORT position → posSide="short", side="buy"
    const posSide = side === "SELL" ? "long" : "short";
    const okxSide = side === "BUY" ? "buy" : "sell";

    const body = JSON.stringify({
      instId,
      tdMode: "isolated",
      side: okxSide,
      posSide,
      ordType: "conditional",
      sz: String(quantity),
      tpTriggerPx: String(triggerPrice),
      tpOrdPx: String(executePrice || triggerPrice),
    });

    const path = "/api/v5/trade/order-algo";
    const headers = this.authHeaders("POST", path, body);

    const response = await this.client.post(path, body, { headers });
    const data = response.data;

    if (data.code === "0" && data.data?.[0]?.algoId) {
      return data.data[0].algoId;
    }
    throw new Error(
      `Failed to place OKX take profit: ${data.msg || data.data?.[0]?.sMsg || "Unknown error"}`,
    );
  }

  // ─── Order Management ───────────────────────────────────────────────

  async getOpenOrders(symbol?: string): Promise<OpenOrderInfo[]> {
    const instId = symbol ? this.toOkxSymbol(symbol) : undefined;
    const path = instId
      ? `/api/v5/trade/orders-pending?instType=SWAP&instId=${instId}`
      : `/api/v5/trade/orders-pending?instType=SWAP`;
    const headers = this.authHeaders("GET", path);

    const response = await this.client.get(path, { headers });
    const data = response.data;

    if (data.code === "0" && data.data) {
      return data.data.map(
        (o: {
          ordId: string;
          instId: string;
          side: string;
          ordType: string;
          px?: string;
          sz: string;
          accFillSz: string;
          state: string;
          cTime?: string;
          [key: string]: unknown;
        }) => ({
          orderId: o.ordId,
          symbol: this.fromOkxSymbol(o.instId),
          side: o.side === "buy" ? ("BUY" as const) : ("SELL" as const),
          type: o.ordType,
          price: o.px ? parseFloat(o.px) : undefined,
          quantity: parseFloat(o.sz),
          filledQuantity: parseFloat(o.accFillSz || "0"),
          status: o.state,
          createdAt: o.cTime ? parseInt(o.cTime) : undefined,
          raw: o,
        }),
      );
    }
    return [];
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    const instId = this.toOkxSymbol(symbol);
    const body = JSON.stringify([{ instId, ordId: orderId }]);
    const path = "/api/v5/trade/cancel-batch-orders";
    const headers = this.authHeaders("POST", path, body);

    console.log(`[OKX] 🗑️ Cancelling order ${orderId} for ${instId}...`);

    const response = await this.client.post(path, body, { headers });
    const data = response.data;

    if (data.code === "0" && data.data?.[0]?.sCode === "0") {
      console.log(`[OKX] ✅ Order cancelled: ${orderId}`);
      return true;
    }
    console.warn(
      `[OKX] ⚠️ Failed to cancel order: ${data.msg || data.data?.[0]?.sMsg}`,
    );
    return false;
  }

  async getAlgoOrders(symbol?: string): Promise<AlgoOrderInfo[]> {
    const instId = symbol ? this.toOkxSymbol(symbol) : undefined;
    // Get conditional orders (TP/SL)
    const path = instId
      ? `/api/v5/trade/orders-algo-pending?ordType=conditional&instType=SWAP&instId=${instId}`
      : `/api/v5/trade/orders-algo-pending?ordType=conditional&instType=SWAP`;
    const headers = this.authHeaders("GET", path);

    const response = await this.client.get(path, { headers });
    const data = response.data;

    if (data.code === "0" && data.data) {
      return data.data.map(
        (o: {
          algoId: string;
          instId: string;
          side: string;
          ordType: string;
          slTriggerPx?: string;
          slOrdPx?: string;
          tpTriggerPx?: string;
          tpOrdPx?: string;
          sz: string;
          state: string;
          cTime?: string;
          [key: string]: unknown;
        }) => ({
          orderId: o.algoId,
          symbol: this.fromOkxSymbol(o.instId),
          side: o.side === "buy" ? ("BUY" as const) : ("SELL" as const),
          type: o.tpTriggerPx ? "tp" : "sl",
          triggerPrice: parseFloat(o.tpTriggerPx || o.slTriggerPx || "0"),
          executePrice: parseFloat(o.tpOrdPx || o.slOrdPx || "0") || undefined,
          quantity: parseFloat(o.sz),
          status: o.state,
          createdAt: o.cTime ? parseInt(o.cTime) : undefined,
          raw: o,
        }),
      );
    }
    return [];
  }

  async cancelAlgoOrders(
    symbol: string,
  ): Promise<{ cancelled: string[]; errors: string[] }> {
    const instId = this.toOkxSymbol(symbol);
    const cancelled: string[] = [];
    const errors: string[] = [];

    // First get all algo orders for this symbol
    const algoOrders = await this.getAlgoOrders(symbol);

    if (algoOrders.length === 0) {
      return { cancelled, errors };
    }

    // Cancel them in batch
    const orderIds = algoOrders.map((o) => ({
      instId,
      algoId: o.orderId,
    }));

    const body = JSON.stringify(orderIds);
    const path = "/api/v5/trade/cancel-algos";
    const headers = this.authHeaders("POST", path, body);

    console.log(
      `[OKX] 🗑️ Cancelling ${algoOrders.length} algo orders for ${instId}...`,
    );

    try {
      const response = await this.client.post(path, body, { headers });
      const data = response.data;

      if (data.code === "0" && data.data) {
        for (const result of data.data) {
          if (result.sCode === "0") {
            cancelled.push(result.algoId);
          } else {
            errors.push(`${result.algoId}: ${result.sMsg}`);
          }
        }
      } else {
        errors.push(`Batch cancel failed: ${data.msg || "Unknown error"}`);
      }
    } catch (error) {
      errors.push(
        `Failed to cancel algo orders: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    return { cancelled, errors };
  }

  async getOrderHistory(
    symbol?: string,
    limit: number = 20,
  ): Promise<HistoricalOrder[]> {
    const instId = symbol ? this.toOkxSymbol(symbol) : undefined;
    const path = instId
      ? `/api/v5/trade/orders-history-archive?instType=SWAP&instId=${instId}&limit=${limit}`
      : `/api/v5/trade/orders-history-archive?instType=SWAP&limit=${limit}`;
    const headers = this.authHeaders("GET", path);

    const response = await this.client.get(path, { headers });
    const data = response.data;

    if (data.code === "0" && data.data) {
      return data.data.map(
        (o: {
          ordId: string;
          instId: string;
          side: string;
          ordType: string;
          px: string;
          sz: string;
          accFillSz: string;
          fee?: string;
          pnl?: string;
          state: string;
          cTime: string;
          uTime?: string;
          [key: string]: unknown;
        }) => ({
          orderId: o.ordId,
          symbol: this.fromOkxSymbol(o.instId),
          side: o.side === "buy" ? ("BUY" as const) : ("SELL" as const),
          type: o.ordType,
          price: parseFloat(o.px || "0"),
          quantity: parseFloat(o.sz),
          filledQuantity: parseFloat(o.accFillSz || "0"),
          fee: Math.abs(parseFloat(o.fee || "0")),
          realizedPnl: o.pnl ? parseFloat(o.pnl) : undefined,
          status: o.state,
          createdAt: parseInt(o.cTime),
          updatedAt: o.uTime ? parseInt(o.uTime) : undefined,
          raw: o,
        }),
      );
    }
    return [];
  }

  // ─── Instrument Specs ────────────────────────────────────────────────

  /**
   * Get instrument specifications (lot size, contract value, tick size, etc.).
   * Results are cached for 30 minutes to avoid repeated API calls.
   *
   * OKX API: GET /api/v5/public/instruments?instType=SWAP&instId=XXX
   * Docs: https://www.okx.com/docs-v5/en/#rest-api-public-data-get-instruments
   */
  async getInstrumentSpecs(symbol: string): Promise<InstrumentSpecs> {
    const instId = this.toOkxSymbol(symbol);

    // Check cache
    const cached = this.specsCache.get(instId);
    if (cached && Date.now() - cached.ts < OkxExchange.SPECS_CACHE_TTL) {
      return cached.specs;
    }

    // Fetch from API
    const path = `/api/v5/public/instruments?instType=SWAP&instId=${instId}`;
    const response = await this.client.get(path);
    const data = response.data;

    if (data.code !== "0" || !data.data?.[0]) {
      throw new Error(
        `Failed to get instrument specs for ${instId}: ${data.msg || "not found"}`,
      );
    }

    const inst = data.data[0];
    const lotSz = parseFloat(inst.lotSz || "1");
    const tickSz = parseFloat(inst.tickSz || "0.1");
    const ctVal = parseFloat(inst.ctVal || "1");

    // Derive decimal places from lotSz and tickSz
    const qtyDecimals = inst.lotSz?.includes(".")
      ? inst.lotSz.split(".")[1].replace(/0+$/, "").length
      : 0;
    const priceDecimals = inst.tickSz?.includes(".")
      ? inst.tickSz.split(".")[1].replace(/0+$/, "").length
      : 0;

    const specs: InstrumentSpecs = {
      ctVal,
      lotSz,
      minSz: parseFloat(inst.minSz || "1"),
      ctValCcy: inst.ctValCcy || "",
      tickSz,
      qtyDecimals,
      priceDecimals,
    };

    // Cache it
    this.specsCache.set(instId, { specs, ts: Date.now() });

    console.log(
      `[OKX] 📋 Instrument specs: ${instId} ctVal=${ctVal} lotSz=${lotSz} minSz=${inst.minSz} tickSz=${tickSz} qtyDecimals=${qtyDecimals}`,
    );

    return specs;
  }
}
