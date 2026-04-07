'use client';

import { BinancePriceData } from '../hooks/useBinanceWebSocket';

const BtcSvg = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
    <path d="M14.24 10.56c-.31 1.24-2.24.73-2.88.58l.55-2.18c.64.16 2.67.47 2.33 1.6zm-3.11 1.56l-.6 2.41c.78.19 3.17.96 3.52-.48.36-1.48-2.13-1.74-2.92-1.93zm10.62-.08c-.81 3.83-4.69 5.7-8.52 4.89-3.83-.81-5.7-4.69-4.89-8.52.81-3.83 4.69-5.7 8.52-4.89 3.83.81 5.7 4.69 4.89 8.52zm-4.96-2.42c.25-1.65-1.01-2.54-2.73-3.13l.56-2.23-1.36-.34-.54 2.17c-.36-.09-.73-.17-1.09-.26l.55-2.18-1.36-.34-.55 2.23c-.3-.07-.59-.13-.87-.2l-1.88-.47-.36 1.45s1.01.23.99.24c.55.14.65.5.63.79l-.63 2.54c.04.01.09.02.14.04l-.14-.04-.89 3.55c-.07.16-.23.41-.61.31.01.02-.99-.25-.99-.25l-.68 1.56 1.77.44c.33.08.65.17.97.25l-.56 2.25 1.36.34.56-2.24c.37.1.73.19 1.08.28l-.55 2.22 1.36.34.56-2.24c2.29.43 4.01.26 4.74-1.81.59-1.67-.03-2.63-1.23-3.26.87-.2 1.53-.78 1.71-1.97z" />
  </svg>
);

interface PriceCardProps {
  priceData: BinancePriceData;
}

export default function PriceCard({ priceData }: PriceCardProps) {
  const { formattedPrice, high, low, volume, changePercent, priceDirection } = priceData;

  const priceFlashClass = priceDirection === 'up' ? 'price-flash-up' : priceDirection === 'down' ? 'price-flash-down' : '';

  return (
    <section className="price-section">
      <div className="price-card glass-card">
        <div className="price-header">
          <div className="btc-badge">
            <BtcSvg />
            <span>Bitcoin</span>
          </div>
          <div className={`price-change ${changePercent >= 0 ? 'positive' : 'negative'}`}>
            <span className="change-value">
              {changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%
            </span>
          </div>
        </div>
        <div className="price-value">
          <span className="currency">$</span>
          <span className={priceFlashClass}>{formattedPrice}</span>
        </div>
        <div className="price-details">
          <div className="detail-item">
            <span className="detail-label">24h High</span>
            <span className="detail-value">{high}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">24h Low</span>
            <span className="detail-value">{low}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">24h Volume</span>
            <span className="detail-value">{volume}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
