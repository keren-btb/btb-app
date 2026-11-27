// today-request
// BUILD VERSION: v1.0.0 — 2026-11-28
// "Ask for a time today" requests from the public booking page (game_bookings.status = 'time_request').
// { action: 'new', booking_id }  — called by the database trigger (service role key) when a request is saved:
//   phone notification + email to the owners (Keren & Joolz).
// { action: 'reply', bookingId, decision: 'accept' | 'decline' | 'suggest', time?, message?, force? }
//   — called from BtB App by an admin/manager login:
//   accept  → checks the room is free, confirms the booking (price filled in if missing) and emails the
//             customer their normal confirmation.
//   decline → cancels the request and emails the customer "sorry, we can't fit you in today".
//   suggest → emails the customer another time to call/text/reply to; the request stays open.
//   If the customer gave no email, nothing is emailed and the answer says so (staff text/call them).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const BUILD_VERSION = 'v1.0.0'
const FROM = 'Beyond the Box <enquiries@mail.btbescaperooms.co.nz>'
const APP_URL = 'https://www.btbescaperooms.co.nz/test/btb_app.html'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const mins = (t: string) => { const a = String(t || '').slice(0, 5).split(':').map(Number); return (a[0] || 0) * 60 + (a[1] || 0) }
function fmtTime(t: string) { const m = mins(t); const h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12; return mm ? `${h12}:${String(mm).padStart(2, '0')}${ap}` : `${h12}${ap}` }
function fmtDate(d: string) { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) }

const SIGN = `<p style="font-size:14px;margin:0 0 4px"><em>The team at Beyond the Box Escape Rooms — Joolz &amp; Keren</em></p>
  <p style="font-size:14px;margin:0"><a href="mailto:info@BtbEscapeRooms.co.nz" style="color:#07b4c5">info@BtbEscapeRooms.co.nz</a> · 0220 537 365</p>`
const wrap = (first: string, h1: string, inner: string) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111827">
  <p style="font-size:14px;margin:0 0 12px;color:#4b5563">${first ? `Hi ${esc(first)},` : 'Hi there,'}</p>
  <h1 style="color:#07b4c5;font-size:22px;margin:0 0 10px">${h1}</h1>${inner}${SIGN}</div>`
const note = (m: string) => m ? `<div style="padding:12px 14px;background:#f0fdfa;border-left:3px solid #07b4c5;border-radius:6px;margin:0 0 14px;font-size:14px;white-space:pre-wrap">${esc(m)}</div>` : ''

async function sendEmail(to: string, subject: string, html: string) {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key || !to) return { ok: false, error: 'no key or address' }
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: FROM, to: [to], subject, html }) })
  const d = await r.json().catch(() => ({}))
  return r.ok ? { ok: true } : { ok: false, error: d?.message || 'Resend error' }
}
async function pushTo(admin: any, staffIds: string[], title: string, body: string) {
  const ids = [...new Set(staffIds)]
  const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!ids.length || !pub || !priv) return 0
  webpush.setVapidDetails('mailto:info@btbescaperooms.co.nz', pub, priv)
  const { data: subs } = await admin.from('push_subscriptions').select('*').in('staff_id', ids)
  if (!subs || !subs.length) return 0
  const payload = JSON.stringify({ title: title.slice(0, 80), body: body.slice(0, 200), url: 'btb_app.html', tag: 'btb-today-' + Date.now() })
  const res = await Promise.allSettled(subs.map((s: any) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)))
  const dead: string[] = []
  res.forEach((r, i) => { if (r.status === 'rejected') { const c = (r.reason as any)?.statusCode; if (c === 404 || c === 410) dead.push(subs[i].endpoint) } })
  if (dead.length) await admin.from('push_subscriptions').delete().in('endpoint', dead)
  return res.filter((r) => r.status === 'fulfilled').length
}
const addNote = (row: any, text: string) => { let n: any[] = []; try { n = JSON.parse(row.staff_notes || '[]'); if (!Array.isArray(n)) n = [] } catch { n = [] } n.push(text); return JSON.stringify(n) }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const auth = req.headers.get('Authorization') || ''
    const admin = createClient(supabaseUrl, serviceKey)
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')
    const isInternal = auth === `Bearer ${serviceKey}`

    const loadBooking = async (id: string) => {
      const { data } = await admin.from('game_bookings')
        .select('id, status, game_id, game_name, booking_date, slot_time, players_booked, total_amount, notes_when_booked, staff_notes, client_id, clients(first_name, last_name, email, phone)')
        .eq('id', id).maybeSingle()
      return data
    }

    // ---------- new request: tell the owners ----------
    if (action === 'new') {
      if (!isInternal) return json({ error: 'Unauthorized' }, 401)
      const b: any = await loadBooking(String(body.booking_id || ''))
      if (!b || b.status !== 'time_request') return json({ ok: true, skipped: true })
      const c = b.clients || {}
      const who = [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Someone'
      const what = `${b.game_name} today at ${fmtTime(b.slot_time)} for ${b.players_booked || '?'}`
      const { data: owners } = await admin.from('staff').select('id, name, email').eq('is_owner', true).eq('active', true)
      const pushed = await pushTo(admin, (owners || []).map((o: any) => o.id), '⏰ Time request for today', `${who}: ${what}. Open BtB App to accept, decline or suggest a time.`)
      let emailed = 0
      for (const o of owners || []) {
        if (!o.email) continue
        const r = await sendEmail(o.email, `⏰ Time request: ${what}`, `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#111827">
          <p>Hi ${esc(String(o.name || '').split(' ')[0])},</p>
          <p><strong>${esc(who)}</strong> would like <strong>${esc(b.game_name)}</strong> today (${esc(fmtDate(b.booking_date))}) at <strong>${esc(fmtTime(b.slot_time))}</strong> for <strong>${b.players_booked || '?'}</strong> players.</p>
          <p>Phone: ${esc(c.phone || '—')}<br>Email: ${esc(c.email || '—')}</p>
          ${b.notes_when_booked ? `<p style="color:#4b5563">${esc(b.notes_when_booked)}</p>` : ''}
          <p><a href="${APP_URL}" style="color:#07b4c5;font-weight:bold">Open BtB App</a> — it's on today's calendar with Accept / Suggest a time / Decline.</p></div>`)
        if (r.ok) emailed++
      }
      return json({ ok: true, version: BUILD_VERSION, pushed, emailed })
    }

    // ---------- reply from BtB App ----------
    if (action === 'reply') {
      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } })
      const { data: { user } } = await userClient.auth.getUser()
      if (!user) return json({ error: 'Please log in again' }, 401)
      const { data: role } = await admin.from('user_roles').select('role, name').eq('id', user.id).maybeSingle()
      if (!role || !['admin', 'manager'].includes(role.role)) return json({ error: 'Only owners and managers can answer time requests' }, 403)
      const by = role.name || user.email || 'staff'

      const b: any = await loadBooking(String(body.bookingId || ''))
      if (!b) return json({ error: 'Request not found' }, 404)
      if (b.status !== 'time_request') return json({ error: 'This request has already been answered' }, 409)
      const c = b.clients || {}
      const first = String(c.first_name || '').trim()
      const message = String(body.message || '').trim().slice(0, 1000)
      const stamp = new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
      const decision = String(body.decision || '')

      if (decision === 'accept') {
        const { data: g } = await admin.from('games').select('duration, buffer_minutes').eq('id', b.game_id).maybeSingle()
        const len = Number(g?.duration ?? 60) || 60, buf = Number(g?.buffer_minutes ?? 30) || 30
        const s = mins(b.slot_time)
        if (!body.force) {
          const { data: others } = await admin.from('game_bookings').select('slot_time, game_name, play_location')
            .eq('game_id', b.game_id).eq('booking_date', b.booking_date).neq('id', b.id).in('status', ['confirmed', 'requested', 'completed'])
          const clash = (others || []).find((o: any) => { const os = mins(o.slot_time); return os < s + len + buf && s < os + len + buf })
          if (clash) return json({ clash: true, message: `${b.game_name} already has a booking at ${fmtTime(clash.slot_time)} (with reset time this overlaps).` })
        }
        const upd: any = { status: 'confirmed', updated_at: new Date().toISOString(), staff_notes: addNote(b, `Time request accepted by ${by} ${stamp}`) }
        if (!(Number(b.total_amount) > 0)) {
          const { data: price } = await admin.rpc('btb_game_base_price', { p_game_id: b.game_id, p_players: b.players_booked || 1 })
          if (Number(price) > 0) upd.total_amount = Number(price)
        }
        const { error } = await admin.from('game_bookings').update(upd).eq('id', b.id).eq('status', 'time_request')
        if (error) return json({ error: error.message }, 500)
        let emailed = false
        if (c.email) {
          const r = await fetch(`${supabaseUrl}/functions/v1/btb-booking-confirmation`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` }, body: JSON.stringify({ booking_id: b.id, force: true }) })
          const d = await r.json().catch(() => ({}))
          emailed = r.ok && d.ok !== false
        }
        return json({ ok: true, decision, emailed, phone: c.phone || null })
      }

      if (decision === 'decline') {
        const { error } = await admin.from('game_bookings').update({ status: 'cancelled', updated_at: new Date().toISOString(), staff_notes: addNote(b, `Time request declined by ${by} ${stamp}${message ? ': ' + message : ''}`) }).eq('id', b.id).eq('status', 'time_request')
        if (error) return json({ error: error.message }, 500)
        let emailed = false
        if (c.email) {
          const r = await sendEmail(c.email, `Sorry — we can't fit you in today`, wrap(first, "Sorry — we can't fit you in today",
            `<p style="font-size:15px;margin:0 0 14px">Thanks for asking about <strong>${esc(b.game_name)}</strong> today at <strong>${esc(fmtTime(b.slot_time))}</strong>. Unfortunately we can't run it then.</p>${note(message)}
             <p style="font-size:14px;color:#374151;margin:0 0 14px">We'd love to see you another time — have a look at the times on our website, or call or text us on <strong>0220 537 365</strong>.</p>`))
          emailed = r.ok
        }
        return json({ ok: true, decision, emailed, phone: c.phone || null })
      }

      if (decision === 'suggest') {
        const t = String(body.time || '')
        if (!/^\d{2}:\d{2}$/.test(t)) return json({ error: 'Pick a time to suggest' }, 400)
        const { error } = await admin.from('game_bookings').update({ updated_at: new Date().toISOString(), staff_notes: addNote(b, `${by} suggested ${fmtTime(t)} instead ${stamp}${message ? ': ' + message : ''}`) }).eq('id', b.id)
        if (error) return json({ error: error.message }, 500)
        let emailed = false
        if (c.email) {
          const r = await sendEmail(c.email, `How about ${fmtTime(t)} today?`, wrap(first, `How about ${esc(fmtTime(t))} today?`,
            `<p style="font-size:15px;margin:0 0 14px">Thanks for asking about <strong>${esc(b.game_name)}</strong> at ${esc(fmtTime(b.slot_time))}. We can't quite do that time, but we could start at <strong>${esc(fmtTime(t))}</strong> today.</p>${note(message)}
             <p style="font-size:14px;color:#374151;margin:0 0 14px">If that works for you, just reply to this email or call or text us on <strong>0220 537 365</strong> and we'll lock it in.</p>`))
          emailed = r.ok
        }
        return json({ ok: true, decision, emailed, phone: c.phone || null })
      }
      return json({ error: 'Unknown decision' }, 400)
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
