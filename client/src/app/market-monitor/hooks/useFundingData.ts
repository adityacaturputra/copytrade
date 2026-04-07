'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { CONFIG, FundingHistoryItem, SignalHistoryItem } from '../lib/utils';

export interface FundingDataState {
  currentRate: number | null;
  previousRate: number | null;
  nextFundingTime: number | null;
  fundingHistory: FundingHistoryItem[];
  signalHistory: SignalHistoryItem[];
  loading: boolean;
}

export function useFundingData(currentPrice: number) {
  const [state, setState] = useState<FundingDataState>({
    currentRate: null,
    previousRate: null,
    nextFundingTime: null,
    fundingHistory: [],
    signalHistory: [],
    loading: true,
  });

  const previousRateRef = useRef<number | null>(null);

  // Fetch current funding rate
  const fetchFundingRate = useCallback(async () => {
    try {
      const response = await fetch(`${CONFIG.BINANCE_API}/fapi/v1/premiumIndex?symbol=BTCUSDT`);
      if (!response.ok) throw new Error('Funding rate API error');
      const data = await response.json();

      const rate = parseFloat(data.lastFundingRate);
      const nextFundingTime = parseInt(data.nextFundingTime);

      setState(prev => {
        const prevRate = prev.currentRate !== null ? prev.currentRate : previousRateRef.current;
        previousRateRef.current = prevRate;

        return {
          ...prev,
          currentRate: rate,
          previousRate: prevRate,
          nextFundingTime,
          loading: false,
        };
      });
    } catch (error) {
      console.error('Error fetching funding rate:', error);
    }
  }, []);

  // Fetch funding history
  const fetchFundingHistory = useCallback(async () => {
    try {
      const response = await fetch(
        `${CONFIG.BINANCE_API}/fapi/v1/fundingRate?symbol=BTCUSDT&limit=${CONFIG.FUNDING_HISTORY_COUNT}`
      );
      if (!response.ok) throw new Error('Funding history API error');
      const data = await response.json();

      const history: FundingHistoryItem[] = data.map((item: { fundingTime: number; fundingRate: string }) => ({
        time: item.fundingTime,
        rate: parseFloat(item.fundingRate),
      }));

      // Detect historical signals
      const signals: SignalHistoryItem[] = [];
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1].rate;
        const curr = history[i].rate;

        if (prev < 0 && curr >= 0) {
          signals.push({
            type: 'tp-short', time: history[i].time,
            prevRate: prev, currRate: curr, price: currentPrice,
          });
        } else if (prev >= 0 && curr < 0) {
          signals.push({
            type: 'tp-long', time: history[i].time,
            prevRate: prev, currRate: curr, price: currentPrice,
          });
        }
      }

      setState(prev => {
        // Initialize previous rate from history if not set
        let prevRate = prev.previousRate;
        if (prevRate === null && history.length >= 2) {
          prevRate = history[history.length - 2].rate;
          previousRateRef.current = prevRate;
        }

        return {
          ...prev,
          fundingHistory: history,
          signalHistory: signals,
          previousRate: prevRate,
          loading: false,
        };
      });
    } catch (error) {
      console.error('Error fetching funding history:', error);
    }
  }, [currentPrice]);

  useEffect(() => {
    fetchFundingRate();
    fetchFundingHistory();

    const rateInterval = setInterval(fetchFundingRate, CONFIG.REFRESH_INTERVAL);
    const historyInterval = setInterval(fetchFundingHistory, 300000); // 5 min

    return () => {
      clearInterval(rateInterval);
      clearInterval(historyInterval);
    };
  }, [fetchFundingRate, fetchFundingHistory]);

  return state;
}
