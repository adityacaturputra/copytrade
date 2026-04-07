'use client';

import { FundingHistoryItem } from '../lib/utils';
import { formatFundingRate } from '../lib/utils';

interface FundingDominanceProps { fundingHistory: FundingHistoryItem[]; }

export default function FundingDominance({ fundingHistory }: FundingDominanceProps) {
  if (fundingHistory.length === 0) return null;

  const timeframes = [
    { label: '8H', periods: 1, desc: 'Last Period' },
    { label: '24H', periods: 3, desc: '3 Periods' },
    { label: '48H', periods: 6, desc: '6 Periods' },
    { label: '3D', periods: 9, desc: '9 Periods' },
    { label: '1W', periods: 21, desc: '21 Periods' },
  ];

  return (
    <section className="mtf-section glass-card">
      <div className="mtf-header">
        <div className="history-title"><span className="metric-icon">📊</span><h3>Multi-Timeframe Funding Analysis</h3></div>
        <span className="mtf-note">Funding rate 8h data</span>
      </div>
      <div className="mtf-grid">
        {timeframes.map(tf => {
          const count = Math.min(tf.periods, fundingHistory.length);
          const slice = fundingHistory.slice(-count);
          let shortCount = 0, longCount = 0;
          slice.forEach(item => { if (item.rate < 0) shortCount++; else longCount++; });
          const total = slice.length;
          const shortPct = total > 0 ? ((shortCount / total) * 100).toFixed(0) : '0';
          const longPct = total > 0 ? ((longCount / total) * 100).toFixed(0) : '0';
          const isShortDom = shortCount > longCount;
          const dominantClass = isShortDom ? 'mtf-short-dominant' : 'mtf-long-dominant';
          const dominantLabel = isShortDom ? '🔴 SHORT' : '🟢 LONG';
          const avgRate = total > 0 ? slice.reduce((s, i) => s + i.rate, 0) / total : 0;
          return (
            <div key={tf.label} className={`mtf-card ${dominantClass}`}>
              <div className="mtf-timeframe">{tf.label}</div>
              <div className="mtf-dominant-label">{dominantLabel}</div>
              <div className="mtf-bar">
                <div className="mtf-bar-short" style={{ width: shortPct + '%' }} />
                <div className="mtf-bar-long" style={{ width: longPct + '%' }} />
              </div>
              <div className="mtf-percentages">
                <span className="mtf-short-pct">S: {shortPct}%</span>
                <span className="mtf-long-pct">L: {longPct}%</span>
              </div>
              <div className="mtf-avg-rate">Avg: {formatFundingRate(avgRate)}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
