'use client';

import { BinancePriceData } from '../hooks/useBinanceWebSocket';
import { FundingDataState } from '../hooks/useFundingData';
import PriceCard from './PriceCard';
import FundingRateCard from './FundingRateCard';
import TPSignalCard from './TPSignalCard';
import TopBottomDetector from './TopBottomDetector';
import LongShortRatio from './LongShortRatio';
import { formatFundingRate, formatDateTime } from '../lib/utils';

interface DashboardTabProps {
  priceData: BinancePriceData;
  fundingData: FundingDataState;
}

export default function DashboardTab({ priceData, fundingData }: DashboardTabProps) {
  const { currentRate, previousRate, nextFundingTime, signalHistory, fundingHistory } = fundingData;

  return (
    <>
      <PriceCard priceData={priceData} />

      <div className="metrics-grid">
        <FundingRateCard currentRate={currentRate} nextFundingTime={nextFundingTime} />
        <TPSignalCard currentRate={currentRate} previousRate={previousRate} />
      </div>

      {/* Signal Logic Explanation */}
      <section className="logic-section glass-card">
        <div className="logic-header"><span className="metric-icon">🧠</span><h3>Signal Logic Explanation</h3></div>
        <div className="logic-grid">
          <div className="logic-item logic-short">
            <div className="logic-arrow"><span className="from negative">Negative</span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg><span className="to positive">Positive</span></div>
            <div className="logic-signal">⚡ MM TP SHORT</div>
            <div className="logic-desc">Funding berubah dari Negatif → Positif berarti: Market Makers yang sebelumnya SHORT telah mengambil profit karena pasar mulai bergerak naik.</div>
          </div>
          <div className="logic-item logic-long">
            <div className="logic-arrow"><span className="from positive">Positive</span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg><span className="to negative">Negative</span></div>
            <div className="logic-signal">⚡ MM TP LONG</div>
            <div className="logic-desc">Funding berubah dari Positif → Negatif berarti: Market Makers yang sebelumnya LONG telah mengambil profit karena pasar mulai bergerak turun.</div>
          </div>
        </div>
      </section>

      <TopBottomDetector />
      <LongShortRatio />

      {/* Signal History */}
      <section className="signal-history glass-card">
        <div className="history-header"><div className="history-title"><span className="metric-icon">📋</span><h3>Signal History</h3></div></div>
        <div className="signal-list">
          {signalHistory.length === 0 ? (
            <div className="empty-state"><span className="empty-icon">📡</span><p>No signals detected yet</p><p className="empty-sub">Signals appear when funding rate transitions between positive and negative</p></div>
          ) : (
            [...signalHistory].reverse().map((signal, index) => (
              <div key={index} className="signal-entry">
                <span className="signal-entry-icon">{signal.type === 'tp-short' ? '🔴' : '🟢'}</span>
                <div className="signal-entry-content">
                  <div className={`signal-entry-title ${signal.type}`}>{signal.type === 'tp-short' ? 'MM TP SHORT' : 'MM TP LONG'}</div>
                  <div className="signal-entry-detail">{formatFundingRate(signal.prevRate)} → {formatFundingRate(signal.currRate)}</div>
                </div>
                <div className="signal-entry-time">{formatDateTime(signal.time)}</div>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}
