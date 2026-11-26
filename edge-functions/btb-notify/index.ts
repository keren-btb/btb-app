// btb-notify v1.0.0 — 2026-11-22
// Phone (web push) notifications for Task Hub jobs, problems, incidents, owners' reminders and meetings.
// Called by logged-in staff pages. Sends only to devices whose owner has "Jobs & problems" switched on
// (push_subscriptions.notify_tasks). Body: { staffIds?: string[], owners?: true, title, body, url? }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)
    // Must be a logged-in staff member (the public key alone is not enough)
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return json({ error: 'Invalid token' }, 401)

    const admin = createClient(supabaseUrl, serviceKey)
    const { data: me } = await admin.from('staff').select('id').eq('user_role_id', user.id).maybeSingle()
    if (!me) return json({ error: 'Not a staff member' }, 403)

    const b = await req.json().catch(() => ({}))
    const title = String(b.title || '').slice(0, 80)
    const text = String(b.body || '').slice(0, 200)
    const url = /^[a-z_]+\.html(\?[\w=&%.-]*)?$/i.test(String(b.url || '')) ? String(b.url) : 'task_hub.html'
    if (!title) return json({ error: 'Missing title' }, 400)

    let ids: string[] = Array.isArray(b.staffIds) ? b.staffIds.filter((x: unknown) => typeof x === 'string').slice(0, 50) : []
    if (b.owners) {
      const { data: owners } = await admin.from('staff').select('id').eq('is_owner', true).eq('active', true)
      ids = ids.concat((owners || []).map((o: { id: string }) => o.id))
    }
    ids = [...new Set(ids)].filter((id) => id !== me.id) // never notify the person who did it
    if (!ids.length) return json({ ok: true, sent: 0, note: 'nobody to notify' })

    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY'), vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
    if (!vapidPublic || !vapidPrivate) return json({ error: 'VAPID keys not configured yet' }, 500)
    webpush.setVapidDetails('mailto:info@btbescaperooms.co.nz', vapidPublic, vapidPrivate)

    const { data: subs, error: subErr } = await admin.from('push_subscriptions').select('*').in('staff_id', ids).eq('notify_tasks', true)
    if (subErr) return json({ error: subErr.message }, 500)
    if (!subs || !subs.length) return json({ ok: true, sent: 0, note: 'no devices switched on' })

    const payload = JSON.stringify({ title, body: text, url, tag: 'btb-task-' + Date.now() })
    const results = await Promise.allSettled(subs.map((s: any) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)))
    const dead: string[] = []
    results.forEach((r, i) => { if (r.status === 'rejected') { const c = (r.reason as any)?.statusCode; if (c === 404 || c === 410) dead.push(subs[i].endpoint) } })
    if (dead.length) await admin.from('push_subscriptions').delete().in('endpoint', dead)
    return json({ ok: true, sent: results.filter((r) => r.status === 'fulfilled').length, failed: results.filter((r) => r.status === 'rejected').length })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
