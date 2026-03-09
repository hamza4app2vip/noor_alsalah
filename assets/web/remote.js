'use strict';
let token = localStorage.getItem('noor_token') || '';
let pollTimer = null;
let currentSlidesShowMode = 'AFTER_PRAYER';
let authReqId = null;

let currentSlides = [];
let activeSlideType = 'TEXT';
let selectedFile = null;
let settingsSyncTimer = null;
let activePage = 'news';

function setSlidesMode(mode) {
    currentSlidesShowMode = mode;
    updateSlidesModeButtons(mode);
    updateLiveSettings();
}

function updateSlidesModeButtons(mode) {
    const btnAfter = document.getElementById('btn-slides-after-prayer');
    const btnManual = document.getElementById('btn-slides-manual');
    if (btnAfter) btnAfter.classList.toggle('active', mode === 'AFTER_PRAYER');
    if (btnManual) btnManual.classList.toggle('active', mode === 'MANUAL');
}

// Convert Hours to Seconds for Backend
function getDurSeconds() {
    return parseInt(document.getElementById('news-duration').value) * 3600;
}

// Format Duration Display
function formatDur(hours) {
    if (hours == 1) return 'ساعة واحدة';
    if (hours == 2) return 'ساعتان';
    if (hours < 24) return hours + ' ساعات';
    const days = Math.floor(hours / 24);
    if (days == 1) return 'يوم واحد';
    if (days == 2) return 'يومان';
    if (days < 7) return days + ' أيام';
    if (days == 7) return 'أسبوع واحد';
    if (days == 14) return 'أسبوعان';
    if (days == 30) return 'شهر واحد';
    const weeks = Math.round(days / 7);
    return weeks + ' أسابيع';
}

function updateDurLabel(val) {
    document.getElementById('dur-label').textContent = formatDur(val);
}

// Handle reverse lookup (seconds to slider val)
function setDurSliderFromSeconds(sec) {
    let hrs = Math.round((sec || 86400) / 3600);
    if (hrs < 1) hrs = 1;
    if (hrs > 720) hrs = 720;
    document.getElementById('news-duration').value = hrs;
    updateDurLabel(hrs);
}

// ─── Initialization ────────────────────────────────────────────────────────
window.onload = async () => {
    showStatus('info', 'تأكد من الاتصال بنفس شبكة Wi-Fi مع الشاشة.');

    const health = await checkHealth();
    if (!health) {
        showStatus('error', 'غير متصل بالشاشة. تأكد من البقاء على نفس الشبكة المحلية.');
        document.getElementById('step-login').style.pointerEvents = 'none';
        document.getElementById('step-login').style.opacity = '0.5';
        return;
    }

    document.getElementById('step-login').style.pointerEvents = 'auto';
    document.getElementById('step-login').style.opacity = '1';

    if (token) {
        const ok = await loadNews();
        if (ok) return showApp();
        token = ''; // token invalid
        localStorage.removeItem('noor_token');
    }
};

async function checkHealth() {
    try {
        const r = await fetch('/health', { signal: AbortSignal.timeout(3000) });
        if (!r.ok) return null;
        return await r.json();
    } catch (e) { return null; }
}

// ─── Auth Flow ─────────────────────────────────────────────────────────────

async function requestLogin() {
    const username = document.getElementById('user-input').value || 'admin';
    const password = document.getElementById('pass-input').value;
    const deviceName = document.getElementById('device-input').value || 'متصفح ويب';
    const btn = document.getElementById('btn-login');

    if (!password) return showError('login', 'كلمة المرور مطلوبة');

    btn.disabled = true;
    btn.innerHTML = 'جاري الطلب... <span class="spinner" style="width:20px;height:20px;border-width:2px;margin:0 0 0 8px;display:inline-block;vertical-align:middle"></span>';
    showError('login', '');

    try {
        const r = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, deviceName })
        });
        const data = await r.json();

        if (!r.ok) {
            showError('login', data.error || 'فشل تسجيل الدخول');
            btn.disabled = false;
            btn.innerHTML = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg> تسجيل الدخول';
            return;
        }

        if (data.status === 'pending_approval' && data.requestId) {
            authReqId = data.requestId;
            document.getElementById('step-login').classList.remove('active');
            document.getElementById('step-waiting').classList.add('active');
            startPolling();
        } else if (data.token) {
            token = data.token;
            localStorage.setItem('noor_token', token);
            showApp();
        }
    } catch (e) {
        showError('login', 'خطأ في الاتصال بالشبكة');
        btn.disabled = false;
        btn.innerHTML = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg> تسجيل الدخول';
    }
}

function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
        try {
            const r = await fetch('/login/status?requestId=' + authReqId);
            const data = await r.json();

            if (r.status === 404 || r.status === 401 || data.error) {
                clearInterval(pollTimer);
                showError('wait', 'تم رفض الطلب أو انتهت صلاحيته من قبل الشاشة');
                setTimeout(() => cancelLogin(), 3000); // go back automatically
                return;
            }

            if (data.status === 'confirmed' && data.token) {
                clearInterval(pollTimer);
                token = data.token;
                localStorage.setItem('noor_token', token);
                showApp();
            }
        } catch (e) {
            console.error('Polling error', e);
        }
    }, 2000);
}

function cancelLogin() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    authReqId = null;
    showError('wait', '');
    document.getElementById('step-waiting').classList.remove('active');
    document.getElementById('btn-login').disabled = false;
    document.getElementById('btn-login').innerHTML = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg> تسجيل الدخول';
    document.getElementById('step-login').classList.add('active');
}

function showError(step, m) {
    const e = document.getElementById('auth-error-' + step);
    if (!e) return;
    e.textContent = m;
    e.style.display = m ? 'block' : 'none';
}

function showStatus(type, msg) {
    const warn = document.getElementById('net-warn');
    const msgEl = document.getElementById('net-warn-msg');
    const noteEls = document.querySelectorAll('[data-wifi-note] span');
    if (warn) {
        warn.className = 'net-warn show';
        warn.style.borderColor = type === 'error' ? 'var(--danger)' : 'rgba(220,184,129,0.35)';
    }
    if (msgEl) msgEl.textContent = msg;
    noteEls.forEach((el) => {
        el.textContent = msg;
    });
}

function switchPage(page) {
    const pages = ['news', 'settings', 'media'];
    if (!pages.includes(page)) page = 'news';

    pages.forEach((name) => {
        const panel = document.getElementById('page-' + name);
        const tab = document.getElementById('tab-' + name);
        if (panel) panel.classList.toggle('active', name === page);
        if (tab) tab.classList.toggle('active', name === page);
    });

    activePage = page;

    if (page === 'news') {
        loadNews();
    } else if (page === 'settings') {
        loadSettings();
    } else if (page === 'media') {
        loadBackgrounds();
        loadAdhanSounds();
    }
}

function showApp() {
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('main-header').style.display = 'flex';
    document.getElementById('body-nav-wrap').style.display = 'block';
    startSSE();
    switchPage('news');
}

function logout() {
    localStorage.removeItem('noor_token');
    location.reload();
}

// ─── SSE & Dashboard ────────────────────────────────────────────────────────

let sse;
function startSSE() {
    if (sse) sse.close();
    sse = new EventSource('/events?token=' + encodeURIComponent(token));
    sse.onopen = () => document.getElementById('status-dot').classList.add('live');
    sse.onerror = () => document.getElementById('status-dot').classList.remove('live');
    sse.addEventListener('news_updated', () => loadNews());
    sse.addEventListener('backgrounds_updated', () => loadBackgrounds());
    sse.addEventListener('background_uploaded', () => loadBackgrounds());
    sse.addEventListener('adhan_updated', () => loadAdhanSounds());
    sse.addEventListener('adhan_uploaded', () => loadAdhanSounds());
    sse.addEventListener('settings_updated', (event) => {
        try {
            const payload = JSON.parse(event.data || '{}');
            if (payload.settings) applySettingsToUi(payload.settings);
        } catch (e) {
            console.warn('Failed to parse settings SSE event', e);
        }
    });
}


const getSvgIcon = (type) => {
    if (type === 'daily') return '<svg class="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>';
    if (type === 'jomoa') return '<svg class="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" /></svg>';
    return '<svg class="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>';
};

async function loadNews() {
    try {
        const r = await fetch('/news', { headers: { 'Authorization': 'Bearer ' + token } });
        if (r.status === 401 || r.status === 403) {
            logout();
            return false;
        }
        if (!r.ok) return false;
        const data = await r.json();
        renderNews(data.items);
        return true;
    } catch (e) { return false; }
}

function renderNews(items) {
    const list = document.getElementById('news-list');
    const empty = document.getElementById('news-empty');
    if (!items || items.length === 0) {
        list.innerHTML = ''; empty.style.display = 'block';
        document.getElementById('header-count').style.display = 'none';
        return;
    }
    empty.style.display = 'none';
    document.getElementById('header-count').style.display = 'inline-flex';
    document.getElementById('header-count').textContent = `${items.length} رسائل`;

    list.innerHTML = items.map(item => `
<div class="news-item">
<div style="flex:1">
<div style="font-size:15px;line-height:1.6;font-weight:500;padding-bottom:10px;">${item.text}</div>
<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
  <button type="button" onclick="toggleNews('${item.id}', ${item.enabled})" class="badge ${item.enabled ? 'badge-green' : 'badge-red'}" style="cursor:pointer;border:none;font-family:inherit;padding:6px 14px;box-shadow: 0 2px 5px rgba(0,0,0,0.2);">
      ${item.enabled ? '<svg class="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" /></svg> نشط (إيقاف)' : '<svg class="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> متوقف (تفعيل)'}
  </button>
  <span class="badge badge-gold">
    ${getSvgIcon(item.scheduleType)}
    ${item.scheduleType === 'daily' ? 'يومياً' : item.scheduleType === 'jomoa' ? 'الجمعة' : item.date}
  </span>
</div>
</div>
<div style="display:flex;gap:8px;flex-direction:column">
<button type="button" class="btn-outline" style="padding:10px" onclick="openEditModal('${item.id}')">
    <svg class="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
</button>
<button type="button" class="btn-outline" style="padding:10px;color:var(--danger);border-color:rgba(239,68,68,0.2)" onclick="deleteNews('${item.id}')">
    <svg class="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
</button>
</div>
</div>
`).join('');
}

async function toggleNews(id, currentState) {
    try {
        const r = await fetch('/news', { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await r.json();
        const item = data.items.find(i => i.id === id);
        if (!item) return;

        const body = {
            text: item.text,
            scheduleType: item.scheduleType,
            date: item.date,
            displayDurationSeconds: item.displayDurationSeconds,
            enabled: !currentState
        };

        await fetch('/news/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify(body)
        });
        loadNews();
    } catch (e) { console.error('Error toggling news:', e); }
}

async function saveNews() {
    const text = document.getElementById('news-text').value;
    const id = document.getElementById('edit-id').value;
    if (!text.trim()) {
        alert("يرجى إدخال نص الإعلان");
        return;
    }

    const btn = document.querySelector('#modal .btn-gold');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'جاري الحفظ...';

    const body = {
        text,
        scheduleType: document.getElementById('news-schedule').value,
        date: document.getElementById('news-date').value,
        displayDurationSeconds: getDurSeconds(),
        enabled: true
    };

    try {
        const r = await fetch(id ? `/news/${id}` : '/news', {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify(body)
        });
        if (r.ok) { closeModal(); loadNews(); }
        else { alert('فشل الحفظ'); }
    } catch (e) {
        console.error(e);
        alert('حدث خطأ');
    }
    btn.disabled = false;
    btn.innerHTML = originalHtml;
}

async function deleteNews(id) {
    if (!confirm('هل متأكد من حذف هذه الرسالة حقاً؟')) return;
    try {
        await fetch(`/news/${id}`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } });
        loadNews();
    } catch (e) { console.error('Error deleting news:', e); }
}

function onScheduleChange() {
    document.getElementById('date-group').style.display = document.getElementById('news-schedule').value === 'date' ? 'block' : 'none';
}

function openAddModal() {
    document.getElementById('edit-id').value = '';
    document.getElementById('news-text').value = '';
    document.getElementById('news-schedule').value = 'daily';
    setDurSliderFromSeconds(86400); // 1 Day default
    onScheduleChange();
    document.getElementById('modal').classList.remove('hidden');
}

async function openEditModal(id) {
    const r = await fetch('/news', { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await r.json();
    const item = data.items.find(i => i.id === id);
    if (!item) return;

    document.getElementById('edit-id').value = id;
    document.getElementById('news-text').value = item.text;
    document.getElementById('news-schedule').value = item.scheduleType;
    document.getElementById('news-date').value = item.date || '';
    setDurSliderFromSeconds(item.displayDurationSeconds);
    onScheduleChange();
    document.getElementById('modal').classList.remove('hidden');
}

function closeModal() { document.getElementById('modal').classList.add('hidden'); }

// --- Settings Management ---
function updateKhushooBadges(settings) {
    const modeBadge = document.getElementById('status-khushoo-mode');
    const manualBadge = document.getElementById('status-khushoo-manual');

    const modeOn = !!settings.khushooModeEnabled;
    const manualOn = !!settings.isKhushooManualActive;

    modeBadge.textContent = modeOn ? 'الوضع التلقائي: مفعّل' : 'الوضع التلقائي: غير مفعّل';
    manualBadge.textContent = manualOn ? 'التحكم اليدوي: مفعّل الآن' : 'التحكم اليدوي: غير مفعّل';

    modeBadge.classList.toggle('active', modeOn);
    manualBadge.classList.toggle('active', manualOn);
}

async function loadSettings() {
    const error = document.getElementById('save-error');
    if (error) error.style.display = 'none';

    try {
        const r = await fetch('/api/settings', { headers: { 'Authorization': 'Bearer ' + token } });
        if (r.status === 401 || r.status === 403) {
            logout();
            return;
        }
        if (!r.ok) {
            throw new Error('HTTP ' + r.status);
        }

        const settings = await r.json();
        applySettingsToUi(settings);
    } catch (e) {
        console.error('Failed to load settings', e);
        if (error) {
            error.textContent = 'تعذر تحميل إعدادات برنامج الخشوع.';
            error.style.display = 'block';
        }
    }
}

function applySettingsToUi(settings) {
    document.getElementById('set-global-mute').checked = !!settings.isGlobalAudioMuted;
    document.getElementById('set-azan-mute').checked = !!settings.isAzanAudioMuted;
    document.getElementById('set-khushoo-enabled').checked = !!settings.khushooModeEnabled;

    const duration = Number.isFinite(Number(settings.khushooModeDuration))
        ? Math.min(60, Math.max(1, Number(settings.khushooModeDuration)))
        : 5;
    document.getElementById('set-khushoo-duration').value = duration;
    document.getElementById('khushoo-dur-label').textContent = duration + ' دقيقة';
    document.getElementById('set-khushoo-manual').checked = !!settings.isKhushooManualActive;

    const slidesEnabled = !!settings.slidesEnabled;
    document.getElementById('set-slides-enabled').checked = slidesEnabled;
    document.getElementById('slides-config-container').style.display = slidesEnabled ? 'block' : 'none';

    document.getElementById('set-slides-shuffle').checked = !!settings.slidesShuffle;

    const slideDur = settings.slideDurationSeconds || 15;
    document.getElementById('set-slide-duration').value = slideDur;
    document.getElementById('slide-dur-label').textContent = slideDur + ' ثانية';

    const mainDur = settings.mainScreenDurationSeconds || 12;
    document.getElementById('set-main-duration').value = mainDur;
    document.getElementById('main-dur-label').textContent = mainDur + ' ثانية';

    currentSlides = settings.slidesList || [];
    currentSlidesShowMode = settings.slidesShowMode || 'AFTER_PRAYER';
    updateSlidesModeButtons(currentSlidesShowMode);
    renderSlides();

    document.getElementById('khushoo-duration-container').style.display = settings.khushooModeEnabled ? 'block' : 'none';
    updateKhushooBadges(settings);
}

async function updateLiveSettings() {
    const isEnabled = document.getElementById('set-khushoo-enabled').checked;
    const slidesEnabled = document.getElementById('set-slides-enabled').checked;
    document.getElementById('khushoo-duration-container').style.display = isEnabled ? 'block' : 'none';
    document.getElementById('slides-config-container').style.display = slidesEnabled ? 'block' : 'none';

    const settings = {
        isGlobalAudioMuted: document.getElementById('set-global-mute').checked,
        isAzanAudioMuted: document.getElementById('set-azan-mute').checked,
        khushooModeEnabled: isEnabled,
        khushooModeDuration: parseInt(document.getElementById('set-khushoo-duration').value, 10),
        isKhushooManualActive: document.getElementById('set-khushoo-manual').checked,
        slidesEnabled: slidesEnabled,
        slidesShuffle: document.getElementById('set-slides-shuffle').checked,
        slideDurationSeconds: parseInt(document.getElementById('set-slide-duration').value, 10),
        mainScreenDurationSeconds: parseInt(document.getElementById('set-main-duration').value, 10),
        slidesShowMode: currentSlidesShowMode,
        slidesList: currentSlides
    };

    const indicator = document.getElementById('save-indicator');
    const error = document.getElementById('save-error');

    clearTimeout(settingsSyncTimer);
    if (error) error.style.display = 'none';
    if (indicator) {
        indicator.className = 'sync-indicator pending';
        indicator.style.display = 'inline-flex';
        indicator.textContent = 'جاري المزامنة...';
    }

    try {
        const r = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify(settings)
        });

        if (!r.ok) {
            const body = await r.text();
            throw new Error(body || ('HTTP ' + r.status));
        }

        const result = await r.json();
        if (result.settings) {
            applySettingsToUi(result.settings);
        } else {
            applySettingsToUi(settings);
        }

        if (indicator) {
            indicator.className = 'sync-indicator ok';
            indicator.style.display = 'inline-flex';
            indicator.textContent = 'تمت المزامنة الفورية';
            settingsSyncTimer = setTimeout(() => {
                indicator.style.display = 'none';
            }, 1500);
        }
    } catch (e) {
        console.error('Failed to sync settings', e);
        if (indicator) indicator.style.display = 'none';
        if (error) {
            error.textContent = 'فشل إرسال التعديل إلى الشاشة.';
            error.style.display = 'block';
        }
    }
}

// --- Media Management (Backgrounds & Adhan) ---
async function loadBackgrounds() {
    try {
        const r = await fetch('/api/backgrounds', { headers: { 'Authorization': 'Bearer ' + token } });
        if (!r.ok) return;
        const data = await r.json();
        renderBackgrounds(data.backgrounds || []);
    } catch (e) { console.error('Failed to load backgrounds', e); }
}

function renderBackgrounds(list) {
    const grid = document.getElementById('bg-grid');
    const empty = document.getElementById('bg-empty');
    if (!list || list.length === 0) {
        grid.innerHTML = '';
        empty.style.display = 'block';
        return;
    }

    empty.style.display = 'none';
    grid.innerHTML = list.map(bg => {
        const fileName = bg.fileName || bg.name || '';
        return `
        <div class="media-thumb">
            <img src="${bg.url}" alt="${fileName}">
            <button onclick="deleteBackground('${fileName}')" class="media-delete" title="حذف">&times;</button>
        </div>
    `;
    }).join('');
}

async function uploadBackground(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const status = document.getElementById('bg-upload-status');
    const progress = document.getElementById('bg-progress-container');
    const bar = document.getElementById('bg-progress-fill');

    status.textContent = 'جاري الرفع...';
    status.style.display = 'block';
    progress.style.display = 'block';
    bar.style.width = '0%';

    try {
        await uploadFile(file, '/api/backgrounds/upload', (p) => {
            bar.style.width = p + '%';
        });
        status.textContent = 'تم الرفع بنجاح';
        loadBackgrounds();
        setTimeout(() => { status.style.display = 'none'; progress.style.display = 'none'; }, 2000);
    } catch (e) {
        status.textContent = 'فشل الرفع: ' + e.message;
        setTimeout(() => { status.style.display = 'none'; progress.style.display = 'none'; }, 4000);
    }
    input.value = '';
}

async function deleteBackground(name) {
    if (!name) return;
    if (!confirm('هل متأكد من حذف هذه الخلفية؟')) return;
    try {
        await fetch('/api/backgrounds/' + encodeURIComponent(name), {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token }
        });
        loadBackgrounds();
    } catch (e) {
        console.error('Failed to delete background', e);
    }
}

async function loadAdhanSounds() {
    try {
        const r = await fetch('/api/adhan', { headers: { 'Authorization': 'Bearer ' + token } });
        if (r.status === 401 || r.status === 403) {
            logout();
            return;
        }
        if (!r.ok) return;
        const data = await r.json();
        renderAdhanSounds(data.adhan || []);
    } catch (e) {
        console.error('Failed to load adhan sounds', e);
    }
}

function renderAdhanSounds(list) {
    const el = document.getElementById('adhan-list');
    const empty = document.getElementById('adhan-empty');
    if (!list || list.length === 0) {
        el.innerHTML = '';
        empty.style.display = 'block';
        return;
    }

    empty.style.display = 'none';
    el.innerHTML = list.map(s => {
        const fileName = s.fileName || s.name || '';
        return `
        <div class="pure-glass media-row">
            <span class="media-name">${fileName}</span>
            <button onclick="deleteAdhan('${fileName}')" class="media-delete-text">حذف</button>
        </div>
    `;
    }).join('');
}

async function uploadAdhan(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const status = document.getElementById('adhan-upload-status');
    const progress = document.getElementById('adhan-progress-container');
    const bar = document.getElementById('adhan-progress-fill');

    status.textContent = 'جاري الرفع...';
    status.style.display = 'block';
    progress.style.display = 'block';
    bar.style.width = '0%';

    try {
        await uploadFile(file, '/api/adhan/upload', (p) => {
            bar.style.width = p + '%';
        });
        status.textContent = 'تم الرفع بنجاح';
        loadAdhanSounds();
        setTimeout(() => { status.style.display = 'none'; progress.style.display = 'none'; }, 2000);
    } catch (e) {
        status.textContent = 'فشل الرفع: ' + e.message;
        setTimeout(() => { status.style.display = 'none'; progress.style.display = 'none'; }, 4000);
    }
    input.value = '';
}

async function deleteAdhan(name) {
    if (!name) return;
    if (!confirm('هل متأكد من حذف صوت الأذان هذا؟')) return;
    try {
        await fetch('/api/adhan/' + encodeURIComponent(name), {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token }
        });
        loadAdhanSounds();
    } catch (e) {
        console.error('Failed to delete adhan sound', e);
    }
}

function uploadFile(file, url, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
                const percent = Math.round((e.loaded / e.total) * 100);
                onProgress(percent);
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {});
                } catch (_) {
                    resolve({});
                }
            } else {
                reject(new Error('Upload failed with status ' + xhr.status));
            }
        };

        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(file);
    });
}

// --- Slides Management ---
function renderSlides() {
    const list = document.getElementById('slides-list');
    if (!list) return;
    if (currentSlides.length === 0) {
        list.innerHTML = '<p style="text-align:center;color:var(--sub);font-size:12px;padding:20px">لا توجد شرائح مضافة</p>';
        return;
    }

    list.innerHTML = currentSlides.map(s => `
        <div class="pure-glass" style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:10px;margin-bottom:10px;border-right:4px solid ${s.enabled ? 'var(--gold)' : 'var(--danger)'}">
            <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:700;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                    ${s.type === 'TEXT' ? s.content : (s.type === 'FILE' ? 'صورة: ' + s.content.split('/').pop() : 'رابط: ' + s.content)}
                </div>
                <div style="font-size:11px;color:var(--sub)">نوع: ${s.type === 'TEXT' ? 'نص' : (s.type === 'FILE' ? 'صورة مرفوعة' : 'رابط خارجي')}</div>
            </div>
            <div style="display:flex;gap:6px">
                <button class="btn-outline" style="padding:4px 8px;font-size:11px" onclick="toggleSlide('${s.id}', ${s.enabled})">${s.enabled ? 'تعطيل' : 'تفعيل'}</button>
                <button class="btn-outline" style="padding:4px 8px;font-size:11px;color:var(--danger)" onclick="deleteSlide('${s.id}')">حذف</button>
            </div>
        </div>
    `).join('');
}

function openSlideModal(id = null) {
    document.getElementById('slide-edit-id').value = id || '';
    if (!id) {
        setSlideType('TEXT');
        document.getElementById('slide-text').value = '';
        document.getElementById('slide-link').value = '';
        document.getElementById('file-name-label').textContent = 'اضغط لاختيار صورة من جهازك';
        document.getElementById('slide-modal-title').textContent = 'إضافة شريحة جديدة';
    } else {
        const s = currentSlides.find(x => x.id === id);
        if (s) {
            setSlideType(s.type);
            if (s.type === 'TEXT') document.getElementById('slide-text').value = s.content;
            else if (s.type === 'LINK') {
                document.getElementById('slide-link').value = s.content;
                previewUrlImage(s.content);
            }
            document.getElementById('slide-modal-title').textContent = 'تعديل الشريحة';
        }
    }
    document.getElementById('modal-slide').classList.remove('hidden');
}

function closeSlideModal() { document.getElementById('modal-slide').classList.add('hidden'); }

function setSlideType(type) {
    activeSlideType = type;
    document.querySelectorAll('.type-opt').forEach(opt => opt.classList.remove('active'));
    document.getElementById('opt-' + type).classList.add('active');

    document.getElementById('slide-content-text').style.display = type === 'TEXT' ? 'block' : 'none';
    document.getElementById('slide-content-file').style.display = type === 'FILE' ? 'block' : 'none';
    document.getElementById('slide-content-link').style.display = type === 'LINK' ? 'block' : 'none';
}

function onFileSelected(input) {
    if (input.files && input.files[0]) {
        selectedFile = input.files[0];
        document.getElementById('file-name-label').textContent = 'الملف: ' + selectedFile.name;
    }
}

function previewUrlImage(url) {
    const preview = document.getElementById('url-preview');
    const img = document.getElementById('url-preview-img');
    if (url && (url.startsWith('http') || url.startsWith('https'))) {
        img.src = url;
        preview.style.display = 'flex';
    } else {
        preview.style.display = 'none';
    }
}

async function saveSlide() {
    const id = document.getElementById('slide-edit-id').value;
    let content = '';

    if (activeSlideType === 'TEXT') {
        content = document.getElementById('slide-text').value;
        if (!content.trim()) return alert('يرجى إدخال النص');
    } else if (activeSlideType === 'LINK') {
        content = document.getElementById('slide-link').value;
        if (!content.trim()) return alert('يرجى إدخال الرابط');
    } else if (activeSlideType === 'FILE') {
        if (!id && !selectedFile) return alert('يرجى اختيار ملف صورة');
        if (selectedFile) {
            const btn = document.getElementById('btn-save-slide');
            const status = document.getElementById('upload-status');
            const progress = document.getElementById('upload-progress-container');
            const bar = document.getElementById('upload-progress-fill');

            btn.disabled = true;
            status.textContent = 'جاري رفع الصورة...';
            status.style.display = 'block';
            progress.style.display = 'block';
            bar.style.width = '0%';

            try {
                const result = await uploadFile(selectedFile, '/api/upload', (p) => {
                    bar.style.width = p + '%';
                });
                content = result.url || ('/slides/' + encodeURIComponent(selectedFile.name));
                selectedFile = null;
            } catch (e) {
                alert('فشل رفع الصورة');
                btn.disabled = false;
                return;
            }
            btn.disabled = false;
        } else {
            const old = currentSlides.find((x) => x.id === id);
            content = old ? old.content : '';
        }
    }

    const existing = currentSlides.find((x) => x.id === id);
    const slide = {
        id: id || ('slide_' + Date.now()),
        type: activeSlideType,
        content,
        enabled: existing ? !!existing.enabled : true
    };

    if (id) {
        currentSlides = currentSlides.map((s) => (s.id === id ? slide : s));
    } else {
        currentSlides = [slide, ...currentSlides];
    }

    renderSlides();
    closeSlideModal();
    await updateLiveSettings();
}

async function deleteSlide(id) {
    if (!confirm('حذف هذه الشريحة؟')) return;
    currentSlides = currentSlides.filter((s) => s.id !== id);
    renderSlides();
    await updateLiveSettings();
}

async function toggleSlide(id, currentState) {
    currentSlides = currentSlides.map((s) => {
        if (s.id !== id) return s;
        return { ...s, enabled: !currentState };
    });
    renderSlides();
    await updateLiveSettings();
}


