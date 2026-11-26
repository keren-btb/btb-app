import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

// v28 (2026-11-23): 'confirmation_email' action — staff preview / send a booking's confirmation email from BtB App.
// v27 (2026-11-23): security — every action now needs a staff login (a user_roles row), not just any
// signed-in account; the client-email push is internal-only; email "from" addresses are locked to
// @mail.btbescaperooms.co.nz; create_staff_login checks the role is a real one.

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

const VALID_ROLES = ['gamemaster_own', 'gamemaster', 'manager', 'admin']
const safeFrom = (e: unknown, fallback: string) =>
  (typeof e === 'string' && /^[a-z0-9._%+-]+@mail\.btbescaperooms\.co\.nz$/i.test(e.trim())) ? e.trim() : fallback
const safeName = (n: unknown) =>
  (typeof n === 'string' && n.trim()) ? n.replace(/[<>"\r\n]/g, '').trim().slice(0, 60) : 'Beyond the Box'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const INTERNAL_ACTIONS = new Set(['send_client_email_push'])
    const presentedToken = authHeader.replace(/^Bearer\s+/i, '')
    const isInternalCall = presentedToken === serviceKey

    const admin = createClient(supabaseUrl, serviceKey)

    let user: { id: string; email?: string } | null = null
    if (!isInternalCall) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      })
      const { data: { user: authedUser }, error: authError } = await userClient.auth.getUser()
      if (authError || !authedUser) return json({ error: 'Invalid token' }, 401)
      user = authedUser
    }

    const body   = await req.json()
    const action = body.action as string

    if (isInternalCall && !INTERNAL_ACTIONS.has(action)) {
      return json({ error: 'Action not permitted for internal calls' }, 403)
    }

    // v27: staff only. get_my_role still answers (with null) so the login screens can say "no access".
    let callerRole: string | null = null
    if (!isInternalCall) {
      const { data: roleRow } = await admin.from('user_roles').select('role').eq('id', user!.id).maybeSingle()
      callerRole = roleRow?.role ?? null
      if (!callerRole && action !== 'get_my_role') return json({ error: 'Staff login required' }, 403)
      if (INTERNAL_ACTIONS.has(action)) return json({ error: 'Internal only' }, 403)
    }

    if (action === 'get_my_role') {
      const { data, error } = await admin.from('user_roles').select('*').eq('id', user!.id).maybeSingle()
      if (error) return json({ error: error.message }, 500)
      return json(data)
    }

    // v28: BtB App > ⋯ > Confirmation email — preview it, or send it (also re-sends / sends when "don't send" was ticked).
    if (action === 'confirmation_email') {
      const bookingId = String(body.bookingId || '')
      if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return json({ error: 'Missing booking' }, 400)
      const r = await fetch(`${supabaseUrl}/functions/v1/btb-booking-confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify(body.send === true ? { booking_id: bookingId, force: true } : { booking_id: bookingId, preview: true }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.ok === false) return json({ error: d.error || `Confirmation email error ${r.status}` }, 502)
      return json(d)
    }

    if (action === 'list_enquiry_templates') {
      const { data, error } = await admin.from('enquiry_templates').select('*').eq('active', true).order('sort_order')
      if (error) return json({ error: error.message }, 500)
      return json(data)
    }

    if (action === 'send_enquiry_template_email') {
      const { to, subject, htmlBody, plainBody, fromEmail, fromName, enquiryId, templateName, clientId, staffId } = body
      const resendKey = Deno.env.get('RESEND_API_KEY')
      if (!resendKey) return json({ error: 'RESEND_API_KEY not configured yet' }, 500)
      if (!to || !subject || !htmlBody) return json({ error: 'Missing to/subject/body' }, 400)
      const from = safeFrom(fromEmail, 'enquiries@mail.btbescaperooms.co.nz')

      const sendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${safeName(fromName)} <${from}>`,
          to: [to], subject, html: htmlBody,
        }),
      })
      const sendData = await sendRes.json()
      if (!sendRes.ok) return json({ error: sendData?.message || 'Resend error' }, 502)

      if (enquiryId) {
        try {
          const { data: row } = await admin.from('game_bookings').select('staff_notes').eq('id', enquiryId).maybeSingle()
          const notes = row?.staff_notes ? JSON.parse(row.staff_notes) : []
          notes.push({ text: `Emailed: ${templateName || subject}`, by: user!.email, at: new Date().toISOString() })
          await admin.from('game_bookings').update({ staff_notes: JSON.stringify(notes) }).eq('id', enquiryId)
        } catch (_e) { /* logging is best-effort */ }
      }

      let interactionLogError: string | null = null
      if (clientId) {
        const { error: logErr } = await admin.from('client_interactions').insert({
          client_id: clientId,
          staff_id: staffId || null,
          type: 'email',
          direction: 'outbound',
          subject: subject,
          content: (plainBody && String(plainBody).trim()) || subject,
          from_email: from,
          to_do: true,
          to_do_done: false,
        })
        if (logErr) {
          interactionLogError = logErr.message
          console.error('client_interactions insert failed:', JSON.stringify(logErr))
        }
      } else {
        interactionLogError = 'No clientId was sent from the app'
        console.error('send_enquiry_template_email called with no clientId')
      }

      return json({ ok: true, id: sendData?.id, interactionLogError })
    }

    if (action === 'send_pos_receipt_email') {
      const { to, subject, htmlBody, fromEmail, fromName } = body
      const resendKey = Deno.env.get('RESEND_API_KEY')
      if (!resendKey) return json({ error: 'RESEND_API_KEY not configured yet' }, 500)
      if (!to || !subject || !htmlBody) return json({ error: 'Missing to/subject/body' }, 400)

      const sendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${safeName(fromName)} <${safeFrom(fromEmail, 'receipts@mail.btbescaperooms.co.nz')}>`,
          to: [to], subject, html: htmlBody,
        }),
      })
      const sendData = await sendRes.json()
      if (!sendRes.ok) return json({ error: sendData?.message || 'Resend error' }, 502)

      return json({ ok: true, id: sendData?.id })
    }

    if (action === 'send_voucher_email') {
      const { to, subject, htmlBody, fromEmail, fromName, voucherId, staffId } = body
      const resendKey = Deno.env.get('RESEND_API_KEY')
      if (!resendKey) return json({ error: 'RESEND_API_KEY not configured yet' }, 500)
      if (!to || !subject || !htmlBody) return json({ error: 'Missing to/subject/body' }, 400)

      const sendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${safeName(fromName)} <${safeFrom(fromEmail, 'vouchers@mail.btbescaperooms.co.nz')}>`,
          to: [to], subject, html: htmlBody,
        }),
      })
      const sendData = await sendRes.json()
      if (!sendRes.ok) return json({ error: sendData?.message || 'Resend error' }, 502)

      if (voucherId) {
        try {
          const { data: row } = await admin.from('vouchers').select('notes').eq('id', voucherId).maybeSingle()
          const stamp = `Emailed to ${to} on ${new Date().toISOString().slice(0,10)} by ${user!.email}`
          const newNotes = row?.notes ? `${row.notes} · ${stamp}` : stamp
          await admin.from('vouchers').update({ notes: newNotes }).eq('id', voucherId)
        } catch (_e) { /* logging is best-effort, never blocks the email send */ }
      }

      return json({ ok: true, id: sendData?.id })
    }

    if (action === 'close_open_email_interactions') {
      const { clientId } = body
      if (!clientId) return json({ ok: true })
      const { error } = await admin
        .from('client_interactions')
        .update({ to_do_done: true })
        .eq('client_id', clientId)
        .eq('type', 'email')
        .eq('to_do', true)
        .eq('to_do_done', false)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    if (action === 'list_open_email_interactions') {
      const { data, error } = await admin
        .from('client_interactions')
        .select('client_id, created_at')
        .eq('type', 'email')
        .eq('to_do', true)
        .eq('to_do_done', false)
        .order('created_at', { ascending: false })
      if (error) return json({ error: error.message }, 500)
      return json(data)
    }

    if (action === 'send_help_push') {
      const { room } = body
      const vapidPublic  = Deno.env.get('VAPID_PUBLIC_KEY')
      const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
      if (!vapidPublic || !vapidPrivate) return json({ error: 'VAPID keys not configured yet' }, 500)

      webpush.setVapidDetails('mailto:info@btbescaperooms.co.nz', vapidPublic, vapidPrivate)

      const { data: subs, error: subErr } = await admin.from('push_subscriptions').select('*').eq('notify_help_alerts', true)
      if (subErr) return json({ error: subErr.message }, 500)
      if (!subs || subs.length === 0) return json({ ok: true, sent: 0, failed: 0, note: 'No subscribed devices' })

      const payload = JSON.stringify({
        title: '🚨 Help needed',
        body: room ? `Help requested — ${String(room).slice(0, 80)}` : 'A help alert was raised',
        url: 'staff_portal.html',
        tag: 'btb-help-alert',
      })

      const results = await Promise.allSettled(
        subs.map((s: any) =>
          webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          )
        )
      )

      const deadEndpoints: string[] = []
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const statusCode = (r.reason as any)?.statusCode
          if (statusCode === 404 || statusCode === 410) deadEndpoints.push(subs[i].endpoint)
        }
      })
      if (deadEndpoints.length) {
        await admin.from('push_subscriptions').delete().in('endpoint', deadEndpoints)
      }

      return json({
        ok: true,
        sent: results.filter(r => r.status === 'fulfilled').length,
        failed: results.filter(r => r.status === 'rejected').length,
      })
    }

    if (action === 'send_client_email_push') {
      const { kind, clientName, subject: emailSubject } = body
      if (kind !== 'reply' && kind !== 'general') {
        return json({ error: 'kind must be "reply" or "general"' }, 400)
      }

      const vapidPublic  = Deno.env.get('VAPID_PUBLIC_KEY')
      const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
      if (!vapidPublic || !vapidPrivate) {
        console.error('send_client_email_push: VAPID keys not configured')
        return json({ error: 'VAPID keys not configured yet' }, 500)
      }

      webpush.setVapidDetails('mailto:info@btbescaperooms.co.nz', vapidPublic, vapidPrivate)

      const prefCol = kind === 'reply' ? 'notify_client_reply' : 'notify_client_general'
      const { data: subs, error: subErr } = await admin.from('push_subscriptions').select('*').eq(prefCol, true)
      if (subErr) {
        console.error('send_client_email_push: query failed:', JSON.stringify(subErr))
        return json({ error: subErr.message }, 500)
      }
      if (!subs || subs.length === 0) return json({ ok: true, sent: 0, failed: 0, note: 'No devices opted in' })

      const title = kind === 'reply' ? '✉️ Client replied' : '📩 New client email'
      const who = clientName || 'A client'
      const payload = JSON.stringify({
        title,
        body: emailSubject ? `${who} — ${emailSubject}` : `${who} sent an email`,
        url: 'clients_mobile.html',
        tag: 'btb-client-email',
      })

      const results = await Promise.allSettled(
        subs.map((s: any) =>
          webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          )
        )
      )

      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const reason: any = r.reason
          console.error(`send_client_email_push: FAILED device ${subs[i].id} — statusCode=${reason?.statusCode}`)
        }
      })

      const deadEndpoints: string[] = []
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const statusCode = (r.reason as any)?.statusCode
          if (statusCode === 404 || statusCode === 410) deadEndpoints.push(subs[i].endpoint)
        }
      })
      if (deadEndpoints.length) {
        await admin.from('push_subscriptions').delete().in('endpoint', deadEndpoints)
      }

      return json({
        ok: true,
        sent: results.filter(r => r.status === 'fulfilled').length,
        failed: results.filter(r => r.status === 'rejected').length,
      })
    }

    if (callerRole !== 'admin') return json({ error: 'Admin only' }, 403)

    if (action === 'list_roles') {
      const { data, error } = await admin.from('user_roles').select('*')
      if (error) return json({ error: error.message }, 500)
      const ROLE_RANK: Record<string, number> = { admin: 0, manager: 1, gamemaster: 2, gamemaster_own: 3 }
      const sorted = (data || []).sort((a, b) => {
        const ra = ROLE_RANK[a.role] ?? 99
        const rb = ROLE_RANK[b.role] ?? 99
        if (ra !== rb) return ra - rb
        return (a.name || '').localeCompare(b.name || '')
      })
      return json(sorted)
    }

    if (action === 'create_staff_login') {
      const { email, password, name, role, allowed_tabs } = body
      if (!VALID_ROLES.includes(role)) return json({ error: `Invalid role: ${role}` }, 400)
      const { data: authData, error: authErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      if (authErr) return json({ error: authErr.message }, 400)
      const { error: roleErr } = await admin.from('user_roles').insert({ id: authData.user.id, name, email, role, allowed_tabs })
      if (roleErr) {
        // don't leave a login behind that has no role
        await admin.auth.admin.deleteUser(authData.user.id).catch(() => {})
        return json({ error: roleErr.message }, 500)
      }
      return json({ id: authData.user.id })
    }

    if (action === 'update_tab_access') {
      const { userId, allowed_tabs } = body
      const { error } = await admin.from('user_roles').update({ allowed_tabs }).eq('id', userId)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    if (action === 'update_staff_role') {
      const { userId, role } = body
      if (!VALID_ROLES.includes(role)) return json({ error: `Invalid role: ${role}` }, 400)
      const { error } = await admin.from('user_roles').update({ role }).eq('id', userId)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    if (action === 'save_enquiry_template') {
      const { id, name, subject, from_email, from_name, body: tplBody, active, sort_order } = body
      const row = { name, subject, from_email: safeFrom(from_email, 'enquiries@mail.btbescaperooms.co.nz'), from_name, body: tplBody, active, sort_order, updated_at: new Date().toISOString() }
      if (id) {
        const { error } = await admin.from('enquiry_templates').update(row).eq('id', id)
        if (error) return json({ error: error.message }, 500)
        return json({ ok: true, id })
      } else {
        const { data, error } = await admin.from('enquiry_templates').insert(row).select('id').maybeSingle()
        if (error) return json({ error: error.message }, 500)
        return json({ ok: true, id: data?.id })
      }
    }

    if (action === 'delete_enquiry_template') {
      const { id } = body
      const { error } = await admin.from('enquiry_templates').delete().eq('id', id)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    return json({ error: 'Unknown action' }, 400)

  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
