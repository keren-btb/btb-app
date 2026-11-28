// btb_access.js v1.0.0 (2026-11-28) — page access check shared by the staff pages.
// Each page sets window.BTB_ACCESS before loading this file:
//   { tab: 'pos' }                              → needs that tick in Settings > Logins & Roles
//   { roles: ['admin','manager'], owners: true } → needs one of those roles (or be an owner)
// Admins always get in (so an owner can never lock themselves out).
// Works on its own: it watches the shared login (btb_staff_session) and asks Supabase who
// this login is. If the page isn't allowed it covers the page with a "no access" message.
// If the internet or Supabase is down it does nothing (never locks someone out by mistake);
// the database rules still protect the data either way.
(function () {
  const SB = 'https://dcksohetvlonijtcbjwe.supabase.co';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRja3NvaGV0dmxvbmlqdGNiandlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NTQ1NzgsImV4cCI6MjA5NjQzMDU3OH0.M_oDB2e0upZUYZijNmigsmXtcKaAFx8iF-nn5FZUkzk';
  const cfg = window.BTB_ACCESS || {};
  const LABELS = { pos: 'POS', control_room: 'Control Room', task_hub: 'Task Hub', leads: 'Clients',
    staff_portal: 'Staff Portal', reports: 'Reports', calendar: 'Calendar', waiver: 'Waiver', settings: 'Settings' };
  let checkedToken = null, busy = false, shown = false;

  function parseTabs(v) {
    if (Array.isArray(v)) return v;
    try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }

  async function isOwner(token, userId) {
    try {
      const r = await fetch(`${SB}/rest/v1/staff?user_role_id=eq.${userId}&select=is_owner`,
        { headers: { apikey: ANON, Authorization: 'Bearer ' + token } });
      if (!r.ok) return false;
      const rows = await r.json();
      return !!(rows[0] && rows[0].is_owner);
    } catch (e) { return false; }
  }

  function show(role) {
    if (shown) return; shown = true;
    const what = cfg.tab ? (LABELS[cfg.tab] || cfg.tab) : 'this page';
    const box = document.createElement('div');
    box.id = 'btbNoAccess';
    box.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:#1a1035;color:#fff;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,-apple-system,Segoe UI,sans-serif');
    box.innerHTML = '<div style="max-width:360px;text-align:center">'
      + '<div style="font-size:44px;margin-bottom:10px">🔒</div>'
      + '<div style="font-size:20px;font-weight:700;margin-bottom:8px">No access to ' + what + '</div>'
      + '<div style="font-size:14px;opacity:.8;margin-bottom:20px">Your login' + (role && role.name ? ' (' + String(role.name).replace(/[<>&"]/g, '') + ')' : '')
      + ' isn\'t set up to use ' + what + '. Ask Keren or Joolz if you need it.</div>'
      + '<a href="btb_app.html" style="display:block;background:#07b4c5;color:#fff;text-decoration:none;padding:12px;border-radius:10px;font-weight:600;margin-bottom:10px">Go to the BtB App</a>'
      + '<a href="staff_portal.html" style="display:block;background:rgba(255,255,255,.12);color:#fff;text-decoration:none;padding:12px;border-radius:10px;font-weight:600;margin-bottom:10px">Staff Portal</a>'
      + '<button id="btbNoAccessOut" style="background:none;border:none;color:#fff;opacity:.7;text-decoration:underline;cursor:pointer;font-size:13px">Log out</button>'
      + '</div>';
    (document.body || document.documentElement).appendChild(box);
    document.getElementById('btbNoAccessOut').onclick = function () {
      try { localStorage.removeItem('btb_staff_session'); } catch (e) {}
      location.reload();
    };
  }

  async function check() {
    if (busy || shown) return;
    let s = null;
    try { s = JSON.parse(localStorage.getItem('btb_staff_session') || 'null'); } catch (e) {}
    if (!s || !s.token || s.token === checkedToken) return;
    if (s.expiresAt && s.expiresAt < Date.now()) return; // the page renews it, then we check
    busy = true;
    const token = s.token;
    try {
      const r = await fetch(`${SB}/functions/v1/btb-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: ANON },
        body: JSON.stringify({ action: 'get_my_role' })
      });
      if (!r.ok) return; // login not valid yet, or Supabase/internet trouble — try again later
      const role = await r.json();
      checkedToken = token;
      if (!role || !role.role) { show(role); return; }
      if (role.role === 'admin') return;
      let ok = true;
      if (cfg.tab) ok = parseTabs(role.allowed_tabs).includes(cfg.tab);
      if (ok && cfg.roles) {
        ok = cfg.roles.includes(role.role);
        if (!ok && cfg.owners) ok = await isOwner(token, role.id);
      }
      if (!ok) show(role);
    } catch (e) { /* offline — leave it */ }
    finally { busy = false; }
  }

  check();
  setInterval(check, 2000);
  window.addEventListener('storage', function (e) { if (e.key === 'btb_staff_session') check(); });
  window.btbAccessCheck = check;
})();
