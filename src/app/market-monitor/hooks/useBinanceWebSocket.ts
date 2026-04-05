'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { CONFIG, formatPrice, formatTime, formatVolume } from '../lib/utils';

export interface BinancePriceData {
  price: number;
  formattedPrice: string;
  high: string;
  low: string;
  volume: string;
  changePercent: number;
  isConnected: boolean;
  lastUpdate: string;
  priceDirection: 'up' | 'down' | null;
}

export function useBinanceWebSocket() {
  const [data, setData] = useState<BinancePriceData>({
    price: 0,
    formattedPrice: '--,---',
    high: '$--,---',
    low: '$--,---',
    volume: '-- BTC',
    changePercent: 0,
    isConnected: false,
    lastUpdate: '--',
    priceDirection: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastWsUpdateRef = useRef<number>(0);
  const previousPriceRef = useRef<number>(0);
  const directionTimerRef = useRef<NodeJS.Timeout | null>(null);

  const connectWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const ws = new WebSocket(`${CONFIG.BINANCE_WS}/btcusdt@ticker`);
      wsRef.current = ws;

      ws.onopen = () => {
        setData(prev => ({ ...prev, isConnected: true }));
      };

      ws.onmessage = (event) => {
        try {
          const wsData = JSON.parse(event.data);
          lastWsUpdateRef.current = Date.now();

          const newPrice = parseFloat(wsData.c);
          const oldPrice = previousPriceRef.current;
          previousPriceRef.current = newPrice;

          let direction: 'up' | 'down' | null = null;
          if (oldPrice > 0 && oldPrice !== newPrice) {
            direction = newPrice > oldPrice ? 'up' : 'down';
          }

          // Clear previous direction timer
          if (directionTimerRef.current) {
            clearTimeout(directionTimerRef.current);
          }

          setData({
            price: newPrice,
            formattedPrice: formatPrice(newPrice),
            high: '$' + formatPrice(wsData.h),
            low: '$' + formatPrice(wsData.l),
            volume: formatVolume(wsData.v),
            changePercent: parseFloat(wsData.P),
            isConnected: true,
            lastUpdate: 'LIVE • ' + formatTime(Date.now()),
            priceDirection: direction,
          });

          // Reset direction after flash
          if (direction) {
            directionTimerRef.current = setTimeout(() => {
              setData(prev => ({ ...prev, priceDirection: null }));
            }, 600);
          }
        } catch (e) {
          console.error('WebSocket parse error:', e);
        }
      };

      ws.onclose = () => {
        setData(prev => ({ ...prev, isConnected: false }));
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = () => {
        setData(prev => ({ ...prev, isConnected: false }));
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
    }
  }, []);

  // REST fallback
  const fetchTicker = useCallback(async () => {
    try {
      const response = await fetch(`${CONFIG.BINANCE_API}/fapi/v1/ticker/24hr?symbol=BTCUSDT`);
      if (!response.ok) throw new Error('Ticker API error');
      const tickerData = await response.json();

      const newPrice = parseFloat(tickerData.lastPrice);
      const oldPrice = previousPriceRef.current;
      previousPriceRef.current = newPrice;

      let direction: 'up' | 'down' | null = null;
      if (oldPrice > 0 && oldPrice !== newPrice) {
        direction = newPrice > oldPrice ? 'up' : 'down';
      }

      setData({
        price: newPrice,
        formattedPrice: formatPrice(newPrice),
        high: '$' + formatPrice(tickerData.highPrice),
        low: '$' + formatPrice(tickerData.lowPrice),
        volume: formatVolume(tickerData.volume),
        changePercent: parseFloat(tickerData.priceChangePercent),
        isConnected: true,
        lastUpdate: 'Updated: ' + formatTime(Date.now()),
        priceDirection: direction,
      });

      if (direction) {
        if (directionTimerRef.current) clearTimeout(directionTimerRef.current);
        directionTimerRef.current = setTimeout(() => {
          setData(prev => ({ ...prev, priceDirection: null }));
        }, 600);
      }
    } catch (error) {
      console.error('Error fetching ticker:', error);
    }
  }, []);

  useEffect(() => {
    connectWebSocket();

    // WebSocket health check
    const healthCheck = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN && Date.now() - lastWsUpdateRef.current > 5000) {
        console.warn('⚠️ WebSocket stale, reconnecting...');
        connectWebSocket();
      }
    }, 5000);

    // REST fallback
    const restFallback = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        fetchTicker();
      }
    }, CONFIG.PRICE_REFRESH_INTERVAL);

    return () => {
      clearInterval(healthCheck);
      clearInterval(restFallback);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (directionTimerRef.current) clearTimeout(directionTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectWebSocket, fetchTicker]);

  return data;
}
