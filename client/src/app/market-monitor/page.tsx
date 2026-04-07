'use client';

import { useState } from 'react';
import './market-monitor.css';
import { useBinanceWebSocket } from './hooks/useBinanceWebSocket';
import { useFundingData } from './hooks/useFundingData';
import Header from './components/Header';
import DashboardTab from './components/DashboardTab';
import AdvancedTab from './components/AdvancedTab';
import ToastContainer, { useToasts } from './components/ToastContainer';

export default function MarketMonitorPage() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'advanced'>('dashboard');
  const priceData = useBinanceWebSocket();
  const fundingData = useFundingData(priceData.price);
  const { toasts, removeToast } = useToasts();

  return (
    <div className="mm-root">
      {/* Background Effects */}
      <div className="bg-grid" />
      <div className="bg-glow bg-glow-1" />
      <div className="bg-glow bg-glow-2" />
      <div className="bg-glow bg-glow-3" />

      <div className="container">
        <Header isConnected={priceData.isConnected} lastUpdate={priceData.lastUpdate} />

        {/* Navigation */}
        <nav className="page-nav">
          <button
            className={`nav-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <span className="nav-icon">📊</span>
            <div>
              <span className="nav-label">Dashboard</span>
              <span className="nav-desc">Funding Rate &amp; TP Signal</span>
            </div>
          </button>
          <button
            className={`nav-tab ${activeTab === 'advanced' ? 'active' : ''}`}
            onClick={() => setActiveTab('advanced')}
          >
            <span className="nav-icon">🐋</span>
            <div>
              <span className="nav-label">Advanced Analysis</span>
              <span className="nav-desc">Whale &amp; Dominance</span>
            </div>
          </button>
        </nav>

        {/* Tab Content */}
        {activeTab === 'dashboard' ? (
          <DashboardTab priceData={priceData} fundingData={fundingData} />
        ) : (
          <AdvancedTab priceData={priceData} fundingData={fundingData} />
        )}

        {/* Footer */}
        <footer className="footer">
          BTC Market Maker Monitor — Data from Binance Futures API — Built with React
        </footer>
      </div>

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
