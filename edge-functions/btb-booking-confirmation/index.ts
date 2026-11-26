// btb-booking-confirmation
// BUILD VERSION: v1.6.0 — 2026-11-23
// v1.6.0 changes: {force:true} (service key only — used by btb-admin 'confirmation_email' when staff press Send in
//   BtB App > ⋯ > Confirmation email) sends even if 'don't send' was ticked or it was sent before (a resend).
// v1.5.0 changes: every confirmation email has a 'Need an invoice? Fill in your invoice details' link (the booking's private
//   link to invoice_request.html) so companies can ask to pay by invoice and give their PO / accounts email etc.
// v1.4.0 changes: PACKAGES (bookings sharing a group_booking_id) now get ONE email, laid out like an invoice:
//   each game with its time, players and price, food/drink/extras lines, hire fees, total, a $35 deposit PER GAME,
//   and the balance due on the day. Only the first game of the package sends it (the others are marked sent),
//   so the customer never gets one email per game. The calendar invite covers the whole package.
//   Only 'confirmed' bookings are emailed. {preview:true} returns the email instead of sending it (service key only).
//   Single bookings: unchanged.
// v1.3.0 changes: headline split over two lines ("— Congratulations —" then "you're booked!"); "with Beyond the Box
//   Escape Rooms" now comes before the game name; when the customer chose cash the deposit box asks them to call and
//   arrange a time to pop in (same as card).
// v1.2.0 changes: added game emoji — 📦 for Gregg in the Box, 🎄 for Saving Christmas (🕵️ Sherlock unchanged).
// v1.1.1 changes: when the customer chose "card" on the widget, the deposit box now asks them to call to
//   arrange a time to pop in and pay by eftpos or credit card (open Saturdays 10am–2pm).
// v1.1.0 changes: game name now on its own line in the same teal as the headline (🕵️ emoji for Sherlock only);
//   the $35 deposit request now ALWAYS shows (removed the "Deposit noted" wording) and mentions the
//   payment method the customer chose on the widget; internet banking details split onto separate
//   lines (heading, account name, account number).
// v1.0.1 changes: deposit box wording shortened (removed the "helps us avoid no-shows" sentence).
// v1.0.0 changes: payment options account name now "Keane and Matthews Partnership";
//   added a clear $35 deposit request box.
//
// Called by a database trigger (on_booking_created_send_confirmation) the
// instant a new row lands in game_bookings — NOT called directly by any
// app. Auth is a shared-secret check (the trigger sends the project's own
// service role key as the bearer token), not a normal staff login, since
// this needs to fire for anonymous public bookings too.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUILD_VERSION = 'v1.6.0'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function formatMoney(v: string | number | null): string {
  const n = Number(v || 0)
  const neg = n < 0 ? '-' : ''
  const a = Math.abs(n)
  return Number.isInteger(a) ? `${neg}$${a}` : `${neg}$${a.toFixed(2)}`
}

function formatDate(dateStr: string): string {
  // dateStr is 'YYYY-MM-DD', a plain NZ local date with no time component
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function formatTime(timeStr: string): string {
  // timeStr is 'HH:MM:SS'
  const [h, min] = timeStr.split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return min === 0 ? `${h12}${ampm}` : `${h12}:${String(min).padStart(2, '0')}${ampm}`
}

function icsTimestamp(dateStr: string, timeStr: string): string {
  // e.g. '2026-08-04', '10:30:00' -> '20260804T103000'
  return `${dateStr.replace(/-/g, '')}T${timeStr.replace(/:/g, '')}`
}

function addMinutes(timeStr: string, minsToAdd: number): string {
  const [h, m, s] = timeStr.split(':').map(Number)
  const total = h * 60 + m + minsToAdd
  const nh = Math.floor(total / 60) % 24
  const nm = total % 60
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}:${String(s || 0).padStart(2, '0')}`
}
function toMins(t: string): number { const [h, m] = t.split(':').map(Number); return h * 60 + m }

function buildIcs(opts: { uid: string; gameName: string; dateStr: string; startTime: string; durationMins: number; address: string }): string {
  const endTime = addMinutes(opts.startTime, opts.durationMins)
  const dtStart = icsTimestamp(opts.dateStr, opts.startTime)
  const dtEnd = icsTimestamp(opts.dateStr, endTime)
  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Beyond the Box//Booking Confirmation//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${opts.uid}@btbescaperooms.co.nz`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;TZID=Pacific/Auckland:${dtStart}`,
    `DTEND;TZID=Pacific/Auckland:${dtEnd}`,
    `SUMMARY:${opts.gameName} — Beyond the Box`,
    `LOCATION:${opts.address}`,
    `DESCRIPTION:Your Beyond the Box booking. Arrive 5 minutes early — doors open before briefing.`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

const VENUE_ADDRESS = 'Upstairs, 105 Market Street North, Hastings'
// Where the customer pages live (change when the app moves from /test/ to the live site)
const PUBLIC_BASE = 'https://btbescaperooms.co.nz/test/'
function invoiceBox(url: string): string {
  return `<p style="margin:14px 0 0;font-size:14px;color:#374151">🧾 <strong>Need a tax invoice?</strong> <a href="${url}" style="color:#07b4c5">Fill in your invoice details</a> (company name, PO number, accounts email) and we'll email you an invoice.</p>`
}
const DEPOSIT_REQUEST_AMOUNT = 35 // per game

// Emoji shown before the game name (only games listed here get one)
function gameEmoji(gameName: string): string {
  const n = gameName.toLowerCase()
  if (n.includes('sherlock')) return '🕵️ '
  if (n.includes('gregg in the box')) return '📦 '
  if (n.includes('saving christmas')) return '🎄 '
  return ''
}

// Plain-English version of what the customer picked on the booking widget
function depositMethodText(method: string | null): string {
  switch (method) {
    case 'stripe': return 'card'
    case 'bank_transfer': return 'bank transfer'
    case 'cash': return 'cash in person'
    case 'invoice': return 'invoice'
    default: return ''
  }
}

const PAYMENT_OPTIONS = `
    <h2 style="font-size:15px;color:#111827;margin:0 0 8px">Payment options</h2>
    <ul style="font-size:14px;color:#374151;padding-left:20px;margin:0 0 20px">
      <li>Internet Banking<br>Account name: Keane and Matthews Partnership<br>Account number: 38-9022-0859175-00</li>
      <li>Cash on the day</li>
      <li>Eftpos on the day</li>
      <li>Invoice by arrangement</li>
    </ul>`

const SIGN_OFF = `
    <p style="font-size:14px;margin:20px 0 4px">We're looking forward to seeing you!</p>
    <p style="font-size:14px;margin:0 0 20px"><em>The team at Beyond the Box Escape Rooms — Joolz &amp; Keren</em><br>
    <a href="mailto:info@BtbEscapeRooms.co.nz" style="color:#07b4c5">info@BtbEscapeRooms.co.nz</a> · 0220 537 365</p>

    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">

    <p style="font-size:13px;color:#6b7280;margin:0 0 4px"><strong>Need to change or cancel your booking?</strong></p>
    <p style="font-size:13px;color:#6b7280;margin:0">Just reply to this email or give us a call/text on 0220 537 365 as soon as you can. We ask for as much notice as possible — ideally at least 24 hours — so we can offer your slot to someone else. Deposits may not be refundable for late cancellations or no-shows, but we're always happy to talk through rescheduling instead.</p>

    <p style="font-size:12px;color:#9ca3af;margin:20px 0 0">A calendar invite is attached to this email.</p>`

function buildEmailHtml(opts: {
  firstName: string; gameName: string; dateDisplay: string; timeDisplay: string; players: number;
  total: string; depositAmount: number; depositMethod: string | null; invoiceUrl?: string;
}): string {
  const greeting = opts.firstName ? `Hi ${esc(opts.firstName)},` : 'Hi there,'
  const deposit = formatMoney(DEPOSIT_REQUEST_AMOUNT)
  let depositText: string
  if (opts.depositMethod === 'stripe') {
    // Card can't be taken online — ask them to call and pop in during open hours
    depositText = `Your booking is made. Please pay your ${deposit} deposit as soon as you can. You chose to pay by card — please call us to see when you can pop in and pay by eftpos or credit card (we're always open Saturdays 10am to 2pm). The remaining balance is due on the day.`
  } else if (opts.depositMethod === 'cash') {
    // Cash is paid in person — ask them to call and arrange a time to pop in
    depositText = `Your booking is made. Please pay your ${deposit} deposit as soon as you can. You chose to pay by cash — please call us to see when you can pop in and pay your deposit (we're always open Saturdays 10am to 2pm). The remaining balance is due on the day.`
  } else {
    const methodText = depositMethodText(opts.depositMethod)
    const methodLine = methodText ? ` You chose to pay by ${methodText}.` : ''
    depositText = `Your booking is made. Please pay your ${deposit} deposit as soon as you can using one of the options below.${methodLine} The remaining balance is due on the day.`
  }
  const depositLine = `<div style="margin:12px 0 0;padding:12px 14px;background:#ecfeff;border:1px dashed #07b4c5;border-radius:8px">
      <p style="margin:0 0 4px;font-size:15px;color:#111827"><strong>Please pay your ${deposit} deposit</strong></p>
      <p style="margin:0;font-size:14px;color:#374151">${depositText}</p>
    </div>`
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111827">
    <p style="font-size:14px;margin:0 0 12px;color:#4b5563">${greeting}</p>
    <h1 style="color:#07b4c5;font-size:22px;margin:0 0 2px">— Congratulations —</h1>
    <h1 style="color:#07b4c5;font-size:22px;margin:0 0 8px">you're booked!</h1>
    <p style="font-size:16px;margin:0 0 2px">with Beyond the Box Escape Rooms</p>
    <p style="font-size:22px;margin:0 0 16px;color:#07b4c5"><strong>${gameEmoji(opts.gameName)}${esc(opts.gameName)}</strong></p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <tr><td style="padding:4px 0;color:#6b7280;font-size:14px">📅 Date</td><td style="padding:4px 0;font-size:14px"><strong>${opts.dateDisplay}</strong></td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;font-size:14px">🕐 Time</td><td style="padding:4px 0;font-size:14px"><strong>${opts.timeDisplay}</strong></td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;font-size:14px">👥 Players</td><td style="padding:4px 0;font-size:14px"><strong>${opts.players}</strong></td></tr>
    </table>

    <p style="font-size:18px;margin:0"><strong>Total: ${opts.total}</strong></p>
    ${depositLine}
    ${opts.invoiceUrl ? invoiceBox(opts.invoiceUrl) : ''}

    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
    ${PAYMENT_OPTIONS}

    <h2 style="font-size:15px;color:#111827;margin:0 0 8px">FAQ</h2>

    <p style="font-size:14px;margin:0 0 4px"><strong>Where should I come?</strong></p>
    <p style="font-size:14px;color:#374151;margin:0 0 12px">${VENUE_ADDRESS}. Look for the pathway sign with Beyond the Box on it.</p>

    <p style="font-size:14px;margin:0 0 4px"><strong>What time should I arrive?</strong></p>
    <p style="font-size:14px;color:#374151;margin:0 0 12px">Briefing starts at your booking time — doors open 5 minutes before.</p>

    <p style="font-size:14px;margin:0 0 4px"><strong>How long have I got in the room?</strong></p>
    <p style="font-size:14px;color:#374151;margin:0 0 12px">A brief intro, then up to an hour of gameplay.</p>

    <p style="font-size:14px;margin:0 0 4px"><strong>Can I bring more people than I booked for?</strong></p>
    <p style="font-size:14px;color:#374151;margin:0 0 12px">Yes, up to the room maximum — extra guests can pay individually.</p>

    <p style="font-size:14px;margin:0 0 4px"><strong>Can I bring fewer people than I booked for?</strong></p>
    <p style="font-size:14px;color:#374151;margin:0 0 12px">Yes — just note the room has a minimum charge regardless of numbers, which is already reflected in your total above.</p>
    ${SIGN_OFF}
  </div>`
}

// ── PACKAGE (several bookings sharing a group_booking_id) ─────────────
type Row = Record<string, any>
function parseList(v: unknown): any[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string' && v.trim()) { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}
const td = 'padding:8px 6px;font-size:14px;border-bottom:1px solid #f1f5f9;vertical-align:top'
const tdR = td + ';text-align:right;white-space:nowrap'

export function buildPackageHtml(o: { firstName: string; dateDisplay: string; rows: Row[]; durations: Record<string, number>; invoiceUrl?: string }): { html: string; total: number } {
  const rows = o.rows
  const greeting = o.firstName ? `Hi ${esc(o.firstName)},` : 'Hi there,'
  const isHire = rows.some(r => r.play_location === 'hire')
  const times = [...new Set(rows.map(r => r.slot_time))]
  const sameTime = times.length === 1
  const tbc = rows.some(r => r.time_tbc)

  const gameLines: string[] = []
  const extraLines: string[] = []
  let total = 0
  for (const r of rows) {
    const rowTotal = Number(r.total_amount || 0)
    total += rowTotal
    const addons = parseList(r.addons)
    const hireExtras = parseList(r.hire_extras)
    const fees = Number(r.gm_fee || 0) + Number(r.travel_fee || 0)
    const extrasSum = addons.reduce((a, x) => a + (Number(x.amount) || 0), 0) + hireExtras.reduce((a, x) => a + (Number(x.amount) || 0), 0)
    const gamePrice = rowTotal - extrasSum - fees
    const when = r.play_location === 'hire' ? (r.time_tbc ? 'time to be confirmed' : `from ${formatTime(r.slot_time)}`) : formatTime(r.slot_time)
    const who = r.play_location === 'hire' ? 'hired out' : `${r.players_booked} player${r.players_booked === 1 ? '' : 's'}`
    gameLines.push(`<tr><td style="${td}"><strong>${gameEmoji(r.game_name || '')}${esc(r.game_name)}</strong><br><span style="color:#6b7280;font-size:13px">${when} · ${who}</span></td><td style="${tdR}">${formatMoney(gamePrice)}</td></tr>`)
    for (const x of addons) extraLines.push(`<tr><td style="${td}">${esc(x.label || 'Extra')}</td><td style="${tdR}">${formatMoney(x.amount)}</td></tr>`)
    if (Number(r.gm_fee || 0)) extraLines.push(`<tr><td style="${td}">Game master</td><td style="${tdR}">${formatMoney(r.gm_fee)}</td></tr>`)
    if (Number(r.travel_fee || 0)) extraLines.push(`<tr><td style="${td}">Travel</td><td style="${tdR}">${formatMoney(r.travel_fee)}</td></tr>`)
    for (const x of hireExtras) extraLines.push(`<tr><td style="${td}">${esc(x.label || 'Extra')}</td><td style="${tdR}">${formatMoney(x.amount)}</td></tr>`)
  }

  const games = rows.length
  const depositDue = DEPOSIT_REQUEST_AMOUNT * games
  const depositPaid = rows.reduce((a, r) => a + (r.deposit_paid ? Number(r.deposit_amount || 0) : 0), 0)
  const depositStill = Math.max(0, Math.min(depositDue, total) - depositPaid)
  const balance = Math.max(0, total - Math.max(depositPaid, Math.min(depositDue, total)))

  const start = rows.map(r => r.slot_time).sort()[0]
  const whenLine = isHire
    ? (tbc ? 'Time: to be confirmed — we\'ll be in touch' : `Starting ${formatTime(start)}`)
    : sameTime ? `All games start at ${formatTime(start)}` : `Starting ${formatTime(start)} — times for each game below`

  const depositBox = depositStill > 0
    ? `<div style="margin:14px 0 0;padding:12px 14px;background:#ecfeff;border:1px dashed #07b4c5;border-radius:8px">
        <p style="margin:0 0 4px;font-size:15px;color:#111827"><strong>Please pay your ${formatMoney(depositStill)} deposit</strong></p>
        <p style="margin:0;font-size:14px;color:#374151">That's ${formatMoney(DEPOSIT_REQUEST_AMOUNT)} per game${depositPaid ? ` (less the ${formatMoney(depositPaid)} already paid — thank you)` : ''}. Please pay it as soon as you can using one of the options below. The rest is due on the day.</p></div>`
    : `<div style="margin:14px 0 0;padding:12px 14px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px">
        <p style="margin:0;font-size:14px;color:#166534"><strong>Deposit received — thank you!</strong> The rest is due on the day.</p></div>`

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111827">
    <p style="font-size:14px;margin:0 0 12px;color:#4b5563">${greeting}</p>
    <h1 style="color:#07b4c5;font-size:22px;margin:0 0 2px">— Congratulations —</h1>
    <h1 style="color:#07b4c5;font-size:22px;margin:0 0 8px">you're booked!</h1>
    <p style="font-size:16px;margin:0 0 14px">with Beyond the Box Escape Rooms</p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:6px">
      <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;width:80px">📅 Date</td><td style="padding:3px 0;font-size:14px"><strong>${o.dateDisplay}</strong></td></tr>
      <tr><td style="padding:3px 0;color:#6b7280;font-size:14px">🕐 Time</td><td style="padding:3px 0;font-size:14px"><strong>${whenLine}</strong></td></tr>
      ${isHire && rows[0].venue_address ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px">📍 Venue</td><td style="padding:3px 0;font-size:14px"><strong>${esc(rows[0].venue_address)}</strong></td></tr>` : ''}
    </table>

    <h2 style="font-size:15px;color:#111827;margin:18px 0 4px">Your booking</h2>
    <table style="width:100%;border-collapse:collapse">
      <tr><th style="text-align:left;font-size:12px;color:#6b7280;padding:6px;border-bottom:2px solid #e5e7eb;font-weight:600">Item</th><th style="text-align:right;font-size:12px;color:#6b7280;padding:6px;border-bottom:2px solid #e5e7eb;font-weight:600">Amount</th></tr>
      ${gameLines.join('')}
      ${extraLines.join('')}
      <tr><td style="padding:10px 6px;font-size:16px"><strong>Total</strong></td><td style="padding:10px 6px;font-size:16px;text-align:right"><strong>${formatMoney(total)}</strong></td></tr>
      <tr><td style="padding:2px 6px;font-size:14px;color:#374151">Deposit (${formatMoney(DEPOSIT_REQUEST_AMOUNT)} × ${games} game${games === 1 ? '' : 's'})</td><td style="padding:2px 6px;font-size:14px;text-align:right;color:#374151">${formatMoney(Math.min(depositDue, total))}</td></tr>
      <tr><td style="padding:2px 6px;font-size:14px;color:#374151">Balance due on the day</td><td style="padding:2px 6px;font-size:14px;text-align:right;color:#374151">${formatMoney(balance)}</td></tr>
    </table>
    ${depositBox}
    ${o.invoiceUrl ? invoiceBox(o.invoiceUrl) : ''}

    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
    ${PAYMENT_OPTIONS}

    <h2 style="font-size:15px;color:#111827;margin:0 0 8px">FAQ</h2>
    ${isHire ? '' : `<p style="font-size:14px;margin:0 0 4px"><strong>Where should I come?</strong></p>
    <p style="font-size:14px;color:#374151;margin:0 0 12px">${VENUE_ADDRESS}. Look for the pathway sign with Beyond the Box on it.</p>

    <p style="font-size:14px;margin:0 0 4px"><strong>What time should I arrive?</strong></p>
    <p style="font-size:14px;color:#374151;margin:0 0 12px">Briefing starts at your booking time — doors open 5 minutes before. Please arrive a few minutes before the first game.</p>`}

    <p style="font-size:14px;margin:0 0 4px"><strong>Can numbers change?</strong></p>
    <p style="font-size:14px;color:#374151;margin:0 0 12px">Yes — just let us know. Extra guests can pay on the day, and each room has a minimum charge that's already included in your total above.</p>
    ${SIGN_OFF}
  </div>`
  return { html, total }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendKey = Deno.env.get('RESEND_API_KEY')

    const authHeader = req.headers.get('Authorization') || ''
    if (authHeader !== `Bearer ${serviceKey}`) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(supabaseUrl, serviceKey)
    const body = await req.json()
    const bookingId = body.booking_id as string
    const preview = body.preview === true
    const force = body.force === true
    if (!bookingId) return json({ error: 'Missing booking_id' }, 400)

    const COLS = 'id, client_id, game_id, game_name, booking_date, slot_time, players_booked, total_amount, deposit_amount, deposit_paid, deposit_method, skip_confirmation_email, confirmation_email_sent_at, status, group_booking_id, addons, hire_extras, gm_fee, travel_fee, play_location, venue_address, time_tbc, created_at, public_token'
    const { data: booking, error: bErr } = await admin.from('game_bookings').select(COLS).eq('id', bookingId).maybeSingle()
    if (bErr) return json({ error: bErr.message }, 500)
    if (!booking) return json({ error: 'Booking not found' }, 404)

    if (!preview) {
      if (booking.skip_confirmation_email && !force) return json({ ok: true, skipped: 'flagged_no_email' })
      if (booking.confirmation_email_sent_at && !force) return json({ ok: true, skipped: 'already_sent' })
      if (booking.status && booking.status !== 'confirmed') return json({ ok: true, skipped: 'status_' + booking.status })
    }
    if (!resendKey && !preview) return json({ error: 'RESEND_API_KEY not configured yet' }, 500)

    // Package? Gather every game in it. Only the first game (earliest time, then id) sends the email.
    let members: Row[] = [booking]
    if (booking.group_booking_id) {
      const { data: grp } = await admin.from('game_bookings').select(COLS).eq('group_booking_id', booking.group_booking_id).neq('status', 'cancelled')
      if (grp && grp.length > 1) {
        members = grp.sort((a: Row, b: Row) => String(a.slot_time).localeCompare(String(b.slot_time)) || String(a.id).localeCompare(String(b.id)))
        if (!preview && !force && members[0].id !== booking.id) return json({ ok: true, skipped: 'package_member_sent_by_first_game' })
        if (!preview && !force && members.some(m => m.confirmation_email_sent_at)) return json({ ok: true, skipped: 'already_sent' })
      }
    }
    const isPackage = members.length > 1

    const { data: client } = await admin.from('clients').select('first_name, last_name, email').eq('id', booking.client_id).maybeSingle()
    if (!client?.email && !preview) {
      console.error('No client email on file for booking', bookingId)
      return json({ ok: false, error: 'No client email on file — confirmation not sent' })
    }

    const gameIds = [...new Set(members.map(m => m.game_id))]
    const { data: gameRows } = await admin.from('games').select('id, duration').in('id', gameIds)
    const durations: Record<string, number> = {}
    for (const g of gameRows || []) durations[g.id] = g.duration || 60

    const dateDisplay = formatDate(booking.booking_date)
    const invoiceUrl = `${PUBLIC_BASE}invoice_request.html?b=${booking.id}&t=${booking.public_token}`
    let html: string, subject: string, ics: string
    if (isPackage) {
      html = buildPackageHtml({ firstName: client?.first_name || '', dateDisplay, rows: members, durations, invoiceUrl }).html
      subject = '🔑 Your Beyond the Box booking is confirmed!'
      const start = members.map(m => m.slot_time).sort()[0]
      const end = Math.max(...members.map(m => toMins(m.slot_time) + (durations[m.game_id] || 60)))
      ics = buildIcs({ uid: booking.group_booking_id, gameName: members.map(m => m.game_name).join(' + '), dateStr: booking.booking_date, startTime: start, durationMins: end - toMins(start), address: members[0].play_location === 'hire' ? (members[0].venue_address || VENUE_ADDRESS) : VENUE_ADDRESS })
    } else {
      html = buildEmailHtml({
        firstName: client?.first_name || '',
        gameName: booking.game_name,
        dateDisplay,
        timeDisplay: formatTime(booking.slot_time),
        players: booking.players_booked,
        total: formatMoney(booking.total_amount),
        depositAmount: Number(booking.deposit_amount || 0),
        depositMethod: booking.deposit_method,
        invoiceUrl,
      })
      subject = '🔑 Your Beyond the Box booking is confirmed!'
      ics = buildIcs({ uid: booking.id, gameName: booking.game_name, dateStr: booking.booking_date, startTime: booking.slot_time, durationMins: durations[booking.game_id] || 60, address: VENUE_ADDRESS })
    }

    if (preview) return json({ ok: true, preview: true, subject, to: client?.email || null, html, version: BUILD_VERSION })

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Beyond the Box Bookings <enquiries@mail.btbescaperooms.co.nz>',
        to: [client!.email],
        subject,
        html,
        attachments: [{ filename: 'booking.ics', content: utf8ToBase64(ics) }],
      }),
    })
    const sendData = await sendRes.json()
    if (!sendRes.ok) {
      console.error('Resend error:', JSON.stringify(sendData))
      return json({ error: sendData?.message || 'Resend error' }, 502)
    }

    await admin.from('game_bookings').update({ confirmation_email_sent_at: new Date().toISOString() }).in('id', members.map(m => m.id))

    if (booking.client_id) {
      await admin.from('client_interactions').insert({
        client_id: booking.client_id,
        type: 'email',
        content: isPackage
          ? `Package confirmation sent: ${members.map(m => m.game_name).join(' + ')} on ${booking.booking_date}`
          : `Booking confirmation sent: ${booking.game_name} on ${booking.booking_date}`,
        to_do: false,
        to_do_done: false,
      })
    }

    return json({ ok: true, id: sendData?.id, version: BUILD_VERSION, package: isPackage })
  } catch (e) {
    console.error('btb-booking-confirmation error:', (e as Error).message)
    return json({ error: (e as Error).message }, 500)
  }
})
