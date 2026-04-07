'use client';

interface HeaderProps {
  isConnected: boolean;
  lastUpdate: string;
}

export default function Header({ isConnected, lastUpdate }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <div className="logo">
          <div className="logo-icon">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M16 2L4 9v14l12 7 12-7V9L16 2z" stroke="currentColor" strokeWidth="2" />
              <path d="M16 8l-6 3.5v7L16 22l6-3.5v-7L16 8z" fill="currentColor" opacity="0.3" />
              <circle cx="16" cy="15" r="3" fill="currentColor" />
            </svg>
          </div>
          <div>
            <h1>Market Maker Monitor</h1>
            <span className="subtitle">BTC Funding Rate &amp; TP Tracker</span>
          </div>
        </div>
      </div>
      <div className="header-right">
        <div className="connection-status">
          <span className={`status-dot ${isConnected ? 'connected' : ''}`} />
          <span className="status-text">{isConnected ? 'Connected' : 'Connecting...'}</span>
        </div>
        <div className="last-update">{lastUpdate}</div>
      </div>
    </header>
  );
}
