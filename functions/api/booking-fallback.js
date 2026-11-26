// booking-fallback — Cloudflare Pages Function, served at https://btb-app.pages.dev/api/booking-fallback
// BUILD VERSION: v1.0.0 — 2026-11-26
//
// Backup way to take booking REQUESTS when Supabase can't be reached (e.g. the 26 Nov 2026 Supabase outage).
// booking_widget.html shows a short request form on its "We're having trouble loading" screen and posts it here.
// This function does NOT touch Supabase at all: it only emails the request (via Resend) to the owners, plus a
// "we've got your request — it isn't confirmed yet" email to the customer if they gave an email address.
//
// Needs Cloudflare Pages environment variables (Settings > Variables and Secrets, Production):
//   RESEND_API_KEY  (secret)   a Resend API key with sending access for mail.btbescaperooms.co.nz
//   FALLBACK_TO     (optional) comma-separated owner addresses; default below. Includes a Gmail address on
//                              purpose, so requests still arrive if the btbescaperooms.co.nz mailboxes are down.

const DEFAULT_TO = 'keren@btbescaperooms.co.nz,joolz@btbescaperooms.co.nz,btbescaperooms@gmail.com';
const FROM = 'Beyond the Box Bookings <enquiries@mail.btbescaperooms.co.nz>';
const ALLOWED_ORIGINS = [
  'https://btb-app.pages.dev',
  'https://www.btbescaperooms.co.nz',
  'https://btbescaperooms.co.nz',
];

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.btb-app\.pages\.dev$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } });
}

async function sendEmail(key, to, subject, html, replyTo) {
  const body = { from: FROM, to, subject, html };
  if (replyTo) body.reply_to = replyTo;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.ok;
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestPost({ request, env }) {
  let d;
  try { d = await request.json(); } catch { return json(request, { ok: false, error: 'bad_request' }, 400); }

  // Honeypot: real people never fill in the hidden "website" box. Pretend it worked so bots move on.
  if (clean(d.website, 200)) return json(request, { ok: true });

  const f = {
    name: clean(d.name, 100),
    phone: clean(d.phone, 40),
    email: clean(d.email, 150),
    what: clean(d.what, 100),
    date: clean(d.date, 20),
    time: clean(d.time, 40),
    players: clean(d.players, 10),
    notes: clean(d.notes, 1000),
    page: clean(d.page, 200),
  };
  if (!f.name) return json(request, { ok: false, error: 'name_required' }, 400);
  if (!f.phone && !f.email) return json(request, { ok: false, error: 'contact_required' }, 400);
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return json(request, { ok: false, error: 'bad_email' }, 400);

  const key = env.RESEND_API_KEY;
  if (!key) return json(request, { ok: false, error: 'not_configured' }, 503);
  const to = String(env.FALLBACK_TO || DEFAULT_TO).split(',').map((s) => s.trim()).filter(Boolean);

  const when = new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const row = (label, val) => val ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top">${label}</td><td style="padding:4px 0">${esc(val)}</td></tr>` : '';
  const details = `<table style="border-collapse:collapse;font-size:15px">
    ${row('Name', f.name)}${row('Phone', f.phone)}${row('Email', f.email)}${row('Wants to book', f.what)}
    ${row('Preferred date', f.date)}${row('Preferred time', f.time)}${row('Players', f.players)}${row('Notes', f.notes)}
  </table>`;

  const ownerHtml = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#111827">
    <p style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:10px 12px;margin:0 0 14px">
      <b>Backup booking request</b> — sent ${esc(when)} while the booking page couldn't reach the database.
      This is <b>not</b> in the BtB App. Check the time is free, add it to the app once it's back, and contact the customer to confirm.</p>
    ${details}
    ${f.page ? `<p style="color:#6b7280;font-size:12px;margin-top:16px">From: ${esc(f.page)}</p>` : ''}
  </div>`;

  const sent = await sendEmail(key, to, `⚠️ Backup booking request: ${f.name}${f.date ? ' — ' + f.date : ''}`, ownerHtml, f.email || undefined);
  if (!sent) return json(request, { ok: false, error: 'send_failed' }, 502);

  if (f.email) {
    const custHtml = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#111827">
      <p>Hi ${esc(f.name.split(' ')[0])},</p>
      <p>Thanks for your booking request — we've got it. Our online booking system is having a short hiccup, so
      <b>your booking isn't confirmed yet</b>. We'll be in touch soon to confirm a time with you.</p>
      ${details}
      <p>Questions? Call us on <a href="tel:0220537365" style="color:#07b4c5">0220 537 365</a> or reply to this email.</p>
      <p>Beyond the Box Escape Rooms<br>105 Market St North, Hastings</p>
    </div>`;
    try { await sendEmail(key, [f.email], 'We’ve got your booking request — Beyond the Box', custHtml, 'info@btbescaperooms.co.nz'); } catch {}
  }

  return json(request, { ok: true });
}
