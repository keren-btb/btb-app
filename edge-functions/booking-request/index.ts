// booking-request
// BUILD VERSION: v1.1.0 — 2026-11-24
// v1.1.0: hourly 'check' now also (a) sends the owners a SECOND reminder if a request is still unanswered
//   requestReminderHours (default 6) after the first alert, and (b) CANCELS a request that is still unanswered
//   requestAutoCancelBeforeGameHours (default 6) before the game: the booking is marked cancelled with a note,
//   the customer is emailed "sorry, we couldn't find a game master — please call us to choose another time",
//   and the owners are told. Both numbers can be changed in the booking config (btb_booking_config).
//
// "Request this time" bookings (status 'requested') from the public booking page.
// { action: 'new', booking_id } — called by the database trigger when a requested booking is saved:
//   works out which casual staff are free + trained for it, records the offers, sets the answer-by deadline
//   (12 waking hours, 8am–9pm NZ, never later than 12 hours before the game — all editable in the booking
//   config), sends phone notifications to those casuals and the owners, and emails the customer a
//   "request received — we're finding a game master" email.
// { action: 'check' } — called hourly by pg_cron: see v1.1.0 above, plus alerts the owners (phone + email) about
//   requests that are past their deadline, or that everyone offered has declined, with nobody accepted.
// Both need the service role key as the bearer token. Accepting/declining happens in the database function
// respond_booking_request (called from the staff portal / BtB App).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const BUILD_VERSION = 'v1.1.0'
const NZ_TZ = 'Pacific/Auckland'
const FROM = 'Beyond the Box Bookings <enquiries@mail.btbescaperooms.co.nz>'
const OWNER_FROM = 'Beyond the Box <enquiries@mail.btbescaperooms.co.nz>'
const PORTAL_URL = 'https://www.btbescaperooms.co.nz/test/staff_portal.html'

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } })
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

// ---------- NZ time helpers ----------
function nzParts(ms: number) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: NZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms))
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value)
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour'), mi: g('minute') }
}
function nzWallMs(ms: number) { const p = nzParts(ms); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) }
// NZ local date + minutes after midnight -> real UTC milliseconds
function nzToUtc(dateStr: string, mins: number): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, 0, mins)
  let utc = guess - (nzWallMs(guess) - guess)
  utc = guess - (nzWallMs(utc) - utc)
  return utc
}
const mins = (t: string) => { const a = String(t || '').slice(0, 5).split(':').map(Number); return (a[0] || 0) * 60 + (a[1] || 0) }
function dowMon1(dateStr: string) { return ((new Date(dateStr + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1 }
function fmtTime(t: string) { const m = mins(t); const h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12; return mm ? `${h12}:${String(mm).padStart(2, '0')}${ap}` : `${h12}${ap}` }
function fmtDate(dateStr: string) { const [y, m, d] = dateStr.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) }
function fmtWhen(ms: number) { return new Date(ms).toLocaleString('en-NZ', { timeZone: NZ_TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) }

// Deadline: `hours` of waking time (awakeStart..awakeEnd NZ) after `fromMs`, but no later than game start − capHours
function deadline(fromMs: number, hours: number, awakeStart: number, awakeEnd: number, gameStartMs: number, capHours: number): number {
  let left = hours * 60, t = fromMs
  const step = 5 * 60000
  for (let i = 0; i < 14 * 24 * 12 && left > 0; i++) {
    const h = nzParts(t).h
    if (h >= awakeStart && h < awakeEnd) left -= 5
    t += step
  }
  return Math.min(t, gameStartMs - capHours * 3600000)
}

async function pushTo(admin: any, staffIds: string[], title: string, body: string, url = 'staff_portal.html') {
  const ids = [...new Set(staffIds)]
  if (!ids.length) return 0
  const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!pub || !priv) return 0
  webpush.setVapidDetails('mailto:info@btbescaperooms.co.nz', pub, priv)
  const { data: subs } = await admin.from('push_subscriptions').select('*').in('staff_id', ids).eq('notify_tasks', true)
  if (!subs || !subs.length) return 0
  const payload = JSON.stringify({ title: title.slice(0, 80), body: body.slice(0, 200), url, tag: 'btb-req-' + Date.now() })
  const res = await Promise.allSettled(subs.map((s: any) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)))
  const dead: string[] = []
  res.forEach((r, i) => { if (r.status === 'rejected') { const c = (r.reason as any)?.statusCode; if (c === 404 || c === 410) dead.push(subs[i].endpoint) } })
  if (dead.length) await admin.from('push_subscriptions').delete().in('endpoint', dead)
  return res.filter((r) => r.status === 'fulfilled').length
}

async function sendEmail(to: string, subject: string, html: string, from = FROM) {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key || !to) return { ok: false, error: 'no key or address' }
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, html }) })
  const d = await r.json().catch(() => ({}))
  return r.ok ? { ok: true, id: d?.id } : { ok: false, error: d?.message || 'Resend error' }
}

const SIGN = `<p style="font-size:14px;margin:0 0 4px"><em>The team at Beyond the Box Escape Rooms — Joolz &amp; Keren</em></p>
  <p style="font-size:14px;margin:0"><a href="mailto:info@BtbEscapeRooms.co.nz" style="color:#07b4c5">info@BtbEscapeRooms.co.nz</a> · 0220 537 365</p>`

function customerEmail(first: string, game: string, dateStr: string, time: string, players: number) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111827">
  <p style="font-size:14px;margin:0 0 12px;color:#4b5563">${first ? `Hi ${esc(first)},` : 'Hi there,'}</p>
  <h1 style="color:#07b4c5;font-size:22px;margin:0 0 8px">We've got your booking request!</h1>
  <p style="font-size:15px;margin:0 0 14px">Thanks for choosing Beyond the Box Escape Rooms.</p>
  <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
    <tr><td style="padding:4px 0;color:#6b7280;font-size:14px;width:90px">🎮 Game</td><td style="padding:4px 0;font-size:14px"><strong>${esc(game)}</strong></td></tr>
    <tr><td style="padding:4px 0;color:#6b7280;font-size:14px">📅 Date</td><td style="padding:4px 0;font-size:14px"><strong>${esc(fmtDate(dateStr))}</strong></td></tr>
    <tr><td style="padding:4px 0;color:#6b7280;font-size:14px">🕐 Time</td><td style="padding:4px 0;font-size:14px"><strong>${esc(fmtTime(time))}</strong></td></tr>
    <tr><td style="padding:4px 0;color:#6b7280;font-size:14px">👥 Players</td><td style="padding:4px 0;font-size:14px"><strong>${players}</strong></td></tr>
  </table>
  <div style="padding:12px 14px;background:#fffbeb;border:1px dashed #f59e0b;border-radius:8px;margin-bottom:14px">
    <p style="margin:0 0 4px;font-size:15px"><strong>This isn't confirmed just yet</strong></p>
    <p style="margin:0;font-size:14px;color:#374151">We're checking game master availability for this time. As soon as one of our game masters confirms, we'll email you your booking confirmation — usually within a day. No deposit is needed until your booking is confirmed.</p>
  </div>
  <p style="font-size:14px;color:#374151;margin:0 0 14px">If this time doesn't work out, we'll get in touch to find another time that suits you.</p>
  ${SIGN}
</div>`
}

function cancelEmail(first: string, game: string, dateStr: string, time: string) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111827">
  <p style="font-size:14px;margin:0 0 12px;color:#4b5563">${first ? `Hi ${esc(first)},` : 'Hi there,'}</p>
  <h1 style="color:#07b4c5;font-size:22px;margin:0 0 8px">Sorry — we couldn't confirm your time</h1>
  <p style="font-size:15px;margin:0 0 14px">Thanks for your request for <strong>${esc(game)}</strong> on <strong>${esc(fmtDate(dateStr))} at ${esc(fmtTime(time))}</strong>.</p>
  <p style="font-size:14px;color:#374151;margin:0 0 14px">Unfortunately we weren't able to find a game master for that time, so we haven't been able to confirm it. You haven't been charged anything.</p>
  <p style="font-size:14px;color:#374151;margin:0 0 14px">We'd love to find you another time — just give us a call or text on <strong>0220 537 365</strong>, reply to this email, or book again on our website.</p>
  ${SIGN}
</div>`
}

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    if ((req.headers.get('Authorization') || '') !== `Bearer ${serviceKey}`) return json({ error: 'Unauthorized' }, 401)
    const admin = createClient(supabaseUrl, serviceKey)
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')

    // settings
    const { data: setRows } = await admin.from('settings').select('key, value').in('key', ['btb_booking_config', 'btb_training_statuses'])
    const getSet = (k: string) => { const r = (setRows || []).find((x: any) => x.key === k); try { return typeof r?.value === 'string' ? JSON.parse(r.value) : r?.value } catch { return null } }
    const cfg = getSet('btb_booking_config') || {}
    const statuses: any[] = Array.isArray(getSet('btb_training_statuses')) ? getSet('btb_training_statuses') : []
    const answerHours = Number(cfg.requestAnswerHours ?? 12) || 12
    const awakeStart = Number(cfg.requestAwakeStartHour ?? 8)
    const awakeEnd = Number(cfg.requestAwakeEndHour ?? 21)
    const capHours = Number(cfg.requestAlertBeforeGameHours ?? 12)
    const reminderHours = Number(cfg.requestReminderHours ?? 6) || 6
    const autoCancelHours = Number(cfg.requestAutoCancelBeforeGameHours ?? 6)

    const { data: owners } = await admin.from('staff').select('id, name, email').eq('is_owner', true).eq('active', true)
    const ownerIds = (owners || []).map((o: any) => o.id)
    const emailOwners = async (subject: string, html: string) => {
      for (const o of owners || []) if (o.email) await sendEmail(o.email, subject, `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#111827"><p>Hi ${esc(String(o.name).split(' ')[0])},</p>${html}<p><a href="${PORTAL_URL}" style="color:#07b4c5">Open the staff portal</a></p></div>`, OWNER_FROM)
    }

    if (action === 'new') {
      const id = String(body.booking_id || '')
      const { data: b } = await admin.from('game_bookings').select('id, client_id, game_id, game_name, booking_date, slot_time, players_booked, status, request_deadline').eq('id', id).maybeSingle()
      if (!b) return json({ error: 'not found' }, 404)
      if (b.status !== 'requested') return json({ ok: true, skipped: 'status_' + b.status })
      if (b.request_deadline) return json({ ok: true, skipped: 'already processed' })

      const { data: game } = await admin.from('games').select('id, duration').eq('id', b.game_id).maybeSingle()
      const len = Number(game?.duration) > 0 ? Number(game!.duration) : 60
      const s = mins(b.slot_time), e = s + len
      const gameStartMs = nzToUtc(b.booking_date, s)

      // candidates: active non-owner-calendar staff, trained, free for the whole game, not busy, not on an overlapping booking
      const [{ data: staff }, { data: training }, { data: free }, { data: ovs }, { data: busy }, { data: dayBookings }] = await Promise.all([
        admin.from('staff').select('id, name, availability_mode, active, is_owner').eq('active', true),
        admin.from('staff_game_training').select('staff_id, game_id, status').eq('game_id', b.game_id),
        admin.from('staff_free_times').select('staff_id, scope, day_of_week, free_date, start_time, end_time').or(`scope.eq.usual,free_date.eq.${b.booking_date}`),
        admin.from('staff_free_day_overrides').select('staff_id').eq('free_date', b.booking_date),
        admin.from('staff_calendar_busy').select('staff_id, busy_start, busy_end').lt('busy_start', new Date(nzToUtc(b.booking_date, e)).toISOString()).gt('busy_end', new Date(gameStartMs).toISOString()),
        admin.from('game_bookings').select('id, game_id, slot_time, assigned_staff_ids, play_location, gm_attends, dropoff_time, pickup_time').eq('booking_date', b.booking_date).neq('status', 'cancelled').neq('id', b.id),
      ])
      const { data: allGames } = await admin.from('games').select('id, duration')
      const lenOf = (gid: string) => { const g = (allGames || []).find((x: any) => x.id === gid); return Number(g?.duration) > 0 ? Number(g.duration) : 60 }
      const overrideSet = new Set((ovs || []).map((o: any) => o.staff_id))
      const dow = dowMon1(b.booking_date)
      const cands = (staff || []).filter((st: any) => {
        if (st.availability_mode === 'calendar') return false // owners/calendar people are told separately
        const t = (training || []).find((x: any) => x.staff_id === st.id)
        const q = t ? statuses.find((x: any) => x.id === t.status) : null
        if (!q || !q.qualifies) return false
        const rows = overrideSet.has(st.id)
          ? (free || []).filter((r: any) => r.staff_id === st.id && r.scope === 'date' && r.free_date === b.booking_date)
          : (free || []).filter((r: any) => r.staff_id === st.id && r.scope === 'usual' && r.day_of_week === dow)
        if (!rows.some((r: any) => mins(r.start_time) <= s && e <= mins(r.end_time))) return false
        if ((busy || []).some((x: any) => x.staff_id === st.id)) return false
        const taken = (dayBookings || []).some((o: any) => {
          let ids: string[] = []; try { ids = JSON.parse(o.assigned_staff_ids || '[]') } catch { ids = [] }
          let os = mins(o.slot_time), oe = os + lenOf(o.game_id)
          // v1.1.0: a GM going out with a hire is away from drop-off to pick-up
          if (o.play_location === 'hire' && o.gm_attends !== false) {
            if (o.dropoff_time) os = Math.min(os, mins(o.dropoff_time))
            if (o.pickup_time && mins(o.pickup_time) > os) oe = Math.max(oe, mins(o.pickup_time))
          }
          return ids.includes(st.id) && os < e && oe > s
        })
        return !taken
      })

      const dl = deadline(Date.now(), answerHours, awakeStart, awakeEnd, gameStartMs, capHours)
      await admin.from('game_bookings').update({ request_deadline: new Date(dl).toISOString() }).eq('id', b.id)
      if (cands.length) await admin.from('booking_request_offers').upsert(cands.map((c: any) => ({ booking_id: b.id, staff_id: c.id })), { onConflict: 'booking_id,staff_id', ignoreDuplicates: true })

      const what = `${b.game_name} — ${fmtDate(b.booking_date)} ${fmtTime(b.slot_time)} (${b.players_booked} players)`
      const pushedC = await pushTo(admin, cands.map((c: any) => c.id), '🙋 Can you run a game?', `${what}. Open the staff portal to accept.`)
      const pushedO = await pushTo(admin, ownerIds, '🙋 New booking request', `${what}. Asked: ${cands.map((c: any) => c.name).join(', ') || 'nobody free'}. Answer by ${fmtWhen(dl)}.`)

      // customer email
      let cust: any = { ok: false, error: 'no client' }
      if (b.client_id) {
        const { data: client } = await admin.from('clients').select('first_name, email').eq('id', b.client_id).maybeSingle()
        if (client?.email) {
          cust = await sendEmail(client.email, `We've got your booking request — ${b.game_name}`, customerEmail(client.first_name || '', b.game_name, b.booking_date, b.slot_time, b.players_booked))
          if (cust.ok) await admin.from('client_interactions').insert({ client_id: b.client_id, type: 'email', content: `Booking request received email sent: ${b.game_name} on ${b.booking_date}`, to_do: false, to_do_done: false })
        }
      }
      return json({ ok: true, version: BUILD_VERSION, offered: cands.map((c: any) => c.name), deadline: new Date(dl).toISOString(), pushed: { casuals: pushedC, owners: pushedO }, customer_email: cust })
    }

    if (action === 'check') {
      const now = Date.now()
      const nowIso = new Date(now).toISOString()
      const { data: reqs } = await admin.from('game_bookings').select('id, client_id, game_name, booking_date, slot_time, players_booked, request_deadline, request_alerted_at, request_reminded_at, staff_notes, created_at').eq('status', 'requested')
      const out: any[] = []
      for (const b of reqs || []) {
        const what = `${b.game_name} — ${fmtDate(b.booking_date)} ${fmtTime(b.slot_time)} (${b.players_booked} players)`
        const gameStartMs = nzToUtc(b.booking_date, mins(b.slot_time))

        // 1. AUTO-CANCEL: still unanswered close to the game
        if (autoCancelHours > 0 && now >= gameStartMs - autoCancelHours * 3600000) {
          let notes: any[] = []; try { notes = JSON.parse(b.staff_notes || '[]'); if (!Array.isArray(notes)) notes = [] } catch { notes = [] }
          notes.push(`Request cancelled automatically ${fmtWhen(now)}: no game master accepted in time. Customer emailed.`)
          const { data: upd } = await admin.from('game_bookings').update({ status: 'cancelled', staff_notes: JSON.stringify(notes), updated_at: nowIso }).eq('id', b.id).eq('status', 'requested').select('id')
          if (!upd || !upd.length) continue // someone accepted it a moment ago
          await admin.from('booking_request_offers').update({ response: 'expired', responded_at: nowIso }).eq('booking_id', b.id).is('response', null)
          let cust: any = { ok: false, error: 'no client email' }
          if (b.client_id) {
            const { data: client } = await admin.from('clients').select('first_name, email').eq('id', b.client_id).maybeSingle()
            if (client?.email) {
              cust = await sendEmail(client.email, `Sorry — we couldn't confirm your ${b.game_name} time`, cancelEmail(client.first_name || '', b.game_name, b.booking_date, b.slot_time))
              await admin.from('client_interactions').insert({ client_id: b.client_id, type: 'email', direction: 'outbound', content: `Booking request cancelled automatically (no game master): ${b.game_name} on ${b.booking_date}. Customer ${cust.ok ? 'emailed' : 'NOT emailed — ' + cust.error} to call to rebook.`, to_do: true, to_do_done: false })
            }
          }
          await pushTo(admin, ownerIds, '❌ Booking request cancelled', `${what}: nobody accepted in time. ${cust.ok ? 'The customer has been emailed to call us to rebook.' : 'The customer could NOT be emailed — please call them.'}`)
          await emailOwners(`❌ Booking request cancelled — ${b.game_name} ${fmtDate(b.booking_date)}`, `<p>The booking request <strong>${esc(what)}</strong> was cancelled automatically because nobody accepted it in time.</p><p>${cust.ok ? 'The customer has been emailed and asked to call us to choose another time.' : '<strong>The customer could not be emailed — please call them.</strong>'}</p>`)
          out.push({ id: b.id, did: 'cancelled', customer_email: cust })
          continue
        }

        // 2. FIRST ALERT: past its deadline, everyone said no, or nobody could be asked
        if (!b.request_alerted_at) {
          // the 'new' step may still be running for a request saved in the last few minutes
          if (!b.request_deadline && now - new Date(b.created_at).getTime() < 15 * 60000) continue
          const { data: offers } = await admin.from('booking_request_offers').select('staff_id, response').eq('booking_id', b.id)
          const allDeclined = !!(offers && offers.length && offers.every((o: any) => o.response === 'declined'))
          const noneOffered = !offers || offers.length === 0
          const late = !!(b.request_deadline && b.request_deadline <= nowIso)
          if (!late && !allDeclined && !noneOffered) continue
          const why = late ? 'nobody has accepted in time' : allDeclined ? 'everyone asked has said no' : 'nobody free could be asked'
          const cancelAt = autoCancelHours > 0 ? ` If nobody takes it, it will be cancelled automatically at ${fmtWhen(gameStartMs - autoCancelHours * 3600000)} and the customer told.` : ''
          await pushTo(admin, ownerIds, '⚠️ Booking request needs you', `${what}: ${why}. Please sort it out.`)
          await emailOwners(`⚠️ Booking request needs you — ${b.game_name} ${fmtDate(b.booking_date)}`, `<p>The booking request <strong>${esc(what)}</strong> needs you: ${esc(why)}.</p><p>The customer is waiting to hear back. You can accept it yourself (or for someone) in the staff portal, or call the customer to offer another time.${esc(cancelAt)}</p>`)
          await admin.from('game_bookings').update({ request_alerted_at: nowIso }).eq('id', b.id)
          out.push({ id: b.id, did: 'alerted', why })
          continue
        }

        // 3. SECOND REMINDER: still unanswered some hours after the first alert
        if (!b.request_reminded_at && now >= new Date(b.request_alerted_at).getTime() + reminderHours * 3600000) {
          const cancelAt = autoCancelHours > 0 ? ` It will be cancelled automatically at ${fmtWhen(gameStartMs - autoCancelHours * 3600000)} and the customer told.` : ''
          await pushTo(admin, ownerIds, '⏰ Booking request still waiting', `${what}: still nobody running it.${cancelAt}`)
          await emailOwners(`⏰ Reminder: booking request still waiting — ${b.game_name} ${fmtDate(b.booking_date)}`, `<p>Reminder: the booking request <strong>${esc(what)}</strong> still has nobody to run it.${esc(cancelAt)}</p>`)
          await admin.from('game_bookings').update({ request_reminded_at: nowIso }).eq('id', b.id)
          out.push({ id: b.id, did: 'reminded' })
        }
      }
      return json({ ok: true, version: BUILD_VERSION, done: out })
    }
    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    console.error('booking-request error:', (e as Error).message)
    return json({ error: (e as Error).message }, 500)
  }
})
