// weekly-availability-email
// BUILD VERSION: v1.1.0 — 2026-11-23
//
// v1.1.0: now goes to EVERY active staff member with an email (casual/roster staff too, not only calendar-mode
//   staff). A casual's email shows their own free times, their own shifts, the bookings they're running plus other
//   bookings during their shifts (game + time only), and asks them to update/confirm by Wednesday. If they have no
//   free times at all it says so. Owners' emails are unchanged apart from "Everyone's confirmations" now listing
//   every active staff member, and the Wednesday line. New test options: { list: true } returns who would get it
//   (names + addresses) without sending; { test_for: 'Liam', send_to: 'Keren' } sends Liam's version to Keren's
//   address.
// v1.0.2: the bookings column now lists ALL bookings that day (not only ones you run or that need a GM), with who is
//   running each; "Everyone's confirmations" now has its column headings above the columns.
// v1.0.1: the "Review and confirm" link now points to the real staff portal address, which is served from the
//   /test/ folder (per .cpanel.yml: public_html/test/). When the app moves out of /test/, change PORTAL_URL below.
//
// Every Sunday at/after 8am NZ time, emails each active staff member who has an email about the NEXT TWO weeks:
// the week starting tomorrow (stage 'next') and the one after (stage 'following'). Confirmation itself happens in
// the staff portal (My Week) — this email only links there.
//
// Called by an hourly pg_cron job with the project's service role key as the bearer token (same shared-secret
// pattern as btb-booking-confirmation). Calls without that key are refused.
// Body options (all optional): { test_for: 'Keren' } sends only to that person, any day, no log entry, [TEST] in the
// subject; add preview: true to return the HTML instead of sending; add send_to: 'Keren' to send that person's
// version to someone else's address; { list: true } returns the recipient list only.
// The free-time summary text (snapshot) MUST match weekSnapshotFor() in staff_portal.html.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUILD_VERSION = 'v1.1.0'
const NZ_TZ = 'Pacific/Auckland'
const SEND_HOUR = 8
const PORTAL_URL = 'https://www.btbescaperooms.co.nz/test/staff_portal.html'
const FROM = 'Beyond the Box <enquiries@mail.btbescaperooms.co.nz>'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ---------- dates (all plain 'YYYY-MM-DD' NZ dates) ----------
function nzNow() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: NZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date())
  const g = (t: string) => parts.find((p) => p.type === t)!.value
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(g('hour')), weekday: g('weekday') }
}
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
function dowMon1(dateStr: string): number { // Monday = 1 … Sunday = 7 (same as staff_free_times.day_of_week)
  return ((new Date(dateStr + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1
}
function nextMondayAfter(today: string): string {
  for (let n = 1; n <= 7; n++) if (dowMon1(addDays(today, n)) === 1) return addDays(today, n)
  return addDays(today, 1)
}
function weekDates(monday: string): string[] { return Array.from({ length: 7 }, (_, i) => addDays(monday, i)) }
function dayLabel(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}
function weekLabel(monday: string): string {
  const a = new Date(monday + 'T00:00:00Z'), b = new Date(addDays(monday, 6) + 'T00:00:00Z')
  const f = (d: Date) => d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `Mon ${f(a)} – Sun ${f(b)}`
}

// ---------- minutes / free time summary (must match the staff portal) ----------
function mins(t: string): number { const a = (t || '').slice(0, 5).split(':').map(Number); return a[0] * 60 + a[1] }
function minsStr(m: number): string { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') }
function minsLabel(m: number): string {
  const h = Math.floor(m / 60) % 24, mm = m % 60
  const ap = h >= 12 ? 'pm' : 'am', h12 = h % 12 === 0 ? 12 : h % 12
  return mm === 0 ? `${h12}${ap}` : `${h12}:${String(mm).padStart(2, '0')}${ap}`
}
function merge(list: { s: number; e: number }[]) {
  const a = list.map((x) => ({ s: x.s, e: x.e })).sort((x, y) => x.s - y.s)
  const out: { s: number; e: number }[] = []
  a.forEach((r) => { const l = out[out.length - 1]; if (l && r.s <= l.e) l.e = Math.max(l.e, r.e); else out.push(r) })
  return out
}

type FreeRow = { staff_id: string; scope: string; day_of_week: number | null; free_date: string | null; start_time: string; end_time: string }

function rangesFor(pid: string, ds: string, free: FreeRow[], overrides: Set<string>) {
  const useDate = overrides.has(pid + '|' + ds)
  const rows = useDate
    ? free.filter((r) => r.staff_id === pid && r.scope === 'date' && r.free_date === ds)
    : free.filter((r) => r.staff_id === pid && r.scope === 'usual' && r.day_of_week === dowMon1(ds))
  return merge(rows.map((r) => ({ s: mins(r.start_time), e: mins(r.end_time) })))
}
function snapshotFor(pid: string, dates: string[], free: FreeRow[], overrides: Set<string>): string {
  return dates.map((ds) => ds + '=' + rangesFor(pid, ds, free, overrides).map((r) => minsStr(r.s) + '-' + minsStr(r.e)).join(',')).join('|')
}

// ---------- confirmation status (mirrors weekConfirmState in the staff portal) ----------
type Conf = { staff_id: string; week_start: string; stage: string; confirmed_at: string; free_snapshot: string }
function when(c: Conf): string {
  return new Date(c.confirmed_at).toLocaleString('en-NZ', { timeZone: NZ_TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
function confirmState(pid: string, stage: 'next' | 'following', snap: string, confs: Conf[]) {
  const mine = confs.filter((c) => c.staff_id === pid)
  const early = mine.find((c) => c.stage === 'following'), fin = mine.find((c) => c.stage === 'next')
  const earlyOk = !!(early && early.free_snapshot === snap), finOk = !!(fin && fin.free_snapshot === snap)
  if (finOk) return { ok: true, text: '✓ Confirmed ' + when(fin!) }
  if (stage === 'next' && earlyOk && !fin) return { ok: false, text: 'Agreed ' + when(early!) + " — please confirm again now it's next week" }
  if (stage === 'following' && earlyOk) return { ok: true, text: '✓ Agreed ' + when(early!) + " — you'll be asked again when it's next week" }
  if (fin) return { ok: false, text: 'Changed since confirmed ' + when(fin) + ' — please confirm again' }
  if (early) return { ok: false, text: 'Changed since confirmed ' + when(early) + ' — please confirm again' }
  return { ok: false, text: 'Not confirmed yet' }
}

// ---------- calendar items (times only) ----------
function nzWallMs(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: NZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'))
}
function busyLabelsForDay(pid: string, ds: string, busy: { staff_id: string; busy_start: string; busy_end: string }[]): string[] {
  const [y, m, d] = ds.split('-').map(Number)
  const dayStart = Date.UTC(y, m - 1, d), dayEnd = dayStart + 86400000
  const out: string[] = []
  busy.filter((b) => b.staff_id === pid).forEach((b) => {
    const s = nzWallMs(b.busy_start), e = nzWallMs(b.busy_end)
    const os = Math.max(s, dayStart), oe = Math.min(e, dayEnd)
    if (oe <= os) return
    if (s <= dayStart && e >= dayEnd) out.push('Busy all day')
    else out.push(`Busy ${minsLabel(Math.round((os - dayStart) / 60000))}–${minsLabel(Math.round((oe - dayStart) / 60000))}`)
  })
  return out
}

// ---------- email ----------
type Staff = { id: string; name: string; email: string | null; is_owner: boolean; availability_mode?: string }
type Booking = { id: string; game_id: string | null; game_name: string; booking_date: string; slot_time: string; players_booked: number; assigned_staff_ids: string | null }
type Shift = { staff_id: string; shift_date: string; custom_start_time: string; custom_end_time: string }

function parseIds(v: string | null): string[] { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : [] } catch { return [] } }

function weekSection(opts: {
  person: Staff; stage: 'next' | 'following'; monday: string; free: FreeRow[]; overrides: Set<string>; confs: Conf[];
  bookings: Booking[]; busy: { staff_id: string; busy_start: string; busy_end: string }[]; nameById: Record<string, string>;
  shifts: Shift[]; gameLen: (b: Booking) => number
}): string {
  const { person, stage, monday, free, overrides, confs, bookings, busy, nameById, shifts, gameLen } = opts
  const ownerView = !!person.is_owner
  const dates = weekDates(monday)
  const snap = snapshotFor(person.id, dates, free, overrides)
  const st = confirmState(person.id, stage, snap, confs.filter((c) => c.week_start === monday))
  const title = stage === 'next' ? 'Next week' : 'The following week'
  const rows = dates.map((ds) => {
    const f = rangesFor(person.id, ds, free, overrides)
    const freeTxt = f.length ? f.map((r) => `${minsLabel(r.s)}–${minsLabel(r.e)}`).join(', ') : '—'
    const myShifts = shifts.filter((s) => s.staff_id === person.id && s.shift_date === ds)
    const shiftLines = myShifts.map((s) => `<span style="color:#1d4ed8"><strong>Shift ${minsLabel(mins(s.custom_start_time))}–${minsLabel(mins(s.custom_end_time))}</strong></span>`)
    const bk = bookings.filter((b) => b.booking_date === ds)
      .filter((b) => {
        if (ownerView) return true
        // casuals: only bookings they run, or that overlap one of their own shifts
        if (parseIds(b.assigned_staff_ids).includes(person.id)) return true
        const bS = mins(b.slot_time), bE = bS + gameLen(b)
        return myShifts.some((s) => bS < mins(s.custom_end_time) && bE > mins(s.custom_start_time))
      })
      .sort((a, b) => a.slot_time.localeCompare(b.slot_time))
      .map((b) => {
        const ids = parseIds(b.assigned_staff_ids)
        if (!ownerView) {
          return ids.includes(person.id)
            ? `${minsLabel(mins(b.slot_time))} ${esc(b.game_name)} — <strong>you</strong>`
            : `<span style="color:#6b7280">${minsLabel(mins(b.slot_time))} ${esc(b.game_name)} (booked)</span>`
        }
        const who = ids.length
          ? ids.map((id) => id === person.id ? '<strong>you</strong>' : esc(nameById[id] || 'someone')).join(', ')
          : '<span style="color:#b45309">needs a GM</span>'
        return `${minsLabel(mins(b.slot_time))} ${esc(b.game_name)} (${b.players_booked}) — ${who}`
      })
    const items = [...shiftLines, ...bk]
    const bz = busyLabelsForDay(person.id, ds, busy)
    return `<tr><td style="padding:6px 8px;border-top:1px solid #e5e7eb;vertical-align:top;white-space:nowrap"><strong>${esc(dayLabel(ds))}</strong></td>`
      + `<td style="padding:6px 8px;border-top:1px solid #e5e7eb;vertical-align:top;color:#15803d">${esc(freeTxt)}</td>`
      + `<td style="padding:6px 8px;border-top:1px solid #e5e7eb;vertical-align:top">${items.length ? items.join('<br>') : '<span style="color:#9ca3af">—</span>'}</td>`
      + `<td style="padding:6px 8px;border-top:1px solid #e5e7eb;vertical-align:top;color:#92400e">${bz.length ? bz.map(esc).join('<br>') : '<span style="color:#9ca3af">—</span>'}</td></tr>`
  }).join('')
  const col3 = ownerView ? 'Bookings' : 'Shifts &amp; bookings'
  return `<h2 style="font-size:17px;margin:24px 0 2px;color:#111827">${title} <span style="font-weight:normal;color:#6b7280;font-size:14px">(${esc(weekLabel(monday))})</span></h2>`
    + `<p style="margin:0 0 8px;font-size:14px;color:${st.ok ? '#15803d' : '#b45309'}"><strong>${esc(st.text)}</strong></p>`
    + `<table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="color:#6b7280;text-align:left"><th style="padding:4px 8px">Day</th><th style="padding:4px 8px">Your free times</th><th style="padding:4px 8px">${col3}</th><th style="padding:4px 8px">Calendar</th></tr>${rows}</table>`
    + (st.ok ? '' : `<p style="margin:12px 0 0"><a href="${PORTAL_URL}" style="display:inline-block;background:#07b4c5;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px"><strong>Review and confirm</strong></a></p>`)
}

function buildEmail(opts: {
  person: Staff; mondays: [string, string]; free: FreeRow[]; overrides: Set<string>; confs: Conf[]; bookings: Booking[];
  busy: { staff_id: string; busy_start: string; busy_end: string }[]; nameById: Record<string, string>; everyone: Staff[];
  shifts: Shift[]; gameLen: (b: Booking) => number; wednesday: string
}): string {
  const { person, mondays, free, overrides, confs, everyone, wednesday } = opts
  const first = person.name.split(' ')[0]
  const short = (mon: string) => new Date(mon + 'T00:00:00Z').toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  const hasAnyFree = free.some((r) => r.staff_id === person.id)
  const noFreeNote = hasAnyFree ? '' : `<p style="font-size:14px;margin:10px 0 0;padding:10px 12px;border-radius:8px;background:#fef3c7;color:#92400e"><strong>We don't know when you can work yet.</strong> Please open My Week and tap each day to add the times you're free. You can set a usual week that repeats, then change single dates.</p>`
  const summary = person.is_owner
    ? `<h2 style="font-size:15px;margin:28px 0 6px;color:#111827">Everyone's confirmations</h2><table style="font-size:13px;border-collapse:collapse;width:100%">`
      + `<tr style="color:#6b7280;text-align:left"><th style="padding:4px 8px"></th><th style="padding:4px 8px">Next week (${esc(short(mondays[0]))})</th><th style="padding:4px 8px">Following week (${esc(short(mondays[1]))})</th></tr>`
      + everyone.map((p) => {
        const cells = ([['next', mondays[0]], ['following', mondays[1]]] as ['next' | 'following', string][]).map(([stage, mon]) => {
          const stt = confirmState(p.id, stage, snapshotFor(p.id, weekDates(mon), free, overrides), confs.filter((c) => c.week_start === mon))
          return `<td style="padding:4px 8px;border-top:1px solid #e5e7eb;color:${stt.ok ? '#15803d' : '#b45309'}">${esc(stt.text)}</td>`
        }).join('')
        return `<tr><td style="padding:4px 8px;border-top:1px solid #e5e7eb"><strong>${esc(p.name)}</strong></td>${cells}</tr>`
      }).join('')
      + `</table>`
    : ''
  const footer = person.is_owner
    ? 'Calendar items show times only. Bookings shown are all bookings that week and who is running them. Sent automatically every Sunday morning.'
    : 'Bookings shown are the ones you are running and others during your shifts. Sent automatically every Sunday morning.'
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#111827">`
    + `<p style="font-size:14px;margin:0 0 8px;color:#4b5563">Hi ${esc(first)},</p>`
    + `<h1 style="color:#07b4c5;font-size:21px;margin:0 0 4px">Your availability — the next two weeks</h1>`
    + `<p style="font-size:14px;margin:0 0 4px;color:#374151">Please check when you can work for both weeks, update anything that has changed, and confirm <strong>by ${esc(wednesday)}</strong> so we can plan. To confirm: open the staff portal, go to <strong>My Week</strong>, find the week and press <strong>Confirm my week</strong> (you'll need to log in).</p>`
    + noFreeNote
    + weekSection({ ...opts, stage: 'next', monday: mondays[0] })
    + weekSection({ ...opts, stage: 'following', monday: mondays[1] })
    + summary
    + `<p style="font-size:12px;color:#9ca3af;margin:28px 0 0">${footer}</p>`
    + `</div>`
}

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if ((req.headers.get('Authorization') || '') !== `Bearer ${serviceKey}`) return json({ error: 'Unauthorized' }, 401)

    let body: { test_for?: string; preview?: boolean; send_to?: string; list?: boolean } = {}
    try { body = await req.json() } catch { body = {} }
    const testFor = (body.test_for || '').trim()
    const sendTo = (body.send_to || '').trim()
    const preview = !!body.preview
    const listOnly = !!body.list

    const now = nzNow()
    if (!testFor && !listOnly && (now.weekday !== 'Sun' || now.hour < SEND_HOUR)) return json({ ok: true, skipped: 'not Sunday after 8am NZ time', nz: now, version: BUILD_VERSION })

    const admin = createClient(supabaseUrl, serviceKey)
    const m1 = nextMondayAfter(now.date), m2 = addDays(m1, 7)
    const rangeEnd = addDays(m2, 6)
    // the Wednesday on or after today (the confirm-by day)
    let wed = now.date; for (let n = 0; n < 7; n++) { if (dowMon1(addDays(now.date, n)) === 3) { wed = addDays(now.date, n); break } }
    const wednesday = new Date(wed + 'T00:00:00Z').toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

    const { data: staffAll, error: sErr } = await admin.from('staff').select('id, name, email, is_owner, active, availability_mode')
    if (sErr) return json({ error: sErr.message }, 500)
    const nameById: Record<string, string> = {}
    ;(staffAll || []).forEach((s) => { nameById[s.id] = s.name })
    // v1.1.0: everyone active (calendar-mode people first, then the rest by name)
    const active = (staffAll || []).filter((s) => s.active !== false) as Staff[]
    const everyone: Staff[] = [
      ...active.filter((s) => s.availability_mode === 'calendar').sort((a, b) => a.name.localeCompare(b.name)),
      ...active.filter((s) => s.availability_mode !== 'calendar').sort((a, b) => a.name.localeCompare(b.name)),
    ]
    let recipients = everyone.filter((s) => (s.email || '').trim() !== '')
    if (listOnly) {
      return json({ ok: true, version: BUILD_VERSION, would_send_to: recipients.map((s) => ({ name: s.name, email: s.email })), no_email: everyone.filter((s) => !(s.email || '').trim()).map((s) => s.name) })
    }
    let redirect: Staff | undefined
    if (testFor) {
      recipients = everyone.filter((s) => s.name.toLowerCase() === testFor.toLowerCase())
      if (sendTo) {
        redirect = everyone.find((s) => s.name.toLowerCase() === sendTo.toLowerCase() && (s.email || '').trim() !== '')
        if (!redirect) return json({ error: 'send_to person not found or has no email' }, 400)
      } else {
        recipients = recipients.filter((s) => (s.email || '').trim() !== '')
      }
    }
    if (recipients.length === 0) return json({ ok: true, skipped: 'no recipients', version: BUILD_VERSION })

    const ids = everyone.map((s) => s.id)
    const [usualR, dateR, ovR, bkR, busyR, confR, logR, shR, gmR] = await Promise.all([
      admin.from('staff_free_times').select('staff_id, scope, day_of_week, free_date, start_time, end_time').in('staff_id', ids).eq('scope', 'usual'),
      admin.from('staff_free_times').select('staff_id, scope, day_of_week, free_date, start_time, end_time').in('staff_id', ids).eq('scope', 'date').gte('free_date', m1).lte('free_date', rangeEnd),
      admin.from('staff_free_day_overrides').select('staff_id, free_date').in('staff_id', ids).gte('free_date', m1).lte('free_date', rangeEnd),
      admin.from('game_bookings').select('id, game_id, game_name, booking_date, slot_time, players_booked, assigned_staff_ids').gte('booking_date', m1).lte('booking_date', rangeEnd).neq('status', 'cancelled'),
      admin.from('staff_calendar_busy').select('staff_id, busy_start, busy_end').in('staff_id', ids).gte('busy_end', addDays(m1, -1) + 'T00:00:00Z').lte('busy_start', addDays(rangeEnd, 2) + 'T00:00:00Z'),
      admin.from('staff_week_confirmations').select('staff_id, week_start, stage, confirmed_at, free_snapshot').in('week_start', [m1, m2]),
      admin.from('staff_week_email_log').select('staff_id').eq('send_date', now.date),
      admin.from('assigned_shifts').select('staff_id, shift_date, custom_start_time, custom_end_time').in('staff_id', ids).gte('shift_date', m1).lte('shift_date', rangeEnd).neq('status', 'open'),
      admin.from('settings').select('value').eq('key', 'btb_games').maybeSingle(),
    ])
    for (const r of [usualR, dateR, ovR, bkR, busyR, confR, logR, shR]) if (r.error) return json({ error: r.error.message }, 500)
    const free = [...(usualR.data || []), ...(dateR.data || [])] as FreeRow[]
    const overrides = new Set<string>((ovR.data || []).map((o: { staff_id: string; free_date: string }) => o.staff_id + '|' + o.free_date))
    const alreadySent = new Set<string>((logR.data || []).map((l: { staff_id: string }) => l.staff_id))
    const shifts = ((shR.data || []) as Shift[]).filter((s) => s.custom_start_time && s.custom_end_time)
    // game lengths (for "bookings during your shift"); unknown length counts as 60 min
    let gamesList: { id?: string; name?: string; duration?: number }[] = []
    try { const v = gmR.data?.value; const d = typeof v === 'string' ? JSON.parse(v) : v; if (Array.isArray(d)) gamesList = d } catch { gamesList = [] }
    const gameLen = (b: Booking) => {
      const g = gamesList.find((x) => x.id === b.game_id) || gamesList.find((x) => x.name === b.game_name)
      const n = g ? Number(g.duration) : NaN
      return n > 0 ? n : 60
    }

    const results: Record<string, unknown>[] = []
    for (const person of recipients) {
      if (!testFor && alreadySent.has(person.id)) { results.push({ name: person.name, skipped: 'already sent today' }); continue }
      const html = buildEmail({ person, mondays: [m1, m2], free, overrides, confs: (confR.data || []) as Conf[], bookings: (bkR.data || []) as Booking[], busy: (busyR.data || []) as { staff_id: string; busy_start: string; busy_end: string }[], nameById, everyone, shifts, gameLen, wednesday })
      if (preview) { results.push({ name: person.name, html }); continue }
      if (!resendKey) return json({ error: 'RESEND_API_KEY not configured' }, 500)
      const toAddr = redirect ? redirect.email : person.email
      const subj = `${testFor ? '[TEST] ' : ''}${redirect ? `(${person.name}'s version) ` : ''}Your availability — next two weeks (please confirm)`
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [toAddr], subject: subj, html }),
      })
      const data = await res.json()
      if (!res.ok) { console.error('Resend error:', JSON.stringify(data)); results.push({ name: person.name, error: data?.message || 'Resend error' }); continue }
      if (!testFor) await admin.from('staff_week_email_log').insert({ staff_id: person.id, send_date: now.date, resend_id: data?.id || null })
      results.push({ name: person.name, sent: true, to: redirect ? redirect.name : person.name, id: data?.id })
    }
    return json({ ok: true, weeks: [m1, m2], results, version: BUILD_VERSION })
  } catch (e) {
    console.error('weekly-availability-email error:', (e as Error).message)
    return json({ error: (e as Error).message }, 500)
  }
})
