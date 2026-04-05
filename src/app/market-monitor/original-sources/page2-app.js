/* ========================================
   BTC Market Maker Monitor - Page 2 (Advanced Analysis)
   Whale, Dominance, Timeline, Chart, TradingView
   ======================================== */

// ─── Funding History (for dominance analysis) ──

async function fetchFundingHistory() {
    await fetchFundingHistoryData();
    if (state.fundingHistory.length >= 2 && state.previousFundingRate === null) {
        state.previousFundingRate = state.fundingHistory[state.fundingHistory.length - 2].rate;
    }
    analyzeDominance();
    analyzeMultiTimeframe();
    updateChart();
}

// ─── Dominance Analysis ───────────────────────

function analyzeDominance() {
    const history = state.fundingHistory;
    if (history.length === 0) return;

    let shortCount = 0;
    let longCount = 0;
    let shortRates = [];
    let longRates = [];
    let shortLongestStreak = 0;
    let longLongestStreak = 0;
    let tempStreakShort = 0;
    let tempStreakLong = 0;

    history.forEach(item => {
        if (item.rate < 0) {
            shortCount++;
            shortRates.push(item.rate);
            tempStreakShort++;
            if (tempStreakShort > shortLongestStreak) shortLongestStreak = tempStreakShort;
            tempStreakLong = 0;
        } else {
            longCount++;
            longRates.push(item.rate);
            tempStreakLong++;
            if (tempStreakLong > longLongestStreak) longLongestStreak = tempStreakLong;
            tempStreakShort = 0;
        }
    });

    // Current streak
    let currentStreakCount = 0;
    let currentStreakType = null;
    for (let i = history.length - 1; i >= 0; i--) {
        const type = history[i].rate < 0 ? 'short' : 'long';
        if (currentStreakType === null) {
            currentStreakType = type;
            currentStreakCount = 1;
        } else if (type === currentStreakType) {
            currentStreakCount++;
        } else {
            break;
        }
    }

    const total = history.length;
    const shortPercent = ((shortCount / total) * 100).toFixed(1);
    const longPercent = ((longCount / total) * 100).toFixed(1);

    const avgShort = shortRates.length > 0 ? (shortRates.reduce((a, b) => a + b, 0) / shortRates.length) : 0;
    const avgLong = longRates.length > 0 ? (longRates.reduce((a, b) => a + b, 0) / longRates.length) : 0;
    const maxShort = shortRates.length > 0 ? Math.min(...shortRates) : 0;
    const maxLong = longRates.length > 0 ? Math.max(...longRates) : 0;

    // Update Short card
    const setTextById = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const setStyleById = (id, prop, val) => { const el = document.getElementById(id); if (el) el.style[prop] = val; };

    setTextById('shortDominancePercent', shortPercent + '%');
    setTextById('shortPeriods', shortCount + '/' + total);
    setTextById('shortStreak', currentStreakType === 'short' ? currentStreakCount + ' periods' : '0');
    setTextById('shortAvgRate', formatFundingRate(avgShort));
    setTextById('shortMaxRate', formatFundingRate(maxShort));
    setTextById('shortLongestStreak', shortLongestStreak + ' periods');
    const shortBarEl = document.getElementById('shortBarFill');
    if (shortBarEl) shortBarEl.style.width = shortPercent + '%';

    setTextById('longDominancePercent', longPercent + '%');
    setTextById('longPeriods', longCount + '/' + total);
    setTextById('longStreak', currentStreakType === 'long' ? currentStreakCount + ' periods' : '0');
    setTextById('longAvgRate', formatFundingRate(avgLong));
    setTextById('longMaxRate', formatFundingRate(maxLong));
    setTextById('longLongestStreak', longLongestStreak + ' periods');
    const longBarEl = document.getElementById('longBarFill');
    if (longBarEl) longBarEl.style.width = longPercent + '%';

    // Active dominant
    const shortCard = document.getElementById('shortDominanceCard');
    const longCard = document.getElementById('longDominanceCard');
    const shortStatus = document.getElementById('shortDominanceStatus');
    const longStatus = document.getElementById('longDominanceStatus');

    if (shortCard && longCard) {
        shortCard.classList.remove('active-dominant');
        longCard.classList.remove('active-dominant');
        if (shortStatus) shortStatus.classList.remove('active-now');
        if (longStatus) longStatus.classList.remove('active-now');

        if (currentStreakType === 'short') {
            shortCard.classList.add('active-dominant');
            if (shortStatus) { shortStatus.textContent = '● ACTIVE NOW'; shortStatus.classList.add('active-now'); }
            if (longStatus) longStatus.textContent = 'Inactive';
        } else {
            longCard.classList.add('active-dominant');
            if (longStatus) { longStatus.textContent = '● ACTIVE NOW'; longStatus.classList.add('active-now'); }
            if (shortStatus) shortStatus.textContent = 'Inactive';
        }
    }

    // Detect dominance switch
    if (!state.isFirstLoad && state.previousDominance !== null && state.previousDominance !== currentStreakType) {
        const price = '$' + formatPrice(state.currentPrice);
        if (currentStreakType === 'short') {
            showToast('short', '⚠️ Dominance Switch → SHORT', `Market switched to Short dominant at ${price}.`);
            sendBrowserNotification('🔴 SHORT Dominant Now!', `Market switched to Short dominant at ${price}`);
        } else {
            showToast('long', '⚠️ Dominance Switch → LONG', `Market switched to Long dominant at ${price}.`);
            sendBrowserNotification('🟢 LONG Dominant Now!', `Market switched to Long dominant at ${price}`);
        }
    }

    state.previousDominance = currentStreakType;
    state.isFirstLoad = false;

    renderDominanceTimeline();
}

// ─── Dominance Timeline ───────────────────────

function renderDominanceTimeline() {
    const history = state.fundingHistory;
    if (history.length === 0) return;

    const timelineEl = document.getElementById('dominanceTimeline');
    if (!timelineEl) return;

    const groups = [];
    let currentGroup = null;

    history.forEach((item, i) => {
        const type = item.rate < 0 ? 'short' : 'long';

        if (!currentGroup || currentGroup.type !== type) {
            if (currentGroup) {
                groups.push({
                    type: 'transition', from: currentGroup.type, to: type,
                    time: item.time, prevRate: history[i - 1].rate, currRate: item.rate,
                });
            }
            currentGroup = {
                type, startTime: item.time, endTime: item.time,
                rates: [item.rate], count: 1,
            };
            groups.push(currentGroup);
        } else {
            currentGroup.endTime = item.time;
            currentGroup.rates.push(item.rate);
            currentGroup.count++;
        }
    });

    const reversed = [...groups].reverse();

    timelineEl.innerHTML = reversed.map((group, idx) => {
        if (group.type === 'transition') {
            const isTPShort = group.from === 'short';
            const label = isTPShort ? '⚡ MM TP SHORT' : '⚡ MM TP LONG';
            const detail = `${formatFundingRate(group.prevRate)} → ${formatFundingRate(group.currRate)}`;
            const relTime = formatRelativeTime(group.time);

            return `
                <div class="timeline-row">
                    <div class="timeline-marker">
                        <div class="timeline-dot transition-dot"></div>
                        ${idx < reversed.length - 1 ? '<div class="timeline-line short-line"></div>' : ''}
                    </div>
                    <div class="timeline-content transition-content">
                        <div class="timeline-top">
                            <span class="timeline-label transition-label">${label}</span>
                            <span class="timeline-time">${formatDateTime(group.time)}</span>
                        </div>
                        <div class="timeline-detail">${detail}</div>
                        <div class="timeline-badges">
                            <span class="timeline-rate-badge transition-rate">Transition Signal</span>
                            <span class="timeline-relative-badge">🕐 ${relTime}</span>
                        </div>
                    </div>
                </div>`;
        }

        const isShort = group.type === 'short';
        const avgRate = group.rates.reduce((a, b) => a + b, 0) / group.rates.length;
        const peakRate = isShort ? Math.min(...group.rates) : Math.max(...group.rates);
        const emoji = isShort ? '🔴' : '🟢';
        const typeLabel = isShort ? 'SHORT DOMINANT' : 'LONG DOMINANT';
        const dotClass = isShort ? 'short-dot' : 'long-dot';
        const lineClass = isShort ? 'short-line' : 'long-line';
        const contentClass = isShort ? 'short-content' : 'long-content';
        const labelClass = isShort ? 'short-label' : 'long-label';
        const rateClass = isShort ? 'short-rate' : 'long-rate';

        const timeRange = group.count === 1
            ? formatDateTime(group.startTime)
            : `${formatDateTime(group.startTime)} — ${formatDateTime(group.endTime)}`;

        const duration = formatDuration(group.startTime, group.endTime || group.startTime);
        const relTime = formatRelativeTime(group.endTime || group.startTime);
        const isActive = idx === 0 && group.type !== 'transition';

        return `
            <div class="timeline-row ${isActive ? 'timeline-active' : ''}">
                <div class="timeline-marker">
                    <div class="timeline-dot ${dotClass}"></div>
                    ${idx < reversed.length - 1 ? `<div class="timeline-line ${lineClass}"></div>` : ''}
                </div>
                <div class="timeline-content ${contentClass}">
                    <div class="timeline-top">
                        <span class="timeline-label ${labelClass}">${emoji} ${typeLabel}${isActive ? ' (AKTIF)' : ''}</span>
                        <span class="timeline-time">${group.count} period${group.count > 1 ? 's' : ''} • ${group.count * 8} jam</span>
                    </div>
                    <div class="timeline-detail">${timeRange}</div>
                    <div class="timeline-badges">
                        <span class="timeline-rate-badge ${rateClass}">
                            Avg: ${formatFundingRate(avgRate)} | Peak: ${formatFundingRate(peakRate)}
                        </span>
                        <span class="timeline-relative-badge">🕐 ${relTime}</span>
                        <span class="timeline-duration-badge">⏱ Durasi: ${duration}</span>
                    </div>
                </div>
            </div>`;
    }).join('');
}

// ─── Multi-Timeframe Funding Analysis ─────────

function analyzeMultiTimeframe() {
    const history = state.fundingHistory;
    if (history.length === 0) return;

    const timeframes = [
        { label: '8H', periods: 1, desc: 'Last Period' },
        { label: '24H', periods: 3, desc: '3 Periods' },
        { label: '48H', periods: 6, desc: '6 Periods' },
        { label: '3D', periods: 9, desc: '9 Periods' },
        { label: '1W', periods: 21, desc: '21 Periods' },
    ];

    const mtfGrid = document.getElementById('mtfGrid');
    if (!mtfGrid) return;

    mtfGrid.innerHTML = timeframes.map(tf => {
        const count = Math.min(tf.periods, history.length);
        const slice = history.slice(-count);

        let shortCount = 0;
        let longCount = 0;

        slice.forEach(item => {
            if (item.rate < 0) shortCount++;
            else longCount++;
        });

        const total = slice.length;
        const shortPct = total > 0 ? ((shortCount / total) * 100).toFixed(0) : 0;
        const longPct = total > 0 ? ((longCount / total) * 100).toFixed(0) : 0;
        const isShortDominant = shortCount > longCount;
        const dominantClass = isShortDominant ? 'mtf-short-dominant' : 'mtf-long-dominant';
        const dominantLabel = isShortDominant ? '🔴 SHORT' : '🟢 LONG';
        const avgRate = total > 0 ? (slice.reduce((sum, item) => sum + item.rate, 0) / total) : 0;

        return `
            <div class="mtf-card ${dominantClass}">
                <div class="mtf-timeframe">${tf.label}</div>
                <div class="mtf-dominant-label">${dominantLabel}</div>
                <div class="mtf-bar">
                    <div class="mtf-bar-short" style="width: ${shortPct}%"></div>
                    <div class="mtf-bar-long" style="width: ${longPct}%"></div>
                </div>
                <div class="mtf-percentages">
                    <span class="mtf-short-pct">S: ${shortPct}%</span>
                    <span class="mtf-long-pct">L: ${longPct}%</span>
                </div>
                <div class="mtf-avg-rate">Avg: ${formatFundingRate(avgRate)}</div>
            </div>`;
    }).join('');
}

// ─── Whale Activity ───────────────────────────

async function fetchWhaleData() {
    const timeframes = [
        { period: '5m', label: '5M' },
        { period: '15m', label: '15M' },
        { period: '30m', label: '30M' },
        { period: '1h', label: '1H' },
        { period: '4h', label: '4H' },
    ];

    const positionGrid = document.getElementById('whalePositionGrid');
    const accountGrid = document.getElementById('whaleAccountGrid');

    try {
        const positionPromises = timeframes.map(tf =>
            fetch(`${CONFIG.BINANCE_API}/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=${tf.period}&limit=1`)
                .then(res => res.json())
                .then(data => ({ ...tf, data: data[0] || null }))
                .catch(() => ({ ...tf, data: null }))
        );

        const accountPromises = timeframes.map(tf =>
            fetch(`${CONFIG.BINANCE_API}/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=${tf.period}&limit=1`)
                .then(res => res.json())
                .then(data => ({ ...tf, data: data[0] || null }))
                .catch(() => ({ ...tf, data: null }))
        );

        const [positionResults, accountResults] = await Promise.all([
            Promise.all(positionPromises),
            Promise.all(accountPromises),
        ]);

        if (positionGrid) positionGrid.innerHTML = renderWhaleGrid(positionResults);
        if (accountGrid) accountGrid.innerHTML = renderWhaleGrid(accountResults);

        const pos1h = positionResults.find(r => r.label === '1H');
        const acc1h = accountResults.find(r => r.label === '1H');
        updateWhaleSummary(pos1h, acc1h);

    } catch (error) {
        console.error('Error fetching whale data:', error);
        if (positionGrid) positionGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Failed to load whale position data</p></div>`;
        if (accountGrid) accountGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Failed to load whale account data</p></div>`;
    }
}

function renderWhaleGrid(results) {
    return results.map(tf => {
        if (!tf.data) {
            return `<div class="mtf-card whale-card"><div class="mtf-timeframe">${tf.label}</div><div class="mtf-dominant-label" style="color: var(--text-muted)">No Data</div></div>`;
        }

        const longPct = (parseFloat(tf.data.longAccount || tf.data.longPosition || 0) * 100).toFixed(1);
        const shortPct = (parseFloat(tf.data.shortAccount || tf.data.shortPosition || 0) * 100).toFixed(1);
        const ratio = parseFloat(tf.data.longShortRatio);
        const isLongDominant = ratio >= 1;
        const dominantClass = isLongDominant ? 'mtf-long-dominant' : 'mtf-short-dominant';
        const dominantLabel = isLongDominant ? '🟢 LONG' : '🔴 SHORT';

        let strength = '', strengthClass = '';
        if (ratio >= 2.0 || ratio <= 0.5) { strength = '🔥 EXTREME'; strengthClass = 'whale-extreme'; }
        else if (ratio >= 1.5 || ratio <= 0.67) { strength = '⚡ STRONG'; strengthClass = 'whale-strong'; }
        else { strength = '➖ NORMAL'; strengthClass = 'whale-normal'; }

        return `
            <div class="mtf-card whale-card ${dominantClass}">
                <div class="mtf-timeframe">${tf.label}</div>
                <div class="mtf-dominant-label">${dominantLabel}</div>
                <div class="mtf-bar">
                    <div class="mtf-bar-short" style="width: ${shortPct}%"></div>
                    <div class="mtf-bar-long" style="width: ${longPct}%"></div>
                </div>
                <div class="mtf-percentages">
                    <span class="mtf-short-pct">S: ${shortPct}%</span>
                    <span class="mtf-long-pct">L: ${longPct}%</span>
                </div>
                <div class="mtf-avg-rate">Ratio: ${ratio.toFixed(2)}</div>
                <div class="whale-strength ${strengthClass}">${strength}</div>
            </div>`;
    }).join('');
}

function updateWhaleSummary(posData, accData) {
    const longPctEl = document.getElementById('whaleLongPct');
    const shortPctEl = document.getElementById('whaleShortPct');
    const longRatioEl = document.getElementById('whaleLongRatio');
    const shortRatioEl = document.getElementById('whaleShortRatio');
    const signalIcon = document.getElementById('whaleSignalIcon');
    const signalText = document.getElementById('whaleSignalText');
    const signalDetail = document.getElementById('whaleSignalDetail');

    if (posData && posData.data) {
        const longPct = (parseFloat(posData.data.longAccount || posData.data.longPosition || 0) * 100).toFixed(1);
        const shortPct = (parseFloat(posData.data.shortAccount || posData.data.shortPosition || 0) * 100).toFixed(1);
        const ratio = parseFloat(posData.data.longShortRatio);

        if (longPctEl) longPctEl.textContent = longPct + '%';
        if (shortPctEl) shortPctEl.textContent = shortPct + '%';
        if (longRatioEl) longRatioEl.textContent = 'Position Ratio: ' + ratio.toFixed(2);
        if (shortRatioEl) shortRatioEl.textContent = 'Position Ratio: ' + (1 / ratio).toFixed(2);

        if (ratio >= 2.0) {
            if (signalIcon) signalIcon.textContent = '🐋🟢';
            if (signalText) { signalText.textContent = 'EXTREME LONG'; signalText.style.color = '#10b981'; }
            if (signalDetail) signalDetail.textContent = `Whales agresif LONG! Ratio ${ratio.toFixed(2)}`;
        } else if (ratio >= 1.5) {
            if (signalIcon) signalIcon.textContent = '🟢';
            if (signalText) { signalText.textContent = 'STRONG LONG'; signalText.style.color = '#10b981'; }
            if (signalDetail) signalDetail.textContent = `Whale dominan LONG. Ratio ${ratio.toFixed(2)}`;
        } else if (ratio >= 1.1) {
            if (signalIcon) signalIcon.textContent = '🟡';
            if (signalText) { signalText.textContent = 'SLIGHT LONG'; signalText.style.color = '#f59e0b'; }
            if (signalDetail) signalDetail.textContent = `Whale sedikit condong LONG. Ratio ${ratio.toFixed(2)}`;
        } else if (ratio <= 0.5) {
            if (signalIcon) signalIcon.textContent = '🐋🔴';
            if (signalText) { signalText.textContent = 'EXTREME SHORT'; signalText.style.color = '#ef4444'; }
            if (signalDetail) signalDetail.textContent = `Whales agresif SHORT! Ratio ${ratio.toFixed(2)}`;
        } else if (ratio <= 0.67) {
            if (signalIcon) signalIcon.textContent = '🔴';
            if (signalText) { signalText.textContent = 'STRONG SHORT'; signalText.style.color = '#ef4444'; }
            if (signalDetail) signalDetail.textContent = `Whale dominan SHORT. Ratio ${ratio.toFixed(2)}`;
        } else if (ratio <= 0.9) {
            if (signalIcon) signalIcon.textContent = '🟡';
            if (signalText) { signalText.textContent = 'SLIGHT SHORT'; signalText.style.color = '#f59e0b'; }
            if (signalDetail) signalDetail.textContent = `Whale sedikit condong SHORT. Ratio ${ratio.toFixed(2)}`;
        } else {
            if (signalIcon) signalIcon.textContent = '⚖️';
            if (signalText) { signalText.textContent = 'NEUTRAL'; signalText.style.color = '#94a3b8'; }
            if (signalDetail) signalDetail.textContent = `Whales seimbang. Ratio ${ratio.toFixed(2)}`;
        }
    }

    if (accData && accData.data) {
        const accRatio = parseFloat(accData.data.longShortRatio);
        if (longRatioEl) longRatioEl.textContent += ` | Acc: ${accRatio.toFixed(2)}`;
        if (shortRatioEl) shortRatioEl.textContent += ` | Acc: ${(1 / accRatio).toFixed(2)}`;
    }
}

// ─── Chart ────────────────────────────────────

function createChart() {
    const canvas = document.getElementById('fundingChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    state.chart = { canvas, ctx };
    resizeChart();
    window.addEventListener('resize', resizeChart);
}

function resizeChart() {
    if (!state.chart) return;
    const { canvas } = state.chart;
    const container = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    canvas.style.width = container.clientWidth + 'px';
    canvas.style.height = container.clientHeight + 'px';
    state.chart.ctx.scale(dpr, dpr);
    updateChart();
}

function updateChart() {
    if (!state.chart || state.fundingHistory.length === 0) return;

    const { canvas, ctx } = state.chart;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    ctx.clearRect(0, 0, width, height);

    const data = state.fundingHistory;
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
    ctx.beginPath();
    ctx.moveTo(startX, centerY);
    ctx.lineTo(width - 10, centerY);
    ctx.stroke();
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
    ctx.moveTo(startX, centerY - yStep * yScale);
    ctx.lineTo(width - 10, centerY - yStep * yScale);
    ctx.moveTo(startX, centerY + yStep * yScale);
    ctx.lineTo(width - 10, centerY + yStep * yScale);
    ctx.stroke();

    // Bars
    data.forEach((item, i) => {
        const x = startX + i * ((width - 60) / data.length) + 2;
        const rate = item.rate * 100;
        const barHeight = Math.abs(rate) * yScale;

        const gradient = ctx.createLinearGradient(x, centerY, x, centerY - rate * yScale);
        if (rate >= 0) {
            gradient.addColorStop(0, 'rgba(16, 185, 129, 0.3)');
            gradient.addColorStop(1, 'rgba(16, 185, 129, 0.9)');
        } else {
            gradient.addColorStop(0, 'rgba(239, 68, 68, 0.3)');
            gradient.addColorStop(1, 'rgba(239, 68, 68, 0.9)');
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        const radius = 2;
        if (rate >= 0) {
            roundedRect(ctx, x, centerY - barHeight, barWidth, barHeight, radius);
        } else {
            roundedRect(ctx, x, centerY, barWidth, barHeight, radius);
        }
        ctx.fill();

        if (data.length <= 15 || i % Math.ceil(data.length / 10) === 0) {
            ctx.fillStyle = '#64748b';
            ctx.font = '9px "JetBrains Mono"';
            ctx.textAlign = 'center';
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
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(x, 10);
            ctx.lineTo(x, height - 20);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = prev < 0 ? '#ef4444' : '#10b981';
            ctx.font = 'bold 8px "Inter"';
            ctx.textAlign = 'center';
            ctx.fillText(prev < 0 ? 'TP SHORT' : 'TP LONG', x, 8);
        }
    }
}

function roundedRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
}

// ─── TradingView Widget ───────────────────────

function initTradingViewWidget() {
    if (typeof TradingView === 'undefined') {
        console.warn('TradingView library not loaded yet, retrying...');
        setTimeout(initTradingViewWidget, 1000);
        return;
    }

    new TradingView.widget({
        "autosize": true,
        "symbol": "BINANCE:BTCUSDT.P",
        "interval": "1",
        "timezone": "Etc/UTC",
        "theme": "dark",
        "style": "1",
        "locale": "en",
        "toolbar_bg": "#0a0e17",
        "enable_publishing": false,
        "hide_top_toolbar": false,
        "hide_legend": false,
        "save_image": false,
        "container_id": "tradingview_chart",
        "backgroundColor": "rgba(10, 14, 23, 1)",
        "gridColor": "rgba(99, 102, 241, 0.06)",
        "hide_volume": false,
        "allow_symbol_change": true,
        "details": true,
        "hotlist": false,
        "calendar": false,
        "studies": ["Volume@tv-basicstudies"],
    });
}

// ─── Main Loop ────────────────────────────────

async function fetchAllData() {
    try {
        const tasks = [fetchWhaleData()];
        if (!state.wsConnected) tasks.push(fetchTicker());
        await Promise.all(tasks);

        if (!state.wsConnected) {
            setConnectionStatus('connected');
            const el = document.getElementById('lastUpdate');
            if (el) el.textContent = 'Updated: ' + formatTime(Date.now());
        }
    } catch (error) {
        console.error('Error fetching data:', error);
        setConnectionStatus('error');
    }
}

// ─── Init Page 2 ──────────────────────────────

async function init() {
    console.log('🚀 Market Maker Monitor - Advanced Analysis starting...');

    setConnectionStatus('connecting');

    createChart();
    initTradingViewWidget();

    try {
        await fetchFundingHistory();
        await fetchAllData();
        console.log('✅ Advanced Analysis data loaded');
    } catch (error) {
        console.error('❌ Error during init:', error);
        setConnectionStatus('error');
    }

    initSharedComponents();

    setInterval(fetchAllData, CONFIG.REFRESH_INTERVAL);
    setInterval(fetchFundingHistory, 300000);
    setInterval(() => {
        if (state.fundingHistory.length > 0) renderDominanceTimeline();
    }, 60000);
}

document.addEventListener('DOMContentLoaded', init);