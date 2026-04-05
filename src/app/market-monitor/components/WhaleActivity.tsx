'use client';

import { useState, useEffect, useCallback } from 'react';
import { CONFIG, WhaleDataResult } from '../lib/utils';

function renderWhaleCard(tf: WhaleDataResult) {
  if (!tf.data) return <div key={tf.label} className="mtf-card whale-card"><div className="mtf-timeframe">{tf.label}</div><div className="mtf-dominant-label" style={{ color: 'var(--text-muted)' }}>No Data</div></div>;

  const longPct = (parseFloat(tf.data.longAccount || tf.data.longPosition || '0') * 100).toFixed(1);
  const shortPct = (parseFloat(tf.data.shortAccount || tf.data.shortPosition || '0') * 100).toFixed(1);
  const ratio = parseFloat(tf.data.longShortRatio);
  const isLongDom = ratio >= 1;
  const dominantClass = isLongDom ? 'mtf-long-dominant' : 'mtf-short-dominant';
  const dominantLabel = isLongDom ? '🟢 LONG' : '🔴 SHORT';
  let strength = '', strengthClass = '';
  if (ratio >= 2.0 || ratio <= 0.5) { strength = '🔥 EXTREME'; strengthClass = 'whale-extreme'; }
  else if (ratio >= 1.5 || ratio <= 0.67) { strength = '⚡ STRONG'; strengthClass = 'whale-strong'; }
  else { strength = '➖ NORMAL'; strengthClass = 'whale-normal'; }

  return (
    <div key={tf.label} className={`mtf-card whale-card ${dominantClass}`}>
      <div className="mtf-timeframe">{tf.label}</div>
      <div className="mtf-dominant-label">{dominantLabel}</div>
      <div className="mtf-bar"><div className="mtf-bar-short" style={{ width: shortPct + '%' }} /><div className="mtf-bar-long" style={{ width: longPct + '%' }} /></div>
      <div className="mtf-percentages"><span className="mtf-short-pct">S: {shortPct}%</span><span className="mtf-long-pct">L: {longPct}%</span></div>
      <div className="mtf-avg-rate">Ratio: {ratio.toFixed(2)}</div>
      <div className={`whale-strength ${strengthClass}`}>{strength}</div>
    </div>
  );
}

export default function WhaleActivity() {
  const [positionData, setPositionData] = useState<WhaleDataResult[]>([]);
  const [accountData, setAccountData] = useState<WhaleDataResult[]>([]);
  const [summary, setSummary] = useState<{ longPct: string; shortPct: string; longRatio: string; shortRatio: string; signalIcon: string; signalText: string; signalColor: string; signalDetail: string }>({
    longPct: '--%', shortPct: '--%', longRatio: '--', shortRatio: '--', signalIcon: '⏳', signalText: 'Loading...', signalColor: '#94a3b8', signalDetail: 'Fetching whale data...'
  });

  const timeframes = [
    { period: '5m', label: '5M' }, { period: '15m', label: '15M' }, { period: '30m', label: '30M' }, { period: '1h', label: '1H' }, { period: '4h', label: '4H' },
  ];

  const fetchWhaleData = useCallback(async () => {
    try {
      const posProm = timeframes.map(tf => fetch(`${CONFIG.BINANCE_API}/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=${tf.period}&limit=1`).then(r => r.json()).then(d => ({ ...tf, data: d[0] || null })).catch(() => ({ ...tf, data: null })));
      const accProm = timeframes.map(tf => fetch(`${CONFIG.BINANCE_API}/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=${tf.period}&limit=1`).then(r => r.json()).then(d => ({ ...tf, data: d[0] || null })).catch(() => ({ ...tf, data: null })));
      const [posRes, accRes] = await Promise.all([Promise.all(posProm), Promise.all(accProm)]);
      setPositionData(posRes);
      setAccountData(accRes);

      // Update summary from 1H data
      const pos1h = posRes.find(r => r.label === '1H');
      const acc1h = accRes.find(r => r.label === '1H');
      if (pos1h?.data) {
        const lp = (parseFloat(pos1h.data.longAccount || pos1h.data.longPosition || '0') * 100).toFixed(1);
        const sp = (parseFloat(pos1h.data.shortAccount || pos1h.data.shortPosition || '0') * 100).toFixed(1);
        const ratio = parseFloat(pos1h.data.longShortRatio);
        let si = '⚖️', st = 'NEUTRAL', sc = '#94a3b8', sd = `Whales seimbang. Ratio ${ratio.toFixed(2)}`;
        if (ratio >= 2.0) { si = '🐋🟢'; st = 'EXTREME LONG'; sc = '#10b981'; sd = `Whales agresif LONG! Ratio ${ratio.toFixed(2)}`; }
        else if (ratio >= 1.5) { si = '🟢'; st = 'STRONG LONG'; sc = '#10b981'; sd = `Whale dominan LONG. Ratio ${ratio.toFixed(2)}`; }
        else if (ratio >= 1.1) { si = '🟡'; st = 'SLIGHT LONG'; sc = '#f59e0b'; sd = `Whale sedikit condong LONG. Ratio ${ratio.toFixed(2)}`; }
        else if (ratio <= 0.5) { si = '🐋🔴'; st = 'EXTREME SHORT'; sc = '#ef4444'; sd = `Whales agresif SHORT! Ratio ${ratio.toFixed(2)}`; }
        else if (ratio <= 0.67) { si = '🔴'; st = 'STRONG SHORT'; sc = '#ef4444'; sd = `Whale dominan SHORT. Ratio ${ratio.toFixed(2)}`; }
        else if (ratio <= 0.9) { si = '🟡'; st = 'SLIGHT SHORT'; sc = '#f59e0b'; sd = `Whale sedikit condong SHORT. Ratio ${ratio.toFixed(2)}`; }
        let lr = `Position Ratio: ${ratio.toFixed(2)}`, sr = `Position Ratio: ${(1/ratio).toFixed(2)}`;
        if (acc1h?.data) { const ar = parseFloat(acc1h.data.longShortRatio); lr += ` | Acc: ${ar.toFixed(2)}`; sr += ` | Acc: ${(1/ar).toFixed(2)}`; }
        setSummary({ longPct: lp + '%', shortPct: sp + '%', longRatio: lr, shortRatio: sr, signalIcon: si, signalText: st, signalColor: sc, signalDetail: sd });
      }
    } catch (error) { console.error('Error fetching whale data:', error); }
  }, []);

  useEffect(() => {
    fetchWhaleData();
    const interval = setInterval(fetchWhaleData, CONFIG.REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchWhaleData]);

  return (
    <section className="whale-section glass-card">
      <div className="whale-header">
        <div className="history-title"><span className="metric-icon">🐋</span><h3>Whale Activity — Top Traders</h3></div>
        <div className="whale-header-badges">
          <div className="whale-badge whale-badge-capital"><span className="whale-badge-icon">👑</span>Top 20% Capital</div>
          <div className="whale-live-dot"><span className="live-pulse" /><span className="live-text">LIVE</span></div>
        </div>
      </div>

      {/* Summary */}
      <div className="whale-summary">
        <div className="whale-summary-card whale-summary-long">
          <div className="whale-summary-icon">🟢</div>
          <div className="whale-summary-info">
            <div className="whale-summary-label">Top Traders LONG</div>
            <div className="whale-summary-value">{summary.longPct}</div>
          </div>
          <div className="whale-summary-ratio">{summary.longRatio}</div>
        </div>
        <div className="whale-summary-card whale-summary-short">
          <div className="whale-summary-icon">🔴</div>
          <div className="whale-summary-info">
            <div className="whale-summary-label">Top Traders SHORT</div>
            <div className="whale-summary-value">{summary.shortPct}</div>
          </div>
          <div className="whale-summary-ratio">{summary.shortRatio}</div>
        </div>
        <div className="whale-summary-card whale-summary-signal">
          <div className="whale-summary-icon">{summary.signalIcon}</div>
          <div className="whale-summary-info">
            <div className="whale-summary-label">Whale Signal</div>
            <div className="whale-summary-value" style={{ color: summary.signalColor }}>{summary.signalText}</div>
          </div>
          <div className="whale-summary-ratio">{summary.signalDetail}</div>
        </div>
      </div>

      {/* Position Ratio Grid */}
      <div className="whale-sub-section">
        <div className="whale-sub-header"><span className="whale-sub-icon">📊</span><span className="whale-sub-title">Top Trader Position Ratio</span><span className="whale-sub-note">Position Size</span></div>
        <div className="mtf-grid">{positionData.map(tf => renderWhaleCard(tf))}</div>
      </div>

      {/* Account Ratio Grid */}
      <div className="whale-sub-section">
        <div className="whale-sub-header"><span className="whale-sub-icon">👥</span><span className="whale-sub-title">Top Trader Account Ratio</span><span className="whale-sub-note">Account Count</span></div>
        <div className="mtf-grid">{accountData.map(tf => renderWhaleCard(tf))}</div>
      </div>
    </section>
  );
}
