'use client';

import { useEffect, useRef } from 'react';

export default function TradingViewWidget() {
  const containerRef = useRef<HTMLDivElement>(null);
  const scriptLoadedRef = useRef(false);

  useEffect(() => {
    if (scriptLoadedRef.current) return;
    scriptLoadedRef.current = true;

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.onload = () => {
      if (typeof (window as any).TradingView !== 'undefined' && containerRef.current) {
        new (window as any).TradingView.widget({
          autosize: true,
          symbol: 'BINANCE:BTCUSDT.P',
          interval: '1',
          timezone: 'Etc/UTC',
          theme: 'dark',
          style: '1',
          locale: 'en',
          toolbar_bg: '#0a0e17',
          enable_publishing: false,
          hide_top_toolbar: false,
          hide_legend: false,
          save_image: false,
          container_id: 'tradingview_chart',
          backgroundColor: 'rgba(10, 14, 23, 1)',
          gridColor: 'rgba(99, 102, 241, 0.06)',
          hide_volume: false,
          allow_symbol_change: true,
          details: true,
          hotlist: false,
          calendar: false,
          studies: ['Volume@tv-basicstudies'],
        });
      }
    };
    document.head.appendChild(script);

    return () => {
      // Cleanup not needed for TradingView
    };
  }, []);

  return (
    <section className="tradingview-section glass-card">
      <div className="history-header">
        <div className="history-title"><span className="metric-icon">📈</span><h3>TradingView — BTCUSDT Perpetual</h3></div>
      </div>
      <div className="tradingview-widget-container" ref={containerRef}>
        <div id="tradingview_chart" />
      </div>
    </section>
  );
}
