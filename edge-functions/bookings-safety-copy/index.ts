// bookings-safety-copy
// BUILD VERSION: v1.1.0 — 2026-11-26
//
// Emails the owners a plain list of the next 7 days of bookings, so if Supabase (or the app) goes down,
// the latest list is already sitting in everyone's inbox — including the BtB Gmail, in case the
// btbescaperooms.co.nz mailboxes are down too. Added after the 26 Nov 2026 Supabase outage.
//
// Called hourly by pg_cron (job 'bookings-safety-copy'), but only sends at the NZ hours listed in the
// booking config key safetyCopyHours (default [7, 13] = 7am and 1pm). { force: true } sends now;
// { force: true, dry: true } builds the list and reports counts without sending.
// v1.1.0: sent ONLY to the BtB Gmail by default (Keren didn't want 2 emails a day in her inbox); a Gmail
// filter files it under the label "BtB Safety Copy" and skips the inbox. Recipients: safetyCopyTo in the
// booking config (default ['btbescaperooms@gmail.com']). Set safetyCopyIncludeOwners: true to add the owners again.
// Needs the service role key as the bearer token (same as booking-request).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUILD_VERSION = 'v1.1.0'
const NZ_TZ = 'Pacific/Auckland'
const FROM = 'Beyond the Box <enquiries@mail.btbescaperooms.co.nz>'
const SKIP_STATUSES = ['cancelled', 'abandoned', 'enquiry', 'waitlist']

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } })
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const nzDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: NZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
const nzHour = (ms: number) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: NZ_TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)))
const mins = (t: string) => { const a = String(t || '').slice(0, 5).split(':').map(Number); return (a[0] || 0) * 60 + (a[1] || 0) }
function fmtTime(t: string | null) { if (!t) return 'time TBC'; const m = mins(t); const h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12; return mm ? `${h12}:${String(mm).padStart(2, '0')}${ap}` : `${h12}${ap}` }
function fmtDay(dateStr: string) { const [y, m, d] = dateStr.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) }
const money = (n: unknown) => { const v = Number(n); return isFinite(v) && v ? '$' + v.toFixed(2).replace(/\.00$/, '') : '' }
function parseList(v: unknown): any[] { let x: any = v; for (let i = 0; i < 2 && typeof x === 'string'; i++) { try { x = JSON.parse(x) } catch { return [] } } return Array.isArray(x) ? x : [] }

async function sendEmail(to: string[], subject: string, html: string) {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' }
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: FROM, to, subject, html }) })
  return r.ok ? { ok: true } : { ok: false, error: `Resend ${r.status}: ${(await r.text()).slice(0, 200)}` }
}

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    if ((req.headers.get('Authorization') || '') !== `Bearer ${serviceKey}`) return json({ error: 'Unauthorized' }, 401)
    const admin = createClient(supabaseUrl, serviceKey)
    const body = await req.json().catch(() => ({}))
    const now = Date.now()

    const { data: setRow } = await admin.from('settings').select('value').eq('key', 'btb_booking_config').maybeSingle()
    let cfg: any = {}; try { cfg = typeof setRow?.value === 'string' ? JSON.parse(setRow.value) : (setRow?.value || {}) } catch { cfg = {} }
    const hours: number[] = Array.isArray(cfg.safetyCopyHours) ? cfg.safetyCopyHours.map(Number) : [7, 13]
    const extraTo: string[] = Array.isArray(cfg.safetyCopyTo) ? cfg.safetyCopyTo : ['btbescaperooms@gmail.com']
    const includeOwners = cfg.safetyCopyIncludeOwners === true
    if (!body.force && !hours.includes(nzHour(now))) return json({ ok: true, version: BUILD_VERSION, skipped: 'not a send hour' })

    const from = nzDate(now), to = nzDate(now + 7 * 86400000)
    const { data: rows, error } = await admin.from('game_bookings')
      .select('id, client_id, game_name, booking_date, slot_time, players_booked, status, assigned_staff_ids, total_amount, deposit_amount, deposit_paid, payments, notes_when_booked, occasion, play_location, venue_address, dropoff_time, pickup_time, time_tbc, group_booking_id')
      .gte('booking_date', from).lte('booking_date', to)
      .order('booking_date').order('slot_time')
    if (error) throw new Error(error.message)
    const list = (rows || []).filter((b: any) => !SKIP_STATUSES.includes(String(b.status || '').toLowerCase()))

    const clientIds = [...new Set(list.map((b: any) => b.client_id).filter(Boolean))]
    const { data: clients } = clientIds.length ? await admin.from('clients').select('id, first_name, last_name, phone, email').in('id', clientIds) : { data: [] as any[] }
    const cById = new Map((clients || []).map((c: any) => [c.id, c]))
    const { data: staff } = await admin.from('staff').select('id, name, email, is_owner, active')
    const sById = new Map((staff || []).map((s: any) => [String(s.id), s.name]))
    const ownerTo = (staff || []).filter((s: any) => s.is_owner && s.active && s.email).map((s: any) => s.email)
    const recipients = [...new Set([...(includeOwners ? ownerTo : []), ...extraTo].map((e) => String(e).trim()).filter(Boolean))]

    const byDay = new Map<string, any[]>()
    for (const b of list) { if (!byDay.has(b.booking_date)) byDay.set(b.booking_date, []); byDay.get(b.booking_date)!.push(b) }

    let html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;color:#111827">
      <p style="background:#ecfeff;border:1px solid #07b4c5;border-radius:8px;padding:10px 12px;margin:0 0 14px">
      <b>Bookings safety copy</b> — the next 7 days as of ${esc(new Date(now).toLocaleString('en-NZ', { timeZone: NZ_TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}.
      Keep this in case the BtB App can't load. Anything booked after this was sent won't be on it.</p>`
    if (!list.length) html += `<p>No bookings in the next 7 days.</p>`
    for (const [day, items] of byDay) {
      html += `<h3 style="margin:18px 0 6px;border-bottom:2px solid #07b4c5;padding-bottom:4px">${esc(fmtDay(day))}</h3>`
      for (const b of items) {
        const c: any = cById.get(b.client_id) || {}
        const who = [c.first_name, c.last_name].filter(Boolean).join(' ') || '(no name)'
        const gms = parseList(b.assigned_staff_ids).map((id) => sById.get(String(id)) || '?').join(', ')
        const paid = parseList(b.payments).reduce((s: number, p: any) => s + (Number(p?.amount) || 0), 0)
        const hire = b.play_location === 'hire'
        const lines = [
          `<b>${esc(b.time_tbc ? 'Time TBC' : fmtTime(b.slot_time))} · ${esc(b.game_name || '')}</b>${hire ? ' · 🚚 hired out' : ''}${b.status && b.status !== 'confirmed' ? ` · <span style="color:#b45309">${esc(b.status)}</span>` : ''}`,
          `${esc(who)}${b.players_booked ? ` · ${esc(b.players_booked)} players` : ''}${b.occasion ? ` · ${esc(b.occasion)}` : ''}`,
          [c.phone ? `📞 ${esc(c.phone)}` : '', c.email ? `✉️ ${esc(c.email)}` : ''].filter(Boolean).join(' · '),
          `GM: ${esc(gms || 'nobody assigned')}`,
          [b.total_amount ? `Total ${money(b.total_amount)}` : '', b.deposit_paid ? `deposit paid${b.deposit_amount ? ' ' + money(b.deposit_amount) : ''}` : (b.deposit_amount ? 'deposit not paid' : ''), paid ? `payments recorded ${money(paid)}` : ''].filter(Boolean).map(esc).join(' · '),
          hire ? esc([b.venue_address, b.dropoff_time ? `drop-off ${fmtTime(b.dropoff_time)}` : '', b.pickup_time ? `pick-up ${fmtTime(b.pickup_time)}` : ''].filter(Boolean).join(' · ')) : '',
          b.notes_when_booked ? `<i>${esc(String(b.notes_when_booked).slice(0, 300))}</i>` : '',
        ].filter(Boolean)
        html += `<div style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;line-height:1.5">${lines.join('<br>')}</div>`
      }
    }
    html += `</div>`

    if (body.dry) return json({ ok: true, version: BUILD_VERSION, dry: true, would_send_to: recipients.length, bookings: list.length, html_chars: html.length })
    const res = await sendEmail(recipients, `📋 Bookings safety copy — next 7 days (${list.length})`, html)
    return json({ ok: res.ok, version: BUILD_VERSION, sent_to: recipients.length, bookings: list.length, error: res.ok ? undefined : res.error }, res.ok ? 200 : 502)
  } catch (e) {
    console.error('bookings-safety-copy error:', (e as Error).message)
    return json({ error: (e as Error).message }, 500)
  }
})
