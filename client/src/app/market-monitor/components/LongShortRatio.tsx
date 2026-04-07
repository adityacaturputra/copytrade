'use client';

import { useState, useEffect, useCallback } from 'react';
import { CONFIG } from '../lib/utils';

interface LSResult { label: string; longPct: number; shortPct: number; ratio: number; }

export default function LongShortRatio() {
  const [results, setResults] = useState<LSResult[]>([]);
  const timeframes = [
    { period: '5m', label: '5M' },
    { period: '15m', label: '15M' },
    { period: '30m', label: '30M' },
    { period: '1h', label: '1H' },
    { period: '4h', label: '4H' },
  ];

  const fetchData = useCallback(async () => {
    try {
      const promises = timeframes.map(tf =>
        fetch(`${CONFIG.BINANCE_API}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=${tf.period}&limit=1`)
          .then(res => res.json())
          .then(data => {
            if (!data[0]) return { label: tf.label, longPct: 50, shortPct: 50, ratio: 1 };
            return {
              label: tf.label,
              longPct: parseFloat(data[0].longAccount) * 100,
              shortPct: parseFloat(data[0].shortAccount) * 100,
              ratio: parseFloat(data[0].longShortRatio),
            };
          })
          .catch(() => ({ label: tf.label, longPct: 50, shortPct: 50, ratio: 1 }))
      );
      setResults(await Promise.all(promises));
    } catch (error) {
      console.error('Error fetching L/S ratio:', error);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, CONFIG.REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <section className="mtf-section glass-card">
      <div className="mtf-header">
        <div className="history-title"><span className="metric-icon">📊</span><h3>Global Long/Short Ratio</h3></div>
        <span className="mtf-note">Source: Binance Futures</span>
      </div>
      <div className="mtf-grid">
        {results.map(r => {
          const isLongDom = r.ratio >= 1;
          const dominantClass = isLongDom ? 'mtf-long-dominant' : 'mtf-short-dominant';
          const dominantLabel = isLongDom ? '🟢 LONG' : '🔴 SHORT';
          return (
            <div key={r.label} className={`mtf-card ${dominantClass}`}>
              <div className="mtf-timeframe">{r.label}</div>
              <div className="mtf-dominant-label">{dominantLabel}</div>
              <div className="mtf-bar">
                <div className="mtf-bar-short" style={{ width: r.shortPct.toFixed(1) + '%' }} />
                <div className="mtf-bar-long" style={{ width: r.longPct.toFixed(1) + '%' }} />
              </div>
              <div className="mtf-percentages">
                <span className="mtf-short-pct">S: {r.shortPct.toFixed(1)}%</span>
                <span className="mtf-long-pct">L: {r.longPct.toFixed(1)}%</span>
              </div>
              <div className="mtf-avg-rate">Ratio: {r.ratio.toFixed(2)}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
