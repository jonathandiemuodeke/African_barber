/* ── KutKing client app — zero credentials here ── */

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
   EMAILJS — client-side email to barber
   Replace the 3 values below with yours
════════════════════════════════════ */
const EMAILJS_PUBLIC_KEY  = 'M2ezCZib4X9WEuPIv'; 
const EMAILJS_SERVICE_ID  = 'service_714gejb';  
const EMAILJS_TEMPLATE_ID = 'template_y35jq2m'; 

(function initEmailJS() {
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
  s.onload = () => emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
  document.head.appendChild(s);
})();

/* ════════════════════════════════════
   BARBER ID — new or returning client
════════════════════════════════════ */
function genId() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'CUT-';
  for (let i = 0; i < 4; i++) id += c[Math.floor(Math.random() * c.length)];
  return id;
}

// Only used for brand-new clients
const newId = genId();
let activeId = newId; // will be overridden if returning client enters their ID

// Show the new ID immediately for first-time clients
document.getElementById('barberIdDisplay').textContent = newId;
document.getElementById('fdate').min = new Date().toISOString().split('T')[0];

/* ── Toggle: new vs returning client ── */
function setClientMode(mode) {
  const isNew = mode === 'new';
  document.getElementById('newClientBlock').style.display   = isNew ? 'block' : 'none';
  document.getElementById('returnClientBlock').style.display = isNew ? 'none'  : 'block';
  document.getElementById('btnNew').classList.toggle('active', isNew);
  document.getElementById('btnReturn').classList.toggle('active', !isNew);
  activeId = isNew ? newId : '';
}

// Update activeId live as returning client types their ID
document.getElementById('existingId').addEventListener('input', function () {
  activeId = this.value.trim().toUpperCase();
});

/* ════════════════════════════════════
   TIME SLOTS
════════════════════════════════════ */
const WEEKDAY_TIMES = ['19:00','19:30','20:00','20:30','21:00','21:30','22:00'];
const WEEKEND_TIMES = [
  '09:00','09:30','10:00','10:30','11:00','11:30',
  '12:00','12:30','13:00','13:30','14:00','14:30',
  '15:00','15:30','16:00','16:30','17:00','17:30',
  '18:00','18:30','19:00','19:30','20:00','20:30','21:00','21:30','22:00'
];

function getTimesForDate(dateStr) {
  if (!dateStr) return [];
  const day = new Date(dateStr).getDay();
  return (day === 0 || day === 6) ? WEEKEND_TIMES : WEEKDAY_TIMES;
}

function populateTimes(dateStr) {
  const sel = document.getElementById('ftime');
  const times = getTimesForDate(dateStr);
  if (!times.length) { sel.innerHTML = '<option value="">— Pick a date first —</option>'; return; }
  const isWeekend = [0,6].includes(new Date(dateStr).getDay());
  sel.innerHTML = `<option value="">— ${isWeekend ? 'Any hour (pick one)' : 'Evening (19:00–22:00)'} —</option>`;
  times.forEach(t => {
    const o = document.createElement('option');
    o.value = t; o.textContent = t; sel.appendChild(o);
  });
}

document.getElementById('fdate').addEventListener('change', function () {
  populateTimes(this.value);
});

/* ════════════════════════════════════
   PHONE VALIDATION
════════════════════════════════════ */
document.getElementById('fphone').addEventListener('input', function () {
  this.value = this.value.replace(/[^\d+\s\-]/g, '');
});
document.getElementById('fphone').addEventListener('keypress', function (e) {
  if (!/[\d+\s\-]/.test(e.key) && e.key.length === 1) e.preventDefault();
});

/* ════════════════════════════════════
   SUBMIT BOOKING
════════════════════════════════════ */
async function submitBooking() {
  const name  = document.getElementById('fname').value.trim();
  const phone = document.getElementById('fphone').value.trim();
  const style = document.getElementById('fstyle').value;
  const date  = document.getElementById('fdate').value;
  const time  = document.getElementById('ftime').value;
  const notes = document.getElementById('fnotes').value.trim();

  // Validate fields
  if (!name || !phone || !style || !date || !time) {
    alert('Please fill in all required fields.'); return;
  }
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    alert('Please enter a valid phone number (7–15 digits).'); return;
  }

  // Validate returning client ID
  const isReturning = document.getElementById('returnClientBlock').style.display !== 'none';
  if (isReturning && activeId.length < 8) {
    alert('Please enter your full Barber ID (e.g. CUT-A3F9).'); return;
  }

  const submitBtn = document.querySelector('.btn-submit');
  submitBtn.textContent = 'Checking slot…';
  submitBtn.disabled = true;

  // Check slot conflicts via function
  const { booked } = await api('check_slot', { date });
  const times = getTimesForDate(date);
  let finalTime = time;

  if (booked.includes(time)) {
    const idx = times.indexOf(time);
    let suggested = 'Next available day';
    for (let i = idx + 1; i < times.length; i++) {
      if (!booked.includes(times[i])) { suggested = times[i]; break; }
    }
    document.getElementById('suggestedTime').textContent = suggested;
    document.getElementById('slotSuggestion').style.display = 'block';
    if (suggested !== 'Next available day') finalTime = suggested;
  }

  submitBtn.textContent = 'Confirming…';

  // Save via function (email also sent server-side)
  const result = await api('book', {
    barber_id: activeId, name, phone, style, date, time: finalTime, notes,
  });

  if (result.error) {
    alert('Something went wrong. Please try again.');
    submitBtn.textContent = 'Confirm Booking →';
    submitBtn.disabled = false;
    return;
  }

  // Send email notification to barber via EmailJS (client-side)
  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      barber_id:    activeId,
      client_name:  name,
      client_phone: phone,
      style:        style,
      date:         date,
      time:         finalTime,
      notes:        notes || '—',
    });
  } catch (e) {
    console.warn('Email notification failed:', e);
    // Booking is still saved — email failure is non-blocking
  }

  // Show success
  document.querySelectorAll('.booking-form > *:not(#formSuccess)').forEach(el => el.style.display = 'none');
  document.getElementById('successId').textContent = activeId;
  document.getElementById('formSuccess').style.display = 'block';
}

/* ════════════════════════════════════
   CHECK POINTS MODAL
════════════════════════════════════ */
function openPointsModal() {
  document.getElementById('checkId').value = '';
  document.getElementById('pointsResult').style.display = 'none';
  document.getElementById('pointsModal').classList.add('open');
}
function closePointsModal() {
  document.getElementById('pointsModal').classList.remove('open');
}
document.getElementById('pointsModal').addEventListener('click', function(e) {
  if (e.target === this) closePointsModal();
});

async function checkPoints() {
  const raw = document.getElementById('checkId').value.trim().toUpperCase();
  if (!raw || raw.length < 8) { alert('Please enter a valid Barber ID (e.g. CUT-A3F9).'); return; }

  const checkBtn = document.querySelector('#pointsModal .btn-gold');
  checkBtn.textContent = 'Checking…';
  checkBtn.disabled = true;

  const { points } = await api('get_points', { barber_id: raw });

  checkBtn.textContent = 'Check My Points →';
  checkBtn.disabled = false;

  const pts = points || 0;
  const pct = Math.min((pts / 80) * 100, 100);
  document.getElementById('ptsValue').textContent = pts;
  document.getElementById('ptsBar').style.width = pct + '%';

  if (pts >= 80) {
    document.getElementById('freeCutBadge').style.display = 'block';
    document.getElementById('ptsMsg').textContent = "🎉 You've unlocked a FREE cut! Show this screen to your barber. Points reset after redemption.";
  } else {
    document.getElementById('freeCutBadge').style.display = 'none';
    const needed = 80 - pts;
    const cuts = Math.ceil(needed / 20);
    document.getElementById('ptsMsg').textContent = pts === 0
      ? 'No points yet. Book your first cut to start earning KingPoints!'
      : `You need ${needed} more points — ${cuts} more verified cut${cuts !== 1 ? 's' : ''} — to earn your free session.`;
  }
  document.getElementById('pointsResult').style.display = 'block';
}
