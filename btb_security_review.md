# BtB App — Senior Review: Security Findings & Fixes

Running document. One section per file. Diffs are copy-paste ready for Claude Desktop.

Files excluded from this review (retired/superseded, per Keren):
- `enquiries.html` (replaced by `client_inbox.html`, `client_profile.html`, `clients.html`)
- root-level `booking_widget.html` (superseded by the `deepseek/` WIP version)
- `deepseek/preview-first-screen-v8.html` (explicitly excluded)

---

## FILE: btb_app.html

### Finding 1 — Stored XSS via customer-entered booking data (HIGH)

**What's wrong:** Booking cards are built with `innerHTML` and drop several customer-controlled
fields straight into the page with no escaping:
- `b.customer` (customer name — sourced from the booking widget or walk-in form)
- `b.customerPhone`, `b.customerEmail`
- `b.name_of_special_person`, `b.age_of_special_person` (free-text fields from the booking widget's
  "occasion" flow — birthday/hen-stag person name)
- `b.previous_game` (free-text "what did you play before" field)
- staff-entered booking notes (`b.notes`)
- `b.name` / `b.occasion` / `b.experience` (lower risk — these come from fixed dropdowns/admin
  config, not free text, but escaping them costs nothing and keeps the pattern consistent)

**Why it matters:** a customer could enter something like `<img src=x onerror="...">` as their
name when booking online. When staff open `btb_app.html`, that would execute inside the staff
member's own logged-in session. Staff auth tokens are stored in `localStorage` and used directly
as the API bearer token — so this is a realistic path to a staff account/session being hijacked,
not just a cosmetic bug.

**Fix:** add one small escaping helper, then wrap every customer/staff-entered field that goes
into `innerHTML` with it.

**Step 1 of 2 — add the helper.** Insert after line 398 (`function dayLbl(d){...}`):

```javascript
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
```

**Step 2 of 2 — wrap the fields.** All changes are inside `function buildCard(b){...}` (starts
line 753) and `function renderTimerBanner(){...}` (starts line 907).

<!-- REPLACE THIS OLD CODE -->
```javascript
const notesHtml=(b.notes||[]).map((n,i)=>`<div class="saved-note"><span>${n}</span><button class="del-btn" onclick="deleteNote('${b.id}',${i})"><i class="ti ti-x"></i></button></div>`).join('');
```
<!-- WITH THIS NEW CODE -->
```javascript
const notesHtml=(b.notes||[]).map((n,i)=>`<div class="saved-note"><span>${escapeHtml(n)}</span><button class="del-btn" onclick="deleteNote('${b.id}',${i})"><i class="ti ti-x"></i></button></div>`).join('');
```

<!-- REPLACE THIS OLD CODE -->
```javascript
    <div class="booking-top" onclick="togglePanel('${b.id}')">
      <div class="booking-col-left">
        <div class="booking-time"><span class="booking-time-val">${fmt12(b.time||'00:00')}</span> <span class="booking-game">${b.name}</span></div>
        <div class="booking-name">${b.customer||'—'}${b.occasion&&b.occasion.toLowerCase().includes('birthday')?' 🎂':''}</div>
        <div class="booking-meta">${b.meta||''}</div>

        ${tagHtml?`<div class="booking-tags">${tagHtml}</div>`:''}
        ${birthdayBannerHtml}
        ${(b.notes||[]).length>0?`<div class="notes-preview">${(b.notes||[]).map(n=>`<div class="note-line">📝 ${n}</div>`).join('')}</div>`:''}
      </div>
```
<!-- WITH THIS NEW CODE -->
```javascript
    <div class="booking-top" onclick="togglePanel('${b.id}')">
      <div class="booking-col-left">
        <div class="booking-time"><span class="booking-time-val">${fmt12(b.time||'00:00')}</span> <span class="booking-game">${escapeHtml(b.name)}</span></div>
        <div class="booking-name">${escapeHtml(b.customer)||'—'}${b.occasion&&b.occasion.toLowerCase().includes('birthday')?' 🎂':''}</div>
        <div class="booking-meta">${b.meta||''}</div>

        ${tagHtml?`<div class="booking-tags">${tagHtml}</div>`:''}
        ${birthdayBannerHtml}
        ${(b.notes||[]).length>0?`<div class="notes-preview">${(b.notes||[]).map(n=>`<div class="note-line">📝 ${escapeHtml(n)}</div>`).join('')}</div>`:''}
      </div>
```

<!-- REPLACE THIS OLD CODE -->
```javascript
        ${b.occasion?`<div style="font-size:11px;color:#6b7280;display:flex;align-items:center;gap:3px">🎉 ${b.occasion}${b.name_of_special_person?' — '+b.name_of_special_person+(b.age_of_special_person?' ('+b.age_of_special_person+')':''):''}${b.occasion==='Hen/Stag do'&&b.name_of_special_person?' 🥂':''}</div>`:''}
        ${b.experience?`<div style="font-size:11px;color:#6b7280;display:flex;align-items:center;gap:3px">⭐ ${b.experience}</div>`:''}
        ${b.played_before?`<div style="font-size:11px;color:#07b4c5;display:flex;align-items:center;gap:3px">👋 ${b.previous_game?'Played: '+b.previous_game:'Returning'}</div>`:''}
```
<!-- WITH THIS NEW CODE -->
```javascript
        ${b.occasion?`<div style="font-size:11px;color:#6b7280;display:flex;align-items:center;gap:3px">🎉 ${escapeHtml(b.occasion)}${b.name_of_special_person?' — '+escapeHtml(b.name_of_special_person)+(b.age_of_special_person?' ('+escapeHtml(b.age_of_special_person)+')':''):''}${b.occasion==='Hen/Stag do'&&b.name_of_special_person?' 🥂':''}</div>`:''}
        ${b.experience?`<div style="font-size:11px;color:#6b7280;display:flex;align-items:center;gap:3px">⭐ ${escapeHtml(b.experience)}</div>`:''}
        ${b.played_before?`<div style="font-size:11px;color:#07b4c5;display:flex;align-items:center;gap:3px">👋 ${b.previous_game?'Played: '+escapeHtml(b.previous_game):'Returning'}</div>`:''}
```

<!-- REPLACE THIS OLD CODE -->
```javascript
        ${b.customerPhone?`<div style="display:flex;align-items:center;gap:6px;color:#374151"><i class="ti ti-phone" style="color:#9ca3af;font-size:12px"></i> ${b.customerPhone}</div>`:''}
        ${b.customerEmail?`<div style="display:flex;align-items:center;gap:6px;color:#374151"><i class="ti ti-mail" style="color:#9ca3af;font-size:12px"></i> ${b.customerEmail}</div>`:''}
        ${b.occasion?`<div style="display:flex;align-items:center;gap:6px;color:#374151">🎉 ${b.occasion}</div>`:''}
```
<!-- WITH THIS NEW CODE -->
```javascript
        ${b.customerPhone?`<div style="display:flex;align-items:center;gap:6px;color:#374151"><i class="ti ti-phone" style="color:#9ca3af;font-size:12px"></i> ${escapeHtml(b.customerPhone)}</div>`:''}
        ${b.customerEmail?`<div style="display:flex;align-items:center;gap:6px;color:#374151"><i class="ti ti-mail" style="color:#9ca3af;font-size:12px"></i> ${escapeHtml(b.customerEmail)}</div>`:''}
        ${b.occasion?`<div style="display:flex;align-items:center;gap:6px;color:#374151">🎉 ${escapeHtml(b.occasion)}</div>`:''}
```

<!-- REPLACE THIS OLD CODE -->
```javascript
    return`<div class="timer-item"><div class="timer-countdown ${cls}" id="banner-timer-${b.id}">${fmtTimer(rem)}</div><div style="flex:1"><div class="timer-game">${b.name}</div><div class="timer-meta">${b.meta||''}</div></div><div class="timer-banner-btns"><button class="timer-help-btn" onclick="triggerHelp('${b.name}')">🚨 Help</button></div></div>`;
```
<!-- WITH THIS NEW CODE -->
```javascript
    return`<div class="timer-item"><div class="timer-countdown ${cls}" id="banner-timer-${b.id}">${fmtTimer(rem)}</div><div style="flex:1"><div class="timer-game">${escapeHtml(b.name)}</div><div class="timer-meta">${b.meta||''}</div></div><div class="timer-banner-btns"><button class="timer-help-btn" onclick="triggerHelp('${b.name}')">🚨 Help</button></div></div>`;
```

**Note on `b.meta`:** left as-is — it's built entirely from numbers and fixed strings the app
generates itself (e.g. `"4 players · Online"`), never from customer free text, so it's not part
of this risk. Confirmed by tracing every place `meta` is set (lines 574, 693 and the `pos.html`
equivalent) — none of them touch customer-entered text.

**Note on `triggerHelp('${b.name}')` in the onclick:** this inserts `b.name` (game name, not
customer text) into an inline `onclick` attribute rather than into HTML content. Since game names
are admin-configured (not customer input), this is low risk, but if you ever let game names contain
an apostrophe it would break the onclick. Flagging as a minor robustness note, not a security fix —
happy to address later if wanted.

### Still to check in btb_app.html
- Auth/role-gating on settings tabs and privileged actions (Logins & Roles, delete operations)
- Whether any Supabase REST calls build filter strings from unescaped user input (potential PostgREST
  filter injection)
- General bad-practice notes (duplicated code, error handling gaps)

---

## FILE: pos.html

### Finding 2 — Stored XSS via public gift voucher requests (HIGH — worse than Finding 1)

**What's wrong:** `gift_voucher_request.html` is a fully public page — no login required, anyone
with the link can submit it. Its `recipient`, `message`, `from_name`, and `purchased_by` (buyer
name) fields are free text, stored in the `vouchers` table, and then rendered with `innerHTML` in
`pos.html`'s voucher list (`renderVoucherList`, line 1833) with zero escaping.

**Why it matters:** this is a lower bar than Finding 1 — it doesn't even require someone to make a
booking, just submit a public form. Same consequence: malicious HTML/JS in any of those fields runs
inside a staff member's authenticated POS session.

**Fix — same helper as btb_app.html, add near the other helpers** (after line 646, `function fmt12`):

```javascript
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
```

<!-- REPLACE THIS OLD CODE -->
```javascript
${v.purchased_by?`<div style="font-size:12px;color:#6b7280">Bought by: ${v.purchased_by}</div>`:''} ${v.recipient?`<div style="font-size:12px;color:#6b7280">For: ${v.recipient}${v.from_name?' · From: '+v.from_name:''}</div>`:''} ${v.message?`<div style="font-size:12px;color:#6b7280;font-style:italic">"${v.message}"</div>`:''}<div style="font-size:11px;color:#9ca3af;margin-top:3px">Issued ${issued}${v.paid_amount?' · Paid $'+parseFloat(v.paid_amount).toFixed(0):''}${v.how_paid?' · '+v.how_paid:''}${usedDate?' · Used '+usedDate:''}</div>${v.notes?`<div style="font-size:11px;color:#9ca3af">${v.notes}</div>`:''}
```
<!-- WITH THIS NEW CODE -->
```javascript
${v.purchased_by?`<div style="font-size:12px;color:#6b7280">Bought by: ${escapeHtml(v.purchased_by)}</div>`:''} ${v.recipient?`<div style="font-size:12px;color:#6b7280">For: ${escapeHtml(v.recipient)}${v.from_name?' · From: '+escapeHtml(v.from_name):''}</div>`:''} ${v.message?`<div style="font-size:12px;color:#6b7280;font-style:italic">"${escapeHtml(v.message)}"</div>`:''}<div style="font-size:11px;color:#9ca3af;margin-top:3px">Issued ${issued}${v.paid_amount?' · Paid $'+parseFloat(v.paid_amount).toFixed(0):''}${v.how_paid?' · '+v.how_paid:''}${usedDate?' · Used '+usedDate:''}</div>${v.notes?`<div style="font-size:11px;color:#9ca3af">${escapeHtml(v.notes)}</div>`:''}
```

`v.code` is safe as-is — it's generated internally from a fixed character set (`generateVoucherCode`,
line 1824), never user input.

### Finding 3 — Same customer-name/game-name pattern as btb_app.html (HIGH)

Same root cause as Finding 1, three more spots:

<!-- REPLACE THIS OLD CODE -->
```javascript
        <div class="brow-name">${b.customer||'—'}</div>
        <div class="brow-meta">${b.name} · ${players}p</div>
```
<!-- WITH THIS NEW CODE -->
```javascript
        <div class="brow-name">${escapeHtml(b.customer)||'—'}</div>
        <div class="brow-meta">${escapeHtml(b.name)} · ${players}p</div>
```

<!-- REPLACE THIS OLD CODE -->
```javascript
          <div style="font-size:14px;font-weight:700;color:#111827">${b.customer||'—'}</div>
          <div style="font-size:11px;color:#9ca3af">${fmt12(b.time)} · ${b.name}</div>
```
<!-- WITH THIS NEW CODE -->
```javascript
          <div style="font-size:14px;font-weight:700;color:#111827">${escapeHtml(b.customer)||'—'}</div>
          <div style="font-size:11px;color:#9ca3af">${fmt12(b.time)} · ${escapeHtml(b.name)}</div>
```

### Finding 4 — Attribute-context injection via customer email (MEDIUM)

**What's wrong:** line 1168 puts `b.customerEmail` inside an HTML attribute (`value="..."`), not
just page text. This is a different flavour of the same bug — if the email contains a `"` character,
it can break out of the attribute and inject new ones (e.g. an `onmouseover` handler).

<!-- REPLACE THIS OLD CODE -->
```javascript
<input type="email" id="invoice-email-${b.id}" placeholder="Email for invoice..." value="${b.customerEmail||''}" style="width:100%;font-size:12px;font-family:inherit;border:1px solid #fbbf24;border-radius:8px;padding:7px 10px;background:#fffbeb">
```
<!-- WITH THIS NEW CODE -->
```javascript
<input type="email" id="invoice-email-${b.id}" placeholder="Email for invoice..." value="${escapeHtml(b.customerEmail)||''}" style="width:100%;font-size:12px;font-family:inherit;border:1px solid #fbbf24;border-radius:8px;padding:7px 10px;background:#fffbeb">
```

(`escapeHtml` covers `"` → `&quot;`, which is what neutralises this specific attribute-breakout.)

### Lower-priority note — PostgREST filter injection surface (LOW, staff-only)

Line 1832 builds the voucher search filter by dropping the raw search box value straight into the
URL: `` `&or=(code.ilike.*${search}*,purchased_by.ilike.*${search}*,recipient.ilike.*${search}*)` ``.
Since this box is only used by logged-in staff (not public), the practical risk is low, but a comma
or parenthesis in the search text could alter the filter logic in unexpected ways. Proper fix is
`encodeURIComponent(search)` before insertion. Flagging for later — not urgent, happy to batch it
with other staff-facing input-handling fixes rather than do it now.

### Still to check in pos.html
- Auth/role-gating on refund/void/discount actions
- Payment amount handling (any client-side trust of amounts that should be server-validated)

---

## FILE: control_room.html

**Good news first:** `populateDashboard()` (the main per-booking dashboard) already handles customer
name and notes safely — it uses `.innerText` / `.value` instead of `.innerHTML` for those fields
(lines 717, 741, 747-750), which auto-escapes. Whoever wrote that part did it right — no changes
needed there.

### Finding 5 — Same customer-name/game-name pattern, two spots (HIGH)

The "All Timers" panel and the booking picker list both build rows with `innerHTML` and drop
`bookingCustomerName(b)` and `b.game_name` in unescaped.

**Fix — add the helper** (after line 328, where `escapeGames` fallback is set, or any convenient spot
in the `<script>` block):

```javascript
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
```

<!-- REPLACE THIS OLD CODE -->
```javascript
                return `<div class="p-4 rounded-xl bg-[#231647] border border-purple-800/40 flex justify-between items-center gap-3" data-booking-id="${b.id}">
                    <div>
                        <div class="font-bold">${b.game_name}</div>
                        <div class="text-xs text-gray-400">${name} · ${b.booking_date} ${b.slot_time ? b.slot_time.substring(0,5) : ''}</div>
                    </div>
```
<!-- WITH THIS NEW CODE -->
```javascript
                return `<div class="p-4 rounded-xl bg-[#231647] border border-purple-800/40 flex justify-between items-center gap-3" data-booking-id="${b.id}">
                    <div>
                        <div class="font-bold">${escapeHtml(b.game_name)}</div>
                        <div class="text-xs text-gray-400">${escapeHtml(name)} · ${b.booking_date} ${b.slot_time ? b.slot_time.substring(0,5) : ''}</div>
                    </div>
```

<!-- REPLACE THIS OLD CODE -->
```javascript
                return `<button onclick="selectBookingFromList(${i})" class="w-full text-left p-4 rounded-xl bg-[#231647] hover:bg-[#2d1d5b] border border-purple-800/40 transition flex justify-between items-center gap-3">
                    <div>
                        <div class="font-bold">${time} — ${b.game_name}</div>
                        <div class="text-xs text-gray-400">${name} · ${b.players_booked||0} players</div>
                    </div>
```
<!-- WITH THIS NEW CODE -->
```javascript
                return `<button onclick="selectBookingFromList(${i})" class="w-full text-left p-4 rounded-xl bg-[#231647] hover:bg-[#2d1d5b] border border-purple-800/40 transition flex justify-between items-center gap-3">
                    <div>
                        <div class="font-bold">${time} — ${escapeHtml(b.game_name)}</div>
                        <div class="text-xs text-gray-400">${escapeHtml(name)} · ${b.players_booked||0} players</div>
                    </div>
```

`gmNamesFor(b)` (staff names) left as-is for now — staff names are admin-entered, not customer
input, so this is low priority. Can fold in later for consistency if wanted.

### Still to check in control_room.html
- Auth/role gating on timer start/pause/complete and review-sequence actions
- Whether any of the metric-capture inputs (clues, time taken, GM notes) get echoed back via
  `innerHTML` anywhere else in the file

---

## FILE: reports.html

### Finding 6 — Same pattern, spread across multiple report tables (HIGH)

Every report tab builds its table with `innerHTML` and drops game name, customer name, occasion,
client contact details, and voucher buyer name straight in — same root cause as the other files.
This one is spread across 4 separate tables, so it's more edits, but the same fix each time.

**Fix — add the helper**, e.g. right after `function customerName(b){` (line 587):

```javascript
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
```

**Outstanding balances table** (line 706-717):

<!-- REPLACE THIS OLD CODE -->
```javascript
      return`<tr>
        <td>${fmtDate(b.booking_date)}</td>
        <td>${b.game_name}</td>
        <td>${customerName(b)}</td>
        <td>${b.players_booked}</td>
```
<!-- WITH THIS NEW CODE -->
```javascript
      return`<tr>
        <td>${fmtDate(b.booking_date)}</td>
        <td>${escapeHtml(b.game_name)}</td>
        <td>${escapeHtml(customerName(b))}</td>
        <td>${b.players_booked}</td>
```

**Bookings table** (line 803-810):

<!-- REPLACE THIS OLD CODE -->
```javascript
  tbody.innerHTML=rows.map(b=>`<tr>
    <td>${fmtDate(b.booking_date)}</td>
    <td>${fmt12((b.slot_time||'').slice(0,5))}</td>
    <td>${b.game_name}</td>
    <td>${customerName(b)}</td>
    <td>${b.players_booked}</td>
    <td>${b.occasion||'—'}</td>
    <td>${b.source||'—'}</td>
```
<!-- WITH THIS NEW CODE -->
```javascript
  tbody.innerHTML=rows.map(b=>`<tr>
    <td>${fmtDate(b.booking_date)}</td>
    <td>${fmt12((b.slot_time||'').slice(0,5))}</td>
    <td>${escapeHtml(b.game_name)}</td>
    <td>${escapeHtml(customerName(b))}</td>
    <td>${b.players_booked}</td>
    <td>${escapeHtml(b.occasion)||'—'}</td>
    <td>${b.source||'—'}</td>
```

**No-shows/cancellations table** (line 940-944):

<!-- REPLACE THIS OLD CODE -->
```javascript
  document.getElementById('ns-tbody').innerHTML=ns.length?ns.map(b=>`<tr>
    <td>${fmtDate(b.booking_date)}</td>
    <td>${b.game_name}</td>
    <td>${customerName(b)}</td>
    <td>${b.players_booked}</td>
```
<!-- WITH THIS NEW CODE -->
```javascript
  document.getElementById('ns-tbody').innerHTML=ns.length?ns.map(b=>`<tr>
    <td>${fmtDate(b.booking_date)}</td>
    <td>${escapeHtml(b.game_name)}</td>
    <td>${escapeHtml(customerName(b))}</td>
    <td>${b.players_booked}</td>
```

**Customers table** (line 985-988) — this one's worth extra attention since `first_name`/`last_name`/
`email`/`phone` come directly from `clients` records, no fallback function in between:

<!-- REPLACE THIS OLD CODE -->
```javascript
  tbody.innerHTML=rows.map(c=>`<tr>
    <td><strong>${[c.first_name,c.last_name].filter(Boolean).join(' ')}</strong></td>
    <td>${c.email||'—'}</td>
    <td>${c.phone||'—'}</td>
```
<!-- WITH THIS NEW CODE -->
```javascript
  tbody.innerHTML=rows.map(c=>`<tr>
    <td><strong>${escapeHtml([c.first_name,c.last_name].filter(Boolean).join(' '))}</strong></td>
    <td>${escapeHtml(c.email)||'—'}</td>
    <td>${escapeHtml(c.phone)||'—'}</td>
```

**Vouchers table** (line 1103-1111):

<!-- REPLACE THIS OLD CODE -->
```javascript
    <td>${fmtMoney(v.value)}${v.type==='players'?` (${v.players}p${v.game_name?' '+v.game_name:''})`:''}${v.personalised?'<span class="badge badge-purple" style="margin-left:4px">✨ Personal</span>':''}</td>
    <td>${fmtMoney(v.paid_amount)}</td>
    <td><span class="badge ${statusBadge[v.status]||'badge-gray'}">${v.status}</span></td>
    <td>${v.issued_at?fmtDate(v.issued_at.slice(0,10)):'—'}</td>
    <td>${v.used_at?fmtDate(v.used_at.slice(0,10)):'—'}</td>
    <td>${v.purchased_by||'—'}</td>
```
<!-- WITH THIS NEW CODE -->
```javascript
    <td>${fmtMoney(v.value)}${v.type==='players'?` (${v.players}p${v.game_name?' '+escapeHtml(v.game_name):''})`:''}${v.personalised?'<span class="badge badge-purple" style="margin-left:4px">✨ Personal</span>':''}</td>
    <td>${fmtMoney(v.paid_amount)}</td>
    <td><span class="badge ${statusBadge[v.status]||'badge-gray'}">${v.status}</span></td>
    <td>${v.issued_at?fmtDate(v.issued_at.slice(0,10)):'—'}</td>
    <td>${v.used_at?fmtDate(v.used_at.slice(0,10)):'—'}</td>
    <td>${escapeHtml(v.purchased_by)||'—'}</td>
```

`v.code` left as-is — same reasoning as `pos.html`, it's system-generated.

### Still to check in reports.html
- Quick Sales table (line 1142) and Products table (line 1199) — haven't confirmed yet whether
  these render any free-text fields; will check in the products/POS-adjacent pass.
- CSV export (`lastCSVData`) isn't an XSS risk (not rendered as HTML), so no changes needed there —
  noting only so it's clear it was considered, not missed.

---

## FILE: waiver.html

### Finding 7 — Same-session reflected XSS in roster review screen (MEDIUM)

**What's wrong:** `renderRosterSummary()` (line 583) prints the names people just typed into the
group roster back onto a review screen, via `innerHTML`, unescaped (lines 590, 597).

**Why this is lower priority than the other findings:** I checked, and this roster data is
**not** displayed anywhere else in the app — `pos.html` only checks a yes/no "has a waiver been
signed" flag (`waiverBookingIds`), it never shows the actual names. So this isn't a path to a staff
account like the others were.

**Why it's still worth fixing:** waiver forms are typically filled on a shared front-desk device.
If waivers are done back-to-back on the same tablet without a full page reload between groups, one
person entering a malicious name could affect the browser tab before the next group's session. Cheap
to fix, so worth doing even though it's not urgent.

**Fix:**

```javascript
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
```

<!-- REPLACE THIS OLD CODE -->
```javascript
    adultRow.innerHTML = `<strong>${item.first_name} ${item.last_name}</strong> <span class="roster-tag tag-adult">${item.role}</span>`;
```
<!-- WITH THIS NEW CODE -->
```javascript
    adultRow.innerHTML = `<strong>${escapeHtml(item.first_name)} ${escapeHtml(item.last_name)}</strong> <span class="roster-tag tag-adult">${escapeHtml(item.role)}</span>`;
```

<!-- REPLACE THIS OLD CODE -->
```javascript
      childRow.innerHTML = `↳ ${child.first} ${child.last} <span class="roster-tag tag-child">Under 16</span>`;
```
<!-- WITH THIS NEW CODE -->
```javascript
      childRow.innerHTML = `↳ ${escapeHtml(child.first)} ${escapeHtml(child.last)} <span class="roster-tag tag-child">Under 16</span>`;
```

### Still to check in waiver.html
- Signature capture / storage handling
- Whether waiver PDF/record generation (if any) touches this same unescaped data downstream

---

## FILES: client_inbox.html, client_profile.html, clients.html

### No security fixes needed — genuinely clean

All three files already define their own `escapeHtml()` helper (identical implementation in each),
and I checked every `innerHTML` call across all three — client names, emails, phones, notes, company
names, thread messages, reply templates, all of it is already wrapped correctly. This is clearly a
more careful build pass than the older files. Nothing to fix here.

One good pattern worth copying back into `pos.html`'s voucher search (the filter-injection note in
Finding 4): `client_profile.html` line 201 uses `encodeURIComponent(company)` when building a
Supabase filter URL from user-typed text. That's exactly the fix `pos.html`'s voucher search needs.

### Bug (not security) — dangling link to a file being retired

`clients.html` line 654 has an "Open enquiry" badge that links to `enquiries.html`:

```javascript
?`<a class="enquiry-badge" href="enquiries.html" onclick="event.stopPropagation()" title="Has a pending enquiry — open Enquiries to view it">...
```

Since `enquiries.html` is being retired, this link will break once it's removed. Flagging now so it
doesn't get missed — worth deciding where this should point once `enquiries.html` is gone (maybe
back into the relevant client's own panel, since this file already has the enquiry data loaded as
`openEnquiriesByClient`). Didn't touch it since that's a product decision, not a drop-in fix — your
call on where it should point.

---

## FILE: gift_voucher_request.html

### Finding 8 — Self-XSS on the confirmation screen (LOW, but cheap to fix)

**What's wrong:** after submitting, the confirmation screen echoes the submitter's own name, phone,
email, recipient, and "from" fields back via `innerHTML`, unescaped (line 382-384).

**Why it's low priority:** this only affects the same person's own browser tab right after they
submit — it's not a path to anyone else's session. Still worth patching since it's the same data
that Finding 2 already flags as reaching staff elsewhere, and this file doesn't have an `escapeHtml`
helper yet at all.

```javascript
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
```

<!-- REPLACE THIS OLD CODE -->
```javascript
    document.getElementById('confirmCard').innerHTML = rows.map(([l,v]) =>
      `<div class="confirm-row"><span class="confirm-lbl">${l}</span><span class="confirm-val">${v}</span></div>`
    ).join('');
```
<!-- WITH THIS NEW CODE -->
```javascript
    document.getElementById('confirmCard').innerHTML = rows.map(([l,v]) =>
      `<div class="confirm-row"><span class="confirm-lbl">${escapeHtml(l)}</span><span class="confirm-val">${escapeHtml(v)}</span></div>`
    ).join('');
```

The real fix for this data (Finding 2) is already covered in the `pos.html` section — that's where
it actually reaches a staff-authenticated session, so that's the one that matters most.

---

## FILE: staff_portal.html (4,486 lines — largest file, reviewed all 60 innerHTML call sites)

No `escapeHtml()` helper exists in this file yet. Add once, anywhere in the main `<script>` block:

```javascript
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
```

### Finding 9 — "Request More Hours" message reaches the admin's session (MEDIUM-HIGH)

**What's wrong:** `r.message` — the free-text reason a staff member types when requesting more
hours — renders unescaped in **both** the staff member's own list (line 3924, `renderMyHoursRequests`)
and the admin's approval queue (line 3936, `renderAdminHoursRequests`).

**Why it matters:** this is the same class of bug as Findings 1/2, just staff→admin instead of
customer→staff. Any active staff account (including one that should have been deactivated) could put
something malicious in that message box and have it run in the owner's/GM's browser when they open
the approval queue — which is a higher-privilege target than a regular staff session.

<!-- REPLACE THIS OLD CODE -->
```javascript
    <div class="shift-notes" style="margin-top:6px">${r.message}</div>
    ${r.admin_note ? `<div class="shift-notes" style="margin-top:4px"><strong>Admin:</strong> ${r.admin_note}</div>` : ''}
```
<!-- WITH THIS NEW CODE -->
```javascript
    <div class="shift-notes" style="margin-top:6px">${escapeHtml(r.message)}</div>
    ${r.admin_note ? `<div class="shift-notes" style="margin-top:4px"><strong>Admin:</strong> ${escapeHtml(r.admin_note)}</div>` : ''}
```

<!-- REPLACE THIS OLD CODE -->
```javascript
    <div class="shift-staff-name"><i class="ti ti-user" style="font-size:12px"></i> ${r.staff_name||'Unknown'}</div>
    <div class="shift-notes" style="margin-top:4px">${r.message}</div>
```
<!-- WITH THIS NEW CODE -->
```javascript
    <div class="shift-staff-name"><i class="ti ti-user" style="font-size:12px"></i> ${escapeHtml(r.staff_name)||'Unknown'}</div>
    <div class="shift-notes" style="margin-top:4px">${escapeHtml(r.message)}</div>
```

### Finding 10 — Timesheet staff/admin notes reach the admin's session (MEDIUM-HIGH)

**What's wrong:** `buildTsCard()` (line 2834) is the shared function used everywhere timesheets are
displayed — staff's own view, admin's pending-approval queue, admin's full timesheet list. It renders
`ts.admin_notes` and `ts.staff_notes` unescaped (lines 2858-2859). Same risk as Finding 9, and fixing
it once here fixes every screen that uses timesheets.

<!-- REPLACE THIS OLD CODE -->
```javascript
    ${ts.admin_notes ? `<div class="timesheet-notes">Admin: ${ts.admin_notes}</div>` : ''}
    ${ts.staff_notes ? `<div class="timesheet-notes">You: ${ts.staff_notes}</div>` : ''}
```
<!-- WITH THIS NEW CODE -->
```javascript
    ${ts.admin_notes ? `<div class="timesheet-notes">Admin: ${escapeHtml(ts.admin_notes)}</div>` : ''}
    ${ts.staff_notes ? `<div class="timesheet-notes">You: ${escapeHtml(ts.staff_notes)}</div>` : ''}
```

### Lower-priority items in this file (all self-XSS — admin's own data reflecting back at them, not a cross-account risk)

These are still worth fixing for consistency and defense-in-depth, but none of them let one person's
input affect a *different* person's session, so I haven't written full diffs — happy to if you want
them, just flagging so nothing's missed:

- Line 2168: recurring availability block `label` — admin-entered, shown only to the admin who wrote it.
- Line 1775: `b.game_name` in the "today's bookings" staff dashboard widget — admin-controlled game names, not customer text.
- Lines 3018-3020: staff `name`/`phone`/`email` dropped into `value="..."` attributes in the admin's
  staff table — same attribute-breakout pattern as `pos.html` Finding 4, but only the admin managing
  staff records can trigger it on themselves.

### Auth/role-gating — not yet reviewed

I haven't done the privilege-check pass on this file yet (who can approve hours requests, edit staff
roles, clock other people in/out, etc.) — that's a separate pass from the XSS sweep. Will cover it
once I've finished sweeping for `innerHTML` issues across every file, so it's one focused pass instead
of splitting attention.

---

## FILE: deepseek/index.html, deepseek/script.js, deepseek/styles.css (WIP new booking widget)

No `escapeHtml()` helper exists yet in `script.js`. `index.html` has no `innerHTML` calls itself
(pure markup + loads `script.js`), so all the JS-side findings live in `script.js`.

### Finding 11 — Same review/confirmation self-XSS pattern as the old booking widget (LOW-MEDIUM, worth fixing since this is the file that becomes the new production widget)

**What's wrong:** the review screen (`showReviewScreen`, line 956) and the confirmation screen
(`showConfirmation`, line 1168) both build their summary rows from customer-typed fields — name,
occasion, special-person name/age, company name, school name, "previous game played" — and drop them
into `innerHTML` unescaped (lines 994 and 1184).

**Why this matters for this file specifically:** this is the version that's meant to eventually
replace the live `booking_widget.html`, so it's worth building the habit in now rather than
retrofitting later. On its own, this is only self-XSS (a customer's browser reflecting their own
typed input back at them before submission) — but this exact data is what later becomes
`b.customer` / `b.name_of_special_person` / `b.previous_game` on the booking record, which is the
data Finding 1 already had to fix on the receiving end (`btb_app.html`, `pos.html`). Escaping it
here too is good defense-in-depth, not a fix for a new bug.

**Fix — add the helper**, anywhere near the top of `script.js`:

```javascript
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
```

**`showReviewScreen()`, line 988** — this is the one with the most customer free text (special
name, company/school name):

<!-- REPLACE THIS OLD CODE -->
```javascript
  if (occasion) rows.push(['Occasion', occasion + (specialName ? ' — ' + specialName + (specialAge ? ' (' + specialAge + ')' : '') : '') + (companyName ? ' — ' + companyName : '') + (schoolName ? ' — ' + schoolName + (schoolAgeGroup ? ' (' + schoolAgeGroup + ')' : '') : '')]);
  if (selGame.category === 'escape' && experience) rows.push(['Experience', experience]);
  if (playedBefore) rows.push(['Played before', 'Yes' + (prevGame ? ' — ' + prevGame : '')]);
```
<!-- WITH THIS NEW CODE -->
```javascript
  if (occasion) rows.push(['Occasion', escapeHtml(occasion) + (specialName ? ' — ' + escapeHtml(specialName) + (specialAge ? ' (' + escapeHtml(specialAge) + ')' : '') : '') + (companyName ? ' — ' + escapeHtml(companyName) : '') + (schoolName ? ' — ' + escapeHtml(schoolName) + (schoolAgeGroup ? ' (' + escapeHtml(schoolAgeGroup) + ')' : '') : '')]);
  if (selGame.category === 'escape' && experience) rows.push(['Experience', experience]);
  if (playedBefore) rows.push(['Played before', 'Yes' + (prevGame ? ' — ' + escapeHtml(prevGame) : '')]);
```

**`showReviewScreen()`, line 984** (name) and **`showConfirmation()`, line 1177** (same field, second
screen) — both build `` `${first} ${last}` ``:

<!-- REPLACE THIS OLD CODE -->
```javascript
    ['Name', `${first} ${last}`],
    ['Email', email],
    ['Phone', phone],
  ];
```
<!-- WITH THIS NEW CODE -->
```javascript
    ['Name', `${escapeHtml(first)} ${escapeHtml(last)}`],
    ['Email', escapeHtml(email)],
    ['Phone', escapeHtml(phone)],
  ];
```

(That block appears once in `showReviewScreen` — line 984-986. `showConfirmation`, line 1177-1178,
has the same three-line shape but without the `Phone` row; apply the same `escapeHtml()` wrapping to
`first`, `last`, and `email` there too.)

### Lower-priority note — game name/icon in card/slot builders

`gameCardHtml()` and `slotBtnHtml()` (used at lines 493, 583, 602, 649, 712) interpolate `g.name` and
similar fields unescaped, same as every other file's game-name spots. These come from your Games
table (admin-controlled via `btb_app.html`'s Games & Activities panel), not customer input, so this
is low priority — flagging for completeness, not urgent.

### Architecture note (repeat from earlier, now confirmed after reading the code)

This confirms what the file listing suggested: the WIP widget really is split into
`index.html` / `script.js` / `styles.css` rather than one file. Functionally that's fine and each
file was easy to review on its own — just flagging again that if/when this gets folded back into a
single `.html` file (per your plan), the `escapeHtml()` fix above needs to survive that merge.

---

## Summary so far

All files in scope have now had the XSS/escaping sweep. Remaining work (not yet started):
- Auth/role-gating pass across all files (who can approve, edit, delete, view what)
- PostgREST filter-injection cleanup (`pos.html` voucher search — `encodeURIComponent`, low priority, staff-only)
- General code-quality / bad-practice notes (duplication, error handling, etc.)
- RLS hardening — already a known, accepted gap per your notes, not re-flagging as new

## Auth / Role-Gating Pass (across all files)

This ties into the already-known RLS gap in your notes, but I wanted to show the concrete,
practical consequence rather than just re-flag "RLS is open" as new — that's a different thing
from "is the app actually enforcing who can do what," and the answer is worth spelling out.

### Finding 12 — Role checks are UI-only; the real permission boundary doesn't exist for most actions (HIGH — systemic, not a single-line fix)

**What I found:** `isAdmin` (e.g. `staff_portal.html` line 1621: `['admin','manager'].includes(currentUser.role)`)
is a plain JavaScript variable, set once after login. It's used everywhere to decide what to *show* —
which buttons appear, which panels render. But the actual data reads/writes go straight to Supabase's
REST API with no server-side check that the caller is actually allowed to do that specific thing.

**Two concrete examples I traced end-to-end:**

1. **Approving/declining hours requests** (`resolveHoursRequest`, line 3945) sends a direct `PATCH` to
   `/rest/v1/hours_requests` using `H()` (which falls back to the plain anon key if no user is logged
   in). The only thing stopping a regular staff member — or anyone with the anon key, which is baked
   into every public-facing file including the completely public booking widget and gift voucher
   pages — from approving their *own* hours request via a direct API call (no staff\_portal.html,
   no login, just a `curl` command) is that the button is hidden in the UI. There's nothing checking
   this server-side.

2. **Staff wage data** (`loadAllStaff`, line 1687) fetches every column for every staff record —
   including `hourly_rate` — for any logged-in session, admin or not. The `isAdmin` check only
   decides whether the *interface* displays that field; the data itself isn't restricted by role.
   Any staff member could read every colleague's pay rate by opening the browser's network tab, no
   admin access required.

**Why I'm not writing this up as 20 individual file-by-file diffs:** every instance of this has the
same root cause and the same fix shape, so patching them one at a time would mean the same
architectural gap re-opens the next time a new feature is added. The fix that actually closes this
(and matches a pattern you're already using — the `btb-admin` edge function with the service-role
key) is:

- **Move privileged writes behind `btb-admin`** (or a new equivalent edge function) that checks the
  caller's role *server-side* before performing the action — hours request approval, role changes,
  wage edits, shift deletion, timesheet approval, etc. This is the same shape as the pattern already
  used elsewhere in your app; it just isn't applied to these actions yet.
- **For read-side wage exposure**, either restrict `hourly_rate` (and similar sensitive columns) with
  column-level RLS/a view that only returns it to admins, or split staff reads into a public-safe
  view (name, role, availability) vs. an admin-only view (adds wage data) — similar to the
  `public_staff_mode`/`public_staff_flags` view pattern you already use elsewhere.

**This is a genuine "let's talk before I build it" moment** rather than something I should just
hand you as a diff — it's a real architectural decision (which actions go through an edge function,
which get column-level RLS, whether it's worth doing before or after the POS receipt/website work),
not a drop-in fix. Want me to scope this out properly as its own follow-up conversation once the
XSS fixes are applied, or do you want to tackle it now?

## Auth / Role-Gating Fix — Scoping Document

### Correction — actual role model (checked the live schema, this is more precise than my first pass)

Roles aren't just `admin`/`manager`/`staff` as I'd assumed from the JS code. There's a dedicated
`user_roles` table (6 rows) with four actual roles: **`admin`, `manager`, `gamemaster`,
`gamemaster_own`** — each with an `allowed_tabs` list controlling which tabs of the app they can see.
`staff.user_role_id` links a staff record to one of these. This matches what you said — roles are
literally defined by which tabs each one can see, in Supabase.

**One more genuinely good finding:** the login flow itself is already done properly. When someone
logs in, the app calls a `get_my_role` edge function (server-side) to resolve their actual role —
the client never just trusts a role it invented. That part of the system is solid.

### NEW Finding 0 — the permissions table itself is wide open to the public (CRITICAL — supersedes my earlier #1)

I checked `user_roles`' live RLS policy directly. It allows **`anon` — no login at all — full
read/write/delete access**, with no restriction.

**Why this is worse than everything else found today:** `user_roles` is the table that defines who
is admin. Anyone with the public anon key (embedded in every customer-facing page) could, right now,
via a direct API call with no account:
- Read every staff member's name, email, and role
- Insert or edit a row to make any email address (including their own, if they also have or create
  any staff login) resolve to `admin` the next time `get_my_role` runs
- Or vandalize it entirely — reassign everyone's roles, wipe the table

This sits underneath everything else in this document. Fixing the `staff`/`hours_requests`/
`assigned_shifts` tables doesn't matter much if the table that decides who's an admin is itself
unprotected. **This should be the first thing fixed, not folded in with general priority.**

### Revised severity ranking

0. **CRITICAL (new) — `user_roles` open to anon.** The root-of-trust table itself. Fix first.
1. **CRITICAL — `staff` table:** any logged-in user can edit any row, including their own
   `hourly_rate` or (indirectly, via `user_role_id`) their effective role.
2. **CRITICAL — `hours_requests` and `assigned_shifts` open to anon** (no login required at all).
3. **HIGH — `timesheets`:** any logged-in user can approve their own timesheet or edit
   pay-related fields.
4. **MEDIUM — `staff_recurring_blocks` (anon-open) and `staff_availability`** (any staff login can
   edit anyone's availability, not just their own).

### On your answer about urgency ("fold in with other queued work")

That's a completely reasonable call for most of this list — but I want to flag Finding 0 (`user_roles`)
specifically, since it's a different kind of risk than "an existing staff member might misuse
access." It doesn't require any of your staff to do anything wrong — it just requires anyone finding
the anon key (visible in your public site's source) and pointing a request at Supabase directly.
Given the app isn't live yet, there's no live customer risk today, but I'd want this closed before
staff start using real logins day-to-day. Your call whether that changes the sequencing — happy to
either do just this one table now and fold the rest in later, or leave the whole list for later as
originally planned.

### Testing approach (per your answer)

Applying directly, then verifying with `get_advisors` (security type) and a manual smoke test —
logging in as each of the four roles and confirming nothing that should still work has broken.

### Decision — Finding 0 urgency

Keren has decided to treat `user_roles` the same as the rest of this list — folded in with the
general auth/role-gating work, no special-cased urgency. Noted. This whole section (Findings 0-12
inclusive) is now queued as a single future body of work, to be scheduled alongside the POS
receipt/email feature and the website overhaul, not before them.

---

## Code Quality Pass — Silent Failures (across files)

I scanned every file for empty `catch(e){}` blocks (errors that get caught and then completely
ignored — no error message, no retry, nothing). Counts: `btb_app.html` 8, `pos.html` 8,
`waiver.html` 2, `staff_portal.html` 1, `clients.html` 1, `client_inbox.html` 1,
`gift_voucher_request.html` 1, `deepseek/script.js` 1. `control_room.html`, `reports.html`, and
`client_profile.html` had none — clean on this specific point.

Most of these are genuinely fine to leave (e.g. an optional lookup that's allowed to fail quietly).
But a real, repeating pattern showed up worth flagging as one finding rather than 15 separate ones:

### Finding 13 — "Optimistic update" actions that silently fail to save (MEDIUM-HIGH, real data-integrity risk)

**The pattern:** several actions update what's shown on screen *immediately*, then fire off a save
to the database in the background — but if that background save fails (bad wifi, phone briefly
locked, Supabase hiccup), nothing tells the user. The screen still shows the change as if it worked.

**Where this actually matters, not just in theory:**

- **`pos.html` stock levels** (lines 1270, 1805, 1821) — every sale decrements `stock_qty` on screen
  immediately, then tries to save the new count. If that save fails, the screen is right but the
  database still has the old number. Do this enough times on a flaky connection and your stock
  counts silently drift from reality, and nobody finds out until a physical stocktake doesn't match.
- **`pos.html` product delete/toggle-active/toggle-favourite** (lines 1701-1703) — same shape: the
  product list updates instantly, the actual database change might not have happened, and there's no
  indication to the staff member that anything went wrong.
- **`btb_app.html` "help alert" trigger** (line 921) — when a room signals for help, if this call
  fails, staff genuinely never find out a room needs assistance, with zero error shown anywhere.
  This is the one I'd prioritise fixing first — it's the only one with a real-time, in-the-moment
  consequence rather than a discovered-later one.
- **`btb_app.html` staff deactivation** (line 1205) — if this silently fails, an admin believes
  they've removed someone's access when they haven't.

**Recommended fix shape** (illustrating with the help-alert one, since it's the highest priority):

<!-- REPLACE THIS OLD CODE -->
```javascript
try{await fetch(`${SB_URL}/rest/v1/help_alerts`,{method:'POST',headers:H(),body:JSON.stringify({room,dismissed:false})})}catch(e){}
```
<!-- WITH THIS NEW CODE -->
```javascript
try{const r=await fetch(`${SB_URL}/rest/v1/help_alerts`,{method:'POST',headers:H(),body:JSON.stringify({room,dismissed:false})});if(!r.ok)throw new Error('save failed')}catch(e){alert('Could not send help alert — please call/radio staff directly.');console.error('Help alert failed:',e)}
```

**I haven't written this same fix for all 6-7 spots** because they all need the same shape of change
(surface an error instead of swallowing it) but each one's right *wording* depends on what the user
was doing (a stock save failing should say something different than a help alert failing). Rather
than guess generic wording for all of them, I'd rather do this as its own short follow-up pass where
I write the specific message for each — happy to do that now or later, your call.

## Not yet done in this pass
- Duplication/DRY review (how much of the same logic is copy-pasted across files vs. shared)
- Magic-number / hardcoded-value audit (prices, timeouts, thresholds buried in code vs. settings)
- A closer pass on `staff_portal.html`'s remaining catch block and the deepseek file's one catch block

That's everything for this sweep unless you want me to keep going into duplication/magic-numbers —
otherwise this is a good handoff point for Claude Desktop.

---

## Code Quality Pass — Duplication & Divergence Risk

### Finding 14 — Gift vouchers are being mispriced for 3 of your 6 games, right now (HIGH — active bug, not just a duplication risk)

**What's wrong:** pricing logic is implemented three separate times (`pos.html`, `deepseek/script.js`,
`gift_voucher_request.html`), and two of those three have already drifted apart. `pos.html` and
`deepseek/script.js` both correctly handle all three pricing types your games actually use
(`per_person_tiered`, `per_hour_flat`, `per_person_per_hour`). `gift_voucher_request.html`'s
`calcPrice()` only ever does the tiered calculation — it doesn't check `pricingType` at all.

**I checked your actual games table to see how much this matters in practice — it's not a small
edge case:**

| Game | Pricing type | Priced correctly on the public voucher page? |
|---|---|---|
| Sherlock | per_person_tiered | Yes |
| Saving Christmas | per_person_tiered | Yes |
| Gregg in the Box | per_person_tiered | Yes |
| VR Hour | per_hour_flat | **No** |
| Mini Escape Room | per_hour_flat | **No** |
| Board Game Cafe | per_person_per_hour | **No** |

**Concretely:** right now, if someone requests a "players" voucher for VR Hour, Mini Escape Room, or
Board Game Cafe on the public gift voucher page, the price shown falls back to the generic tiered
default (`$35/person` unless a per-game tier is configured) instead of the game's actual flat or
per-hour-per-person rate. That's a real, live pricing mismatch between what a customer sees/pays for
a voucher and what the same game actually costs to book normally.

**Fix — bring `gift_voucher_request.html`'s `calcPrice()` in line with the other two:**

<!-- REPLACE THIS OLD CODE -->
```javascript
function calcPrice(gameId, players) {
  const tiers = (bookingConfig.gamePriceTiers||{})[gameId] || [{min:1,max:99,pp:35}];
  const tier = tiers.find(t => players >= t.min && players <= t.max) || tiers[tiers.length-1];
  return (tier ? tier.pp : 35) * players;
}
```
<!-- WITH THIS NEW CODE -->
```javascript
function calcPrice(gameId, players) {
  const game = games.find(g => g.id === gameId);
  const type = game ? (game.pricingType || 'per_person_tiered') : 'per_person_tiered';
  if (type === 'per_hour_flat') return (bookingConfig.gameFlatPrice || {})[gameId] ?? 0;
  if (type === 'per_person_per_hour') return ((bookingConfig.gamePerPersonPerHour || {})[gameId] ?? 0) * players;
  const tiers = (bookingConfig.gamePriceTiers||{})[gameId] || [{min:1,max:99,pp:35}];
  const tier = tiers.find(t => players >= t.min && players <= t.max) || tiers[tiers.length-1];
  return (tier ? tier.pp : 35) * players;
}
```

(This matches `pos.html`'s version of the function exactly, just without its object-wrapping — the
gift voucher page only ever needs the plain number, not the label/breakdown text `pos.html` and
`deepseek` build for their on-screen summaries.)

### General note on duplication (lower priority, no fix needed right now)

Beyond pricing, the `escapeHtml()` helper now needs adding to 6+ files individually (from the XSS
sweep above) rather than living in one shared place — that's an inherent tradeoff of the single-file
architecture you've deliberately chosen, not a mistake. Worth being aware of it as a category though:
**any time business logic (not just markup) is copy-pasted across files, it can silently drift apart
like the pricing did here.** Worth a quick skim of the other duplicated logic (booking-slot
availability rules, timer/duration calculations) next time you're in the code, just to confirm they
haven't drifted the same way — I haven't done that check exhaustively in this pass.

## Not yet done
- Magic-number / hardcoded-value audit
- Duplication check on booking-slot availability and timer/duration logic specifically (flagged above
  as worth a look, not yet actually compared line-by-line)

---

## Code Quality Pass — Magic Numbers & Stale Hardcoded Fallbacks

### Finding 15 — Public pages have their own hardcoded "starter" game/pricing data, and it's already out of date (MEDIUM)

**What's wrong:** `gift_voucher_request.html` and `deepseek/script.js` both start with a hardcoded
JavaScript list of games and prices, which gets overwritten once the real settings load from
Supabase. That's a reasonable pattern on its own (something to show while the real data loads) — the
problem is both hardcoded lists are already out of sync with your actual 6-game roster and with each
other:

- `gift_voucher_request.html`'s hardcoded default only lists 3 games (the original escape rooms) —
  missing VR Hour, Board Game Cafe, and Mini Escape Room entirely.
- `deepseek/script.js`'s hardcoded default has 5 of the 6 (missing Mini Escape Room).
- Neither matches the other, and both will silently drift further any time you add or reprice a game,
  since nobody updates a hardcoded JS array when they change pricing in the admin panel.

**Why this matters more than a typical "keep code tidy" note:** I checked what happens if the real
settings fetch fails (bad connection, Supabase hiccup, RLS misconfiguration) — in
`gift_voucher_request.html`, the failure is caught and only logged to the browser console
(`init()`, line 234). The page keeps running and looks completely normal to the customer — it just
silently shows the stale 3-game, possibly-outdated-price list instead. A customer could buy a
voucher at an old price, or not see games you actually offer, with no error shown to them or to you.

**What I'd suggest** (this is a design conversation, not a one-line fix, similar to the auth/role
item): rather than hardcoding a full fallback game list in two separate files, show a clear
"having trouble loading — please refresh or call us" message if the settings fetch fails, instead of
silently continuing with stale data. Happy to write that once you've had a chance to weigh in —
didn't want to guess at the right wording/behaviour without checking with you first, per your
instruction not to just implement without asking.

### Finding 16 — Timer warning threshold duplicated 4 times (LOW, fragile not broken)

The "5 minutes left" warning color change (`rem<300`) is hardcoded as the literal number `300` in
four places: `btb_app.html` (lines 913, 1610) and `control_room.html` (lines 585, 782). All four
currently agree, so nothing's actually wrong today — but if you ever want to change that warning
window (say, to 10 minutes), you'd need to remember to update all four, and it'd be easy to miss one,
leaving staff looking at two screens that disagree about whether a room is "running low." Not urgent,
just flagging so a future change doesn't silently create an inconsistency.

## Review complete — summary of everything found

| # | Finding | Severity | Status |
|---|---|---|---|
| 1-11 | XSS (unescaped customer/staff data → innerHTML) across all files | HIGH-MEDIUM | Diffs ready above |
| 12 | Role checks are UI-only, no server-side enforcement | HIGH (systemic) | Scoped, queued, no special urgency (your call) |
| 0 | `user_roles` table open to anon (root-of-trust exposure) | CRITICAL | Same queue as #12 |
| 13 | Silent failures on stock/help-alert/staff-deactivation writes | MEDIUM-HIGH | 1 example fixed, rest need custom wording |
| 14 | Gift vouchers mispriced for 3 of 6 games (live bug) | HIGH | Diff ready above |
| 15 | Stale hardcoded fallback game/price data on public pages | MEDIUM | Needs your input on desired behaviour |
| 16 | Timer warning threshold duplicated 4x | LOW | Flagged, no action needed unless you want it centralised |

Plus two smaller unresolved items already noted inline: the `pos.html` voucher-search filter-injection
note, and the decision on where the `clients.html` "Open enquiry" badge should link once
`enquiries.html` is retired.

That's the full sweep — ready for handoff to Claude Desktop.
