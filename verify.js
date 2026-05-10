/* ── KutKing Barber Dashboard — zero credentials here ── */

const API = '/.netlify/functions/api';

async function api(action, payload = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  return res.json();
}

/* ════════════════════════════════════
   PIN LOGIC
════════════════════════════════════ */
let pinEntry = '';

function pinPress(digit) {
  if (pinEntry.length >= 4) return;
  pinEntry += digit;
  updateDots();
  if (pinEntry.length === 4) setTimeout(checkPin, 120);
}

function pinDel() {
  pinEntry = pinEntry.slice(0, -1);
  updateDots();
  document.getElementById('pinErr').textContent = '';
}

function updateDots(state) {
  for (let i = 0; i < 4; i++) {
    const d = document.getElementById('d' + i);
    d.className = 'pin-dot';
    if (state === 'error') d.classList.add('error');
    else if (i < pinEntry.length) d.classList.add('filled');
  }
}

async function checkPin() {
  const { ok } = await api('verify_pin', { pin: pinEntry });
  if (ok) {
    document.getElementById('pinScreen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    sessionStorage.setItem('kk_auth', '1');
    initDashboard();
  } else {
    updateDots('error');
    document.getElementById('pinErr').textContent = 'Incorrect PIN. Try again.';
    setTimeout(() => { pinEntry = ''; updateDots(); document.getElementById('pinErr').textContent = ''; }, 1000);
  }
}

function lockDashboard() {
  sessionStorage.removeItem('kk_auth');
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('pinScreen').style.display = 'flex';
  pinEntry = ''; updateDots();
}

// Stay unlocked on page refresh within same session
if (sessionStorage.getItem('kk_auth') === '1') {
  document.getElementById('pinScreen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  document.addEventListener('DOMContentLoaded', initDashboard);
}

/* ════════════════════════════════════
   TOAST
════════════════════════════════════ */
function toast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => { t.className = 'toast'; }, 3000);
}

/* ════════════════════════════════════
   TABS
════════════════════════════════════ */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active', ['verify', 'bookings'][i] === name);
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  if (name === 'bookings') loadBookings();
}

/* ════════════════════════════════════
   INIT
════════════════════════════════════ */
async function initDashboard() {
  await loadStats();
  await loadTodaySchedule();
  document.getElementById('filterDate').value = new Date().toISOString().split('T')[0];
}

/* ════════════════════════════════════
   STATS
════════════════════════════════════ */
async function loadStats() {
  const s = await api('get_stats');
  document.getElementById('statToday').textContent   = s.today    ?? '—';
  document.getElementById('statPending').textContent = s.pending  ?? '—';
  document.getElementById('statTotal').textContent   = s.total    ?? '—';
  document.getElementById('statFree').textContent    = s.freeCuts ?? '—';
}

/* ════════════════════════════════════
   TODAY'S SCHEDULE
════════════════════════════════════ */
async function loadTodaySchedule() {
  const { bookings } = await api('get_today');
  const list = document.getElementById('todayList');
  if (!bookings || bookings.length === 0) {
    list.innerHTML = '<div class="empty-state">No bookings today.</div>'; return;
  }
  list.innerHTML = bookings.map(b => `
    <div style="display:flex;align-items:center;justify-content:space-between;
                background:rgba(255,255,255,.03);border:1px solid rgba(200,151,58,.12);
                border-radius:6px;padding:12px 16px;gap:12px;flex-wrap:wrap;">
      <div>
        <div style="font-family:'Space Mono',monospace;font-size:13px;font-weight:700;color:var(--gold);">${b.barber_id}</div>
        <div style="font-size:13px;margin-top:2px;">${b.name} · ${b.time}</div>
        <div style="font-size:11px;color:rgba(245,239,227,.4);margin-top:2px;">${b.style}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="status-chip ${b.verified ? 'verified' : 'pending'}">${b.verified ? '✔ Done' : 'Pending'}</span>
        ${!b.verified ? `<button class="tbl-verify-btn" onclick="quickVerify('${b.barber_id}','${b.id}',this)">Verify</button>` : ''}
      </div>
    </div>
  `).join('');
}

/* ════════════════════════════════════
   LOOKUP CLIENT
════════════════════════════════════ */
async function lookupClient() {
  const id = document.getElementById('lookupId').value.trim().toUpperCase();
  if (!id) { toast('Enter a Barber ID first.', 'error'); return; }

  const { points, found } = await api('lookup_client', { barber_id: id });
  const pts = points || 0;
  const pct = Math.min((pts / 80) * 100, 100);

  document.getElementById('rId').textContent  = id;
  document.getElementById('rPts').textContent = pts + ' / 80';
  document.getElementById('rBar').style.width = pct + '%';

  if (pts >= 80) {
    document.getElementById('lookupFreeBadge').style.display = 'block';
    document.getElementById('btnRedeem').style.display = 'block';
    document.getElementById('btnVerify').style.display = 'none';
  } else {
    document.getElementById('lookupFreeBadge').style.display = 'none';
    document.getElementById('btnRedeem').style.display = 'none';
    document.getElementById('btnVerify').style.display = 'block';
  }

  if (!found) toast('New client — no points record yet. Verify their cut to start their points.', 'success');
  document.getElementById('lookupResult').classList.add('show');
}

/* ════════════════════════════════════
   VERIFY CUT (+20 pts)
════════════════════════════════════ */
async function verifyAndAddPoints() {
  const id = document.getElementById('lookupId').value.trim().toUpperCase();
  if (!id) return;
  const btn = document.getElementById('btnVerify');
  btn.disabled = true; btn.textContent = 'Saving…';

  const { points } = await api('verify_cut', { barber_id: id });
  toast(`✔ Cut verified! ${id} now has ${points} points.`);
  document.getElementById('rPts').textContent = points + ' / 80';
  document.getElementById('rBar').style.width = Math.min((points / 80) * 100, 100) + '%';

  if (points >= 80) {
    document.getElementById('lookupFreeBadge').style.display = 'block';
    document.getElementById('btnRedeem').style.display = 'block';
    document.getElementById('btnVerify').style.display = 'none';
  }

  btn.disabled = false; btn.textContent = '✔ Verify Cut (+20 pts)';
  await loadStats(); await loadTodaySchedule();
}

/* ════════════════════════════════════
   REDEEM FREE CUT (reset to 0)
════════════════════════════════════ */
async function redeemFreeCut() {
  const id = document.getElementById('lookupId').value.trim().toUpperCase();
  if (!id) return;
  if (!confirm(`Redeem free cut for ${id}? This resets their points to 0.`)) return;

  await api('redeem_cut', { barber_id: id });
  toast(`🎁 Free cut redeemed! ${id} points reset to 0.`);
  document.getElementById('rPts').textContent = '0 / 80';
  document.getElementById('rBar').style.width = '0%';
  document.getElementById('lookupFreeBadge').style.display = 'none';
  document.getElementById('btnRedeem').style.display = 'none';
  document.getElementById('btnVerify').style.display = 'block';
  await loadStats();
}

/* ════════════════════════════════════
   QUICK VERIFY from today's list
════════════════════════════════════ */
async function quickVerify(barberId, bookingId, btn) {
  btn.disabled = true; btn.textContent = '…';
  const { points } = await api('verify_cut', { barber_id: barberId, booking_id: bookingId });
  toast(`✔ ${barberId} verified — ${points} pts`);
  await loadStats(); await loadTodaySchedule();
}

/* ════════════════════════════════════
   ALL BOOKINGS TABLE
════════════════════════════════════ */
async function loadBookings() {
  const date   = document.getElementById('filterDate').value;
  const status = document.getElementById('filterStatus').value;
  const search = document.getElementById('filterSearch').value.trim();

  const { bookings } = await api('get_bookings', { date, status, search });
  const rows = bookings || [];
  const tbody = document.getElementById('bookingsBody');

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No bookings found.</td></tr>'; return;
  }

  tbody.innerHTML = rows.map(b => `
    <tr>
      <td><span class="id-chip">${b.barber_id}</span></td>
      <td>${b.name || '—'}</td>
      <td>${b.phone || '—'}</td>
      <td>${b.style || '—'}</td>
      <td>${b.date || '—'}</td>
      <td>${b.time || '—'}</td>
      <td><span class="status-chip ${b.verified ? 'verified' : 'pending'}">${b.verified ? '✔ Verified' : 'Pending'}</span></td>
      <td>${!b.verified
        ? `<button class="tbl-verify-btn" onclick="quickVerify('${b.barber_id}','${b.id}',this)">Verify</button>`
        : '<span style="font-size:11px;color:rgba(245,239,227,.3);">Done</span>'
      }</td>
    </tr>
  `).join('');
}
