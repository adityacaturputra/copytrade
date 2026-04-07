/* ========================================
   BTC Market Maker Monitor - Shared Utils
   ======================================== */

// ─── Configuration ────────────────────────────
const CONFIG = {
    BINANCE_API: 'https://fapi.binance.com',
    BINANCE_WS: 'wss://fstream.binance.com/ws',
    REFRESH_INTERVAL: 10000,      // 10 seconds for REST data
    PRICE_REFRESH_INTERVAL: 1000, // 1 second fallback for price
    FUNDING_HISTORY_COUNT: 100,
    CHART_BARS: 100,
};

// ─── Shared State ─────────────────────────────
const state = {
    currentPrice: 0,
    previousFundingRate: null,
    currentFundingRate: null,
    fundingHistory: [],
    signalHistory: [],
    isConnected: false,
    chart: null,
    previousDominance: null,
    isFirstLoad: true,
    ws: null,
    wsReconnectTimer: null,
    wsConnected: false,
    lastWsUpdate: 0,
    priceFlashTimer: null,
};

// ─── Utility Functions ────────────────────────
function formatPrice(price) {
    return parseFloat(price).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function formatFundingRate(rate) {
    return (parseFloat(rate) * 100).toFixed(4) + '%';
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour12: false });
}

function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

function formatVolume(vol) {
    const num = parseFloat(vol);
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K BTC';
    return num.toFixed(2) + ' BTC';
}

function formatRelativeTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'Baru saja';
    if (minutes < 60) return `${minutes} menit lalu`;
    if (hours < 24) return `${hours} jam lalu`;
    if (days === 1) return 'Kemarin';
    if (days < 7) return `${days} hari lalu`;
    if (days < 30) return `${Math.floor(days / 7)} minggu lalu`;
    return `${Math.floor(days / 30)} bulan lalu`;
}

function formatDuration(startTime, endTime) {
    const diff = endTime - startTime;
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;

    if (hours < 1) return 'Kurang dari 1 jam';
    if (hours < 24) return `${hours} jam`;
    if (remainingHours === 0) return `${days} hari`;
    return `${days} hari ${remainingHours} jam`;
}

// ─── Connection Status ────────────────────────
function setConnectionStatus(status) {
    const connEl = document.getElementById('connectionStatus');
    if (!connEl) return;
    const dot = connEl.querySelector('.status-dot');
    const text = connEl.querySelector('.status-text');
    dot.className = 'status-dot ' + status;
    if (status === 'connected') {
        text.textContent = 'Connected';
        state.isConnected = true;
    } else if (status === 'error') {
        text.textContent = 'Error';
        state.isConnected = false;
    } else {
        text.textContent = 'Connecting...';
    }
}

// ─── Price Display ────────────────────────────
function updatePriceDisplay(data) {
    const btcPriceEl = document.getElementById('btcPrice');
    const priceChangeEl = document.getElementById('priceChange');
    const highPriceEl = document.getElementById('highPrice');
    const lowPriceEl = document.getElementById('lowPrice');
    const volume24hEl = document.getElementById('volume24h');

    if (!btcPriceEl) return;

    const newPrice = parseFloat(data.lastPrice || data.c);
    const oldPrice = state.currentPrice;
    state.currentPrice = newPrice;

    btcPriceEl.textContent = formatPrice(newPrice);

    if (oldPrice > 0 && oldPrice !== newPrice) {
        const flashClass = newPrice > oldPrice ? 'price-flash-up' : 'price-flash-down';
        btcPriceEl.classList.remove('price-flash-up', 'price-flash-down');
        void btcPriceEl.offsetWidth;
        btcPriceEl.classList.add(flashClass);
        if (state.priceFlashTimer) clearTimeout(state.priceFlashTimer);
        state.priceFlashTimer = setTimeout(() => {
            btcPriceEl.classList.remove('price-flash-up', 'price-flash-down');
        }, 600);
    }

    const highPrice = data.highPrice || data.h;
    const lowPrice = data.lowPrice || data.l;
    const volume = data.volume || data.v;

    if (highPrice && highPriceEl) highPriceEl.textContent = '$' + formatPrice(highPrice);
    if (lowPrice && lowPriceEl) lowPriceEl.textContent = '$' + formatPrice(lowPrice);
    if (volume && volume24hEl) volume24hEl.textContent = formatVolume(volume);

    if (priceChangeEl) {
        const changePercent = parseFloat(data.priceChangePercent || data.P || 0);
        const changeVal = priceChangeEl.querySelector('.change-value');
        if (changeVal) {
            changeVal.textContent = (changePercent >= 0 ? '+' : '') + changePercent.toFixed(2) + '%';
            priceChangeEl.className = 'price-change ' + (changePercent >= 0 ? 'positive' : 'negative');
        }
    }
}

// ─── WebSocket Real-Time Price ────────────────
function connectWebSocket() {
    if (state.ws) {
        state.ws.close();
        state.ws = null;
    }

    console.log('🔌 Connecting to Binance WebSocket...');

    try {
        state.ws = new WebSocket(`${CONFIG.BINANCE_WS}/btcusdt@ticker`);

        state.ws.onopen = () => {
            console.log('✅ WebSocket connected');
            state.wsConnected = true;
            setConnectionStatus('connected');
        };

        state.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                state.lastWsUpdate = Date.now();

                updatePriceDisplay({
                    lastPrice: data.c,
                    highPrice: data.h,
                    lowPrice: data.l,
                    volume: data.v,
                    priceChangePercent: data.P,
                });

                const lastUpdateEl = document.getElementById('lastUpdate');
                if (lastUpdateEl) lastUpdateEl.textContent = 'LIVE • ' + formatTime(Date.now());
            } catch (e) {
                console.error('WebSocket parse error:', e);
            }
        };

        state.ws.onclose = () => {
            console.warn('⚠️ WebSocket disconnected, reconnecting in 3s...');
            state.wsConnected = false;
            setConnectionStatus('connecting');
            if (state.wsReconnectTimer) clearTimeout(state.wsReconnectTimer);
            state.wsReconnectTimer = setTimeout(connectWebSocket, 3000);
        };

        state.ws.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            state.wsConnected = false;
            setConnectionStatus('error');
        };
    } catch (error) {
        console.error('Failed to create WebSocket:', error);
        setInterval(fetchTicker, CONFIG.PRICE_REFRESH_INTERVAL);
    }
}

// ─── REST Fallback for Price ──────────────────
async function fetchTicker() {
    try {
        const response = await fetch(`${CONFIG.BINANCE_API}/fapi/v1/ticker/24hr?symbol=BTCUSDT`);
        if (!response.ok) throw new Error('Ticker API error');
        const data = await response.json();
        updatePriceDisplay(data);
        return data;
    } catch (error) {
        console.error('Error fetching ticker:', error);
        return null;
    }
}

// ─── Funding History Data ─────────────────────
async function fetchFundingHistoryData() {
    try {
        const response = await fetch(
            `${CONFIG.BINANCE_API}/fapi/v1/fundingRate?symbol=BTCUSDT&limit=${CONFIG.FUNDING_HISTORY_COUNT}`
        );
        if (!response.ok) throw new Error('Funding history API error');
        const data = await response.json();
        state.fundingHistory = data.map(item => ({
            time: item.fundingTime,
            rate: parseFloat(item.fundingRate),
        }));
        return state.fundingHistory;
    } catch (error) {
        console.error('Error fetching funding history:', error);
        return null;
    }
}

// ─── Toast Notifications ──────────────────────
function showToast(type, title, message) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'short' ? '🔴' : '🟢';

    toast.innerHTML = `
        <div class="toast-icon">${icon}</div>
        <div class="toast-body">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.classList.add('toast-exit'); setTimeout(() => this.parentElement.remove(), 400)">✕</button>
        <div class="toast-progress"></div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('toast-exit');
            setTimeout(() => toast.remove(), 400);
        }
    }, 8000);

    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        oscillator.connect(gain);
        gain.connect(audioCtx.destination);
        oscillator.frequency.value = type === 'short' ? 440 : 660;
        gain.gain.value = 0.1;
        oscillator.start();
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
        oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) { /* ignore audio errors */ }
}

function sendBrowserNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '📊', badge: '📊' });
    }
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// ─── Countdown Timer ──────────────────────────
let countdownInterval = null;

function updateCountdown(nextFundingTime) {
    if (countdownInterval) clearInterval(countdownInterval);
    const el = document.getElementById('nextFunding');
    if (!el) return;

    const tick = () => {
        const now = Date.now();
        const diff = nextFundingTime - now;

        if (diff <= 0) {
            el.textContent = 'Now!';
            el.style.color = '#f59e0b';
            clearInterval(countdownInterval);
            return;
        }

        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);

        el.textContent =
            String(hours).padStart(2, '0') + ':' +
            String(minutes).padStart(2, '0') + ':' +
            String(seconds).padStart(2, '0');
        el.style.color = diff < 300000 ? '#f59e0b' : '#94a3b8';
    };

    tick();
    countdownInterval = setInterval(tick, 1000);
}

// ─── Init Shared Components ───────────────────
function initSharedComponents() {
    requestNotificationPermission();
    connectWebSocket();

    // WebSocket health check
    setInterval(() => {
        if (state.wsConnected && Date.now() - state.lastWsUpdate > 5000) {
            console.warn('⚠️ WebSocket stale, reconnecting...');
            connectWebSocket();
        }
    }, 5000);

    // REST fallback
    setInterval(() => {
        if (!state.wsConnected) fetchTicker();
    }, CONFIG.PRICE_REFRESH_INTERVAL);
}