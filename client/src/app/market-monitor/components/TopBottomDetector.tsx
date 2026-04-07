'use client';

import { useState, useEffect, useCallback } from 'react';
import { CONFIG } from '../lib/utils';
import { calculateRSI, calculateMACD, detectVolumeDivergence, TF_RELIABILITY, MACDResult, VolDivResult } from '../lib/calculations';

interface TFResult {
  interval: string;
  label: string;
  rsi: number | null;
  macd: MACDResult | null;
  volDiv: VolDivResult | null;
}

export default function TopBottomDetector() {
  const [results, setResults] = useState<TFResult[]>([]);

  const fetchData = useCallback(async () => {
    const allTimeframes = [
      { interval: '1m', label: '1M', limit: 50 },
      { interval: '5m', label: '5M', limit: 50 },
      { interval: '15m', label: '15M', limit: 50 },
      { interval: '30m', label: '30M', limit: 50 },
      { interval: '1h', label: '1H', limit: 50 },
      { interval: '2h', label: '2H', limit: 50 },
      { interval: '4h', label: '4H', limit: 50 },
      { interval: '6h', label: '6H', limit: 50 },
      { interval: '8h', label: '8H', limit: 50 },
      { interval: '12h', label: '12H', limit: 50 },
      { interval: '1d', label: '1D', limit: 50 },
      { interval: '1w', label: '1W', limit: 50 },
    ];

    try {
      const promises = allTimeframes.map(tf =>
        fetch(`${CONFIG.BINANCE_API}/fapi/v1/klines?symbol=BTCUSDT&interval=${tf.interval}&limit=${tf.limit}`)
          .then(res => res.json())
          .then(data => {
            const closes = data.map((k: number[]) => parseFloat(String(k[4])));
            const volumes = data.map((k: number[]) => parseFloat(String(k[5])));
            return { interval: tf.interval, label: tf.label, rsi: calculateRSI(closes), macd: calculateMACD(closes), volDiv: detectVolumeDivergence(closes, volumes) };
          })
          .catch(() => ({ interval: tf.interval, label: tf.label, rsi: null, macd: null, volDiv: null }))
      );
      setResults(await Promise.all(promises));
    } catch (error) {
      console.error('Error fetching top/bottom data:', error);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, CONFIG.REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Calculate overall signal
  let bottomScore = 0, topScore = 0, total = 0;
  results.forEach(tf => {
    if (!tf.rsi && !tf.macd) return;
    total++;
    if (tf.rsi !== null) {
      if (tf.rsi <= 20) bottomScore += 3;
      else if (tf.rsi <= 30) bottomScore += 2;
      else if (tf.rsi <= 40) bottomScore += 1;
      else if (tf.rsi >= 80) topScore += 3;
      else if (tf.rsi >= 70) topScore += 2;
      else if (tf.rsi >= 60) topScore += 1;
    }
    if (tf.macd) {
      if (tf.macd.crossover) bottomScore += 3;
      else if (tf.macd.histogram > 0 && Math.abs(tf.macd.histogram) > Math.abs(tf.macd.prevHistogram)) bottomScore += 1;
      if (tf.macd.crossunder) topScore += 3;
      else if (tf.macd.histogram < 0 && Math.abs(tf.macd.histogram) > Math.abs(tf.macd.prevHistogram)) topScore += 1;
    }
    if (tf.volDiv && tf.volDiv.type !== 'none') {
      const rel = TF_RELIABILITY[tf.label];
      let weight = 1;
      if (rel) { if (rel.tier === 'best') weight = 1.5; else if (rel.tier === 'swing') weight = 1.3; else if (rel.tier === 'long') weight = 1.2; else if (rel.tier === 'short') weight = 0.8; }
      let baseScore = 0;
      if (tf.volDiv.strength === 'strong') baseScore = 3; else if (tf.volDiv.strength === 'moderate') baseScore = 2; else baseScore = 1;
      const ws = Math.round(baseScore * weight);
      if (tf.volDiv.type === 'bullish') bottomScore += ws; else topScore += ws;
    }
  });

  const maxScore = total * 9;
  const bottomPct = maxScore > 0 ? (bottomScore / maxScore * 100).toFixed(0) : '0';
  const topPct = maxScore > 0 ? (topScore / maxScore * 100).toFixed(0) : '0';
  const volDivResults = results.filter(tf => tf.volDiv && tf.volDiv.type !== 'none' && TF_RELIABILITY[tf.label]);
  const bullDivCount = volDivResults.filter(v => v.volDiv!.type === 'bullish').length;
  const bearDivCount = volDivResults.filter(v => v.volDiv!.type === 'bearish').length;
  const divSuffix = ` | Bull Div: ${bullDivCount} | Bear Div: ${bearDivCount}`;

  let overallIcon = '⏳', overallSignal = 'Calculating...', overallColor = '#94a3b8', overallDetail = 'Waiting for data...', overallClass = '', summaryIcon = '⏳', summaryText = 'Analyzing...', summaryColor = '#94a3b8';

  if (total > 0) {
    if (bottomScore > topScore && bottomScore >= total * 2) {
      overallIcon = '🟢'; overallSignal = '⬆ POTENTIAL BOTTOM — Accumulation Zone'; overallColor = '#10b981'; overallDetail = `Bottom: ${bottomPct}% | Top: ${topPct}%${divSuffix}`; overallClass = 'tb-overall-bottom'; summaryIcon = '🟢'; summaryText = 'BOTTOM ZONE'; summaryColor = '#10b981';
    } else if (topScore > bottomScore && topScore >= total * 2) {
      overallIcon = '🔴'; overallSignal = '⬇ POTENTIAL TOP — Distribution Zone'; overallColor = '#ef4444'; overallDetail = `Bottom: ${bottomPct}% | Top: ${topPct}%${divSuffix}`; overallClass = 'tb-overall-top'; summaryIcon = '🔴'; summaryText = 'TOP ZONE'; summaryColor = '#ef4444';
    } else if (bottomScore > topScore) {
      overallIcon = '🟡'; overallSignal = '↗ SLIGHT BULLISH — Monitor for Bottom'; overallColor = '#f59e0b'; overallDetail = `Bottom: ${bottomPct}% | Top: ${topPct}%${divSuffix}`; summaryIcon = '🟡'; summaryText = 'SLIGHT BULLISH'; summaryColor = '#f59e0b';
    } else if (topScore > bottomScore) {
      overallIcon = '🟡'; overallSignal = '↘ SLIGHT BEARISH — Monitor for Top'; overallColor = '#f59e0b'; overallDetail = `Bottom: ${bottomPct}% | Top: ${topPct}%${divSuffix}`; summaryIcon = '🟡'; summaryText = 'SLIGHT BEARISH'; summaryColor = '#f59e0b';
    } else {
      overallIcon = '⚖️'; overallSignal = '↔ NEUTRAL — No Clear Signal'; overallColor = '#94a3b8'; overallDetail = `Bottom: ${bottomPct}% | Top: ${topPct}%${divSuffix}`; summaryIcon = '⚖️'; summaryText = 'NEUTRAL'; summaryColor = '#94a3b8';
    }
  }

  return (
    <section className="topbottom-section glass-card">
      <div className="topbottom-header">
        <div className="history-title"><span className="metric-icon">🎯</span><h3>BTC Top / Bottom Detector</h3></div>
        <div className="topbottom-header-right">
          <div className="topbottom-signal-summary"><span className="tb-summary-icon">{summaryIcon}</span><span className="tb-summary-text" style={{ color: summaryColor }}>{summaryText}</span></div>
          <div className="whale-live-dot"><span className="live-pulse" /><span className="live-text">LIVE</span></div>
        </div>
      </div>

      {/* Overall Signal */}
      <div className={`tb-overall ${overallClass}`}>
        <div className="tb-overall-card">
          <div className="tb-overall-icon">{overallIcon}</div>
          <div className="tb-overall-info">
            <div className="tb-overall-label">Overall Market Structure</div>
            <div className="tb-overall-signal" style={{ color: overallColor }}>{overallSignal}</div>
            <div className="tb-overall-detail">{overallDetail}</div>
          </div>
        </div>
      </div>

      {/* RSI Grid */}
      <div className="tb-sub-section">
        <div className="whale-sub-header">
          <span className="whale-sub-icon">📈</span>
          <span className="whale-sub-title">RSI — Relative Strength Index (14)</span>
          <span className="whale-sub-note">Oversold &lt; 30 = Bottom | Overbought &gt; 70 = Top</span>
        </div>
        <div className="tb-grid">
          {results.map(tf => {
            if (tf.rsi === null) return <div key={tf.label} className="tb-card"><div className="tb-tf">{tf.label}</div><div className="tb-value" style={{ color: 'var(--text-muted)' }}>N/A</div></div>;
            const rsi = tf.rsi;
            let zone: string, zoneClass: string, zoneIcon: string;
            if (rsi <= 20) { zone = 'EXTREME OVERSOLD'; zoneClass = 'tb-extreme-bottom'; zoneIcon = '🟢🔥'; }
            else if (rsi <= 30) { zone = 'OVERSOLD'; zoneClass = 'tb-bottom'; zoneIcon = '🟢'; }
            else if (rsi <= 40) { zone = 'NEAR OVERSOLD'; zoneClass = 'tb-near-bottom'; zoneIcon = '🟡'; }
            else if (rsi >= 80) { zone = 'EXTREME OVERBOUGHT'; zoneClass = 'tb-extreme-top'; zoneIcon = '🔴🔥'; }
            else if (rsi >= 70) { zone = 'OVERBOUGHT'; zoneClass = 'tb-top'; zoneIcon = '🔴'; }
            else if (rsi >= 60) { zone = 'NEAR OVERBOUGHT'; zoneClass = 'tb-near-top'; zoneIcon = '🟡'; }
            else { zone = 'NEUTRAL'; zoneClass = 'tb-neutral'; zoneIcon = '⚪'; }
            const barPos = Math.min(Math.max(rsi, 0), 100);
            return (
              <div key={tf.label} className={`tb-card ${zoneClass}`}>
                <div className="tb-tf">{tf.label}</div>
                <div className="tb-value">{rsi.toFixed(1)}</div>
                <div className="tb-rsi-bar">
                  <div className="tb-rsi-zones"><div className="tb-zone-oversold" /><div className="tb-zone-neutral" /><div className="tb-zone-overbought" /></div>
                  <div className="tb-rsi-needle" style={{ left: barPos + '%' }} />
                </div>
                <div className="tb-zone-label">{zoneIcon} {zone}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* MACD Grid */}
      <div className="tb-sub-section">
        <div className="whale-sub-header">
          <span className="whale-sub-icon">📉</span>
          <span className="whale-sub-title">MACD — Moving Average Convergence Divergence</span>
          <span className="whale-sub-note">Histogram hijau = Bullish | Histogram merah = Bearish</span>
        </div>
        <div className="tb-grid">
          {results.map(tf => {
            if (!tf.macd) return <div key={tf.label} className="tb-card"><div className="tb-tf">{tf.label}</div><div className="tb-value" style={{ color: 'var(--text-muted)' }}>N/A</div></div>;
            const { histogram, crossover, crossunder } = tf.macd;
            const isBullish = histogram > 0;
            const isGrowing = Math.abs(histogram) > Math.abs(tf.macd.prevHistogram);
            let signalText: string, signalClass: string, signalIcon: string;
            if (crossover) { signalText = 'BULLISH CROSS'; signalClass = 'tb-extreme-bottom'; signalIcon = '🟢⚡'; }
            else if (crossunder) { signalText = 'BEARISH CROSS'; signalClass = 'tb-extreme-top'; signalIcon = '🔴⚡'; }
            else if (isBullish && isGrowing) { signalText = 'BULLISH GROWING'; signalClass = 'tb-bottom'; signalIcon = '🟢↑'; }
            else if (isBullish && !isGrowing) { signalText = 'BULLISH FADING'; signalClass = 'tb-near-top'; signalIcon = '🟡↓'; }
            else if (!isBullish && isGrowing) { signalText = 'BEARISH GROWING'; signalClass = 'tb-top'; signalIcon = '🔴↓'; }
            else { signalText = 'BEARISH FADING'; signalClass = 'tb-near-bottom'; signalIcon = '🟡↑'; }
            const histWidth = Math.min(Math.abs(histogram) / 100 * 100, 100);
            return (
              <div key={tf.label} className={`tb-card ${signalClass}`}>
                <div className="tb-tf">{tf.label}</div>
                <div className="tb-value" style={{ color: isBullish ? '#10b981' : '#ef4444' }}>{histogram >= 0 ? '+' : ''}{histogram.toFixed(2)}</div>
                <div className="tb-macd-bar"><div className={`tb-macd-fill ${isBullish ? 'tb-macd-bull' : 'tb-macd-bear'}`} style={{ width: histWidth + '%' }} /></div>
                <div className="tb-zone-label">{signalIcon} {signalText}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Volume Divergence Grid */}
      <div className="tb-sub-section">
        <div className="whale-sub-header">
          <span className="whale-sub-icon">📊</span>
          <span className="whale-sub-title">Volume Divergence — Bear/Bull Divergence Detector</span>
          <span className="whale-sub-note">Price vs Volume swing analysis</span>
        </div>
        <div className="voldiv-legend">
          <div className="voldiv-legend-item"><span className="voldiv-legend-dot voldiv-dot-bullish" /><span>Bullish Div (Price ↓ Vol ↓ = Reversal Up)</span></div>
          <div className="voldiv-legend-item"><span className="voldiv-legend-dot voldiv-dot-bearish" /><span>Bearish Div (Price ↑ Vol ↓ = Reversal Down)</span></div>
        </div>
        <div className="tb-grid voldiv-grid">
          {results.filter(tf => TF_RELIABILITY[tf.label]).map(tf => {
            const rel = TF_RELIABILITY[tf.label];
            const vd = tf.volDiv;
            if (!vd || vd.type === 'none') {
              return (
                <div key={tf.label} className="tb-card voldiv-card voldiv-none">
                  <div className="tb-tf">{tf.label}</div>
                  <div className="voldiv-reliability" style={{ color: rel.color, borderColor: rel.color + '33' }}>{rel.label}</div>
                  <div className="tb-value" style={{ color: 'var(--text-muted)' }}>—</div>
                  <div className="voldiv-bar-container"><div className="voldiv-bar"><div className="voldiv-bar-fill" style={{ width: '0%' }} /></div></div>
                  <div className="tb-zone-label" style={{ color: 'var(--text-muted)' }}>⚪ NO DIVERGENCE</div>
                </div>
              );
            }
            const isBullish = vd.type === 'bullish';
            const strengthLabel = vd.strength.toUpperCase();
            let cardClass: string, icon: string, color: string, barColor: string;
            if (isBullish) {
              if (vd.strength === 'strong') { cardClass = 'tb-extreme-bottom'; icon = '🟢🔥'; } else if (vd.strength === 'moderate') { cardClass = 'tb-bottom'; icon = '🟢'; } else { cardClass = 'tb-near-bottom'; icon = '🟡'; }
              color = '#10b981'; barColor = 'voldiv-bar-bull';
            } else {
              if (vd.strength === 'strong') { cardClass = 'tb-extreme-top'; icon = '🔴🔥'; } else if (vd.strength === 'moderate') { cardClass = 'tb-top'; icon = '🔴'; } else { cardClass = 'tb-near-top'; icon = '🟡'; }
              color = '#ef4444'; barColor = 'voldiv-bar-bear';
            }
            const barWidth = Math.min(vd.volDrop, 100);
            return (
              <div key={tf.label} className={`tb-card voldiv-card ${cardClass}`}>
                <div className="tb-tf">{tf.label}</div>
                <div className="voldiv-reliability" style={{ color: rel.color, borderColor: rel.color + '33' }}>{rel.label}</div>
                <div className="tb-value" style={{ color }}>{isBullish ? 'BULL' : 'BEAR'}</div>
                <div className="voldiv-bar-container">
                  <div className="voldiv-bar"><div className={`voldiv-bar-fill ${barColor}`} style={{ width: barWidth + '%' }} /></div>
                  <div className="voldiv-bar-label">Vol ↓{vd.volDrop.toFixed(0)}%</div>
                </div>
                <div className={`voldiv-strength-badge voldiv-strength-${vd.strength}`}>{strengthLabel}</div>
                <div className="tb-zone-label">{icon} {isBullish ? 'BULLISH' : 'BEARISH'} DIV</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
