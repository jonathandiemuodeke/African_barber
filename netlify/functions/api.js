const { createClient } = require('@supabase/supabase-js');

/* ── ALL SECRETS LIVE HERE — never visible to the browser ── */
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const EMAILJS_SERVICE   = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE  = process.env.EMAILJS_TEMPLATE_ID;
const EMAILJS_KEY       = process.env.EMAILJS_PUBLIC_KEY;
const BARBER_PIN        = process.env.BARBER_PIN;

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { action } = body;

  /* ════════════════════════════════════════════
     ACTION: check_slot — is a time already booked?
  ════════════════════════════════════════════ */
  if (action === 'check_slot') {
    const { date, time } = body;
    const { data } = await db.from('bookings').select('time').eq('date', date);
    const booked = (data || []).map(r => r.time);
    return ok({ booked });
  }

  /* ════════════════════════════════════════════
     ACTION: book — save booking + ensure points row + email
  ════════════════════════════════════════════ */
  if (action === 'book') {
    const { barber_id, name, phone, style, date, time, notes } = body;

    // Save booking
    const { error: bookErr } = await db.from('bookings').insert({
      barber_id, name, phone, style, date, time, notes: notes || '', verified: false,
    });
    if (bookErr) return err('Failed to save booking');

    // Ensure points row exists
    const { data: existing } = await db.from('points')
      .select('barber_id').eq('barber_id', barber_id).maybeSingle();
    if (!existing) {
      await db.from('points').insert({ barber_id, points: 0 });
    }

    // Send email via EmailJS REST API
    try {
      await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id:  EMAILJS_SERVICE,
          template_id: EMAILJS_TEMPLATE,
          user_id:     EMAILJS_KEY,
          template_params: {
            barber_id, client_name: name, client_phone: phone,
            style, date, time, notes: notes || '—',
          },
        }),
      });
    } catch (e) { /* email failure doesn't block booking */ }

    return ok({ success: true });
  }

  /* ════════════════════════════════════════════
     ACTION: get_points — fetch points for an ID
  ════════════════════════════════════════════ */
  if (action === 'get_points') {
    const { barber_id } = body;
    const { data } = await db.from('points')
      .select('points').eq('barber_id', barber_id).maybeSingle();
    return ok({ points: data ? data.points : 0 });
  }

  /* ════════════════════════════════════════════
     ACTION: verify_pin — barber dashboard auth
  ════════════════════════════════════════════ */
  if (action === 'verify_pin') {
    const { pin } = body;
    if (pin === BARBER_PIN) return ok({ ok: true });
    return ok({ ok: false });
  }

  /* ════════════════════════════════════════════
     ACTION: get_stats — dashboard stats
  ════════════════════════════════════════════ */
  if (action === 'get_stats') {
    const today = new Date().toISOString().split('T')[0];
    const [todayRes, allRes, ptsRes] = await Promise.all([
      db.from('bookings').select('id, verified').eq('date', today),
      db.from('bookings').select('id, verified'),
      db.from('points').select('points'),
    ]);
    return ok({
      today:    (todayRes.data || []).length,
      pending:  (todayRes.data || []).filter(r => !r.verified).length,
      total:    (allRes.data   || []).filter(r =>  r.verified).length,
      freeCuts: (ptsRes.data   || []).filter(r => r.points >= 80).length,
    });
  }

  /* ════════════════════════════════════════════
     ACTION: get_today — today's bookings list
  ════════════════════════════════════════════ */
  if (action === 'get_today') {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await db.from('bookings')
      .select('*').eq('date', today).order('time');
    return ok({ bookings: data || [] });
  }

  /* ════════════════════════════════════════════
     ACTION: get_bookings — filtered bookings table
  ════════════════════════════════════════════ */
  if (action === 'get_bookings') {
    const { date, status, search } = body;
    let query = db.from('bookings').select('*').order('created_at', { ascending: false });
    if (date)           query = query.eq('date', date);
    if (status !== '')  query = query.eq('verified', status === 'true');
    const { data } = await query;
    let rows = data || [];
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(r =>
        r.name?.toLowerCase().includes(s) || r.barber_id?.toLowerCase().includes(s)
      );
    }
    return ok({ bookings: rows });
  }

  /* ════════════════════════════════════════════
     ACTION: lookup_client — barber looks up a client by ID
  ════════════════════════════════════════════ */
  if (action === 'lookup_client') {
    const { barber_id } = body;
    const { data } = await db.from('points')
      .select('points').eq('barber_id', barber_id).maybeSingle();
    return ok({ points: data ? data.points : 0, found: !!data });
  }

  /* ════════════════════════════════════════════
     ACTION: verify_cut — add 20 pts + mark booking verified
  ════════════════════════════════════════════ */
  if (action === 'verify_cut') {
    const { barber_id, booking_id } = body;
    const { data: existing } = await db.from('points')
      .select('points').eq('barber_id', barber_id).maybeSingle();
    const current = existing ? existing.points : 0;
    const newPts  = current + 20;

    if (existing) {
      await db.from('points')
        .update({ points: newPts, updated_at: new Date().toISOString() })
        .eq('barber_id', barber_id);
    } else {
      await db.from('points').insert({ barber_id, points: 20 });
    }

    // Mark booking verified
    if (booking_id) {
      await db.from('bookings').update({ verified: true }).eq('id', booking_id);
    } else {
      await db.from('bookings')
        .update({ verified: true })
        .eq('barber_id', barber_id)
        .eq('verified', false);
    }

    return ok({ points: newPts });
  }

  /* ════════════════════════════════════════════
     ACTION: redeem_cut — reset points to 0
  ════════════════════════════════════════════ */
  if (action === 'redeem_cut') {
    const { barber_id } = body;
    await db.from('points')
      .update({ points: 0, updated_at: new Date().toISOString() })
      .eq('barber_id', barber_id);
    await db.from('bookings')
      .update({ verified: true })
      .eq('barber_id', barber_id)
      .eq('verified', false);
    return ok({ points: 0 });
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
};

function ok(data)  { return { statusCode: 200, headers, body: JSON.stringify(data) }; }
function err(msg)  { return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) }; }
