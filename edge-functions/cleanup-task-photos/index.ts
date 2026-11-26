import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// cleanup-task-photos v2.0.0 — 2026-11-22 (runs daily via pg_cron)
// Old Task Hub (task_instances): photos older than 60 days, unless flagged and not yet reviewed (unchanged).
// New Task Hub (cl_*):
//   - routine checklist photos (answers not flagged): deleted 90 days after the checklist was finished
//   - photos on answers that raised an issue: kept until every issue from that checklist has been fixed for 1 year
//   - issue photos: deleted 1 year after the issue was fixed
//   - "how it should look" reference photos and incident photos: never deleted

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
const RETENTION_DAYS = 60
const DAY = 24 * 60 * 60 * 1000

Deno.serve(async (_req) => {
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const report: Record<string, unknown> = {}
    const removeFiles = async (paths: string[]) => {
      if (!paths.length) return
      const { error } = await admin.storage.from('task-photos').remove(paths)
      if (error) console.error('Storage remove error (continuing to clear DB refs anyway):', error.message)
    }

    // ---- old Task Hub (unchanged rules) ----
    const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY).toISOString()
    const { data: instances } = await admin.from('task_instances').select('id').lt('completed_at', cutoff).or('needs_review.eq.false,reviewed.eq.true')
    if (instances && instances.length) {
      const { data: responses } = await admin.from('task_instance_responses').select('id, photo_path').in('instance_id', instances.map((i) => i.id)).not('photo_path', 'is', null)
      if (responses && responses.length) {
        await removeFiles(responses.map((r) => r.photo_path as string))
        await admin.from('task_instance_responses').update({ photo_path: null }).in('id', responses.map((r) => r.id))
        report.old_task_hub = responses.length
      }
    }

    // ---- new Task Hub: routine answer photos after 90 days ----
    const c90 = new Date(Date.now() - 90 * DAY).toISOString()
    const { data: oldRuns } = await admin.from('cl_runs').select('id').eq('status', 'done').lt('completed_at', c90).limit(1000)
    if (oldRuns && oldRuns.length) {
      const runIds = oldRuns.map((r) => r.id)
      const { data: ans } = await admin.from('cl_answers').select('id, run_id, photo_path, flagged').in('run_id', runIds).not('photo_path', 'is', null)
      const { data: iss } = await admin.from('cl_issues').select('source_run_id, status, fixed_at').in('source_run_id', runIds)
      const yearAgo = Date.now() - 365 * DAY
      const keepRun = new Set((iss || []).filter((i) => i.status !== 'fixed' || !i.fixed_at || new Date(i.fixed_at).getTime() > yearAgo).map((i) => i.source_run_id))
      // Follow-up photos (e.g. "Photo" under "Maintenance needed?") belong to a run that raised an issue — keep with it
      const runsWithFlags = new Set((ans || []).filter((a) => a.flagged).map((a) => a.run_id))
      const del = (ans || []).filter((a) => !keepRun.has(a.run_id) && (!runsWithFlags.has(a.run_id) || !(iss || []).some((i) => i.source_run_id === a.run_id && i.status !== 'fixed')))
        .filter((a) => !a.flagged || !keepRun.has(a.run_id))
      if (del.length) {
        await removeFiles(del.map((a) => a.photo_path as string))
        await admin.from('cl_answers').update({ photo_path: null }).in('id', del.map((a) => a.id))
        report.checklist_photos = del.length
      }
    }

    // ---- new Task Hub: issue photos 1 year after fixed ----
    const c365 = new Date(Date.now() - 365 * DAY).toISOString()
    const { data: oldIssues } = await admin.from('cl_issues').select('id, photo_path').eq('status', 'fixed').lt('fixed_at', c365).not('photo_path', 'is', null).limit(1000)
    if (oldIssues && oldIssues.length) {
      await removeFiles(oldIssues.map((i) => i.photo_path as string))
      await admin.from('cl_issues').update({ photo_path: null }).in('id', oldIssues.map((i) => i.id))
      report.issue_photos = oldIssues.length
    }

    return json({ ok: true, version: '2.0.0', deleted: report })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
