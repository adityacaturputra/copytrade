/**
 * PaperExchange — Simulated exchange for testing without real API keys.
 *
 * All trades are virtual. Market prices are simulated with slight randomness.
 * Positions are stored in-memory (lost on server restart).
 *
 * Usage: Set EXCHANGE_PROVIDER=paper in .env
 */

import {
  ExchangeClient,
  OrderParams,
  OrderResult,
  PositionInfo,
  AccountInfo,
  KlineData,
  OpenOrderInfo,
  AlgoOrderInfo,
  HistoricalOrder,
} from "./types";

interface SimPosition {
  symbol: string;
  positionId: string;
  side: "LONG" | "SHORT";
  leverage: number;
  marginType: "isolated" | "cross";
  entryPrice: number;
  quantity: number;
  margin: number;
  liquidationPrice: number;
  createdAt: Date;
}

export class PaperExchange implements ExchangeClient {
  readonly name = "paper";

  private balance = 10000; // Starting virtual balance: $10,000
  private positions = new Map<string, SimPosition>();
  private nextPositionId = 1;

  // Simulated prices for common pairs
  private simulatedPrices: Record<string, number> = {
    BTCUSDT: 67500,
    ETHUSDT: 3450,
    SOLUSDT: 178,
    BNBUSDT: 605,
    XRPUSDT: 0.62,
    DOGEUSDT: 0.165,
    ADAUSDT: 0.45,
    AVAXUSDT: 38.5,
    DOTUSDT: 7.2,
    LINKUSDT: 14.5,
    MATICUSDT: 0.72,
    SHIBUSDT: 0.000026,
    ATOMUSDT: 9.8,
    UNIUSDT: 7.5,
    NEARUSDT: 7.2,
  };

  // ─── Account ──────────────────────────────────────────────

  async getAccountInfo(): Promise<AccountInfo> {
    let unrealizedPnl = 0;
    for (const pos of this.positions.values()) {
      const currentPrice = await this.getTickerPrice(pos.symbol);
      const pnl =
        pos.side === "LONG"
          ? (currentPrice - pos.entryPrice) * pos.quantity
          : (pos.entryPrice - currentPrice) * pos.quantity;
      unrealizedPnl += pnl;
    }

    return {
      totalBalance: this.balance + unrealizedPnl,
      availableBalance: this.balance,
      unrealizedPnl,
      currency: "USDT",
    };
  }

  // ─── Market Data ──────────────────────────────────────────

  async getTickerPrice(symbol: string): Promise<number> {
    const basePrice = this.simulatedPrices[symbol] || 100;
    // Add ±0.5% random variation each call
    const variation = 1 + (Math.random() - 0.5) * 0.01;
    return parseFloat((basePrice * variation).toFixed(8));
  }

  async getKlines(
    symbol: string,
    interval: string = "1h",
    limit: number = 30,
  ): Promise<KlineData[]> {
    const basePrice = this.simulatedPrices[symbol] || 100;
    const klines: KlineData[] = [];
    const now = Date.now();
    const intervalMs = this.parseInterval(interval);

    for (let i = limit - 1; i >= 0; i--) {
      const time = now - i * intervalMs;
      const open = basePrice * (1 + (Math.random() - 0.5) * 0.02);
      const close = open * (1 + (Math.random() - 0.5) * 0.01);
      const high = Math.max(open, close) * (1 + Math.random() * 0.005);
      const low = Math.min(open, close) * (1 - Math.random() * 0.005);
      const volume = Math.random() * 1000000;

      klines.push({ open, close, high, low, volume, time });
    }

    return klines;
  }

  // ─── Positions ────────────────────────────────────────────

  async getOpenPositions(): Promise<PositionInfo[]> {
    const result: PositionInfo[] = [];

    for (const [id, pos] of this.positions) {
      const markPrice = await this.getTickerPrice(pos.symbol);
      const unrealizedPnl =
        pos.side === "LONG"
          ? (markPrice - pos.entryPrice) * pos.quantity * pos.leverage
          : (pos.entryPrice - markPrice) * pos.quantity * pos.leverage;

      result.push({
        symbol: pos.symbol,
        positionId: id,
        side: pos.side,
        leverage: pos.leverage,
        marginType: pos.marginType,
        entryPrice: pos.entryPrice,
        quantity: pos.quantity,
        margin: pos.margin,
        unrealizedPnl: parseFloat(unrealizedPnl.toFixed(2)),
        liquidationPrice: pos.liquidationPrice,
        markPrice,
        raw: pos,
      });
    }

    return result;
  }

  // ─── Orders ───────────────────────────────────────────────

  async placeOrder(params: OrderParams): Promise<OrderResult> {
    const price = params.price || (await this.getTickerPrice(params.symbol));
    const leverage = params.leverage || 1;
    const cost = params.quantity * price;

    // Check if we have enough balance for margin
    const margin = cost / leverage;
    if (params.side === "BUY" && margin > this.balance) {
      throw new Error(
        `Insufficient paper balance: $${this.balance.toFixed(2)} < $${margin.toFixed(2)} margin needed`,
      );
    }

    const positionId = String(this.nextPositionId++);

    if (params.side === "BUY") {
      // Deduct margin from balance
      this.balance -= margin;

      const liquidationPrice =
        leverage > 1 ? price * (1 - 1 / leverage + 0.005) : 0;

      this.positions.set(positionId, {
        symbol: params.symbol,
        positionId,
        side: "LONG",
        leverage,
        marginType: "cross",
        entryPrice: price,
        quantity: params.quantity,
        margin,
        liquidationPrice,
        createdAt: new Date(),
      });

      console.log(
        `📊 [PAPER] OPENED LONG ${params.symbol}: ${params.quantity} @ $${price.toFixed(2)} (${leverage}x) margin=$${margin.toFixed(2)}`,
      );
    } else {
      // SELL - for simplicity, close any open LONG position or open SHORT
      this.balance -= margin;

      const liquidationPrice =
        leverage > 1 ? price * (1 + 1 / leverage - 0.005) : Infinity;

      this.positions.set(positionId, {
        symbol: params.symbol,
        positionId,
        side: "SHORT",
        leverage,
        marginType: "cross",
        entryPrice: price,
        quantity: params.quantity,
        margin,
        liquidationPrice,
        createdAt: new Date(),
      });

      console.log(
        `📊 [PAPER] OPENED SHORT ${params.symbol}: ${params.quantity} @ $${price.toFixed(2)} (${leverage}x) margin=$${margin.toFixed(2)}`,
      );
    }

    return {
      orderId: `paper_${positionId}_${Date.now()}`,
      price,
      quantity: params.quantity,
      status: "FILLED",
    };
  }

  async closePosition(
    symbol: string,
    positionId?: string,
    quantity?: number,
  ): Promise<void> {
    const pos = this.findPosition(symbol, positionId);
    if (!pos) {
      throw new Error(`No paper position found for ${symbol}`);
    }

    const closePrice = await this.getTickerPrice(symbol);
    const pnl =
      pos.side === "LONG"
        ? (closePrice - pos.entryPrice) * pos.quantity * pos.leverage
        : (pos.entryPrice - closePrice) * pos.quantity * pos.leverage;

    // Return margin + pnl
    this.balance += pos.margin + pnl;
    this.positions.delete(pos.positionId);

    console.log(
      `📊 [PAPER] CLOSED ${pos.side} ${symbol} @ $${closePrice.toFixed(2)} | PnL: $${pnl.toFixed(2)} | Balance: $${this.balance.toFixed(2)}`,
    );
  }

  async closeAllPositions(): Promise<{ closed: string[]; errors: string[] }> {
    const closed: string[] = [];
    const errors: string[] = [];

    for (const [id, pos] of [...this.positions]) {
      try {
        await this.closePosition(pos.symbol, id);
        closed.push(`${pos.symbol} (${pos.side})`);
      } catch (err) {
        errors.push(
          `${pos.symbol}: ${err instanceof Error ? err.message : "Unknown"}`,
        );
      }
    }

    return { closed, errors };
  }

  // ─── Leverage ─────────────────────────────────────────────

  async setLeverage(
    symbol: string,
    leverage: number,
    _marginType?: "isolated" | "cross",
    _side?: "BUY" | "SELL",
  ): Promise<void> {
    console.log(`📊 [PAPER] Set leverage for ${symbol}: ${leverage}x`);
    // Update existing position if any
    for (const pos of this.positions.values()) {
      if (pos.symbol === symbol) {
        pos.leverage = leverage;
      }
    }
  }

  // ─── Stop Loss / Take Profit ──────────────────────────────

  async placeStopLoss(
    symbol: string,
    triggerPrice: number,
    _executePrice: number,
    _side: "BUY" | "SELL",
    _quantity: number,
  ): Promise<string> {
    console.log(
      `📊 [PAPER] SL set for ${symbol} @ $${triggerPrice.toFixed(2)}`,
    );
    return `paper_sl_${Date.now()}`;
  }

  async placeTakeProfit(
    symbol: string,
    triggerPrice: number,
    _executePrice: number,
    _side: "BUY" | "SELL",
    _quantity: number,
  ): Promise<string> {
    console.log(
      `📊 [PAPER] TP set for ${symbol} @ $${triggerPrice.toFixed(2)}`,
    );
    return `paper_tp_${Date.now()}`;
  }

  // ─── Order Management ──────────────────────────────────────

  private openOrders: OpenOrderInfo[] = [];
  private algoOrders: AlgoOrderInfo[] = [];
  private orderHistory: HistoricalOrder[] = [];

  async getOpenOrders(symbol?: string): Promise<OpenOrderInfo[]> {
    if (symbol) {
      return this.openOrders.filter((o) => o.symbol === symbol);
    }
    return this.openOrders;
  }

  async cancelOrder(orderId: string, _symbol: string): Promise<boolean> {
    const idx = this.openOrders.findIndex((o) => o.orderId === orderId);
    if (idx >= 0) {
      this.openOrders.splice(idx, 1);
      console.log(`📊 [PAPER] Cancelled order ${orderId}`);
      return true;
    }
    return false;
  }

  async getAlgoOrders(symbol?: string): Promise<AlgoOrderInfo[]> {
    if (symbol) {
      return this.algoOrders.filter((o) => o.symbol === symbol);
    }
    return this.algoOrders;
  }

  async cancelAlgoOrders(
    symbol: string,
  ): Promise<{ cancelled: string[]; errors: string[] }> {
    const toCancel = this.algoOrders.filter((o) => o.symbol === symbol);
    const cancelled = toCancel.map((o) => o.orderId);
    this.algoOrders = this.algoOrders.filter((o) => o.symbol !== symbol);
    console.log(
      `📊 [PAPER] Cancelled ${cancelled.length} algo orders for ${symbol}`,
    );
    return { cancelled, errors: [] };
  }

  async getOrderHistory(
    symbol?: string,
    _limit?: number,
  ): Promise<HistoricalOrder[]> {
    if (symbol) {
      return this.orderHistory.filter((o) => o.symbol === symbol);
    }
    return this.orderHistory;
  }

  // ─── Helpers ──────────────────────────────────────────────

  private findPosition(
    symbol: string,
    positionId?: string,
  ): SimPosition | undefined {
    if (positionId) {
      return this.positions.get(positionId);
    }
    // Find first position matching symbol
    for (const pos of this.positions.values()) {
      if (pos.symbol === symbol) return pos;
    }
    return undefined;
  }

  private parseInterval(interval: string): number {
    const map: Record<string, number> = {
      "1m": 60_000,
      "5m": 300_000,
      "15m": 900_000,
      "1h": 3_600_000,
      "4h": 14_400_000,
      "1d": 86_400_000,
    };
    return map[interval] || 3_600_000;
  }

  async getInstrumentSpecs(
    symbol: string,
  ): Promise<import("./types").InstrumentSpecs> {
    // Paper trading stub — uses simplified defaults
    return {
      ctVal: 1,
      lotSz: 1,
      minSz: 1,
      ctValCcy: "",
      tickSz: 0.01,
      qtyDecimals: 2,
      priceDecimals: 2,
    };
  }
}
