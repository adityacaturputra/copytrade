'use client';

import { useState, useEffect, useRef } from 'react';
import { formatFundingRate } from '../lib/utils';

interface FundingRateCardProps {
  currentRate: number | null;
  nextFundingTime: number | null;
}

export default function FundingRateCard({ currentRate, nextFundingTime }: FundingRateCardProps) {
  const [countdown, setCountdown] = useState('--:--:--');
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!nextFundingTime) return;

    const tick = () => {
      const now = Date.now();
      const diff = nextFundingTime - now;
      if (diff <= 0) {
        setCountdown('Now!');
        return;
      }
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setCountdown(
        String(hours).padStart(2, '0') + ':' +
        String(minutes).padStart(2, '0') + ':' +
        String(seconds).padStart(2, '0')
      );
    };

    tick();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(tick, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [nextFundingTime]);

  const rate = currentRate ?? 0;
  const barWidth = Math.min(Math.abs(rate) * 100 * 100, 50);
  const isPositive = rate >= 0;

  let statusText = '⚪ Neutral';
  let statusColor = '#94a3b8';
  if (rate > 0) {
    statusText = '🟢 Positive (Longs Pay)';
    statusColor = '#10b981';
  } else if (rate < 0) {
    statusText = '🔴 Negative (Shorts Pay)';
    statusColor = '#ef4444';
  }

  return (
    <div className="metric-card glass-card">
      <div className="metric-header">
        <span className="metric-icon">📊</span>
        <h3>Current Funding Rate</h3>
      </div>
      <div className={`metric-value-large ${isPositive ? 'positive' : 'negative'}`}>
        {currentRate !== null ? formatFundingRate(rate) : '0.0000%'}
      </div>
      <div className="metric-bar-container">
        <div className="metric-bar">
          <div
            className={`metric-bar-fill ${isPositive ? 'positive' : 'negative'}`}
            style={{ width: barWidth + '%' }}
          />
          <div className="metric-bar-center" />
        </div>
        <div className="metric-bar-labels">
          <span className="label-negative">Short Dominant</span>
          <span className="label-positive">Long Dominant</span>
        </div>
      </div>
      <div className="funding-info">
        <div className="info-item">
          <span className="info-label">Status</span>
          <span className="info-value" style={{ color: statusColor }}>{statusText}</span>
        </div>
        <div className="info-item">
          <span className="info-label">Next Funding</span>
          <span className="info-value">{countdown}</span>
        </div>
      </div>
    </div>
  );
}
