import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function base64Encode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

// Resend signs webhooks using the Svix scheme: HMAC-SHA256 over
// "{svix-id}.{svix-timestamp}.{raw_body}" using the webhook signing secret.
async function verifySignature(req: Request, rawBody: string, secret: string): Promise<boolean> {
  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')
  if (!svixId || !svixTimestamp || !svixSignature) return false

  const secretBytes = base64Decode(secret.startsWith('whsec_') ? secret.slice(6) : secret)
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`

  const key = await crypto.subtle.importKey(
    'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent))
  const expected = base64Encode(new Uint8Array(sigBuffer))

  // svix-signature header looks like: "v1,base64sig v1,base64sig2"
  const candidates = svixSignature.split(' ').map((s) => s.split(',')[1]).filter(Boolean)
  return candidates.includes(expected)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET')
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    if (!webhookSecret) return json({ error: 'RESEND_WEBHOOK_SECRET not configured' }, 500)
    if (!resendKey) return json({ error: 'RESEND_API_KEY not configured' }, 500)

    const rawBody = await req.text()

    const valid = await verifySignature(req, rawBody, webhookSecret)
    if (!valid) return json({ error: 'Invalid signature' }, 401)

    const payload = JSON.parse(rawBody)

    if (payload.type !== 'email.received') {
      return json({ ok: true, skipped: true })
    }

    const emailId = payload.data?.email_id
    const fromRaw: string = payload.data?.from || ''
    const subject: string = payload.data?.subject || '(no subject)'
    const messageId: string = payload.data?.message_id || emailId

    // Extract plain email address. Only treat text before "<email>" as a
    // display name when that bracket format is actually present — otherwise
    // fromRaw IS just the email address and there's no name to extract.
    const emailMatch = fromRaw.match(/<([^>]+)>/)
    const fromEmail = (emailMatch ? emailMatch[1] : fromRaw).trim().toLowerCase()
    let fromName: string | null = null
    if (emailMatch && emailMatch.index !== undefined && emailMatch.index > 0) {
      const nameOnly = fromRaw.slice(0, emailMatch.index).trim().replace(/^"|"$/g, '')
      fromName = nameOnly || null
    }

    const admin = createClient(supabaseUrl, serviceKey)

    // Dedup: Resend may retry webhook delivery — skip if we've already logged this message
    if (messageId) {
      const { data: existing } = await admin
        .from('client_interactions')
        .select('id')
        .eq('external_message_id', messageId)
        .maybeSingle()
      if (existing) return json({ ok: true, duplicate: true })
    }

    // Webhook only has metadata — fetch the actual body via the Receiving API
    let bodyText = ''
    let fetchDebug = ''
    if (emailId) {
      const emailRes = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
        headers: { Authorization: `Bearer ${resendKey}` },
      })
      if (emailRes.ok) {
        const emailData = await emailRes.json()
        bodyText = emailData.text || emailData.html || ''
      } else {
        fetchDebug = `Receiving API ${emailRes.status}: ${await emailRes.text()}`
        console.log(fetchDebug)
      }
    }

    // Match sender to an existing client by email (case-insensitive)
    let clientId: string | null = null
    let clientDisplayName: string | null = fromName
    if (fromEmail) {
      const { data: existingClient } = await admin
        .from('clients')
        .select('id, first_name, last_name')
        .ilike('email', fromEmail)
        .maybeSingle()
      if (existingClient) {
        clientId = existingClient.id
        const full = [existingClient.first_name, existingClient.last_name].filter(Boolean).join(' ')
        if (full) clientDisplayName = full
      }
    }

    // Was this client already awaiting-reply before this email arrived? If
    // so, this inbound email is a REPLY to something we sent. If not (brand
    // new client, or an existing client with no open outbound item), it's a
    // GENERAL inbound email (new enquiry, cold email, etc). Must be checked
    // BEFORE we close out the open items below, or everything would look
    // like "general".
    let isReply = false
    if (clientId) {
      const { data: openOutbound } = await admin
        .from('client_interactions')
        .select('id')
        .eq('client_id', clientId)
        .eq('direction', 'outbound')
        .eq('to_do', true)
        .eq('to_do_done', false)
        .limit(1)
      isReply = !!(openOutbound && openOutbound.length > 0)
    }

    // No match — auto-create a new client record
    if (!clientId && fromEmail) {
      let firstName = 'Unknown'
      let lastName: string | null = null
      if (fromName) {
        const parts = fromName.split(' ')
        firstName = parts[0]
        lastName = parts.slice(1).join(' ') || null
      }
      const { data: newClient, error: clientErr } = await admin
        .from('clients')
        .insert({ first_name: firstName, last_name: lastName, email: fromEmail, source: 'enquiry' })
        .select('id')
        .maybeSingle()
      if (!clientErr) clientId = newClient?.id || null
    }

    // Log the inbound reply — awaiting OUR reply now
    await admin.from('client_interactions').insert({
      client_id: clientId,
      staff_id: null,
      type: 'email',
      direction: 'inbound',
      subject,
      content: bodyText || (fetchDebug ? `(body fetch failed: ${fetchDebug})` : '(no content captured)'),
      from_email: fromEmail,
      external_message_id: messageId,
      to_do: true,
      to_do_done: false,
    })

    // Close out the client's open "awaiting their reply" item(s), since they just replied
    if (clientId) {
      await admin
        .from('client_interactions')
        .update({ to_do_done: true })
        .eq('client_id', clientId)
        .eq('direction', 'outbound')
        .eq('to_do', true)
        .eq('to_do_done', false)
    }

    // Push-notify staff devices opted in for this kind of client email.
    // Internal service-to-service call: authenticates with the service role
    // key itself (see isInternalCall in btb-admin), since there's no staff
    // session here. Best-effort — never block/fail the webhook response on
    // a push failure, Resend will retry the whole webhook otherwise.
    try {
      await fetch(`${supabaseUrl}/functions/v1/btb-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          action: 'send_client_email_push',
          kind: isReply ? 'reply' : 'general',
          clientName: clientDisplayName,
          subject,
        }),
      })
    } catch (pushErr) {
      console.log('send_client_email_push call failed (non-blocking):', (pushErr as Error).message)
    }

    return json({ ok: true })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
