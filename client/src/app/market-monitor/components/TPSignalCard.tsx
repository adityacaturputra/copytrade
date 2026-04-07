'use client';

import { formatFundingRate } from '../lib/utils';

interface TPSignalCardProps {
  currentRate: number | null;
  previousRate: number | null;
}

export default function TPSignalCard({ currentRate, previousRate }: TPSignalCardProps) {
  const prev = previousRate;
  const curr = currentRate;

  let signalType = 'monitoring';
  if (prev !== null && curr !== null) {
    if (prev < 0 && curr >= 0) signalType = 'tp-short';
    else if (prev >= 0 && curr < 0) signalType = 'tp-long';
  }

  let displayClass = 'signal-display';
  let icon = '📡';
  let text = 'Waiting for Data...';
  let textColor = '#f1f5f9';
  let sub = 'Monitoring funding rate transitions';

  if (signalType === 'tp-short') {
    displayClass = 'signal-display tp-short';
    icon = '🔴';
    text = 'MM TP SHORT';
    textColor = '#ef4444';
    sub = 'Funding: Negative → Positive | Market Makers taking profit on SHORT';
  } else if (signalType === 'tp-long') {
    displayClass = 'signal-display tp-long';
    icon = '🟢';
    text = 'MM TP LONG';
    textColor = '#10b981';
    sub = 'Funding: Positive → Negative | Market Makers taking profit on LONG';
  } else if (curr !== null) {
    if (curr >= 0) {
      text = 'Funding Positive';
      sub = 'Long dominant market — monitoring for transition to negative';
    } else {
      text = 'Funding Negative';
      sub = 'Short dominant market — monitoring for transition to positive';
    }
  }

  return (
    <div className="metric-card glass-card signal-card">
      <div className="metric-header">
        <span className="metric-icon">🎯</span>
        <h3>Market Maker TP Signal</h3>
      </div>
      <div className={displayClass}>
        <div className="signal-icon">{icon}</div>
        <div className="signal-text" style={{ color: textColor }}>{text}</div>
        <div className="signal-sub">{sub}</div>
      </div>
      <div className="signal-details">
        <div className="info-item">
          <span className="info-label">Previous Rate</span>
          <span className="info-value" style={{ color: prev !== null ? (prev >= 0 ? '#10b981' : '#ef4444') : undefined }}>
            {prev !== null ? formatFundingRate(prev) : '--'}
          </span>
        </div>
        <div className="info-item">
          <span className="info-label">Current Rate</span>
          <span className="info-value" style={{ color: curr !== null ? (curr >= 0 ? '#10b981' : '#ef4444') : undefined }}>
            {curr !== null ? formatFundingRate(curr) : '--'}
          </span>
        </div>
      </div>
    </div>
  );
}
