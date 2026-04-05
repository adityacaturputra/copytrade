/* ========================================
   BTC Market Maker Monitor - Shared Utils
   ======================================== */

// ─── Configuration ────────────────────────────
export const CONFIG = {
  BINANCE_API: 'https://fapi.binance.com',
  BINANCE_WS: 'wss://fstream.binance.com/ws',
  REFRESH_INTERVAL: 10000,      // 10 seconds for REST data
  PRICE_REFRESH_INTERVAL: 1000, // 1 second fallback for price
  FUNDING_HISTORY_COUNT: 100,
  CHART_BARS: 100,
};

// ─── Formatting Functions ─────────────────────

export function formatPrice(price: number | string): string {
  return parseFloat(String(price)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatFundingRate(rate: number): string {
  return (rate * 100).toFixed(4) + '%';
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour12: false });
}

export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatVolume(vol: number | string): string {
  const num = parseFloat(String(vol));
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K BTC';
  return num.toFixed(2) + ' BTC';
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'Baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  if (hours < 24) return `${hours} jam lalu`;
  if (days === 1) return 'Kemarin';
  if (days < 7) return `${days} hari lalu`;
  if (days < 30) return `${Math.floor(days / 7)} minggu lalu`;
  return `${Math.floor(days / 30)} bulan lalu`;
}

export function formatDuration(startTime: number, endTime: number): string {
  const diff = endTime - startTime;
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  if (hours < 1) return 'Kurang dari 1 jam';
  if (hours < 24) return `${hours} jam`;
  if (remainingHours === 0) return `${days} hari`;
  return `${days} hari ${remainingHours} jam`;
}

// ─── Types ────────────────────────────────────

export interface FundingHistoryItem {
  time: number;
  rate: number;
}

export interface PriceData {
  lastPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  priceChangePercent: string;
}

export interface WhaleDataResult {
  label: string;
  period: string;
  data: {
    longAccount?: string;
    shortAccount?: string;
    longPosition?: string;
    shortPosition?: string;
    longShortRatio: string;
  } | null;
}

export interface SignalHistoryItem {
  type: 'tp-short' | 'tp-long';
  time: number;
  prevRate: number;
  currRate: number;
  price: number;
}

export interface DominanceGroup {
  type: 'short' | 'long' | 'transition';
  startTime?: number;
  endTime?: number;
  rates?: number[];
  count?: number;
  from?: string;
  to?: string;
  time?: number;
  prevRate?: number;
  currRate?: number;
}
