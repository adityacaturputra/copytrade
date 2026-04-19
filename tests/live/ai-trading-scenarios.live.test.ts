import mongoose from "mongoose";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AIFactory, type AIProvider } from "../../shared/src/lib/ai/AIFactory";
import { connectDB, disconnectDB } from "../../shared/src/lib/database";
import type { BulkSignalResult } from "../../shared/src/lib/ai/types";
import {
  canRunLiveDbTest,
  isLiveIntegrationEnabled,
  resolveLiveAiProvider,
} from "../helpers/live";

const liveAiProvider = resolveLiveAiProvider();

describe.skipIf(!isLiveIntegrationEnabled() || !liveAiProvider)(
  "live AI trading scenarios",
  () => {
    beforeEach(() => {
      AIFactory.reset();
    });

    afterAll(() => {
      AIFactory.reset();
    });

    it("parses a market entry signal", async () => {
      const analyzer = AIFactory.getAnalyzer(liveAiProvider as AIProvider);
      const signal = await analyzer.parseSignal(`
        BTCUSDT
        Buy market now
        SL 61200
        TP 62800 / 63500
        leverage 10x
      `);

      expect(signal).toBeTruthy();
      expect(signal?.action).toBe("BUY");
      expect(signal?.symbol).toContain("BTC");
      expect(signal?.orderType).toBe("market");
    }, 120000);

    it("parses a limit entry signal", async () => {
      const analyzer = AIFactory.getAnalyzer(liveAiProvider as AIProvider);
      const signal = await analyzer.parseSignal(`
        ETHUSDT short limit 3150
        stop loss 3210
        take profit 3080 3020
        8x
      `);

      expect(signal).toBeTruthy();
      expect(signal?.action).toBe("SELL");
      expect(signal?.symbol).toContain("ETH");
      expect(signal?.orderType).toBe("limit");
      expect(signal?.entryPrice).toBeTruthy();
    }, 120000);

    it("parses management messages for SL, TP, and close flows", async () => {
      const analyzer = AIFactory.getAnalyzer(liveAiProvider as AIProvider);
      const [moveSl, moveTp, close] = await Promise.all([
        analyzer.parseSignal("Move stop loss BTCUSDT long to 61850"),
        analyzer.parseSignal("Update TP BTCUSDT to 64200"),
        analyzer.parseSignal("Close BTCUSDT position now"),
      ]);

      expect(["UPDATE_SL", "SL"]).toContain(moveSl?.action);
      expect(["UPDATE_TP", "TP", "ADD_TP"]).toContain(moveTp?.action);
      expect(close?.action).toBe("CLOSE");
    }, 120000);

    it("covers bulk trade actions and message types from live AI parsing", async () => {
      const analyzer = AIFactory.getAnalyzer(liveAiProvider as AIProvider);
      const results = await analyzer.parseBulkSignals([
        {
          messageId: "buy",
          content:
            "BTCUSDT buy market now. stop loss 61200. take profit 62800 63500. leverage 10x.",
        },
        {
          messageId: "sell",
          content:
            "ETHUSDT short limit 3150. stop loss 3210. take profit 3080 3020. leverage 8x.",
        },
        {
          messageId: "close",
          content: "Close BTCUSDT position now.",
        },
        {
          messageId: "cancel",
          content: "Cancel pending BTCUSDT order, setup invalid.",
        },
        {
          messageId: "tp",
          content: "Take profit on BTCUSDT at 62800 now.",
        },
        {
          messageId: "sl",
          content: "Stop loss BTCUSDT at 61000, exit if touched.",
        },
        {
          messageId: "update-sl",
          content: "Move stop loss BTCUSDT long to 61850.",
        },
        {
          messageId: "update-tp",
          content: "Update TP BTCUSDT to 64200.",
        },
        {
          messageId: "add-tp",
          content: "Add TP2 for BTCUSDT at 65000.",
        },
        {
          messageId: "hold",
          content: "BTCUSDT already hit all TPs, nice trade.",
        },
        {
          messageId: "ignore",
          content: "gm guys, no trade today just chatting.",
        },
      ]);

      const byId = new Map(results.map((result) => [result.messageId, result]));
      const expectSignal = (messageId: string): NonNullable<BulkSignalResult["signal"]> => {
        const signal = byId.get(messageId)?.signal;
        expect(signal).toBeTruthy();
        return signal!;
      };

      expect(expectSignal("buy").action).toBe("BUY");
      expect(expectSignal("buy").messageType).toBe("new_entry");

      expect(expectSignal("sell").action).toBe("SELL");
      expect(expectSignal("sell").messageType).toBe("new_entry");

      expect(expectSignal("close").action).toBe("CLOSE");
      expect(expectSignal("close").messageType).toBe("close_cancel");

      expect(expectSignal("cancel").action).toBe("CANCEL");
      expect(expectSignal("cancel").messageType).toBe("close_cancel");

      expect(["TP", "UPDATE_TP", "ADD_TP"]).toContain(expectSignal("tp").action);
      expect(expectSignal("tp").messageType).toBe("position_update");

      expect(["SL", "UPDATE_SL", "CLOSE"]).toContain(expectSignal("sl").action);
      expect(expectSignal("sl").messageType).toMatch(/position_update|close_cancel/);

      expect(["UPDATE_SL", "SL"]).toContain(expectSignal("update-sl").action);
      expect(expectSignal("update-sl").messageType).toBe("position_update");

      expect(["UPDATE_TP", "TP"]).toContain(expectSignal("update-tp").action);
      expect(expectSignal("update-tp").messageType).toBe("position_update");

      expect(["ADD_TP", "UPDATE_TP", "TP"]).toContain(expectSignal("add-tp").action);
      expect(expectSignal("add-tp").messageType).toBe("position_update");

      expect(byId.get("hold")?.signal ?? null).toBeNull();
      expect(byId.get("ignore")?.signal ?? null).toBeNull();
    }, 120000);

    it("covers live position decisions from AI analysis", async () => {
      const analyzer = AIFactory.getAnalyzer(liveAiProvider as AIProvider);
      const currentTime = new Date().toISOString();

      const [close, hold, moveSl, partialClose, updateTp] = await Promise.all([
        analyzer.analyzePosition({
          symbol: "BTCUSDT",
          side: "LONG",
          entryPrice: 62000,
          currentPrice: 60750,
          takeProfitTargets: [64000, 65000],
          stopLoss: 60800,
          pnl: -8,
          quantity: 0.01,
          currentTime,
          discordContextMessages: [
            {
              messageId: "c1",
              author: "Trader",
              content: "Close BTCUSDT immediately, setup invalid.",
            },
          ],
        }),
        analyzer.analyzePosition({
          symbol: "BTCUSDT",
          side: "LONG",
          entryPrice: 62000,
          currentPrice: 62500,
          takeProfitTargets: [64000, 65000],
          stopLoss: 61000,
          pnl: 3,
          quantity: 0.01,
          currentTime,
          discordContextMessages: [
            {
              messageId: "h1",
              author: "Trader",
              content: "Hold the runner, trend still strong.",
            },
          ],
        }),
        analyzer.analyzePosition({
          symbol: "BTCUSDT",
          side: "LONG",
          entryPrice: 62000,
          currentPrice: 69000,
          takeProfitTargets: [70500],
          stopLoss: 61000,
          pnl: 18,
          quantity: 0.01,
          currentTime,
          discordContextMessages: [
            {
              messageId: "m1",
              author: "Trader",
              content: "Move stop loss to breakeven and lock profit.",
            },
          ],
        }),
        analyzer.analyzePosition({
          symbol: "BTCUSDT",
          side: "LONG",
          entryPrice: 62000,
          currentPrice: 69950,
          takeProfitTargets: [70000],
          stopLoss: 61000,
          pnl: 12,
          quantity: 0.01,
          currentTime,
          discordContextMessages: [
            {
              messageId: "p1",
              author: "Trader",
              content: "Take partial profits here, close half and keep a runner.",
            },
          ],
        }),
        analyzer.analyzePosition({
          symbol: "BTCUSDT",
          side: "LONG",
          entryPrice: 62000,
          currentPrice: 66000,
          takeProfitTargets: [67000],
          stopLoss: 62000,
          pnl: 8,
          quantity: 0.01,
          currentTime,
          discordContextMessages: [
            {
              messageId: "u1",
              author: "Trader",
              content: "New TP for BTCUSDT is 69000.",
            },
          ],
        }),
      ]);

      expect(close.decision).toBe("CLOSE");
      expect(hold.decision).toBe("HOLD");
      expect(moveSl.decision).toBe("MOVE_SL");
      expect(partialClose.decision).toBe("PARTIAL_CLOSE");
      expect(updateTp.decision).toBe("UPDATE_TP");
    }, 120000);
  },
);

describe.skipIf(!canRunLiveDbTest())("live DB smoke", () => {
  afterAll(async () => {
    await disconnectDB();
  });

  it("connects to the configured development MongoDB URI", async () => {
    await connectDB();
    expect(mongoose.connection.readyState).toBe(1);

    const ping = await mongoose.connection.db?.admin().ping();
    expect(ping?.ok).toBe(1);
  }, 120000);
});
