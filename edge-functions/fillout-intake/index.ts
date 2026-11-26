import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function toText(v: unknown): string | null {
  if (v == null) return null
  if (Array.isArray(v)) {
    const joined = v.filter(Boolean).join(', ').trim()
    return joined || null
  }
  const s = String(v).trim()
  return s || null
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const sharedSecret = Deno.env.get('FILLOUT_WEBHOOK_SECRET')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    if (!sharedSecret) return json({ error: 'FILLOUT_WEBHOOK_SECRET not configured' }, 500)

    const url = new URL(req.url)
    const key = url.searchParams.get('key')
    const form = url.searchParams.get('form') // 'contact' | 'booking'
    if (key !== sharedSecret) return json({ error: 'Unauthorized' }, 401)
    if (form !== 'contact' && form !== 'booking') {
      return json({ error: "form param must be 'contact' or 'booking'" }, 400)
    }

    const body = await req.json().catch(() => ({}))
    const name: string = toText(body.name) || ''
    const email: string | null = toText(body.email)?.toLowerCase() || null
    const phone: string | null = toText(body.phone)
    const business: string | null = toText(body.business)
    const notes: string | null = toText(body.notes)
    const experience: string | null = toText(body.experience)
    const occasion: string | null = toText(body.occasion)

    if (!name && !email && !phone) {
      return json({ error: 'Submission had no name, email, or phone — nothing to log' }, 400)
    }

    const admin = createClient(supabaseUrl, serviceKey)
    const nameParts = name.split(' ')
    const firstName = nameParts[0] || name || 'Unknown'
    const lastName = nameParts.slice(1).join(' ') || null

    // Find or create the client — same safe RPC pattern used across the app
    // (booking_widget.html, gift_voucher_request.html), so Fillout submitters
    // become real client records instead of free text.
    let clientId: string | null = null
    let isNewClient = false
    const { data: foundId } = await admin.rpc('public_find_client_id', { p_email: email, p_phone: phone })
    if (foundId) {
      clientId = foundId
    } else {
      const { data: newId, error: createErr } = await admin.rpc('public_create_client', {
        p_first_name: firstName,
        p_last_name: lastName,
        p_email: email,
        p_phone: phone,
        p_source: 'fillout',
      })
      if (createErr) return json({ error: `Client creation failed: ${createErr.message}` }, 500)
      clientId = newId
      isNewClient = true
    }

    // Only set company on brand-new clients — never overwrite an existing
    // record's data from an inbound form submission.
    if (isNewClient && business && clientId) {
      await admin.from('clients').update({ company: business }).eq('id', clientId)
    }

    // Log the submission itself as a client interaction so it shows up in
    // the inbox, flagged for follow-up.
    const formLabel = form === 'booking' ? 'Booking form' : 'Contact/Enquiry form'
    const summaryParts = [`Submitted ${formLabel} (Fillout)`]
    if (occasion) summaryParts.push(`Occasion: ${occasion}`)
    if (experience) summaryParts.push(`Experience: ${experience}`)
    if (notes) summaryParts.push(notes)
    const summary = summaryParts.join(' — ')

    if (clientId) {
      await admin.rpc('public_log_client_contact', { p_client_id: clientId, p_summary: summary })
    }

    return json({ ok: true, clientId, isNewClient })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
