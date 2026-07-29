// ============================================================
// script.js — all booking logic (unchanged from original)
// ============================================================

// === CONFIG ===
const SB_URL = 'https://dcksohetvlonijtcbjwe.supabase.co';
const BUILD_VERSION = '1.7.7'; // v1.7.7: removed the pause before the game name pulse (starts right as shimmer ends); reduced the gap between DATE/TIME/PLAYERS pulses from 500ms to 350ms
console.log(`%cBooking Widget — build v${BUILD_VERSION}`, 'color:#07b4c5;font-weight:bold;font-size:13px');

function nzToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function nzNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const o = {};
  parts.forEach(p => o[p.type] = p.value);
  if (o.hour === '24') o.hour = '00';
  return new Date(`${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}:${o.second}`);
}
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRja3NvaGV0dmxvbmlqdGNiandlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NTQ1NzgsImV4cCI6MjA5NjQzMDU3OH0.M_oDB2e0upZUYZijNmigsmXtcKaAFx8iF-nn5FZUkzk';
const SB_H = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SB_KEY}`, 'apikey': SB_KEY };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// === DATA ===
let games = [
  { id: 'g1', name: 'Sherlock', duration: 60, pricingType: 'per_person_tiered', icon: '🔍', bookable: true, category: 'escape' },
  { id: 'g2', name: 'Saving Christmas', duration: 60, pricingType: 'per_person_tiered', icon: '🎄', bookable: true, category: 'escape' },
  { id: 'g3', name: 'Gregg in the Box', duration: 45, pricingType: 'per_person_tiered', icon: '📦', bookable: true, category: 'escape' },
  { id: 'g4', name: 'VR Hour', duration: 60, pricingType: 'per_hour_flat', icon: '🥽', bookable: true, category: 'vr' },
  { id: 'g5', name: 'Board Game Cafe', duration: 60, pricingType: 'per_person_per_hour', icon: '🎲', bookable: true, category: 'cafe' },
];

let bookingConfig = {
  openingHours: [
    { day: 0, open: null }, { day: 1, open: null },
    { day: 2, open: '10:30', close: '20:30' }, { day: 3, open: '10:30', close: '20:30' },
    { day: 4, open: '10:30', close: '20:30' }, { day: 5, open: '10:30', close: '20:30' },
    { day: 6, open: '10:30', close: '20:30' },
  ],
  slotTimes: {
    2: { default: ['10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30'] },
    3: { default: ['10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30'] },
    4: { default: ['10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30'] },
    5: { default: ['10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30'] },
    6: { default: ['10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30'] },
  },
  gamePriceTiers: {
    g1: [{ min: 2, max: 2, pp: 50 }, { min: 3, max: 6, pp: 35 }, { min: 7, max: 99, pp: 34 }],
    g2: [{ min: 2, max: 2, pp: 50 }, { min: 3, max: 6, pp: 35 }, { min: 7, max: 99, pp: 34 }],
    g3: [{ min: 2, max: 2, pp: 50 }, { min: 3, max: 6, pp: 35 }, { min: 7, max: 99, pp: 34 }],
  },
  gameFlatPrice: { g4: 150 },
  gamePerPersonPerHour: { g5: 2 },
  gamePlayerLimits: {
    g1: { min: 2, max: 8 }, g2: { min: 2, max: 8 }, g3: { min: 2, max: 8 },
    g4: { min: 1, max: 6 }, g5: { min: 2, max: 20 },
  },
  callToBookCutoffHours: 3,
  depositAmount: 35,
};

let staffAvail = {};
let staffTraining = [];
let staffAvailStatus = {};
let rosterShifts = [];
let staffFlags = {};
let staffMode = {}; // { staff_id: 'roster'|'calendar' }
let staffCalendarBusy = []; // [{staff_id, busy_start, busy_end}] — synced Google Calendar blocks, calendar-mode staff only
let staffRecurringBlocks = []; // [{staff_id, day_of_week, start_time, end_time}] — weekly "always away" blocks, calendar-mode staff only
let trainingStatuses = [{ id: 'trained', qualifies: true }, { id: 'can_supervise', qualifies: true }];
  let existingBookings = [];

// === STATE ===
let gameWeekOffset = 0;
let selCategory = null;
let selGame = null;
let selDate = null;
let selSlot = null;
let playerCount = 2;
let playedBefore = null;
let selectedExperiences = [];
const EXPERIENCE_LEVELS = [
  { value: 'First time', label: 'First time — totally new!' },
  { value: 'Beginner', label: 'Done one or two before' },
  { value: 'Intermediate', label: 'A few under our belt' },
  { value: 'Experienced', label: 'Pretty experienced' },
  { value: 'Expert', label: 'Escape room enthusiasts' },
];
let selectedExperienceLevels = ['First time'];
let depositPref = null;
let escapeView = 'game';
let enqType = null;
let draftSaved = false;

// === INIT ===
async function init() {
  await loadSettings();
  await loadStaffData();
  await loadExistingBookings();
  populatePrevGameSelect();
}

async function loadSettings() {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/settings`, { headers: SB_H });
    const rows = await r.json();
    rows.forEach(row => {
      try {
        const d = JSON.parse(row.value);
        if (row.key === 'btb_games' && Array.isArray(d)) games = d;
        if (row.key === 'btb_training_statuses' && Array.isArray(d)) trainingStatuses = d;
        if (row.key === 'btb_booking_config' && typeof d === 'object' && !Array.isArray(d)) {
          bookingConfig = { ...bookingConfig, ...d };
        }
      } catch (e) {}
    });
  } catch (e) { console.error('Settings load error:', e); }
}

async function loadStaffData() {
  try {
    const today = nzToday();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 90);
    const future = toDateStr(futureDate);

    const sr = await fetch(
      `${SB_URL}/rest/v1/public_staff_availability?specific_date=gte.${today}&specific_date=lte.${future}&available=neq.unavailable&select=staff_id,specific_date,start_time,available`, { headers: SB_H }
    );
    const rows = await sr.json();
    staffAvail = {};
    staffAvailStatus = {};
    rows.forEach(row => {
      const ds = row.specific_date;
      const t = (row.start_time || '').slice(0, 5);
      if (!t) return;
      if (!staffAvail[row.staff_id]) staffAvail[row.staff_id] = {};
      if (!staffAvail[row.staff_id][ds]) staffAvail[row.staff_id][ds] = [];
      if (!staffAvail[row.staff_id][ds].includes(t))
        staffAvail[row.staff_id][ds].push(t);
      if (!staffAvailStatus[row.staff_id]) staffAvailStatus[row.staff_id] = {};
      staffAvailStatus[row.staff_id][ds + '_' + t] = row.available;
    });

    const tr = await fetch(`${SB_URL}/rest/v1/public_staff_training`, { headers: SB_H });
    staffTraining = await tr.json();

    const rs = await fetch(
      `${SB_URL}/rest/v1/assigned_shifts?shift_date=gte.${today}&shift_date=lte.${future}&status=neq.open&select=staff_id,shift_date,custom_start_time,custom_end_time`, { headers: SB_H }
    );
    rosterShifts = await rs.json();
    if (!Array.isArray(rosterShifts)) rosterShifts = [];

try {
      const fr = await fetch(`${SB_URL}/rest/v1/public_staff_flags?select=staff_id,trusted_opener`, { headers: SB_H });
      const flagRows = await fr.json();
      staffFlags = {};
      if (Array.isArray(flagRows)) flagRows.forEach(f => { staffFlags[f.staff_id] = f.trusted_opener === true; });
    } catch (e) { staffFlags = {}; }

    // Calendar-mode staff — availability_mode per staff (from the new view)
    try {
      const mr = await fetch(`${SB_URL}/rest/v1/public_staff_mode?select=staff_id,availability_mode`, { headers: SB_H });
      const modeRows = await mr.json();
      staffMode = {};
      if (Array.isArray(modeRows)) modeRows.forEach(m => { staffMode[m.staff_id] = m.availability_mode; });
    } catch (e) { staffMode = {}; }

    // Synced Google Calendar busy blocks (staff_calendar_busy is already open to anon)
    try {
      const cb = await fetch(`${SB_URL}/rest/v1/staff_calendar_busy?select=staff_id,busy_start,busy_end`, { headers: SB_H });
      staffCalendarBusy = await cb.json();
      if (!Array.isArray(staffCalendarBusy)) staffCalendarBusy = [];
    } catch (e) { staffCalendarBusy = []; }

    // Weekly recurring "always away" blocks e.g. a day job (staff_recurring_blocks is already open to anon)
    try {
      const rb = await fetch(`${SB_URL}/rest/v1/staff_recurring_blocks?select=staff_id,day_of_week,start_time,end_time`, { headers: SB_H });
      staffRecurringBlocks = await rb.json();
      if (!Array.isArray(staffRecurringBlocks)) staffRecurringBlocks = [];
    } catch (e) { staffRecurringBlocks = []; }
  } catch (e) { console.error('Staff data error:', e); }
}

    
function getSlotsForDay(dayIdx) {
  const dc = (bookingConfig.slotTimes || {})[dayIdx] || {};
  const slots = Array.isArray(dc) ? dc : (dc['default'] || []);
  return [...slots].sort();
}

async function loadExistingBookings() {
  try {
    const today = nzToday();
    const r = await fetch(
      `${SB_URL}/rest/v1/public_booking_slots?booking_date=gte.${today}&status=eq.confirmed&select=game_id,booking_date,slot_time,assigned_staff_ids`, { headers: SB_H }
    );
    existingBookings = await r.json();
  } catch (e) { existingBookings = []; }
}

function calcPrice(gameId, players) {
  const g = games.find(x => x.id === gameId);
  if (!g) return { label: '—', total: 0, breakdown: '' };
  const type = g.pricingType || 'per_person_tiered';
  if (type === 'per_hour_flat') {
    const p = (bookingConfig.gameFlatPrice || {})[gameId] ?? 0;
    return { label: `$${p}`, total: p, breakdown: 'Flat rate per session' };
  }
  if (type === 'per_person_per_hour') {
    const rate = (bookingConfig.gamePerPersonPerHour || {})[gameId] ?? 0;
    const total = rate * players;
    return { label: `$${total}`, total, breakdown: `$${rate}pp/hr × ${players} player${players !== 1 ? 's' : ''}` };
  }
  const tiers = (bookingConfig.gamePriceTiers || {})[gameId] || [{ min: 1, max: 99, pp: 35 }];
  const tier = tiers.find(t => players >= t.min && players <= t.max) || tiers[tiers.length - 1];
  const pp = tier ? tier.pp : 35;
  const total = pp * players;
  return { label: `$${total}`, total, breakdown: `$${pp} per person × ${players}` };
}

function calcDeposit(total) {
  const type = bookingConfig.depositType || 'fixed';
  const amt = bookingConfig.depositAmount ?? 35;
  if (type === 'percent') return Math.round(total * amt / 100 * 100) / 100;
  return Math.min(amt, total);
}

function gamePriceLabel(g) {
  const type = g.pricingType || 'per_person_tiered';
  if (type === 'per_hour_flat') {
    const p = (bookingConfig.gameFlatPrice || {})[g.id] ?? 0;
    return `$${p} per session`;
  }
  if (type === 'per_person_per_hour') {
    const r = (bookingConfig.gamePerPersonPerHour || {})[g.id] ?? 0;
    return `$${r} per person / hr`;
  }
  const tiers = (bookingConfig.gamePriceTiers || {})[g.id] || [];
  if (!tiers.length) return '$35 per person';
  const mn = Math.min(...tiers.map(t => t.pp));
  const mx = Math.max(...tiers.map(t => t.pp));
  return mn === mx ? `$${mn} per person` : `$${mn}–$${mx} per person`;
}

function getSlotStatus(gameId, dateStr, slotTime) {
  const d = new Date(dateStr + 'T' + slotTime + ':00');
  const now = nzNow();
  const cut = (bookingConfig.callToBookCutoffHours || 3) * 3600000;
  if (d < now) return 'past';
  const alreadyBooked = existingBookings.some(b =>
    b.game_id === gameId &&
    b.booking_date === dateStr &&
    (b.slot_time || '').slice(0, 5) === slotTime
  );
  if (alreadyBooked) return 'booked';

  const anyStaffData = rosterShifts.length > 0 || staffTraining.length > 0;
  if (!anyStaffData) return 'call';

  const pool = getQualifiedStaffPool(gameId, dateStr, slotTime);
  if (pool.fullyAvailable.length === 0 && pool.maybeAvailable.length === 0) return 'booked';

  const withinCutoff = (d - now) < cut;
  if (withinCutoff) {
    const trustedFree = pool.fullyAvailable.some(sid => staffFlags[sid] === true);
    return trustedFree ? 'available' : 'call';
  }
  return pool.fullyAvailable.length > 0 ? 'available' : 'call';
}

// Splits qualified staff for a slot into two groups: roster-mode staff (the
// roster/assigned_shifts decides who's working) and calendar-mode staff
// (Google Calendar — synced busy blocks + weekly recurring blocks — decides
// instead). A specific-date time-off block (staff_availability, the Book
// Time Off tab) can still exclude someone in either mode.
function getQualifiedStaffPool(gameId, dateStr, slotTime) {
  const fullyAvailable = [];
  const maybeAvailable = []; // kept for compatibility with getSlotStatus's cutoff logic — always empty now the roster/calendar checks decide

  const rosteredIds = new Set(
    rosterShifts
    .filter(r => r.shift_date === dateStr &&
      slotTime >= (r.custom_start_time || '').slice(0, 5) &&
      slotTime < (r.custom_end_time || '').slice(0, 5))
    .map(r => r.staff_id)
  );

  // Calendar-mode staff (e.g. Keren) — Google Calendar decides availability
  // instead of the roster. staffMode comes from the public_staff_mode view.
  const calendarIds = Object.keys(staffMode).filter(sid => staffMode[sid] === 'calendar');

  const candidateIds = new Set([...rosteredIds, ...calendarIds]);

  const [y, mo, da] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, da)).getUTCDay(); // 0=Sun...6=Sat, matches day_of_week columns
  const game = games.find(g => g.id === gameId);
  const durationMin = (game && game.duration) || 60;
  const slotStart = new Date(`${dateStr}T${slotTime}:00`);
  const slotEnd = new Date(slotStart.getTime() + durationMin * 60000);

  candidateIds.forEach(sid => {
    const training = staffTraining.find(t => t.staff_id === sid && t.game_id === gameId);
    const statusObj = training ? trainingStatuses.find(s => s.id === training.status) : null;
    if (!statusObj || !statusObj.qualifies) return;

    // Manual time-off override (Book Time Off tab) applies regardless of mode
    const blocked = (staffAvailStatus[sid] || {})[dateStr + '_' + slotTime] === 'unavailable';
    if (blocked) return;

    if (staffMode[sid] === 'calendar') {
      // Weekly recurring "always away" block e.g. a day job
      const recurBlocked = staffRecurringBlocks.some(b =>
        b.staff_id === sid && b.day_of_week === dow &&
        slotTime >= (b.start_time || '').slice(0, 5) && slotTime < (b.end_time || '').slice(0, 5)
      );
      if (recurBlocked) return;

      // Synced Google Calendar busy blocks — checks for any overlap with the slot
      const calendarBlocked = staffCalendarBusy.some(b => {
        if (b.staff_id !== sid) return false;
        const busyStart = toNzNaive(b.busy_start);
        const busyEnd = toNzNaive(b.busy_end);
        return slotStart < busyEnd && slotEnd > busyStart;
      });
      if (calendarBlocked) return;
    }

    const taken = existingBookings.some(b => {
      const ids = JSON.parse(b.assigned_staff_ids || '[]');
      return ids.includes(sid) && b.booking_date === dateStr && (b.slot_time || '').slice(0, 5) === slotTime;
    });
    if (taken) return;

    fullyAvailable.push(sid);
  });

  return { fullyAvailable, maybeAvailable };
}

function getAvailableGMs(gameId, dateStr, slotTime) {
  const pool = getQualifiedStaffPool(gameId, dateStr, slotTime);
  const sortedFullyAvailable = [...pool.fullyAvailable].sort((a, b) => (staffFlags[b] === true ? 1 : 0) - (staffFlags[a] === true ? 1 : 0));
  return [...sortedFullyAvailable, ...pool.maybeAvailable];
}

function toDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function fmt12(t) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function getUpcomingDates(count = 30) {
  const dates = [],
    d = nzNow();
  d.setHours(0, 0, 0, 0);
  let checked = 0;
  while (dates.length < count && checked < 120) {
    checked++;
    const oh = (bookingConfig.openingHours || []).find(o => o.day === d.getDay());
    if (oh && oh.open) dates.push(toDateStr(new Date(d)));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function getSlotsForGame(gameId, dayIndex) {
  const ds = (bookingConfig.slotTimes || {})[dayIndex] || {};
  if (Array.isArray(ds)) return ds;
  return ds[gameId] || ds['default'] || [];
}

function setStep(n) {
  [1, 2, 3, 4].forEach(i => {
    const dot = document.getElementById('dot' + i);
    const lbl = document.getElementById('lbl' + i);
    if (!dot || !lbl) return; // step-dot UI not present in this markup - don't crash goTo()
    if (i < n) { dot.className = 'step-num done';
      dot.textContent = '✓';
      lbl.className = 'step-lbl'; } else if (i === n) { dot.className = 'step-num active';
      dot.textContent = i;
      lbl.className = 'step-lbl active'; } else { dot.className = 'step-num';
      dot.textContent = i;
      lbl.className = 'step-lbl'; }
    const lineEl = i < 4 ? document.getElementById('line' + i) : null;
    if (lineEl) lineEl.className = 'step-line' + (i < n ? ' done' : '');
  });
  [1, 2, 3, 4].forEach(i => {
    const vdot = document.getElementById('vdot' + i);
    const vlbl = document.getElementById('vlbl' + i);
    const vcon = document.getElementById('vcon' + i);
    if (!vdot) return;
    if (i < n) {
      vdot.className = 'vstep-dot done';
      vdot.textContent = '✓';
      vlbl.className = 'vstep-lbl done';
      if (vcon) vcon.className = 'vstep-connector done';
    } else if (i === n) {
      vdot.className = 'vstep-dot active';
      vdot.textContent = i;
      vlbl.className = 'vstep-lbl active';
    } else {
      vdot.className = 'vstep-dot';
      vdot.textContent = i;
      vlbl.className = 'vstep-lbl';
      if (vcon) vcon.className = 'vstep-connector';
    }
  });
}

function goTo(screenId, step) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screenEl = document.getElementById(screenId);
  screenEl.classList.add('active');
  setStep(step);
  scrollScreenIntoView(screenEl);
  updateLeftSummary();
}

function scrollScreenIntoView(el) {
  // Wait two animation frames so the newly-shown screen has been laid out
  // (fixes goTo() previously not scrolling at all on some browsers/devices)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const targetY = window.scrollY + rect.top - 12;
      window.scrollTo({ top: targetY, behavior: 'smooth' });
    });
  });
}

function updateLeftSummary() {
  const panel = document.getElementById('lcSummary');
  const rows = document.getElementById('lcSummaryRows');
  if (!panel || !rows) return;
  const items = [];
  if (selGame) {
    items.push({ icon: selGame.icon || '🚪', val: selGame.name, sub: selGame.duration ? selGame.duration + 'min' : '' });
  }
  if (selDate) {
    const d = new Date(selDate + 'T12:00');
    items.push({ icon: '📅', val: DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()], sub: '' });
  }
  if (selSlot) {
    items.push({ icon: '🕐', val: fmt12(selSlot), sub: '' });
  }
  if (selGame && selSlot) {
    const p = calcPrice(selGame.id, playerCount);
    items.push({ icon: '💰', val: p.label + ' NZD', sub: p.breakdown });
  }
  if (!items.length) { panel.classList.remove('show'); return; }
  panel.classList.add('show');
  rows.innerHTML = items.map(item => `
      <div class="lc-sum-row">
        <span class="lc-sum-icon">${item.icon}</span>
        <div><div class="lc-sum-val">${item.val}</div>${item.sub ? `<div class="lc-sum-sub">${item.sub}</div>` : ''}</div>
      </div>`).join('');
}

function showTooltip(el) {
  const circle = el.closest('.cat-circle');
  if (!circle) return;
  const isActive = circle.classList.contains('active');
  document.querySelectorAll('.cat-circle').forEach(c => c.classList.remove('active'));
  if (!isActive) circle.classList.add('active');
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('.cat-circle')) {
    document.querySelectorAll('.cat-circle.active').forEach(c => c.classList.remove('active'));
  }
});

function updateTicketPreview() {
  const gameEl = document.getElementById('stubGame');
  const nameEl = document.getElementById('stubName');
  if (gameEl) gameEl.textContent = selGame ? selGame.name : 'TBC';
  const firstInput = document.getElementById('fFirst');
  const first = firstInput ? firstInput.value.trim() : '';
  if (nameEl) nameEl.textContent = first || 'TBC';

  const dateEl = document.getElementById('ticketDate');
  if (dateEl) {
    if (selDate) {
      const d = new Date(selDate + 'T12:00');
      dateEl.textContent = '– ' + DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
      dateEl.classList.add('filled');
    } else {
      dateEl.textContent = '– TBC';
      dateEl.classList.remove('filled');
    }
  }

  const timeEl = document.getElementById('ticketTime');
  if (timeEl) {
    if (selSlot) {
      timeEl.textContent = '– ' + fmt12(selSlot);
      timeEl.classList.add('filled');
    } else {
      timeEl.textContent = '– TBC';
      timeEl.classList.remove('filled');
    }
  }

  const playersEl = document.getElementById('ticketPlayers');
  if (playersEl) {
    if (selGame && playerCount) {
      playersEl.textContent = '– ' + playerCount;
      playersEl.classList.add('filled');
    } else {
      playersEl.textContent = '– TBC';
      playersEl.classList.remove('filled');
    }
  }
}

function selectCategory(cat) {
  selCategory = cat;
  selGame = null;
  selDate = null;
  selSlot = null;
  updateTicketPreview();
  if (cat === 'enquiry') {
    const sel = document.getElementById('cGame');
    if (sel) sel.innerHTML = '<option value="">Not sure yet</option>' + games.filter(g => g.bookable !== false).map(g => `<option value="${g.id}">${g.name}</option>`).join('');
    const today = nzToday();
    const cd = document.getElementById('cDate');
    if (cd) cd.value = today;
    goTo('s2-enquiry', 2);
    return;
  }
  if (cat === 'escape') {
    renderEscapeGames();
    goTo('s2-escape', 2);
  } else if (cat === 'vr') {
    renderVRGames();
    goTo('s2-vr', 2);
  } else {
    renderCafeGames();
    goTo('s2-cafe', 2);
  }
}

function gameCardHtml(g, idPrefix, clickFn) {
  const min = g.minPlayers ?? 1;
  const max = g.maxPlayers ?? '–';
  const photo = g.photoUrl
    ? `<img src="${g.photoUrl}" alt="${g.name}">`
    : `<div class="game-photo-placeholder">${g.icon || '🚪'}</div>`;
  return `
      <div class="game-card" id="${idPrefix}-${g.id}" onclick="${clickFn}('${g.id}')">
        <div class="game-photo">${photo}</div>
        <div class="game-info">
          <div class="game-name">${g.name}</div>
          <div class="game-price">${gamePriceLabel(g)}</div>
        </div>
        <div class="game-stats">
          <div class="game-stat" title="Players"><span class="game-stat-icon">👥</span><span>${min}–${max}</span></div>
          <div class="game-stat" title="Duration"><span class="game-stat-icon">⏱️</span><span>${g.duration} min</span></div>
        </div>
      </div>`;
}

function renderEscapeGames() {
  const cats = games.filter(g => g.category === 'escape' && g.bookable !== false);
  document.getElementById('escapeGameList').innerHTML = cats.map(g => gameCardHtml(g, 'gc', 'selectEscapeGame')).join('');
}

function setEscapeView(v) {
  escapeView = v;
  document.getElementById('vog').className = 'view-opt' + (v === 'game' ? ' active' : '');
  document.getElementById('vod').className = 'view-opt' + (v === 'date' ? ' active' : '');
  document.getElementById('byGame').style.display = v === 'game' ? '' : 'none';
  document.getElementById('byDate').style.display = v === 'date' ? '' : 'none';
  selGame = null;
  selDate = null;
  selSlot = null;
  if (v === 'date') renderDateDates();
}

function selectEscapeGame(gameId) {
  selGame = games.find(g => g.id === gameId);
  selDate = null;
  selSlot = null;
  gameWeekOffset = 0;
  updateTicketPreview();
  document.querySelectorAll('.game-card').forEach(c => c.classList.remove('selected'));
  const el = document.getElementById('gc-' + gameId);
  if (el) el.classList.add('selected');
  const wrap = document.getElementById('gameDateWrap');
  wrap.style.display = '';
  renderGameDates();
  setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

function renderGameDates() {
  const today = nzNow();
  today.setHours(0, 0, 0, 0);
  const dow = (today.getDay() + 6) % 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - dow + (gameWeekOffset * 7));
  const wEnd = new Date(weekStart);
  wEnd.setDate(weekStart.getDate() + 6);
  const lbl = document.getElementById('gameWeekLabel');
  if (lbl) lbl.textContent = weekStart.getDate() + ' ' + MONTHS[weekStart.getMonth()] + ' - ' + wEnd.getDate() + ' ' + MONTHS[wEnd.getMonth()];
  const strip = document.getElementById('gameDateStrip');
  document.getElementById('gameSlotsWrap').style.display = 'none';
  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const ds = toDateStr(d);
    const isPast = d < today;
    const slots = getSlotsForGame(selGame.id, d.getDay());
    if (!slots.length) continue;
    const dayName = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    html += '<div style="margin-bottom:18px">';
    html += '<div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;';
    html += 'color:' + (isPast ? 'var(--text-muted)' : 'var(--text-primary)') + ';margin-bottom:8px;padding-bottom:6px;';
    html += 'border-bottom:1px solid var(--border-color)">' + dayName + '</div>';
    html += '<div class="slot-grid">';
    [...slots].sort().forEach(function(t) {
      const status = isPast ? 'past' : getSlotStatus(selGame.id, ds, t);
      const statusLabels = { available: 'Available', call: 'Call us', booked: 'Full', past: 'Past' };
      const clickable = status === 'available';
      html += '<div class="slot-btn ' + status + '"' + (clickable ? ' onclick="selectSlot(\'' + selGame.id + '\',\'' + ds + '\',\'' + t + '\')"' : '') + ' >';
      html += '<div class="slot-time">' + fmt12(t) + '</div>';
      html += '<div class="slot-status">' + (statusLabels[status] || '') + '</div>';
      html += '</div>';
    });
    html += '</div></div>';
  }
  if (!html) html = '<div style="padding:24px;text-align:center;color:var(--text-muted)">No slots this week.</div>';
  strip.innerHTML = html;
}

function renderDateDates() {
  const dates = getUpcomingDates(30);
  document.getElementById('dateDateStrip').innerHTML = dates.map(ds => {
    const d = new Date(ds + 'T12:00');
    return `<div class="date-chip" onclick="selectDateFirst('${ds}',this)">
        <div class="dc-day">${DAYS[d.getDay()]}</div>
        <div class="dc-num">${d.getDate()}</div>
        <div class="dc-mon">${MONTHS[d.getMonth()]}</div>
      </div>`;
  }).join('');
}

function selectDateFirst(ds, el) {
  selDate = ds;
  document.querySelectorAll('#dateDateStrip .date-chip').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('dateGamesWrap').style.display = '';
  const escapGames = games.filter(g => g.category === 'escape' && g.bookable !== false);
  const d = new Date(ds + 'T12:00');
  document.getElementById('dateGamesList').innerHTML = escapGames.map(g => {
    const slots = getSlotsForGame(g.id, d.getDay());
    if (!slots.length) return '';
    const slotBtns = slots.sort().map(t => slotBtnHtml(g.id, ds, t, true)).join('');
    return `<div class="dg-section">
        <div class="dg-header">
          <div class="dg-icon">${g.icon || '🚪'}</div>
          <div class="dg-name">${g.name} <span style="font-size:11px;color:var(--text-muted);font-weight:400">${g.duration}min</span></div>
          <div class="dg-price">${gamePriceLabel(g)}</div>
        </div>
        <div class="dg-slots"><div class="slot-grid">${slotBtns}</div></div>
      </div>`;
  }).join('');
  const dateGamesWrapEl = document.getElementById('dateGamesWrap');
  setTimeout(() => dateGamesWrapEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

function renderVRGames() {
  const vrGames = games.filter(g => g.category === 'vr' && g.bookable !== false);
  document.getElementById('vrGameList').innerHTML = vrGames.map(g => gameCardHtml(g, 'vgc', 'selectVRGame')).join('') || '<div class="empty"><div class="empty-icon">🥽</div>No VR sessions available to book online right now.<br>Use the enquiry below.</div>';
}

function selectVRGame(gameId) {
  selGame = games.find(g => g.id === gameId);
  selDate = null;
  selSlot = null;
  updateTicketPreview();
  document.querySelectorAll('.game-card').forEach(c => c.classList.remove('selected'));
  const el = document.getElementById('vgc-' + gameId);
  if (el) el.classList.add('selected');
  const wrap = document.getElementById('vrDateWrap');
  wrap.style.display = '';
  document.getElementById('vrSlotsWrap').style.display = 'none';
  renderVRDates();
  setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

function renderVRDates() {
  const dates = getUpcomingDates(30);
  document.getElementById('vrDateStrip').innerHTML = dates.map(ds => {
    const d = new Date(ds + 'T12:00');
    const slots = getSlotsForGame(selGame.id, d.getDay());
    const hasSlots = slots.length > 0;
    return `<div class="date-chip${!hasSlots ? ' no-avail' : ''}" onclick="selectVRDate('${ds}',this)">
        <div class="dc-day">${DAYS[d.getDay()]}</div>
        <div class="dc-num">${d.getDate()}</div>
        <div class="dc-mon">${MONTHS[d.getMonth()]}</div>
      </div>`;
  }).join('');
}

function selectVRDate(ds, el) {
  selDate = ds;
  document.querySelectorAll('#vrDateStrip .date-chip').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  const wrap = document.getElementById('vrSlotsWrap');
  wrap.style.display = '';
  const d = new Date(ds + 'T12:00');
  document.getElementById('vrSlotsHeading').textContent =
    DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  renderSlots('vrSlotsGrid', selGame.id, ds);
  setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

function renderCafeGames() {
  const cafeGames = games.filter(g => g.category === 'cafe' && g.bookable !== false);
  document.getElementById('cafeGameList').innerHTML = cafeGames.map(g => gameCardHtml(g, 'cgc', 'selectCafeGame')).join('');
}

function selectCafeGame(gameId) {
  selGame = games.find(g => g.id === gameId);
  selDate = null;
  selSlot = null;
  updateTicketPreview();
  document.querySelectorAll('.game-card').forEach(c => c.classList.remove('selected'));
  const el = document.getElementById('cgc-' + gameId);
  if (el) el.classList.add('selected');
  const wrap = document.getElementById('cafeDateWrap');
  wrap.style.display = '';
  document.getElementById('cafeSlotsWrap').style.display = 'none';
  renderCafeDates();
  setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

function renderCafeDates() {
  const dates = getUpcomingDates(30);
  document.getElementById('cafeDateStrip').innerHTML = dates.map(ds => {
    const d = new Date(ds + 'T12:00');
    return `<div class="date-chip" onclick="selectCafeDate('${ds}',this)">
        <div class="dc-day">${DAYS[d.getDay()]}</div>
        <div class="dc-num">${d.getDate()}</div>
        <div class="dc-mon">${MONTHS[d.getMonth()]}</div>
      </div>`;
  }).join('');
}

function selectCafeDate(ds, el) {
  selDate = ds;
  document.querySelectorAll('#cafeDateStrip .date-chip').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  const wrap = document.getElementById('cafeSlotsWrap');
  wrap.style.display = '';
  const d = new Date(ds + 'T12:00');
  document.getElementById('cafeSlotsHeading').textContent =
    DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  renderSlots('cafeSlotsGrid', selGame.id, ds);
  setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

function slotBtnHtml(gameId, dateStr, slotTime, withGame = false) {
  const status = getSlotStatus(gameId, dateStr, slotTime);
  const labels = { available: 'Available', call: '📞 Call us', booked: 'Full', past: 'Past' };
  const clickable = status === 'available';
  const gname = withGame ? games.find(g => g.id === gameId)?.name || '' : '';
  return `<div class="slot-btn ${status}"
      ${clickable ? `onclick="selectSlot('${gameId}','${dateStr}','${slotTime}')"` : ''}>
      <div class="slot-time">${fmt12(slotTime)}</div>
      <div class="slot-status">${labels[status] || ''}</div>
    </div>`;
}

function renderSlots(gridId, gameId, dateStr) {
  const d = new Date(dateStr + 'T12:00');
  const slots = getSlotsForGame(gameId, d.getDay());
  const el = document.getElementById(gridId);
  if (!slots.length) {
    el.innerHTML = '<div class="empty" style="grid-column:1/-1">No slots on this day.</div>';
    return;
  }
  el.innerHTML = slots.sort().map(t => slotBtnHtml(gameId, dateStr, t)).join('');
}

function selectSlot(gameId, dateStr, slotTime) {
  selGame = games.find(g => g.id === gameId);
  selDate = dateStr;
  selSlot = slotTime;
  const trackPlayers = selGame.trackPlayers !== false;
  if (trackPlayers) {
    const limits = (bookingConfig.gamePlayerLimits || {})[gameId] || { min: 2, max: 8 };
    playerCount = limits.min;
  } else {
    playerCount = 1;
  }
  updateTicketPreview();
  showIntakeForm();
}

function showIntakeForm() {
  const d = new Date(selDate + 'T12:00');
  const dateLabel = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  document.getElementById('summaryBar').innerHTML = `
      <div class="summary-icon">${selGame.icon || '🚪'}</div>
      <div style="flex:1;min-width:0">
        <div class="summary-game">${selGame.name}</div>
        <div class="summary-detail">${dateLabel} · ${fmt12(selSlot)}</div>
      </div>
      <div class="summary-change" onclick="goBack()">Change</div>`;
  const trackPlayers = selGame.trackPlayers !== false;
  const playersFieldLabelEl = document.getElementById('playersFieldLabel');
  if (trackPlayers) {
    const limits = (bookingConfig.gamePlayerLimits || {})[selGame.id] || { min: 2, max: 8 };
    document.getElementById('playerLbl').textContent = `players (${limits.min}–${limits.max})`;
    if (playersFieldLabelEl) playersFieldLabelEl.innerHTML = 'How many players? <span class="req">*</span>';
  } else {
    document.getElementById('playerLbl').textContent = `players (optional)`;
    if (playersFieldLabelEl) playersFieldLabelEl.innerHTML = 'How many players? <span style="color:var(--text-muted);font-weight:400;text-transform:none">(optional — just for our info)</span>';
  }
  document.getElementById('playerVal').textContent = playerCount;
  const expField = document.getElementById('fExperienceField');
  expField.style.display = selGame.category === 'escape' ? '' : 'none';
  renderExperienceLevels();
  updatePlayedBeforeVisibility();
  selectedExperiences = [];
  depositPref = null;
  document.querySelectorAll('#depositPrefGroup .radio-opt').forEach(el => el.classList.remove('selected'));
  const ageInput = document.getElementById('fSpecialAge');
  if (ageInput) ageInput.value = '';
  renderPersonalExp();
  updatePriceDisplay();
  goTo('s3', 3);
}

function adjPlayers(d) {
  const trackPlayers = selGame.trackPlayers !== false;
  if (trackPlayers) {
    const limits = (bookingConfig.gamePlayerLimits || {})[selGame.id] || { min: 2, max: 8 };
    playerCount = Math.max(limits.min, Math.min(limits.max, playerCount + d));
  } else {
    playerCount = Math.max(1, Math.min(50, playerCount + d));
  }
document.getElementById('playerVal').textContent = playerCount;
  updatePriceDisplay();
  updateLeftSummary();
  updateTicketPreview();
}

function renderPersonalExp() {
  const wrap = document.getElementById('personalExpWrap');
  const occasion = document.getElementById('fOccasion').value;
  const exps = (bookingConfig.personalisedExperiences || []).filter(e =>
    e.active !== false && (!e.occasions || !e.occasions.length || e.occasions.includes(occasion))
  );
  selectedExperiences = selectedExperiences.filter(id => exps.find(e => e.id === id));
  if (!occasion || !exps.length) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  document.getElementById('personalExpList').innerHTML = exps.map(e => `
      <div class="exp-opt ${selectedExperiences.includes(e.id) ? 'selected' : ''}" onclick="toggleExperience('${e.id}')">
        <div class="exp-check"></div>
        <div class="exp-body">
          <div class="exp-label-row">
            <span class="exp-label">${e.label}</span>
            <span class="exp-price">${parseFloat(e.price) > 0 ? '+$' + e.price : 'Free'}</span>
          </div>
          ${e.description ? `<div class="exp-desc">${e.description}</div>` : ''}
        </div>
      </div>`).join('');
}

function toggleExperience(id) {
  const i = selectedExperiences.indexOf(id);
  if (i === -1) selectedExperiences.push(id);
  else selectedExperiences.splice(i, 1);
  renderPersonalExp();
  updatePriceDisplay();
}

function getSelectedExpRows() {
  return (bookingConfig.personalisedExperiences || []).filter(e => selectedExperiences.includes(e.id));
}

function getSelectedExpTotal() {
  return getSelectedExpRows().reduce((s, e) => s + (parseFloat(e.price) || 0), 0);
}

function renderExperienceLevels() {
  const list = document.getElementById('fExperienceList');
  if (!list) return;
  list.innerHTML = EXPERIENCE_LEVELS.map(o => `
      <div class="exp-opt ${selectedExperienceLevels.includes(o.value) ? 'selected' : ''}" onclick="toggleExperienceLevel('${o.value}')">
        <div class="exp-check"></div>
        <div class="exp-body"><div class="exp-label-row"><span class="exp-label">${o.label}</span></div></div>
      </div>`).join('');
}

function toggleExperienceLevel(val) {
  const i = selectedExperienceLevels.indexOf(val);
  if (i === -1) selectedExperienceLevels.push(val);
  else selectedExperienceLevels.splice(i, 1);
  renderExperienceLevels();
  updatePlayedBeforeVisibility();
}

function getExperienceLabel() {
  return EXPERIENCE_LEVELS.filter(o => selectedExperienceLevels.includes(o.value)).map(o => o.label).join(', ');
}

function setDepositPref(val) {
  depositPref = val;
  document.querySelectorAll('#depositPrefGroup .radio-opt').forEach(el => {
    el.classList.toggle('selected', el.dataset.val === val);
  });
  updatePriceDisplay();
}

function updatePriceDisplay() {
  if (!selGame) return;
  const p = calcPrice(selGame.id, playerCount);
  const expRows = getSelectedExpRows();
  const expTotal = getSelectedExpTotal();
  const grandTotal = p.total + expTotal;
  document.getElementById('priceBig').textContent = `$${grandTotal}`;
  document.getElementById('priceSmall').textContent = p.breakdown;
  const dep = calcDeposit(grandTotal);
  const expRowsHtml = expRows.map(e => `<div class="price-row"><span class="price-lbl">${e.label}</span><span class="price-val">+$${e.price}</span></div>`).join('');
  const depositNote = depositPref === 'invoice' ?
    `We'll email you an invoice for the deposit — please pay it to secure your booking. Remaining balance due on the day.` :
    `We'll be in touch shortly after you confirm with payment details. Remaining balance due on the day.`;
  document.getElementById('priceBox').innerHTML = `
      <div class="price-row"><span class="price-lbl">${selGame.name}</span><span class="price-val">${p.breakdown}</span></div>
      ${expRowsHtml}
      <div class="price-divider"></div>
      <div class="price-row"><span class="price-total-lbl">Total</span><span class="price-total-val">$${grandTotal} NZD</span></div>
      <div class="deposit-note"><strong>💳 Deposit to secure your booking: $${dep}</strong>${depositNote}</div>`;
}

document.getElementById('fOccasion').addEventListener('change', function() {
  const show = ['Birthday', 'Hen/Stag do'].includes(this.value);
  document.getElementById('specialPersonWrap').style.display = show ? '' : 'none';
  const companyWrap = document.getElementById('companyNameWrap');
  const isCompany = ['Company team building', 'Company fun event'].includes(this.value);
  if (companyWrap) companyWrap.style.display = isCompany ? '' : 'none';
  if (!isCompany) { const cn = document.getElementById('fCompanyName'); if (cn) cn.value = ''; }
  const schoolWrap = document.getElementById('schoolGroupWrap');
  const isSchool = this.value === 'School group';
  if (schoolWrap) schoolWrap.style.display = isSchool ? '' : 'none';
  if (!isSchool) {
    const sn = document.getElementById('fSchoolName');
    if (sn) sn.value = '';
    const sa = document.getElementById('fSchoolAgeGroup');
    if (sa) sa.value = '';
  }
  const invoiceOpt = document.getElementById('depositOptInvoice');
  if (invoiceOpt) {
    invoiceOpt.style.display = isCompany ? '' : 'none';
    if (!isCompany && depositPref === 'invoice') {
      depositPref = null;
      invoiceOpt.classList.remove('selected');
    }
  }
  const lbl = document.getElementById('specialPersonLabel');
  if (lbl) {
    if (this.value === 'Birthday') lbl.textContent = 'Name of the birthday person';
    else if (this.value === 'Hen/Stag do') lbl.textContent = 'Name of the hen / stag';
    else lbl.textContent = 'Name of the special guest';
  }
  const ph = document.getElementById('fSpecialName');
  if (ph) {
    if (this.value === 'Birthday') ph.placeholder = 'e.g. Emma';
    else if (this.value === 'Hen/Stag do') ph.placeholder = 'e.g. Sophie';
  }
  const ageWrap = document.getElementById('specialAgeWrap');
  if (ageWrap) {
    ageWrap.style.display = this.value === 'Birthday' ? '' : 'none';
    if (this.value !== 'Birthday') {
      document.getElementById('fSpecialAge').value = '';
      document.getElementById('childHint').style.display = 'none';
    }
  }
  renderPersonalExp();
  updatePriceDisplay();
});

document.getElementById('fSpecialAge').addEventListener('input', function() {
  const age = parseInt(this.value);
  document.getElementById('childHint').style.display = (!isNaN(age) && age < 18 && age >= 0) ? '' : 'none';
});

function setPlayedBefore(val) {
  playedBefore = val;
  document.getElementById('rb-yes').classList.toggle('selected', val === true);
  document.getElementById('rb-no').classList.toggle('selected', val === false);
  document.getElementById('prevGameWrap').style.display = val ? '' : 'none';
}

function updatePlayedBeforeVisibility() {
  const isEscape = selGame && selGame.category === 'escape';
  const isFirstTime = selectedExperienceLevels.length === 1 && selectedExperienceLevels[0] === 'First time';
  const wrap = document.getElementById('playedBeforeWrap');
  if (isEscape && isFirstTime) {
    wrap.style.display = 'none';
    setPlayedBefore(false);
  } else {
    wrap.style.display = '';
  }
}

function populatePrevGameSelect() {
  const sel = document.getElementById('fPrevGame');
  const escapeGames = games.filter(g => g.category === 'escape');
  sel.innerHTML = '<option value="">Can\'t remember</option>' +
    escapeGames.map(g => `<option value="${g.name}">${g.name}</option>`).join('');
}

function goBack() {
  selSlot = null;
  if (selCategory === 'escape') goTo('s2-escape', 2);
  else if (selCategory === 'vr') goTo('s2-vr', 2);
  else goTo('s2-cafe', 2);
}

function showReviewScreen() {
  const first = document.getElementById('fFirst').value.trim();
  const last = document.getElementById('fLast').value.trim();
  const email = document.getElementById('fEmail').value.trim();
  const phone = document.getElementById('fPhone').value.trim();

  if (!first || !last) { showErr('Please enter your full name.'); return; }
  if (!email || !email.includes('@')) { showErr('Please enter a valid email address.'); return; }
  if (!phone) { showErr('Please enter a phone number so we can reach you.'); return; }

  const d = new Date(selDate + 'T12:00');
  const dateLabel = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  const occasion = document.getElementById('fOccasion').value;
  const specialName = document.getElementById('fSpecialName').value.trim();
  const specialAge = document.getElementById('fSpecialAge')?.value;
  const companyName = document.getElementById('fCompanyName')?.value.trim();
  const schoolName = document.getElementById('fSchoolName')?.value.trim();
  const schoolAgeGroup = document.getElementById('fSchoolAgeGroup')?.value.trim();
  const experience = getExperienceLabel();
  const prevGame = document.getElementById('fPrevGame').value;
  const expRows = getSelectedExpRows();
  const depositLabels = { stripe: '💳 Card', bank_transfer: '🏦 Bank transfer', invoice: '📧 Invoice me', cash: '💵 Cash in person' };

  const rows = [
    ['Game', `${selGame.icon || ''} ${selGame.name}`],
    ['Date', dateLabel],
    ['Time', fmt12(selSlot)],
    ['Players', playerCount],
    ['Name', `${first} ${last}`],
    ['Email', email],
    ['Phone', phone],
  ];
  if (occasion) rows.push(['Occasion', occasion + (specialName ? ' — ' + specialName + (specialAge ? ' (' + specialAge + ')' : '') : '') + (companyName ? ' — ' + companyName : '') + (schoolName ? ' — ' + schoolName + (schoolAgeGroup ? ' (' + schoolAgeGroup + ')' : '') : '')]);
  if (selGame.category === 'escape' && experience) rows.push(['Experience', experience]);
  if (playedBefore) rows.push(['Played before', 'Yes' + (prevGame ? ' — ' + prevGame : '')]);
  if (expRows.length) rows.push(['Add-ons', expRows.map(e => e.label).join(', ')]);
  if (depositPref) rows.push(['Deposit payment', depositLabels[depositPref] || depositPref]);

  document.getElementById('reviewCard').innerHTML = rows.map(([l, v]) =>
    `<div class="confirm-row"><span class="confirm-lbl">${l}</span><span class="confirm-val">${v}</span></div>`
  ).join('');

  document.getElementById('reviewPriceBox').innerHTML = document.getElementById('priceBox').innerHTML;

  goTo('s3review', 4);
  playTicketHighlight();
}

function playTicketHighlight() {
  const wrapper = document.querySelector('.ticket-wrapper');
  if (!wrapper) return;

  // Scroll the ticket itself into view first - it sits above the .screens
  // section, so goTo()'s own scroll (which targets the review screen further
  // down) leaves the ticket off-screen while the animation plays.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const rect = wrapper.getBoundingClientRect();
      const targetY = window.scrollY + rect.top - 12;
      window.scrollTo({ top: targetY, behavior: 'smooth' });
    });
  });

  const nameEl = document.getElementById('stubGame');
  const boxEls = ['ticketDate', 'ticketTime', 'ticketPlayers']
    .map(id => document.getElementById(id)?.closest('.seat-box'))
    .filter(Boolean);

  const pulse = (el, cls) => {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  };

  // Timing constants (kept together so future tweaks are easy):
  // shimmer -> gap -> name pulse -> gap -> DATE pulse -> gap -> TIME pulse -> gap -> PLAYERS pulse
  // Each step now fully finishes before the next one starts, with a pause in between.
  const SHIMMER_DELAY = 250;
  const SHIMMER_MS = 1900;   // matches @keyframes shimmerSweep duration in CSS
  const NAME_PULSE_MS = 3500; // matches @keyframes pulseName duration in CSS
  const BOX_PULSE_MS = 4500;  // matches @keyframes pulseBox/pulseZoom duration in CSS
  const GAP_AFTER_SHIMMER = 0;   // no pause before the game name pulse - starts right as shimmer ends
  const GAP_AFTER_NAME = 500;    // pause before DATE starts
  const GAP_BETWEEN_BOXES = 350; // pause between DATE/TIME/PLAYERS (reduced from 500)

  setTimeout(() => {
    wrapper.classList.remove('shimmer-play');
    void wrapper.offsetWidth;
    wrapper.classList.add('shimmer-play');
    wrapper.addEventListener('animationend', () => wrapper.classList.remove('shimmer-play'), { once: true });
  }, SHIMMER_DELAY);

  let t = SHIMMER_DELAY + SHIMMER_MS + GAP_AFTER_SHIMMER;
  setTimeout(() => pulse(nameEl, 'pulse-name'), t);
  t += NAME_PULSE_MS + GAP_AFTER_NAME;
  boxEls.forEach(el => {
    setTimeout(() => pulse(el, 'pulse-box'), t);
    t += BOX_PULSE_MS + GAP_BETWEEN_BOXES;
  });
}

async function submitBooking() {
  const errEl = document.getElementById('reviewErr');
  const btn = document.getElementById('btnFinalConfirm');
  errEl.classList.remove('show');

  const first = document.getElementById('fFirst').value.trim();
  const last = document.getElementById('fLast').value.trim();
  const email = document.getElementById('fEmail').value.trim().toLowerCase();
  const phone = document.getElementById('fPhone').value.trim();
  const occasion = document.getElementById('fOccasion').value;
  const specialName = document.getElementById('fSpecialName').value.trim();
  const specialAgeVal = document.getElementById('fSpecialAge')?.value;
  const specialAge = specialAgeVal ? parseInt(specialAgeVal) : null;
  const companyName = document.getElementById('fCompanyName')?.value.trim();
  const schoolName = document.getElementById('fSchoolName')?.value.trim();
  const schoolAgeGroup = document.getElementById('fSchoolAgeGroup')?.value.trim();
  const experience = getExperienceLabel();
  const prevGame = document.getElementById('fPrevGame').value;

  if (!first || !last) { showErr('Please enter your full name.'); return; }
  if (!email || !email.includes('@')) { showErr('Please enter a valid email address.'); return; }
  if (!phone) { showErr('Please enter a phone number so we can reach you.'); return; }

  const slotCheck = getSlotStatus(selGame.id, selDate, selSlot);
  if (slotCheck === 'past') {
    showErr('This slot has already passed. Please choose another time.');
    return;
  }
  if (slotCheck === 'call') {
    showErr('This slot now needs a phone call to confirm — please call us.');
    return;
  }

  const pricing = calcPrice(selGame.id, playerCount);
  const expRows = getSelectedExpRows();
  const expTotal = getSelectedExpTotal();
  const grandTotal = pricing.total + expTotal;
  const dep = calcDeposit(grandTotal);
  const ref = 'BTB-' + Date.now().toString(36).toUpperCase();

  btn.classList.add('btn-loading');
  btn.disabled = true;

  try {
    const takenCheck = await fetch(
      `${SB_URL}/rest/v1/public_booking_slots?game_id=eq.${selGame.id}&booking_date=eq.${selDate}&slot_time=eq.${selSlot}:00&status=eq.confirmed&select=game_id`, { headers: SB_H }
    );
    const takenRows = await takenCheck.json();
    if (Array.isArray(takenRows) && takenRows.length > 0) {
      showErr('Sorry, this slot was just taken. Please choose another time.');
      btn.classList.remove('btn-loading');
      btn.disabled = false;
      return;
    }

    const avail = getAvailableGMs(selGame.id, selDate, selSlot);

    let clientId = null;
    if (email) {
      const cr = await fetch(
        `${SB_URL}/rest/v1/rpc/public_find_client_id`, { method: 'POST', headers: SB_H, body: JSON.stringify({ p_email: email, p_phone: null }) }
      );
      const foundId = await cr.json();
      if (foundId) {
        clientId = foundId;
      } else {
        const nr = await fetch(`${SB_URL}/rest/v1/rpc/public_create_client`, {
          method: 'POST',
          headers: SB_H,
          body: JSON.stringify({
            p_first_name: first,
            p_last_name: last,
            p_email: email,
            p_phone: phone,
          })
        });
        clientId = await nr.json();
      }
    }

    const bookingData = {
      client_id: clientId,
      game_id: selGame.id,
      game_name: selGame.name,
      booking_date: selDate,
      slot_time: selSlot + ':00',
      players_booked: playerCount,
      occasion: occasion || null,
      name_of_special_person: specialName || null,
      age_of_special_person: specialAge,
      experience: selGame.category === 'escape' ? experience : null,
      played_before: playedBefore === true,
      previous_game: playedBefore ? prevGame || null : null,
      total_amount: grandTotal,
      deposit_amount: dep,
      deposit_method: depositPref || null,
      addons: expRows.length ? JSON.stringify(expRows.map(e => ({ label: e.label, amount: parseFloat(e.price) || 0, at: new Date().toISOString() }))) : null,
      status: 'confirmed',
      source: 'online',
      assigned_staff_ids: JSON.stringify(avail.slice(0, 1)),
      tags: JSON.stringify([]),
      staff_notes: JSON.stringify([]),
      notes_when_booked: `${first} ${last} · ${ref}` + (companyName ? ` · Company: ${companyName}` : '') + (schoolName ? ` · School: ${schoolName}${schoolAgeGroup ? ' (' + schoolAgeGroup + ')' : ''}` : ''),
    };

    const br = await fetch(`${SB_URL}/rest/v1/game_bookings`, {
      method: 'POST',
      headers: { ...SB_H, 'Prefer': 'return=minimal' },
      body: JSON.stringify(bookingData),
    });
    if (!br.ok) throw new Error('Booking save failed: ' + await br.text());

    existingBookings.push({
      game_id: selGame.id,
      booking_date: selDate,
      slot_time: selSlot + ':00',
      assigned_staff_ids: JSON.stringify(avail.slice(0, 1)),
    });

    showConfirmation(first, last, email, grandTotal, dep, ref, expRows, depositPref);

  } catch (e) {
    showErr('Something went wrong — please try again or call us.');
    console.error('Booking error:', e);
  } finally {
    btn.classList.remove('btn-loading');
    btn.disabled = false;
  }
}

function showErr(msg) {
  const el = document.querySelector('.screen.active .err-msg') || document.getElementById('formErr');
  el.textContent = msg;
  el.classList.add('show');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showConfirmation(first, last, email, grandTotal, dep, ref, expRows, depositPref) {
  const d = new Date(selDate + 'T12:00');
  const dateLabel = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  const depositLabels = { stripe: '💳 Card', bank_transfer: '🏦 Bank transfer', invoice: '📧 Invoice me', cash: '💵 Cash in person' };
  const rows = [
    ['Game', `${selGame.icon || ''} ${selGame.name}`],
    ['Date', dateLabel],
    ['Time', fmt12(selSlot)],
    ['Players', playerCount],
    ['Name', `${first} ${last}`],
    ['Email', email],
  ];
  if (expRows && expRows.length) rows.push(['Add-ons', expRows.map(e => e.label).join(', ')]);
  rows.push(['Total', `$${grandTotal} NZD`]);
  rows.push(['Deposit due', `$${dep} NZD`]);
  if (depositPref) rows.push(['Deposit payment', depositLabels[depositPref] || depositPref]);
  document.getElementById('confirmCard').innerHTML = rows.map(([l, v]) => `<div class="confirm-row"><span class="confirm-lbl">${l}</span><span class="confirm-val">${v}</span></div>`).join('');
  document.getElementById('confirmRef').textContent = ref;
  goTo('s4', 5);
}

function startOver() {
  selCategory = null;
  selGame = null;
  selDate = null;
  selSlot = null;
  playerCount = 2;
  playedBefore = null;
  escapeView = 'game';
  ['fFirst', 'fLast', 'fEmail', 'fPhone', 'fSpecialName', 'fCompanyName', 'fSchoolName', 'fSchoolAgeGroup'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('fOccasion').value = '';
  document.getElementById('companyNameWrap').style.display = 'none';
  document.getElementById('schoolGroupWrap').style.display = 'none';
  const invoiceOptReset = document.getElementById('depositOptInvoice');
  if (invoiceOptReset) { invoiceOptReset.style.display = 'none';
    invoiceOptReset.classList.remove('selected'); }
  selectedExperienceLevels = ['First time'];
  renderExperienceLevels();
  document.getElementById('rb-yes').classList.remove('selected');
  document.getElementById('rb-no').classList.remove('selected');
  document.getElementById('prevGameWrap').style.display = 'none';
  document.getElementById('specialPersonWrap').style.display = 'none';
  document.getElementById('gameDateWrap').style.display = 'none';
  document.getElementById('gameSlotsWrap').style.display = 'none';
  document.getElementById('dateGamesWrap').style.display = 'none';
  document.getElementById('vrDateWrap').style.display = 'none';
  document.getElementById('vrSlotsWrap').style.display = 'none';
  document.getElementById('cafeDateWrap').style.display = 'none';
  document.getElementById('cafeSlotsWrap').style.display = 'none';
  goTo('s1', 1);
}

const ENQ_CONFIG = {
  'casual-vr': { title: 'Casual VR enquiry', sub: 'Tell us your preferred time and how many people — we\'ll confirm if we have space.' },
  'cafe': { title: 'Table hire enquiry', sub: 'Let us know your group size, preferred date and any questions.' },
  'general': { title: 'Send an enquiry', sub: 'Tell us what you\'re after and we\'ll get back to you.' },
};

function openEnquiry(type) {
  enqType = type;
  const cfg = ENQ_CONFIG[type] || ENQ_CONFIG['general'];
  document.getElementById('enqTitle').textContent = cfg.title;
  document.getElementById('enqSub').textContent = cfg.sub;
  const today = nzToday();
  document.getElementById('enqDate').value = today;
  document.getElementById('enqErr').classList.remove('show');
  document.getElementById('enqOverlay').classList.add('open');
}

function closeEnquiry() {
  document.getElementById('enqOverlay').classList.remove('open');
  enqType = null;
}

async function submitEnquiry() {
  const name = document.getElementById('enqName').value.trim();
  const contact = document.getElementById('enqContact').value.trim();
  const date = document.getElementById('enqDate').value;
  const time = document.getElementById('enqTime').value;
  const players = document.getElementById('enqPlayers').value;
  const notes = document.getElementById('enqNotes').value.trim();
  const errEl = document.getElementById('enqErr');

  if (!name || !contact) {
    errEl.textContent = 'Please enter your name and contact details.';
    errEl.classList.add('show');
    return;
  }

  const d = date ? new Date(date + 'T12:00') : nzNow();
  const typeLabels = { 'casual-vr': 'Casual VR', 'cafe': 'Cafe table hire', 'general': 'General' };
  const noteText = [
    typeLabels[enqType] || 'Enquiry',
    players ? `${players} players` : '',
    date ? DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] : '',
    time || '',
    notes,
    `Contact: ${contact}`,
  ].filter(Boolean).join(' · ');

  try {
    await fetch(`${SB_URL}/rest/v1/game_bookings`, {
      method: 'POST',
      headers: { ...SB_H, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        game_id: enqType === 'casual-vr' ? 'g4' : 'g5',
        game_name: typeLabels[enqType] || 'Enquiry',
        booking_date: date || nzToday(),
        slot_time: (time || '12:00') + ':00',
        players_booked: parseInt(players) || 1,
        status: 'enquiry',
        source: 'online',
        notes_when_booked: name + ' · ' + noteText,
        tags: JSON.stringify([]),
        staff_notes: JSON.stringify([]),
        assigned_staff_ids: JSON.stringify([]),
      })
    });
  } catch (e) { console.error('Enquiry save error:', e); }

  closeEnquiry();

  const thanks = document.createElement('div');
  thanks.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  thanks.innerHTML = `<div style="background:var(--bg-card);border:var(--ticket-border);border-radius:var(--ticket-radius);padding:32px;width:100%;max-width:380px;text-align:center;box-shadow:var(--shadow)">
      <div style="font-size:52px;margin-bottom:14px">🥽</div>
      <div style="font-family:var(--head-font);font-size:30px;color:var(--text-primary);margin-bottom:8px">Enquiry sent!</div>
      <div style="font-size:13px;color:var(--text-secondary);line-height:1.7;margin-bottom:24px">Thanks ${name}! We'll get back to you at <strong style="color:var(--text-primary)">${contact}</strong> as soon as we can to confirm availability.</div>
      <button class="btn btn-primary" onclick="this.closest('div[style]').remove()">Done →</button>
    </div>`;
  document.body.appendChild(thanks);
}

async function submitContactEnquiry() {
  const first = document.getElementById('cFirst').value.trim();
  const last = document.getElementById('cLast').value.trim();
  const phone = document.getElementById('cPhone').value.trim();
  const email = document.getElementById('cEmail').value.trim().toLowerCase();
  const gameId = document.getElementById('cGame').value;
  const date = document.getElementById('cDate').value;
  const players = parseInt(document.getElementById('cPlayers').value) || 1;
  const occasion = document.getElementById('cOccasion').value;
  const message = document.getElementById('cMessage').value.trim();
  const errEl = document.getElementById('enqFormErr');
  errEl.classList.remove('show');
  if (!first) { errEl.textContent = 'Please enter your first name.';
    errEl.classList.add('show'); return; }
  if (!phone && !email) { errEl.textContent = 'Please enter a phone or email so we can reach you.';
    errEl.classList.add('show'); return; }
  const btn = document.getElementById('btnEnqSubmit');
  btn.classList.add('btn-loading');
  btn.disabled = true;
  const game = games.find(g => g.id === gameId);
  const gameName = game ? game.name : 'General enquiry';
  const ref = 'ENQ-' + Date.now().toString(36).toUpperCase();
  const noteText = [`${first} ${last}`.trim(), phone, email, occasion || null, message || null, ref].filter(Boolean).join(' · ');
  try {
    let clientId = null;
    const cr = await fetch(`${SB_URL}/rest/v1/rpc/public_find_client_id`, {
      method: 'POST',
      headers: SB_H,
      body: JSON.stringify({ p_email: email || null, p_phone: phone || null })
    });
    const foundId = await cr.json();
    if (foundId) { clientId = foundId; } else {
      const nr = await fetch(`${SB_URL}/rest/v1/rpc/public_create_client`, {
        method: 'POST',
        headers: SB_H,
        body: JSON.stringify({ p_first_name: first, p_last_name: last || null, p_email: email || null, p_phone: phone || null })
      });
      clientId = await nr.json();
    }
    const r = await fetch(`${SB_URL}/rest/v1/game_bookings`, {
      method: 'POST',
      headers: { ...SB_H, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        client_id: clientId,
        game_id: gameId || 'enquiry',
        game_name: gameName,
        booking_date: date || nzToday(),
        slot_time: '12:00:00',
        players_booked: players,
        occasion: occasion || null,
        status: 'enquiry',
        source: 'online',
        notes_when_booked: noteText,
        tags: JSON.stringify([]),
        staff_notes: JSON.stringify([]),
        assigned_staff_ids: JSON.stringify([]),
      })
    });
    if (!r.ok) throw new Error(await r.text());
    btn.classList.remove('btn-loading');
    btn.disabled = false;
    const thanks = document.createElement('div');
    thanks.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    thanks.innerHTML = `<div style="background:var(--bg-card);border:var(--ticket-border);border-radius:var(--ticket-radius);padding:32px;width:100%;max-width:380px;text-align:center;box-shadow:var(--shadow)">
        <div style="font-size:52px;margin-bottom:14px">💬</div>
        <div style="font-family:var(--head-font);font-size:30px;color:var(--text-primary);margin-bottom:8px">Message sent!</div>
        <div style="font-size:13px;color:var(--text-secondary);line-height:1.7;margin-bottom:24px">
          Thanks ${first}! We'll be in touch at <strong style="color:var(--text-primary)">${phone || email}</strong> as soon as we can.
        </div>
        <button class="btn btn-primary" onclick="this.closest('div[style]').remove();startOver()">Done →</button>
      </div>`;
    document.body.appendChild(thanks);
  } catch (e) {
    btn.classList.remove('btn-loading');
    btn.disabled = false;
    errEl.textContent = 'Something went wrong — please call us directly.';
    errEl.classList.add('show');
    console.error('Enquiry submit error:', e);
  }
}

function saveAbandonedDraft() {
  if (draftSaved) return;
  const s3active = document.getElementById('s3')?.classList.contains('active');
  const s3rActive = document.getElementById('s3review')?.classList.contains('active');
  if (!s3active && !s3rActive) return;

  const first = document.getElementById('fFirst')?.value.trim();
  const last = document.getElementById('fLast')?.value.trim();
  const email = document.getElementById('fEmail')?.value.trim();
  const phone = document.getElementById('fPhone')?.value.trim();
  if (!first || (!email && !phone)) return;

  draftSaved = true;

  const occasion = document.getElementById('fOccasion')?.value || '';
  const noteText = [
    `${first} ${last || ''}`.trim(),
    phone || '',
    email || '',
    occasion || '',
    'Abandoned before confirming',
  ].filter(Boolean).join(' · ');

  const draftData = {
    game_id: selGame?.id || 'unknown',
    game_name: selGame?.name || 'Unknown',
    booking_date: selDate || nzToday(),
    slot_time: (selSlot || '12:00') + ':00',
    players_booked: playerCount || 1,
    occasion: occasion || null,
    status: 'abandoned',
    source: 'online',
    notes_when_booked: noteText,
    tags: JSON.stringify([]),
    staff_notes: JSON.stringify([]),
    assigned_staff_ids: JSON.stringify([]),
  };

  fetch(`${SB_URL}/rest/v1/game_bookings`, {
    method: 'POST',
    headers: { ...SB_H, 'Prefer': 'return=minimal' },
    body: JSON.stringify(draftData),
    keepalive: true,
  }).catch(() => {});
}

window.addEventListener('pagehide', saveAbandonedDraft);

init();
