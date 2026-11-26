import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const clip = (v: unknown, n: number) => (v == null ? null : String(v).trim().slice(0, n) || null)
const DEPOSIT_PER_GAME = 35

// btb-public: for the customer-facing pages (booking_widget.html, invoice_request.html, invoice_view.html).
// Unlike btb-admin, this does NOT require a staff login — it's called by
// anonymous customers. Because of that, every action here must be written
// defensively: return the absolute minimum needed, never the full row, and
// never trust anything from the request body beyond what's explicitly used.
// v3 (2026-11-23): invoice_form / invoice_request / invoice_view — each needs the booking's (or invoice's)
// private link token, so a customer can only ever see or fill in their own.
// v4 (2026-11-23): invoice_view also returns deposit_due ("Deposit of $X due now" on the invoice).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey)

    const body   = await req.json()
    const action = body.action as string

    // Checks a voucher code and returns only what's needed to show/apply a
    // discount in the booking widget. Does NOT mark the voucher used — that
    // only happens at actual booking submission via redeem_voucher below,
    // so an abandoned booking never burns a customer's voucher.
    if (action === 'validate_voucher') {
      const code = String(body.code || '').trim().toUpperCase()
      if (!code) return json({ valid: false, message: 'Enter a voucher code.' })

      const { data: v, error } = await admin
        .from('vouchers')
        .select('code, type, value, players, game_id, game_name, status')
        .eq('code', code)
        .maybeSingle()

      if (error) return json({ valid: false, message: 'Could not check that code right now.' })
      if (!v || v.status !== 'active') {
        // Deliberately generic — never reveal WHY a code failed (used /
        // never existed / cancelled) to avoid helping someone guess codes.
        return json({ valid: false, message: 'That voucher code is not valid.' })
      }

      return json({
        valid: true,
        code: v.code,
        type: v.type,
        value: v.value,
        players: v.players,
        game_id: v.game_id,
        game_name: v.game_name,
      })
    }

    // Marks a voucher as used and links it to the booking that was just
    // created. Re-checks status itself (never trusts the widget) so a code
    // can't be redeemed twice even if two tabs tried to use it at once.
    if (action === 'redeem_voucher') {
      const code = String(body.code || '').trim().toUpperCase()
      const bookingId = body.bookingId as string
      if (!code || !bookingId) return json({ ok: false, message: 'Missing code or booking.' }, 400)

      const { data: updated, error } = await admin
        .from('vouchers')
        .update({ status: 'used', used_at: new Date().toISOString(), used_on_booking: bookingId })
        .eq('code', code)
        .eq('status', 'active')
        .select('code')
        .maybeSingle()

      if (error) return json({ ok: false, message: 'Could not redeem voucher.' }, 500)
      if (!updated) return json({ ok: false, message: 'Voucher was no longer valid — it may have just been used.' }, 409)

      return json({ ok: true })
    }

    // ── INVOICE DETAILS (customer) ─────────────────────────────────────
    // Looks up the booking by id + its private token (from the confirmation email or booking page).
    async function bookingByToken(): Promise<any | null> {
      const id = String(body.bookingId || ''), tok = String(body.token || '')
      if (!UUID.test(id) || !UUID.test(tok)) return null
      const { data } = await admin.from('game_bookings')
        .select('id, client_id, game_name, booking_date, slot_time, players_booked, total_amount, deposit_paid, deposit_amount, group_booking_id, status, public_token, notes_when_booked')
        .eq('id', id).maybeSingle()
      if (!data || data.public_token !== tok || data.status === 'cancelled') return null
      return data
    }

    if (action === 'invoice_form') {
      const b = await bookingByToken()
      if (!b) return json({ ok: false, message: 'This link is not valid any more — please contact us.' }, 404)
      let members = [b]
      if (b.group_booking_id) {
        const { data } = await admin.from('game_bookings')
          .select('id, game_name, booking_date, slot_time, players_booked, total_amount, deposit_paid, deposit_amount, status')
          .eq('group_booking_id', b.group_booking_id).neq('status', 'cancelled')
        if (data && data.length) members = data
      }
      const { data: c } = b.client_id
        ? await admin.from('clients').select('first_name, last_name, email, phone, company').eq('id', b.client_id).maybeSingle()
        : { data: null }
      const companyFromNotes = (String(b.notes_when_booked || '').match(/Company:\s*([^·]+)/) || [])[1]?.trim() || null
      const total = members.reduce((a, m) => a + Number(m.total_amount || 0), 0)
      const paid = members.reduce((a, m) => a + (m.deposit_paid ? Number(m.deposit_amount || 0) : 0), 0)
      const { data: prior } = await admin.from('invoice_requests').select('id, created_at').eq('booking_id', b.id).order('created_at', { ascending: false }).limit(1)
      return json({
        ok: true,
        date: b.booking_date,
        games: members.sort((x, y) => String(x.slot_time).localeCompare(String(y.slot_time))).map(m => ({ name: m.game_name, time: String(m.slot_time).slice(0, 5), players: m.players_booked })),
        total, depositDue: Math.min(total, DEPOSIT_PER_GAME * members.length), depositPaid: paid,
        prefill: { contact_name: c ? [c.first_name, c.last_name].filter(Boolean).join(' ') : null, email: c?.email || null, phone: c?.phone || null, org_name: c?.company || companyFromNotes },
        alreadySent: !!(prior && prior.length),
      })
    }

    if (action === 'invoice_request') {
      const b = await bookingByToken()
      if (!b) return json({ ok: false, message: 'This link is not valid any more — please contact us.' }, 404)
      const f = body.fields || {}
      const email = clip(f.email, 200)
      if (!clip(f.org_name, 200) || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, message: 'Please give the name to invoice and a valid email address.' }, 400)
      const what = ['deposit', 'full_now', 'full_after'].includes(f.invoice_what) ? f.invoice_what : 'full_now'
      const row = {
        booking_id: b.id, group_booking_id: b.group_booking_id, client_id: b.client_id,
        org_name: clip(f.org_name, 200), contact_name: clip(f.contact_name, 120), email, phone: clip(f.phone, 40),
        po_number: clip(f.po_number, 80), narration: clip(f.narration, 300), invoice_what: what,
        billing_address: clip(f.billing_address, 400), terms_note: clip(f.terms_note, 200), notes: clip(f.notes, 1000), source: 'customer',
      }
      const { error } = await admin.from('invoice_requests').insert(row)
      if (error) return json({ ok: false, message: 'Could not save your details — please try again or call us.' }, 500)
      // Shows as a to-do on the client so staff see it (Clients page) as well as on the Invoices page
      if (b.client_id) {
        await admin.from('client_interactions').insert({
          client_id: b.client_id, type: 'note', direction: 'inbound', to_do: true, to_do_done: false,
          content: `🧾 Invoice requested for ${b.booking_date}: ${row.org_name}${row.po_number ? ' · PO ' + row.po_number : ''} · send to ${email} · ${what === 'deposit' ? 'deposit' : what === 'full_after' ? 'full amount after the event' : 'full amount now'}`,
        })
      }
      return json({ ok: true })
    }

    if (action === 'invoice_view') {
      const id = String(body.invoiceId || ''), tok = String(body.token || '')
      if (!UUID.test(id) || !UUID.test(tok)) return json({ ok: false }, 404)
      const { data: inv } = await admin.from('invoices')
        .select('invoice_number, kind, status, issue_date, due_date, bill_to, contact_name, bill_address, po_number, reference, lines, total, gst, paid_amount, deposit_due, public_token')
        .eq('id', id).maybeSingle()
      if (!inv || inv.public_token !== tok || inv.status === 'draft') return json({ ok: false }, 404)
      delete (inv as any).public_token
      return json({ ok: true, invoice: inv })
    }

    return json({ error: 'Unknown action' }, 400)

  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
