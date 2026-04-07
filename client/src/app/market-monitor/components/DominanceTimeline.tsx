'use client';

import { FundingHistoryItem, DominanceGroup, formatFundingRate, formatDateTime, formatRelativeTime, formatDuration } from '../lib/utils';

interface Props { fundingHistory: FundingHistoryItem[]; }

export default function DominanceTimeline({ fundingHistory }: Props) {
  if (fundingHistory.length === 0) return null;

  const groups: DominanceGroup[] = [];
  let currentGroup: DominanceGroup | null = null;

  fundingHistory.forEach((item, i) => {
    const type = item.rate < 0 ? 'short' : 'long';
    if (!currentGroup || currentGroup.type !== type) {
      if (currentGroup) {
        groups.push({ type: 'transition', from: currentGroup.type, to: type, time: item.time, prevRate: fundingHistory[i - 1].rate, currRate: item.rate });
      }
      currentGroup = { type, startTime: item.time, endTime: item.time, rates: [item.rate], count: 1 };
      groups.push(currentGroup);
    } else {
      currentGroup.endTime = item.time;
      currentGroup.rates!.push(item.rate);
      currentGroup.count!++;
    }
  });

  const reversed = [...groups].reverse();

  return (
    <section className="dominance-timeline-section glass-card">
      <div className="history-header">
        <div className="history-title"><span className="metric-icon">📅</span><h3>MM Dominance History</h3></div>
        <span className="mtf-note">{fundingHistory.length} periods analyzed</span>
      </div>
      <div className="dominance-timeline">
        {reversed.map((group, idx) => {
          if (group.type === 'transition') {
            const isTPShort = group.from === 'short';
            const label = isTPShort ? '⚡ MM TP SHORT' : '⚡ MM TP LONG';
            const detail = `${formatFundingRate(group.prevRate!)} → ${formatFundingRate(group.currRate!)}`;
            const relTime = formatRelativeTime(group.time!);
            return (
              <div key={idx} className="timeline-row">
                <div className="timeline-marker">
                  <div className="timeline-dot transition-dot" />
                  {idx < reversed.length - 1 && <div className="timeline-line short-line" />}
                </div>
                <div className="timeline-content transition-content">
                  <div className="timeline-top">
                    <span className="timeline-label transition-label">{label}</span>
                    <span className="timeline-time">{formatDateTime(group.time!)}</span>
                  </div>
                  <div className="timeline-detail">{detail}</div>
                  <div className="timeline-badges">
                    <span className="timeline-rate-badge transition-rate">Transition Signal</span>
                    <span className="timeline-relative-badge">🕐 {relTime}</span>
                  </div>
                </div>
              </div>
            );
          }

          const isShort = group.type === 'short';
          const avgRate = group.rates!.reduce((a, b) => a + b, 0) / group.rates!.length;
          const peakRate = isShort ? Math.min(...group.rates!) : Math.max(...group.rates!);
          const emoji = isShort ? '🔴' : '🟢';
          const typeLabel = isShort ? 'SHORT DOMINANT' : 'LONG DOMINANT';
          const dotClass = isShort ? 'short-dot' : 'long-dot';
          const lineClass = isShort ? 'short-line' : 'long-line';
          const contentClass = isShort ? 'short-content' : 'long-content';
          const labelClass = isShort ? 'short-label' : 'long-label';
          const rateClass = isShort ? 'short-rate' : 'long-rate';
          const timeRange = group.count === 1 ? formatDateTime(group.startTime!) : `${formatDateTime(group.startTime!)} — ${formatDateTime(group.endTime!)}`;
          const duration = formatDuration(group.startTime!, group.endTime || group.startTime!);
          const relTime = formatRelativeTime(group.endTime || group.startTime!);
          const isActive = idx === 0;

          return (
            <div key={idx} className={`timeline-row ${isActive ? 'timeline-active' : ''}`}>
              <div className="timeline-marker">
                <div className={`timeline-dot ${dotClass}`} />
                {idx < reversed.length - 1 && <div className={`timeline-line ${lineClass}`} />}
              </div>
              <div className={`timeline-content ${contentClass}`}>
                <div className="timeline-top">
                  <span className={`timeline-label ${labelClass}`}>{emoji} {typeLabel}{isActive ? ' (AKTIF)' : ''}</span>
                  <span className="timeline-time">{group.count} period{group.count! > 1 ? 's' : ''} • {group.count! * 8} jam</span>
                </div>
                <div className="timeline-detail">{timeRange}</div>
                <div className="timeline-badges">
                  <span className={`timeline-rate-badge ${rateClass}`}>Avg: {formatFundingRate(avgRate)} | Peak: {formatFundingRate(peakRate)}</span>
                  <span className="timeline-relative-badge">🕐 {relTime}</span>
                  <span className="timeline-duration-badge">⏱ Durasi: {duration}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
