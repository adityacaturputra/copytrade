import type { PositionInfo } from "../../types";
import { BybitCtx } from "./types";

export async function fetchBybitPositions(ctx: BybitCtx, symbol?: string): Promise<any[]> {
  const rows: any[] = [];
  let cursor: string | undefined;
  do {
    const result = await ctx.signedRequest<any>("GET", "/v5/position/list", { category: "linear", symbol: symbol ? ctx.toSymbol(symbol) : undefined, settleCoin: symbol ? undefined : "USDT", cursor, limit: 50 });
    if (result?.list) rows.push(...result.list);
    cursor = result?.nextPageCursor;
  } while (cursor);
  return rows;
}

export async function mapBybitOpenPositions(ctx: BybitCtx, rows: any[]): Promise<PositionInfo[]> {
  const result: PositionInfo[] = [];
  for (const row of rows) {
    const quantity = ctx.parseNumber(row.size);
    if (quantity <= 0 || !row.symbol || !row.side) continue;
    result.push({
      symbol: ctx.toSymbol(row.symbol),
      positionId: `${row.symbol}:${row.positionIdx ?? row.side}`,
      side: row.side === "Sell" ? "SHORT" : "LONG",
      leverage: ctx.parseNumber(row.leverage),
      marginType: await ctx.resolvePositionMarginType(row),
      entryPrice: ctx.parseNumber(row.avgPrice),
      quantity,
      margin: ctx.parseNumber(row.positionIM ?? row.positionBalance),
      unrealizedPnl: ctx.parseNumber(row.unrealisedPnl),
      liquidationPrice: ctx.parseNumber(row.liqPrice),
      markPrice: ctx.parseNumber(row.markPrice),
      raw: row,
    });
  }
  return result;
}

export async function closeBybitPosition(ctx: BybitCtx, symbol: string, positionId?: string, quantity?: number): Promise<void> {
  const normalized = ctx.toSymbol(symbol);
  const specs = await ctx.getInstrumentSpecs(normalized);
  const positions = (await ctx.fetchPositions(normalized)).filter(row => row.symbol === normalized && (row.side === "Buy" || row.side === "Sell") && ctx.parseNumber(row.size) > 0);
  const filtered = positionId ? positions.filter(row => `${row.symbol}:${row.positionIdx ?? 0}` === positionId) : positions;
  if (filtered.length === 0) throw new Error(`No open Bybit position found for ${normalized}`);
  let remaining = quantity && quantity > 0 ? quantity : null;
  for (const row of filtered) {
    const currentQty = ctx.parseNumber(row.size);
    const requestedQty = remaining === null ? currentQty : Math.min(currentQty, remaining);
    const closeQty = ctx.clampToStep(requestedQty, specs.lotSz, specs.qtyDecimals);
    if (closeQty <= 0) continue;
    await ctx.signedRequest("POST", "/v5/order/create", { category: "linear", symbol: normalized, side: row.side === "Buy" ? "Sell" : "Buy", orderType: "Market", qty: ctx.formatNum(closeQty, specs.qtyDecimals), reduceOnly: true, closeOnTrigger: true, positionIdx: row.positionIdx ?? 0 });
    if (remaining !== null) { remaining = Math.max(0, remaining - closeQty); if (remaining <= 0) break; }
  }
}

export async function closeBybitAllPositions(ctx: BybitCtx): Promise<{ closed: string[]; errors: string[] }> {
  const closed: string[] = [];
  const errors: string[] = [];
  try {
    const positions = await ctx.getOpenPositions();
    for (const p of positions) {
      try { await closeBybitPosition(ctx, p.symbol, p.positionId, p.quantity); closed.push(`${p.symbol} (${p.side})`); }
      catch (e: any) { errors.push(`${p.symbol}: ${e.message}`); }
    }
  } catch (e: any) { errors.push(`Failed to fetch positions: ${e.message}`); }
  return { closed, errors };
}

export async function placeBybitConditionalCloseOrder(ctx: BybitCtx, type: "tp" | "sl", symbol: string, triggerPrice: number, side: "BUY" | "SELL", quantity: number): Promise<string> {
  const normalized = ctx.toSymbol(symbol);
  const specs = await ctx.getInstrumentSpecs(normalized);
  const positions = (await ctx.fetchPositions(normalized)).filter(row => row.symbol === normalized && (row.side === "Buy" || row.side === "Sell") && ctx.parseNumber(row.size) > 0);
  const position = positions.find(p => (side === "BUY" ? "Sell" : "Buy") === p.side);
  if (!position) throw new Error(`No matching ${side === "BUY" ? "SHORT" : "LONG"} position for ${type.toUpperCase()} order on ${normalized}`);
  const maxQuantity = ctx.parseNumber(position.size);
  const requestedQty = Math.min(quantity, maxQuantity);
  const qty = ctx.clampToStep(requestedQty, specs.lotSz, specs.qtyDecimals);
  if (qty < specs.minSz) {
    throw new Error(`Conditional ${type.toUpperCase()} quantity too small for ${normalized}: ${qty} < ${specs.minSz}`);
  }
  const price = ctx.clampToStep(triggerPrice, specs.tickSz, specs.priceDecimals);
  const currentPrice =
    ctx.parseNumber(position.markPrice) ||
    (await ctx.getTickerPrice(normalized));
  const payload: any = {
    category: "linear",
    symbol: normalized,
    side: side === "BUY" ? "Buy" : "Sell",
    orderType: "Market",
    qty: ctx.formatNum(qty, specs.qtyDecimals),
    triggerPrice: ctx.formatNum(price, specs.priceDecimals),
    triggerDirection: price >= currentPrice ? 1 : 2,
    triggerBy: "MarkPrice",
    reduceOnly: true,
    closeOnTrigger: true,
    positionIdx: position.positionIdx ?? 0,
    orderLinkId: `ct_${type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  };
  const result = await ctx.signedRequest<any>("POST", "/v5/order/create", payload);
  return result.orderId || result.orderLinkId || payload.orderLinkId;
}

export async function setBybitPositionStopLoss(
  ctx: BybitCtx,
  symbol: string,
  triggerPrice: number,
  side: "BUY" | "SELL",
): Promise<string> {
  const normalized = ctx.toSymbol(symbol);
  const specs = await ctx.getInstrumentSpecs(normalized);
  const positions = (await ctx.fetchPositions(normalized)).filter(
    (row) =>
      row.symbol === normalized &&
      (row.side === "Buy" || row.side === "Sell") &&
      ctx.parseNumber(row.size) > 0,
  );
  const position = positions.find(
    (row) => (side === "BUY" ? "Sell" : "Buy") === row.side,
  );
  if (!position) {
    throw new Error(
      `No matching ${side === "BUY" ? "SHORT" : "LONG"} position for SL on ${normalized}`,
    );
  }

  const price = ctx.clampToStep(
    triggerPrice,
    specs.tickSz,
    specs.priceDecimals,
  );
  const positionIdx = position.positionIdx ?? 0;

  await ctx.signedRequest("POST", "/v5/position/trading-stop", {
    category: "linear",
    symbol: normalized,
    stopLoss: ctx.formatNum(price, specs.priceDecimals),
    slTriggerBy: "MarkPrice",
    positionIdx,
  });

  return `position-sl:${normalized}:${positionIdx}`;
}
