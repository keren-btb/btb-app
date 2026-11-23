import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// v1.3.0 — 2026-11-24 — Handles cal.com cancellations and reschedules automatically, and never saves the
//   same cal.com booking twice:
//   - BOOKING_CREATED: saved as before, plus cal.com's booking id (calcom_uid). If that id is already saved
//     (cal.com sent it twice), nothing new is saved.
//   - BOOKING_CANCELLED: the matching booking is marked cancelled with a note (and the reason, if given);
//     a to-do is added on the client so staff can follow up (e.g. deposit refund).
//   - BOOKING_RESCHEDULED: the matching booking is moved to the new date/time (note added, GM kept, flagged
//     in a to-do because the GM may no longer be free). If no match is found, it's saved as a new booking.
//   - Any other cal.com message is ignored (answers 200 so cal.com doesn't retry).
//   Matching: by cal.com booking id; for bookings saved before v1.3.0 (no id stored), by the customer's email
//   + the original date and time.
//   The function log no longer prints the whole message (customer details) — just the event type and ids.
// v1.2.0 — 2026-11-22 — Saves the booking's price (total_amount), worked out with the same formula as
//   POS / btb_app / the booking widget (settings btb_games + btb_booking_config).
// v1.1.0 — 2026-11-03 — Accept ANY cal.com event type, not just the 3 known games.
// v1.0.0 — original: only sherlock / gregg / saving-christmas accepted.
const FUNCTION_VERSION = '1.3.0'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const GAME_MAP: Record<string, { id: string; name: string }> = {
  'sherlock': { id: 'g1', name: 'Sherlock' },
  'gregg': { id: 'g3', name: 'Gregg in the Box' },
  'saving-christmas': { id: 'g2', name: 'Saving Christmas' },
}

function findResponseByLabel(responses: Record<string, any>, matches: string[]): string | null {
  if (!responses) return null
  for (const key of Object.keys(responses)) {
    const r = responses[key]
    const label = (r?.label || key || '').toString().toLowerCase()
    if (matches.some((m) => label.includes(m))) {
      const val = r?.value
      if (val == null) continue
      return Array.isArray(val) ? val.join(', ') : String(val)
    }
  }
  return null
}

async function calcTotal(admin: any, gameId: string, players: number): Promise<number | null> {
  try {
    const { data: rows, error } = await admin.from('settings').select('key, value').in('key', ['btb_games', 'btb_booking_config'])
    if (error || !rows) return null
    const get = (k: string) => { const r = rows.find((x: any) => x.key === k); try { return r ? JSON.parse(r.value) : null } catch { return null } }
    const games = get('btb_games')
    const cfg = get('btb_booking_config') || {}
    const game = Array.isArray(games) ? games.find((g: any) => g.id === gameId) : null
    if (!game) return null
    const type = game.pricingType || 'per_person_tiered'
    let total: number
    if (type === 'per_hour_flat') total = Number((cfg.gameFlatPrice || {})[gameId] ?? 0)
    else if (type === 'per_person_per_hour') total = Number((cfg.gamePerPersonPerHour || {})[gameId] ?? 0) * players
    else {
      const tiers = (cfg.gamePriceTiers || {})[gameId] || [{ min: 1, max: 99, pp: 35 }]
      const tier = tiers.find((t: any) => players >= t.min && players <= t.max) || tiers[tiers.length - 1]
      total = (tier ? Number(tier.pp) : 35) * players
    }
    return Number.isFinite(total) && total > 0 ? Math.round(total * 100) / 100 : null
  } catch (e) {
    console.log('PRICE CALC ERROR (booking still saved):', (e as Error).message)
    return null
  }
}

function nzDateTime(iso: string): { date: string; time: string } | null {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  return { date, time: `${time}:00` }
}
const nowNz = () => new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const sharedSecret = Deno.env.get('FILLOUT_WEBHOOK_SECRET') // reusing the same secret store
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    if (!sharedSecret) return json({ error: 'Secret not configured' }, 500)

    const url = new URL(req.url)
    const key = url.searchParams.get('key')
    if (key !== sharedSecret) return json({ error: 'Unauthorized' }, 401)

    const raw = await req.json().catch(() => ({}))
    const payload = raw.payload || raw
    const trigger = String(raw.triggerEvent || payload.triggerEvent || 'BOOKING_CREATED').toUpperCase()
    const uid: string | null = payload.uid ? String(payload.uid) : null
    const oldUid: string | null = payload.rescheduleUid || payload.fromReschedule || payload.rescheduledFromUid || null
    console.log(`[calcom-booking-intake v${FUNCTION_VERSION}] ${trigger} uid=${uid} oldUid=${oldUid}`)

    const admin = createClient(supabaseUrl, serviceKey)
    const attendee = (payload.attendees && payload.attendees[0]) || {}
    const email: string | null = (attendee.email || '').toString().trim().toLowerCase() || null

    // Find the app's booking for a cal.com booking id; older bookings (no id saved) by email + date + time
    async function findBooking(calUid: string | null, startIso: string | null) {
      if (calUid) {
        const { data } = await admin.from('game_bookings').select('id, client_id, status, staff_notes, booking_date, slot_time, game_name').eq('calcom_uid', calUid).neq('status', 'cancelled').limit(1)
        if (data && data.length) return data[0]
      }
      if (email && startIso) {
        const when = nzDateTime(startIso); if (!when) return null
        const { data: c } = await admin.rpc('public_find_client_id', { p_email: email, p_phone: null })
        if (!c) return null
        const { data } = await admin.from('game_bookings').select('id, client_id, status, staff_notes, booking_date, slot_time, game_name')
          .eq('client_id', c).eq('booking_date', when.date).eq('slot_time', when.time).eq('source', 'cal.com').neq('status', 'cancelled').limit(1)
        if (data && data.length) return data[0]
      }
      return null
    }
    const addNote = (row: any, text: string) => { let n: any[] = []; try { n = JSON.parse(row.staff_notes || '[]'); if (!Array.isArray(n)) n = [] } catch { n = [] } n.push(text); return JSON.stringify(n) }
    const todo = async (clientId: string | null, content: string) => {
      if (clientId) await admin.from('client_interactions').insert({ client_id: clientId, type: 'note', direction: 'inbound', content, to_do: true, to_do_done: false })
    }

    // ── CANCELLED ──
    if (trigger === 'BOOKING_CANCELLED') {
      const b = await findBooking(uid, payload.startTime || null)
      if (!b) return json({ ok: true, version: FUNCTION_VERSION, cancelled: false, note: 'no matching booking found' })
      const reason = (payload.cancellationReason || '').toString().trim()
      const { error } = await admin.from('game_bookings').update({
        status: 'cancelled', updated_at: new Date().toISOString(),
        staff_notes: addNote(b, `Cancelled by the customer in cal.com ${nowNz()}${reason ? ' — reason: ' + reason : ''}`),
      }).eq('id', b.id)
      if (error) return json({ error: `Cancel failed: ${error.message}` }, 500)
      await todo(b.client_id, `❌ Customer cancelled ${b.game_name} on ${b.booking_date} ${String(b.slot_time).slice(0, 5)} in cal.com${reason ? ' — "' + reason + '"' : ''}. Check whether a deposit needs refunding.`)
      return json({ ok: true, version: FUNCTION_VERSION, cancelled: true, bookingId: b.id })
    }

    // ── RESCHEDULED ──
    if (trigger === 'BOOKING_RESCHEDULED') {
      const b = await findBooking(oldUid, payload.rescheduleStartTime || null) || (uid ? await findBooking(uid, null) : null)
      const when = nzDateTime(String(payload.startTime || ''))
      if (b && when) {
        const { error } = await admin.from('game_bookings').update({
          booking_date: when.date, slot_time: when.time, calcom_uid: uid, updated_at: new Date().toISOString(),
          staff_notes: addNote(b, `Moved by the customer in cal.com ${nowNz()}: was ${b.booking_date} ${String(b.slot_time).slice(0, 5)}`),
        }).eq('id', b.id)
        if (error) return json({ error: `Reschedule failed: ${error.message}` }, 500)
        await todo(b.client_id, `🔁 Customer moved ${b.game_name} from ${b.booking_date} ${String(b.slot_time).slice(0, 5)} to ${when.date} ${when.time.slice(0, 5)} in cal.com. Check the game master is still free.`)
        return json({ ok: true, version: FUNCTION_VERSION, rescheduled: true, bookingId: b.id, to: when })
      }
      // no match: fall through and save it as a new booking
    } else if (trigger !== 'BOOKING_CREATED') {
      return json({ ok: true, version: FUNCTION_VERSION, ignored: trigger })
    }

    // ── CREATED (or a reschedule we couldn't match) ──
    if (uid) {
      const { data: dup } = await admin.from('game_bookings').select('id').eq('calcom_uid', uid).limit(1)
      if (dup && dup.length) return json({ ok: true, version: FUNCTION_VERSION, duplicate: true, bookingId: dup[0].id })
    }

    const fullName: string = (attendee.name || '').toString().trim()
    const eventSlug: string = (payload.type || '').toString().trim()
    const eventTitle: string = (payload.eventTypeTitle || '').toString().trim()
    const startTimeIso: string = (payload.startTime || '').toString().trim()
    const responses = payload.responses || {}
    const playersRaw = findResponseByLabel(responses, ['player'])
    const notes = findResponseByLabel(responses, ['note', 'quer'])
    const players = parseInt(playersRaw || '', 10) || 1

    if (!eventSlug) return json({ error: 'Missing event slug' }, 400)
    if (!startTimeIso) return json({ error: 'Missing start time' }, 400)
    if (!fullName && !email) return json({ error: 'Missing both name and email' }, 400)
    const when = nzDateTime(startTimeIso)
    if (!when) return json({ error: `Invalid start time: "${startTimeIso}"` }, 400)

    const game = GAME_MAP[eventSlug] || { id: eventSlug, name: eventTitle || eventSlug }
    const nameParts = fullName.split(' ')
    const firstName = nameParts[0] || 'Unknown'
    const lastName = nameParts.slice(1).join(' ') || null

    let clientId: string | null = null
    const { data: foundId } = await admin.rpc('public_find_client_id', { p_email: email, p_phone: null })
    if (foundId) {
      clientId = foundId
    } else {
      const { data: newId, error: createErr } = await admin.rpc('public_create_client', {
        p_first_name: firstName, p_last_name: lastName, p_email: email, p_phone: null, p_source: 'cal.com',
      })
      if (createErr) {
        console.log('CLIENT CREATE ERROR:', createErr.message)
        return json({ error: `Client creation failed: ${createErr.message}` }, 500)
      }
      clientId = newId
    }

    const totalAmount = await calcTotal(admin, game.id, players)

    const { data: bookingId, error: bookingErr } = await admin
      .from('game_bookings')
      .insert({
        client_id: clientId,
        game_id: game.id,
        game_name: game.name,
        booking_date: when.date,
        slot_time: when.time,
        players_booked: players,
        total_amount: totalAmount,
        source: 'cal.com',
        notes_when_booked: notes,
        status: 'confirmed',
        calcom_uid: uid,
      })
      .select('id')
      .single()

    if (bookingErr) {
      console.log('BOOKING INSERT ERROR:', bookingErr.message)
      return json({ error: `Booking insert failed: ${bookingErr.message}` }, 500)
    }

    return json({ ok: true, version: FUNCTION_VERSION, trigger, clientId, bookingId: bookingId?.id, gameName: game.name, nzDate: when.date, nzTime: when.time, players, totalAmount })
  } catch (e) {
    console.log('CAUGHT ERROR:', (e as Error).message)
    return json({ error: (e as Error).message }, 500)
  }
})
