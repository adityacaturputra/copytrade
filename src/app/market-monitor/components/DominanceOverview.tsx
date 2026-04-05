'use client';

import { FundingHistoryItem, formatFundingRate } from '../lib/utils';

interface Props { fundingHistory: FundingHistoryItem[]; }

export default function DominanceOverview({ fundingHistory }: Props) {
  if (fundingHistory.length === 0) return null;

  let shortCount = 0, longCount = 0, shortRates: number[] = [], longRates: number[] = [];
  let shortLongestStreak = 0, longLongestStreak = 0, tempShort = 0, tempLong = 0;

  fundingHistory.forEach(item => {
    if (item.rate < 0) { shortCount++; shortRates.push(item.rate); tempShort++; if (tempShort > shortLongestStreak) shortLongestStreak = tempShort; tempLong = 0; }
    else { longCount++; longRates.push(item.rate); tempLong++; if (tempLong > longLongestStreak) longLongestStreak = tempLong; tempShort = 0; }
  });

  let currentStreakCount = 0, currentStreakType: string | null = null;
  for (let i = fundingHistory.length - 1; i >= 0; i--) {
    const t = fundingHistory[i].rate < 0 ? 'short' : 'long';
    if (!currentStreakType) { currentStreakType = t; currentStreakCount = 1; }
    else if (t === currentStreakType) currentStreakCount++;
    else break;
  }

  const total = fundingHistory.length;
  const shortPercent = ((shortCount / total) * 100).toFixed(1);
  const longPercent = ((longCount / total) * 100).toFixed(1);
  const avgShort = shortRates.length > 0 ? shortRates.reduce((a, b) => a + b, 0) / shortRates.length : 0;
  const avgLong = longRates.length > 0 ? longRates.reduce((a, b) => a + b, 0) / longRates.length : 0;
  const maxShort = shortRates.length > 0 ? Math.min(...shortRates) : 0;
  const maxLong = longRates.length > 0 ? Math.max(...longRates) : 0;

  return (
    <div className="dominance-overview">
      {/* Short Dominance Card */}
      <div className={`dominance-card glass-card dominance-short ${currentStreakType === 'short' ? 'active-dominant' : ''}`}>
        <div className="dominance-card-header">
          <div className="dominance-badge short-badge"><span className="badge-icon">🔴</span> SHORT DOMINANCE</div>
          <div className={`dominance-status ${currentStreakType === 'short' ? 'active-now' : ''}`}>
            {currentStreakType === 'short' ? '● ACTIVE NOW' : 'Inactive'}
          </div>
        </div>
        <div className="dominance-stats">
          <div className="dom-stat"><span className="dom-stat-label">Dominance</span><span className="dom-stat-value">{shortPercent}%</span></div>
          <div className="dom-stat"><span className="dom-stat-label">Periods</span><span className="dom-stat-value">{shortCount}/{total}</span></div>
          <div className="dom-stat"><span className="dom-stat-label">Current Streak</span><span className="dom-stat-value">{currentStreakType === 'short' ? currentStreakCount + ' periods' : '0'}</span></div>
        </div>
        <div className="dominance-stats">
          <div className="dom-stat"><span className="dom-stat-label">Avg Rate</span><span className="dom-stat-value">{formatFundingRate(avgShort)}</span></div>
          <div className="dom-stat"><span className="dom-stat-label">Max Rate</span><span className="dom-stat-value">{formatFundingRate(maxShort)}</span></div>
          <div className="dom-stat"><span className="dom-stat-label">Longest Streak</span><span className="dom-stat-value">{shortLongestStreak} periods</span></div>
        </div>
        <div className="dominance-bar-wrapper"><div className="dominance-mini-bar"><div className="dominance-mini-fill short-fill" style={{ width: shortPercent + '%' }} /></div></div>
      </div>

      {/* Long Dominance Card */}
      <div className={`dominance-card glass-card dominance-long ${currentStreakType === 'long' ? 'active-dominant' : ''}`}>
        <div className="dominance-card-header">
          <div className="dominance-badge long-badge"><span className="badge-icon">🟢</span> LONG DOMINANCE</div>
          <div className={`dominance-status ${currentStreakType === 'long' ? 'active-now' : ''}`}>
            {currentStreakType === 'long' ? '● ACTIVE NOW' : 'Inactive'}
          </div>
        </div>
        <div className="dominance-stats">
          <div className="dom-stat"><span className="dom-stat-label">Dominance</span><span className="dom-stat-value">{longPercent}%</span></div>
          <div className="dom-stat"><span className="dom-stat-label">Periods</span><span className="dom-stat-value">{longCount}/{total}</span></div>
          <div className="dom-stat"><span className="dom-stat-label">Current Streak</span><span className="dom-stat-value">{currentStreakType === 'long' ? currentStreakCount + ' periods' : '0'}</span></div>
        </div>
        <div className="dominance-stats">
          <div className="dom-stat"><span className="dom-stat-label">Avg Rate</span><span className="dom-stat-value">{formatFundingRate(avgLong)}</span></div>
          <div className="dom-stat"><span className="dom-stat-label">Max Rate</span><span className="dom-stat-value">{formatFundingRate(maxLong)}</span></div>
          <div className="dom-stat"><span className="dom-stat-label">Longest Streak</span><span className="dom-stat-value">{longLongestStreak} periods</span></div>
        </div>
        <div className="dominance-bar-wrapper"><div className="dominance-mini-bar"><div className="dominance-mini-fill long-fill" style={{ width: longPercent + '%' }} /></div></div>
      </div>
    </div>
  );
}
