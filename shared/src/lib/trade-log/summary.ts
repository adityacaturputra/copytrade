import { listTradeLogs } from "./store";
import type { TradeLogListOptions } from "./types";

export async function totalTradeLogs() {
  const result = await listTradeLogs({
    page: 1,
    limit: 1,
    hideCronNoise: false,
  });
  return result.totalCount;
}

export async function recentTradeLogs(limit = 50) {
  const options: TradeLogListOptions = {
    page: 1,
    limit,
    hideCronNoise: false,
    order: "desc",
  };
  const result = await listTradeLogs(options);
  return result.logs;
}
