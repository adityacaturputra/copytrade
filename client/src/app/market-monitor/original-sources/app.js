/* ========================================
   BTC Market Maker Monitor - Page 1 (Dashboard)
   RSI, MACD, Volume Divergence, Funding, L/S Ratio
   ======================================== */

// ─── Funding Rate ─────────────────────────────

async function fetchFundingRate() {
    try {
        const response = await fetch(`${CONFIG.BINANCE_API}/fapi/v1/premiumIndex?symbol=BTCUSDT`);
        if (!response.ok) throw new Error('Funding rate API error');
        const data = await response.json();

        const rate = parseFloat(data.lastFundingRate);
        const nextFundingTime = parseInt(data.nextFundingTime);

        if (state.currentFundingRate !== null) {
            state.previousFundingRate = state.currentFundingRate;
        }
        state.currentFundingRate = rate;

        // Update display
        const fundingRateEl = document.getElementById('fundingRateValue');
        const fundingBarEl = document.getElementById('fundingBar');
        const fundingStatusEl = document.getElementById('fundingStatus');
        const currRateEl = document.getElementById('currRate');
        const prevRateEl = document.getElementById('prevRate');

        if (fundingRateEl) {
            fundingRateEl.textContent = formatFundingRate(rate);
            fundingRateEl.className = 'metric-value-large ' + (rate >= 0 ? 'positive' : 'negative');
        }

        if (fundingBarEl) {
            const barWidth = Math.min(Math.abs(rate) * 100 * 100, 50);
            fundingBarEl.style.width = barWidth + '%';
            fundingBarEl.className = 'metric-bar-fill ' + (rate >= 0 ? 'positive' : 'negative');
        }

        if (fundingStatusEl) {
            if (rate > 0) {
                fundingStatusEl.textContent = '🟢 Positive (Longs Pay)';
                fundingStatusEl.style.color = '#10b981';
            } else if (rate < 0) {
                fundingStatusEl.textContent = '🔴 Negative (Shorts Pay)';
                fundingStatusEl.style.color = '#ef4444';
            } else {
                fundingStatusEl.textContent = '⚪ Neutral';
                fundingStatusEl.style.color = '#94a3b8';
            }
        }

        updateCountdown(nextFundingTime);

        if (currRateEl) {
            currRateEl.textContent = formatFundingRate(rate);
            currRateEl.style.color = rate >= 0 ? '#10b981' : '#ef4444';
        }
        if (state.previousFundingRate !== null && prevRateEl) {
            prevRateEl.textContent = formatFundingRate(state.previousFundingRate);
            prevRateEl.style.color = state.previousFundingRate >= 0 ? '#10b981' : '#ef4444';
        }

        checkSignalTransition();
        return data;
    } catch (error) {
        console.error('Error fetching funding rate:', error);
        return null;
    }
}

// ─── Funding History (for signal detection) ───

async function fetchFundingHistory() {
    await fetchFundingHistoryData();
    if (state.fundingHistory.length >= 2 && state.previousFundingRate === null) {
        state.previousFundingRate = state.fundingHistory[state.fundingHistory.length - 2].rate;
    }
    detectHistoricalSignals();
}

// ─── Signal Detection ─────────────────────────

function checkSignalTransition() {
    if (state.previousFundingRate === null || state.currentFundingRate === null) return;

    const prev = state.previousFundingRate;
    const curr = state.currentFundingRate;

    if (prev < 0 && curr >= 0) {
        triggerSignal('tp-short', prev, curr);
    } else if (prev >= 0 && curr < 0) {
        triggerSignal('tp-long', prev, curr);
    } else {
        updateSignalDisplay('monitoring', prev, curr);
    }
}

function detectHistoricalSignals() {
    const history = state.fundingHistory;
    if (history.length < 2) return;

    state.signalHistory = [];
    for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1].rate;
        const curr = history[i].rate;

        if (prev < 0 && curr >= 0) {
            state.signalHistory.push({
                type: 'tp-short', time: history[i].time,
                prevRate: prev, currRate: curr, price: state.currentPrice,
            });
        } else if (prev >= 0 && curr < 0) {
            state.signalHistory.push({
                type: 'tp-long', time: history[i].time,
                prevRate: prev, currRate: curr, price: state.currentPrice,
            });
        }
    }

    if (state.signalHistory.length > 0) {
        const latest = state.signalHistory[state.signalHistory.length - 1];
        updateSignalDisplay(latest.type, latest.prevRate, latest.currRate);
    }
}

function triggerSignal(type, prevRate, currRate) {
    const signal = { type, time: Date.now(), prevRate, currRate, price: state.currentPrice };
    const lastSignal = state.signalHistory[state.signalHistory.length - 1];
    if (lastSignal && lastSignal.type === type && Math.abs(lastSignal.time - signal.time) < 28800000) return;
    state.signalHistory.push(signal);
    updateSignalDisplay(type, prevRate, currRate);
}

function updateSignalDisplay(type, prevRate, currRate) {
    const display = document.getElementById('signalDisplay');
    const iconEl = document.getElementById('signalIcon');
    const textEl = document.getElementById('signalText');
    const subEl = document.getElementById('signalSub');
    if (!display) return;

    if (type === 'tp-short') {
        display.className = 'signal-display tp-short';
        iconEl.textContent = '🔴';
        textEl.textContent = 'MM TP SHORT';
        textEl.style.color = '#ef4444';
        subEl.textContent = 'Funding: Negative → Positive | Market Makers taking profit on SHORT';
    } else if (type === 'tp-long') {
        display.className = 'signal-display tp-long';
        iconEl.textContent = '🟢';
        textEl.textContent = 'MM TP LONG';
        textEl.style.color = '#10b981';
        subEl.textContent = 'Funding: Positive → Negative | Market Makers taking profit on LONG';
    } else {
        display.className = 'signal-display';
        iconEl.textContent = '📡';
        textEl.style.color = '#f1f5f9';
        if (currRate >= 0) {
            textEl.textContent = 'Funding Positive';
            subEl.textContent = 'Long dominant market — monitoring for transition to negative';
        } else {
            textEl.textContent = 'Funding Negative';
            subEl.textContent = 'Short dominant market — monitoring for transition to positive';
        }
    }
}

// ─── Long/Short Ratio ─────────────────────────

async function fetchLongShortRatio() {
    const timeframes = [
        { period: '5m', label: '5M' },
        { period: '15m', label: '15M' },
        { period: '30m', label: '30M' },
        { period: '1h', label: '1H' },
        { period: '4h', label: '4H' },
    ];

    const grid = document.getElementById('lsRatioGrid');
    if (!grid) return;

    try {
        const promises = timeframes.map(tf =>
            fetch(`${CONFIG.BINANCE_API}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=${tf.period}&limit=1`)
                .then(res => res.json())
                .then(data => ({ ...tf, data: data[0] || null }))
                .catch(() => ({ ...tf, data: null }))
        );

        const responses = await Promise.all(promises);

        grid.innerHTML = responses.map(tf => {
            if (!tf.data) {
                return `<div class="mtf-card"><div class="mtf-timeframe">${tf.label}</div><div class="mtf-dominant-label" style="color: var(--text-muted)">No Data</div></div>`;
            }

            const longPct = (parseFloat(tf.data.longAccount) * 100).toFixed(1);
            const shortPct = (parseFloat(tf.data.shortAccount) * 100).toFixed(1);
            const ratio = parseFloat(tf.data.longShortRatio);
            const isLongDominant = ratio >= 1;
            const dominantClass = isLongDominant ? 'mtf-long-dominant' : 'mtf-short-dominant';
            const dominantLabel = isLongDominant ? '🟢 LONG' : '🔴 SHORT';

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
                    <div class="mtf-avg-rate">Ratio: ${ratio.toFixed(2)}</div>
                </div>`;
        }).join('');

    } catch (error) {
        console.error('Error fetching L/S ratio:', error);
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Failed to load ratio data</p></div>`;
    }
}

// ─── RSI Calculation ──────────────────────────

function calculateRSI(closes, period = 14) {
    if (closes.length < period + 1) return null;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const change = closes[i] - closes[i - 1];
        if (change >= 0) gains += change;
        else losses += Math.abs(change);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        const gain = change >= 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// ─── MACD Calculation ─────────────────────────

function calculateEMA(data, period) {
    const multiplier = 2 / (period + 1);
    const ema = [data[0]];
    for (let i = 1; i < data.length; i++) {
        ema.push((data[i] - ema[i - 1]) * multiplier + ema[i - 1]);
    }
    return ema;
}

function calculateMACD(closes) {
    if (closes.length < 35) return null;

    const ema12 = calculateEMA(closes, 12);
    const ema26 = calculateEMA(closes, 26);
    const macdLine = ema12.map((val, i) => val - ema26[i]);
    const signalLine = calculateEMA(macdLine.slice(25), 9);

    const macdVal = macdLine[macdLine.length - 1];
    const signalVal = signalLine[signalLine.length - 1];
    const histogram = macdVal - signalVal;

    const prevMacdVal = macdLine[macdLine.length - 2];
    const prevSignalVal = signalLine[signalLine.length - 2];
    const prevHistogram = prevMacdVal - prevSignalVal;

    return {
        macd: macdVal,
        signal: signalVal,
        histogram,
        prevHistogram,
        crossover: prevHistogram <= 0 && histogram > 0,
        crossunder: prevHistogram >= 0 && histogram < 0,
    };
}

// ─── Volume Divergence Detection ──────────────

function detectVolumeDivergence(closes, volumes) {
    if (!closes || !volumes || closes.length < 15) return null;

    const lookback = 2;
    const len = closes.length;

    // Find swing highs and lows
    const swingHighs = [];
    const swingLows = [];

    for (let i = lookback; i < len - lookback; i++) {
        let isHigh = true;
        let isLow = true;

        for (let j = 1; j <= lookback; j++) {
            if (closes[i] <= closes[i - j] || closes[i] <= closes[i + j]) isHigh = false;
            if (closes[i] >= closes[i - j] || closes[i] >= closes[i + j]) isLow = false;
        }

        if (isHigh) swingHighs.push({ idx: i, price: closes[i], vol: volumes[i] });
        if (isLow) swingLows.push({ idx: i, price: closes[i], vol: volumes[i] });
    }

    // Average volume around swing for robustness
    function getAvgVolume(idx) {
        let sum = 0;
        let count = 0;
        for (let i = Math.max(0, idx - 1); i <= Math.min(len - 1, idx + 1); i++) {
            sum += volumes[i];
            count++;
        }
        return sum / count;
    }

    let result = { type: 'none', strength: 'none', volDrop: 0, detail: 'Tidak ada divergence' };

    // Check bearish divergence (price higher high, volume lower)
    if (swingHighs.length >= 2) {
        const prev = swingHighs[swingHighs.length - 2];
        const curr = swingHighs[swingHighs.length - 1];
        const prevVol = getAvgVolume(prev.idx);
        const currVol = getAvgVolume(curr.idx);

        if (curr.price > prev.price && currVol < prevVol) {
            const volDrop = ((prevVol - currVol) / prevVol) * 100;
            if (volDrop > 5) {
                let strength;
                if (volDrop > 35) strength = 'strong';
                else if (volDrop > 18) strength = 'moderate';
                else strength = 'weak';

                result = {
                    type: 'bearish',
                    strength,
                    volDrop,
                    detail: `HH + Vol ↓${volDrop.toFixed(0)}%`,
                };
            }
        }
    }

    // Check bullish divergence (price lower low, volume lower)
    if (swingLows.length >= 2) {
        const prev = swingLows[swingLows.length - 2];
        const curr = swingLows[swingLows.length - 1];
        const prevVol = getAvgVolume(prev.idx);
        const currVol = getAvgVolume(curr.idx);

        if (curr.price < prev.price && currVol < prevVol) {
            const volDrop = ((prevVol - currVol) / prevVol) * 100;
            if (volDrop > 5) {
                let strength;
                if (volDrop > 35) strength = 'strong';
                else if (volDrop > 18) strength = 'moderate';
                else strength = 'weak';

                if (result.type === 'none' || volDrop > result.volDrop) {
                    result = {
                        type: 'bullish',
                        strength,
                        volDrop,
                        detail: `LL + Vol ↓${volDrop.toFixed(0)}%`,
                    };
                }
            }
        }
    }

    return result;
}

// Timeframe reliability map
const TF_RELIABILITY = {
    '15M': { tier: 'short', label: 'SHORT-TERM', color: '#f59e0b' },
    '30M': { tier: 'short', label: 'SHORT-TERM', color: '#f59e0b' },
    '1H':  { tier: 'best',  label: '⭐ BEST',     color: '#10b981' },
    '2H':  { tier: 'best',  label: '⭐ BEST',     color: '#10b981' },
    '4H':  { tier: 'best',  label: '⭐ BEST',     color: '#10b981' },
    '6H':  { tier: 'swing', label: 'SWING',      color: '#6366f1' },
    '8H':  { tier: 'swing', label: 'SWING',      color: '#6366f1' },
    '12H': { tier: 'swing', label: 'SWING',      color: '#6366f1' },
    '1D':  { tier: 'long',  label: 'LONG-TERM',  color: '#8b5cf6' },
    '1W':  { tier: 'long',  label: 'LONG-TERM',  color: '#8b5cf6' },
};

// ─── Fetch Top/Bottom + Volume Divergence ─────

async function fetchTopBottomData() {
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

    const rsiGrid = document.getElementById('rsiGrid');
    const macdGrid = document.getElementById('macdGrid');
    const volDivGrid = document.getElementById('volDivGrid');

    try {
        const promises = allTimeframes.map(tf =>
            fetch(`${CONFIG.BINANCE_API}/fapi/v1/klines?symbol=BTCUSDT&interval=${tf.interval}&limit=${tf.limit}`)
                .then(res => res.json())
                .then(data => {
                    const closes = data.map(k => parseFloat(k[4]));
                    const volumes = data.map(k => parseFloat(k[5]));
                    const rsi = calculateRSI(closes);
                    const macd = calculateMACD(closes);
                    const volDiv = detectVolumeDivergence(closes, volumes);
                    return { ...tf, rsi, macd, volDiv, closes, volumes };
                })
                .catch(() => ({ ...tf, rsi: null, macd: null, volDiv: null, closes: [], volumes: [] }))
        );

        const results = await Promise.all(promises);

        // ── Render RSI Grid ──
        if (rsiGrid) {
            rsiGrid.innerHTML = results.map(tf => {
                if (tf.rsi === null) {
                    return `<div class="tb-card"><div class="tb-tf">${tf.label}</div><div class="tb-value" style="color:var(--text-muted)">N/A</div></div>`;
                }

                const rsi = tf.rsi;
                let zone, zoneClass, zoneIcon;

                if (rsi <= 20) { zone = 'EXTREME OVERSOLD'; zoneClass = 'tb-extreme-bottom'; zoneIcon = '🟢🔥'; }
                else if (rsi <= 30) { zone = 'OVERSOLD'; zoneClass = 'tb-bottom'; zoneIcon = '🟢'; }
                else if (rsi <= 40) { zone = 'NEAR OVERSOLD'; zoneClass = 'tb-near-bottom'; zoneIcon = '🟡'; }
                else if (rsi >= 80) { zone = 'EXTREME OVERBOUGHT'; zoneClass = 'tb-extreme-top'; zoneIcon = '🔴🔥'; }
                else if (rsi >= 70) { zone = 'OVERBOUGHT'; zoneClass = 'tb-top'; zoneIcon = '🔴'; }
                else if (rsi >= 60) { zone = 'NEAR OVERBOUGHT'; zoneClass = 'tb-near-top'; zoneIcon = '🟡'; }
                else { zone = 'NEUTRAL'; zoneClass = 'tb-neutral'; zoneIcon = '⚪'; }

                const barPosition = Math.min(Math.max(rsi, 0), 100);

                return `
                    <div class="tb-card ${zoneClass}">
                        <div class="tb-tf">${tf.label}</div>
                        <div class="tb-value">${rsi.toFixed(1)}</div>
                        <div class="tb-rsi-bar">
                            <div class="tb-rsi-zones">
                                <div class="tb-zone-oversold"></div>
                                <div class="tb-zone-neutral"></div>
                                <div class="tb-zone-overbought"></div>
                            </div>
                            <div class="tb-rsi-needle" style="left: ${barPosition}%"></div>
                        </div>
                        <div class="tb-zone-label">${zoneIcon} ${zone}</div>
                    </div>`;
            }).join('');
        }

        // ── Render MACD Grid ──
        if (macdGrid) {
            macdGrid.innerHTML = results.map(tf => {
                if (!tf.macd) {
                    return `<div class="tb-card"><div class="tb-tf">${tf.label}</div><div class="tb-value" style="color:var(--text-muted)">N/A</div></div>`;
                }

                const { histogram, crossover, crossunder } = tf.macd;
                const isBullish = histogram > 0;
                const isGrowing = Math.abs(histogram) > Math.abs(tf.macd.prevHistogram);

                let signalText, signalClass, signalIcon;

                if (crossover) { signalText = 'BULLISH CROSS'; signalClass = 'tb-extreme-bottom'; signalIcon = '🟢⚡'; }
                else if (crossunder) { signalText = 'BEARISH CROSS'; signalClass = 'tb-extreme-top'; signalIcon = '🔴⚡'; }
                else if (isBullish && isGrowing) { signalText = 'BULLISH GROWING'; signalClass = 'tb-bottom'; signalIcon = '🟢↑'; }
                else if (isBullish && !isGrowing) { signalText = 'BULLISH FADING'; signalClass = 'tb-near-top'; signalIcon = '🟡↓'; }
                else if (!isBullish && isGrowing) { signalText = 'BEARISH GROWING'; signalClass = 'tb-top'; signalIcon = '🔴↓'; }
                else { signalText = 'BEARISH FADING'; signalClass = 'tb-near-bottom'; signalIcon = '🟡↑'; }

                const maxHist = 100;
                const histWidth = Math.min(Math.abs(histogram) / maxHist * 100, 100);

                return `
                    <div class="tb-card ${signalClass}">
                        <div class="tb-tf">${tf.label}</div>
                        <div class="tb-value" style="color: ${isBullish ? '#10b981' : '#ef4444'}">${histogram >= 0 ? '+' : ''}${histogram.toFixed(2)}</div>
                        <div class="tb-macd-bar">
                            <div class="tb-macd-fill ${isBullish ? 'tb-macd-bull' : 'tb-macd-bear'}" style="width: ${histWidth}%"></div>
                        </div>
                        <div class="tb-zone-label">${signalIcon} ${signalText}</div>
                    </div>`;
            }).join('');
        }

        // ── Render Volume Divergence Grid ──
        if (volDivGrid) {
            // Only show 15M through 1W for volume divergence
            const volDivTfs = results.filter(tf => TF_RELIABILITY[tf.label]);

            volDivGrid.innerHTML = volDivTfs.map(tf => {
                const rel = TF_RELIABILITY[tf.label];
                const vd = tf.volDiv;

                if (!vd || vd.type === 'none') {
                    return `
                        <div class="tb-card voldiv-card voldiv-none">
                            <div class="tb-tf">${tf.label}</div>
                            <div class="voldiv-reliability" style="color: ${rel.color}; border-color: ${rel.color}33">${rel.label}</div>
                            <div class="tb-value" style="color: var(--text-muted)">—</div>
                            <div class="voldiv-bar-container">
                                <div class="voldiv-bar"><div class="voldiv-bar-fill" style="width: 0%"></div></div>
                            </div>
                            <div class="tb-zone-label" style="color: var(--text-muted)">⚪ NO DIVERGENCE</div>
                        </div>`;
                }

                const isBullish = vd.type === 'bullish';
                const strengthLabel = vd.strength.toUpperCase();
                let cardClass, icon, color, barColor;

                if (isBullish) {
                    if (vd.strength === 'strong') { cardClass = 'tb-extreme-bottom'; icon = '🟢🔥'; }
                    else if (vd.strength === 'moderate') { cardClass = 'tb-bottom'; icon = '🟢'; }
                    else { cardClass = 'tb-near-bottom'; icon = '🟡'; }
                    color = '#10b981';
                    barColor = 'voldiv-bar-bull';
                } else {
                    if (vd.strength === 'strong') { cardClass = 'tb-extreme-top'; icon = '🔴🔥'; }
                    else if (vd.strength === 'moderate') { cardClass = 'tb-top'; icon = '🔴'; }
                    else { cardClass = 'tb-near-top'; icon = '🟡'; }
                    color = '#ef4444';
                    barColor = 'voldiv-bar-bear';
                }

                const barWidth = Math.min(vd.volDrop, 100);

                return `
                    <div class="tb-card voldiv-card ${cardClass}">
                        <div class="tb-tf">${tf.label}</div>
                        <div class="voldiv-reliability" style="color: ${rel.color}; border-color: ${rel.color}33">${rel.label}</div>
                        <div class="tb-value" style="color: ${color}">${isBullish ? 'BULL' : 'BEAR'}</div>
                        <div class="voldiv-bar-container">
                            <div class="voldiv-bar">
                                <div class="voldiv-bar-fill ${barColor}" style="width: ${barWidth}%"></div>
                            </div>
                            <div class="voldiv-bar-label">Vol ↓${vd.volDrop.toFixed(0)}%</div>
                        </div>
                        <div class="voldiv-strength-badge voldiv-strength-${vd.strength}">${strengthLabel}</div>
                        <div class="tb-zone-label">${icon} ${isBullish ? 'BULLISH' : 'BEARISH'} DIV</div>
                    </div>`;
            }).join('');
        }

        // Calculate Overall Signal (RSI + MACD + Volume Divergence)
        updateOverallSignal(results);

    } catch (error) {
        console.error('Error fetching top/bottom data:', error);
        if (rsiGrid) rsiGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Failed to load RSI data</p></div>`;
        if (macdGrid) macdGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Failed to load MACD data</p></div>`;
        if (volDivGrid) volDivGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Failed to load Volume Divergence data</p></div>`;
    }
}

// ─── Overall Signal (enhanced with Volume Divergence) ──

function updateOverallSignal(results) {
    let bottomScore = 0;
    let topScore = 0;
    let total = 0;

    results.forEach(tf => {
        if (!tf.rsi && !tf.macd) return;
        total++;

        // RSI scoring
        if (tf.rsi !== null) {
            if (tf.rsi <= 20) bottomScore += 3;
            else if (tf.rsi <= 30) bottomScore += 2;
            else if (tf.rsi <= 40) bottomScore += 1;
            else if (tf.rsi >= 80) topScore += 3;
            else if (tf.rsi >= 70) topScore += 2;
            else if (tf.rsi >= 60) topScore += 1;
        }

        // MACD scoring
        if (tf.macd) {
            if (tf.macd.crossover) bottomScore += 3;
            else if (tf.macd.histogram > 0 && Math.abs(tf.macd.histogram) > Math.abs(tf.macd.prevHistogram)) bottomScore += 1;
            if (tf.macd.crossunder) topScore += 3;
            else if (tf.macd.histogram < 0 && Math.abs(tf.macd.histogram) > Math.abs(tf.macd.prevHistogram)) topScore += 1;
        }

        // Volume Divergence scoring (weighted by timeframe reliability)
        if (tf.volDiv && tf.volDiv.type !== 'none') {
            const rel = TF_RELIABILITY[tf.label];
            let weight = 1;
            if (rel) {
                if (rel.tier === 'best') weight = 1.5;
                else if (rel.tier === 'swing') weight = 1.3;
                else if (rel.tier === 'long') weight = 1.2;
                else if (rel.tier === 'short') weight = 0.8;
            }

            let baseScore = 0;
            if (tf.volDiv.strength === 'strong') baseScore = 3;
            else if (tf.volDiv.strength === 'moderate') baseScore = 2;
            else baseScore = 1;

            const weightedScore = Math.round(baseScore * weight);

            if (tf.volDiv.type === 'bullish') bottomScore += weightedScore;
            else topScore += weightedScore;
        }
    });

    const iconEl = document.getElementById('tbOverallIcon');
    const signalEl = document.getElementById('tbOverallSignal');
    const detailEl = document.getElementById('tbOverallDetail');
    const summaryEl = document.getElementById('tbSignalSummary');
    const overallEl = document.getElementById('tbOverall');
    if (!overallEl) return;

    const maxScore = total * 9; // max 3 RSI + 3 MACD + 3 VolDiv per TF (approx)
    const bottomPct = maxScore > 0 ? (bottomScore / maxScore * 100).toFixed(0) : 0;
    const topPct = maxScore > 0 ? (topScore / maxScore * 100).toFixed(0) : 0;

    // Count volume divergences
    const volDivResults = results.filter(tf => tf.volDiv && tf.volDiv.type !== 'none' && TF_RELIABILITY[tf.label]);
    const bullDivCount = volDivResults.filter(v => v.volDiv.type === 'bullish').length;
    const bearDivCount = volDivResults.filter(v => v.volDiv.type === 'bearish').length;
    const divSuffix = ` | Bull Div: ${bullDivCount} | Bear Div: ${bearDivCount}`;

    overallEl.className = 'tb-overall';

    if (bottomScore > topScore && bottomScore >= total * 2) {
        iconEl.textContent = '🟢';
        signalEl.textContent = '⬆ POTENTIAL BOTTOM — Accumulation Zone';
        signalEl.style.color = '#10b981';
        detailEl.textContent = `Bottom: ${bottomPct}% | Top: ${topPct}%${divSuffix} — Multiple TFs oversold + bullish divergence`;
        overallEl.classList.add('tb-overall-bottom');
        summaryEl.innerHTML = '<span class="tb-summary-icon">🟢</span><span class="tb-summary-text" style="color:#10b981">BOTTOM ZONE</span>';
    } else if (topScore > bottomScore && topScore >= total * 2) {
        iconEl.textContent = '🔴';
        signalEl.textContent = '⬇ POTENTIAL TOP — Distribution Zone';
        signalEl.style.color = '#ef4444';
        detailEl.textContent = `Bottom: ${bottomPct}% | Top: ${topPct}%${divSuffix} — Multiple TFs overbought + bearish divergence`;
        overallEl.classList.add('tb-overall-top');
        summaryEl.innerHTML = '<span class="tb-summary-icon">🔴</span><span class="tb-summary-text" style="color:#ef4444">TOP ZONE</span>';
    } else if (bottomScore > topScore) {
        iconEl.textContent = '🟡';
        signalEl.textContent = '↗ SLIGHT BULLISH — Monitor for Bottom';
        signalEl.style.color = '#f59e0b';
        detailEl.textContent = `Bottom: ${bottomPct}% | Top: ${topPct}%${divSuffix}`;
        summaryEl.innerHTML = '<span class="tb-summary-icon">🟡</span><span class="tb-summary-text" style="color:#f59e0b">SLIGHT BULLISH</span>';
    } else if (topScore > bottomScore) {
        iconEl.textContent = '🟡';
        signalEl.textContent = '↘ SLIGHT BEARISH — Monitor for Top';
        signalEl.style.color = '#f59e0b';
        detailEl.textContent = `Bottom: ${bottomPct}% | Top: ${topPct}%${divSuffix}`;
        summaryEl.innerHTML = '<span class="tb-summary-icon">🟡</span><span class="tb-summary-text" style="color:#f59e0b">SLIGHT BEARISH</span>';
    } else {
        iconEl.textContent = '⚖️';
        signalEl.textContent = '↔ NEUTRAL — No Clear Signal';
        signalEl.style.color = '#94a3b8';
        detailEl.textContent = `Bottom: ${bottomPct}% | Top: ${topPct}%${divSuffix}`;
        summaryEl.innerHTML = '<span class="tb-summary-icon">⚖️</span><span class="tb-summary-text" style="color:#94a3b8">NEUTRAL</span>';
    }
}

// ─── Main Loop ────────────────────────────────

async function fetchAllData() {
    try {
        const tasks = [
            fetchFundingRate(),
            fetchLongShortRatio(),
            fetchTopBottomData(),
        ];

        if (!state.wsConnected) {
            tasks.push(fetchTicker());
        }

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

// ─── Init Page 1 ──────────────────────────────

async function init() {
    console.log('🚀 Market Maker Monitor - Dashboard starting...');

    setConnectionStatus('connecting');

    try {
        await fetchFundingHistory();
        await fetchAllData();
        console.log('✅ Dashboard data loaded');
    } catch (error) {
        console.error('❌ Error during init:', error);
        setConnectionStatus('error');
    }

    initSharedComponents();

    // Refresh all data every 10 seconds
    setInterval(fetchAllData, CONFIG.REFRESH_INTERVAL);

    // Refresh funding history every 5 minutes
    setInterval(fetchFundingHistory, 300000);
}

document.addEventListener('DOMContentLoaded', init);