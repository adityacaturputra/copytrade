'use client';

import { useEffect, useRef, useCallback } from 'react';
import { FundingHistoryItem, formatFundingRate } from '../lib/utils';

interface Props { fundingHistory: FundingHistoryItem[]; }

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
}

export default function FundingChart({ fundingHistory }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || fundingHistory.length === 0) return;

    const container = canvas.parentElement;
    if (!container) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    canvas.style.width = container.clientWidth + 'px';
    canvas.style.height = container.clientHeight + 'px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = container.clientWidth;
    const height = container.clientHeight;
    ctx.clearRect(0, 0, width, height);

    const data = fundingHistory;
    const rates = data.map(d => d.rate * 100);
    const maxRate = Math.max(...rates.map(Math.abs), 0.02);
    const yScale = (height / 2 - 30) / maxRate;
    const barWidth = Math.max((width - 60) / data.length - 4, 8);
    const startX = 40;
    const centerY = height / 2;

    // Zero line
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(startX, centerY); ctx.lineTo(width - 10, centerY); ctx.stroke();
    ctx.setLineDash([]);

    // Y-axis labels
    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono"';
    ctx.textAlign = 'right';
    ctx.fillText('0%', startX - 8, centerY + 4);
    const yStep = maxRate / 2;
    ctx.fillText('+' + yStep.toFixed(3) + '%', startX - 8, centerY - yStep * yScale + 4);
    ctx.fillText('-' + yStep.toFixed(3) + '%', startX - 8, centerY + yStep * yScale + 4);

    // Grid lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(startX, centerY - yStep * yScale); ctx.lineTo(width - 10, centerY - yStep * yScale);
    ctx.moveTo(startX, centerY + yStep * yScale); ctx.lineTo(width - 10, centerY + yStep * yScale);
    ctx.stroke();

    // Bars
    data.forEach((item, i) => {
      const x = startX + i * ((width - 60) / data.length) + 2;
      const rate = item.rate * 100;
      const barHeight = Math.abs(rate) * yScale;
      const gradient = ctx.createLinearGradient(x, centerY, x, centerY - rate * yScale);
      if (rate >= 0) { gradient.addColorStop(0, 'rgba(16, 185, 129, 0.3)'); gradient.addColorStop(1, 'rgba(16, 185, 129, 0.9)'); }
      else { gradient.addColorStop(0, 'rgba(239, 68, 68, 0.3)'); gradient.addColorStop(1, 'rgba(239, 68, 68, 0.9)'); }
      ctx.fillStyle = gradient;
      ctx.beginPath();
      const radius = 2;
      if (rate >= 0) roundedRect(ctx, x, centerY - barHeight, barWidth, barHeight, radius);
      else roundedRect(ctx, x, centerY, barWidth, barHeight, radius);
      ctx.fill();

      if (data.length <= 15 || i % Math.ceil(data.length / 10) === 0) {
        ctx.fillStyle = '#64748b'; ctx.font = '9px "JetBrains Mono"'; ctx.textAlign = 'center';
        const timeLabel = new Date(item.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        ctx.fillText(timeLabel, x + barWidth / 2, height - 5);
      }
    });

    // Transition markers
    for (let i = 1; i < data.length; i++) {
      const prev = data[i - 1].rate;
      const curr = data[i].rate;
      if ((prev < 0 && curr >= 0) || (prev >= 0 && curr < 0)) {
        const x = startX + i * ((width - 60) / data.length) + barWidth / 2;
        ctx.strokeStyle = prev < 0 ? 'rgba(239, 68, 68, 0.6)' : 'rgba(16, 185, 129, 0.6)';
        ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x, height - 20); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = prev < 0 ? '#ef4444' : '#10b981';
        ctx.font = 'bold 8px "Inter"'; ctx.textAlign = 'center';
        ctx.fillText(prev < 0 ? 'TP SHORT' : 'TP LONG', x, 8);
      }
    }
  }, [fundingHistory]);

  useEffect(() => {
    drawChart();
    const handleResize = () => drawChart();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [drawChart]);

  return (
    <section className="history-section glass-card">
      <div className="history-header">
        <div className="history-title"><span className="metric-icon">📊</span><h3>Funding Rate History Chart</h3></div>
        <div className="history-legend">
          <span className="legend-item positive-legend">🟢 Positive (Long Dominant)</span>
          <span className="legend-item negative-legend">🔴 Negative (Short Dominant)</span>
        </div>
      </div>
      <div className="chart-container"><canvas ref={canvasRef} /></div>
    </section>
  );
}
