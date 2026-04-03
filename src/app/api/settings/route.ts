import { NextRequest, NextResponse } from "next/server";
import { connectDB, getTradingMode, setTradingMode } from "@/lib/database";
import { getRiskConfig, setRiskConfig } from "@/lib/risk";
import {
  getSignalConfig,
  setSignalConfig,
  SignalConfigType,
} from "@/lib/signal-config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await connectDB();
    const mode = await getTradingMode();
    const riskConfig = await getRiskConfig();
    const signalCfg = await getSignalConfig();
    return NextResponse.json({
      success: true,
      mode,
      risk: riskConfig,
      signal: signalCfg,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json();

    // Handle trading mode update
    if (body.mode) {
      if (!["auto", "manual"].includes(body.mode)) {
        return NextResponse.json(
          { success: false, error: "Mode must be 'auto' or 'manual'" },
          { status: 400 },
        );
      }
      await setTradingMode(body.mode as "auto" | "manual");
    }

    // Handle risk settings update
    if (body.risk) {
      const {
        riskPerTradePercent,
        maxPositionPercent,
        maxLeverage,
        minLeverage,
        skipNoSL,
      } = body.risk;

      // Validation
      if (
        riskPerTradePercent !== undefined &&
        (riskPerTradePercent < 0.1 || riskPerTradePercent > 100)
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "Risk per trade must be between 0.1% and 100%",
          },
          { status: 400 },
        );
      }
      if (
        maxPositionPercent !== undefined &&
        (maxPositionPercent < 1 || maxPositionPercent > 100)
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "Max position percent must be between 1% and 100%",
          },
          { status: 400 },
        );
      }
      if (maxLeverage !== undefined && (maxLeverage < 1 || maxLeverage > 125)) {
        return NextResponse.json(
          { success: false, error: "Max leverage must be between 1 and 125" },
          { status: 400 },
        );
      }
      if (minLeverage !== undefined && (minLeverage < 1 || minLeverage > 125)) {
        return NextResponse.json(
          { success: false, error: "Min leverage must be between 1 and 125" },
          { status: 400 },
        );
      }

      const { defaultRR, defaultPositionSize, defaultLeverage, maxPositions } =
        body.risk;
      if (defaultRR !== undefined && (defaultRR < 1 || defaultRR > 20)) {
        return NextResponse.json(
          { success: false, error: "Default RR must be between 1 and 20" },
          { status: 400 },
        );
      }
      if (
        defaultPositionSize !== undefined &&
        (defaultPositionSize < 1 || defaultPositionSize > 1000000)
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "Default position size must be between 1 and 1,000,000",
          },
          { status: 400 },
        );
      }
      if (
        defaultLeverage !== undefined &&
        (defaultLeverage < 1 || defaultLeverage > 125)
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "Default leverage must be between 1 and 125",
          },
          { status: 400 },
        );
      }
      if (
        maxPositions !== undefined &&
        (maxPositions < 0 || maxPositions > 100)
      ) {
        return NextResponse.json(
          { success: false, error: "Max positions must be between 0 and 100" },
          { status: 400 },
        );
      }

      await setRiskConfig({
        ...(riskPerTradePercent !== undefined && { riskPerTradePercent }),
        ...(maxPositionPercent !== undefined && { maxPositionPercent }),
        ...(maxLeverage !== undefined && { maxLeverage }),
        ...(minLeverage !== undefined && { minLeverage }),
        ...(skipNoSL !== undefined && { skipNoSL }),
        ...(defaultRR !== undefined && { defaultRR }),
        ...(defaultPositionSize !== undefined && { defaultPositionSize }),
        ...(defaultLeverage !== undefined && { defaultLeverage }),
        ...(maxPositions !== undefined && { maxPositions }),
      });
    }

    // Handle signal config update
    if (body.signal) {
      const { fetchLimit, timeWindowHours, batchSize } = body.signal;

      if (fetchLimit !== undefined && (fetchLimit < 1 || fetchLimit > 100)) {
        return NextResponse.json(
          {
            success: false,
            error: "Fetch limit must be between 1 and 100",
          },
          { status: 400 },
        );
      }
      if (
        timeWindowHours !== undefined &&
        (timeWindowHours < 1 || timeWindowHours > 720)
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "Time window must be between 1 and 720 hours",
          },
          { status: 400 },
        );
      }
      if (batchSize !== undefined && (batchSize < 1 || batchSize > 20)) {
        return NextResponse.json(
          {
            success: false,
            error: "Batch size must be between 1 and 20",
          },
          { status: 400 },
        );
      }

      const includeImageUrls = body.signal.includeImageUrls;
      await setSignalConfig({
        ...(fetchLimit !== undefined && { fetchLimit }),
        ...(timeWindowHours !== undefined && { timeWindowHours }),
        ...(batchSize !== undefined && { batchSize }),
        ...(includeImageUrls !== undefined && { includeImageUrls }),
      });
    }

    const mode = await getTradingMode();
    const riskConfig = await getRiskConfig();
    const signalCfg = await getSignalConfig();
    return NextResponse.json({
      success: true,
      mode,
      risk: riskConfig,
      signal: signalCfg,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
