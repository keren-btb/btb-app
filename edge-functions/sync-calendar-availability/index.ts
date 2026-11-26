// sync-calendar-availability (v4 - 2026-11-09)
//
// v4: Also saves the TITLE of each busy calendar item into the private table
// staff_calendar_busy_details (only the person themselves and owners can read it).
// The public busy-times table (staff_calendar_busy) is unchanged and still holds
// times only, no titles. If saving titles fails, busy times are still saved.
//
// v3: Repeating events are now only listed for review / counted as busy if they
// have a real occurrence between now and the end of the sync window. Previously
// only an UNTIL end date was checked, so events that repeat a set number of times
// (COUNT=...) and finished years ago kept appearing as 'pending'. Also raised
// MAX_ITER_DAYS (5000 -> 30000) so repeating events that started many years ago
// still reach today's date when expanded.
//
// TEMP DEBUG (2026-08-17): console.log lines left in deliberately while
// we verify this against Joolz's real calendar. Remove once confirmed
// working — see VERSIONS.md.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SYNC_WINDOW_DAYS = 60;
const NZ_TZ = "Pacific/Auckland";
const MAX_ITER_DAYS = 30000;

function dbHeaders() {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

function unescapeICS(s: string): string {
  return (s || "")
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function unfoldICS(text: string): string[] {
  const rawLines = text.split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function nzOffsetMinutes(utcDate: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: NZ_TZ, timeZoneName: "shortOffset" });
  const part = dtf.formatToParts(utcDate).find((p) => p.type === "timeZoneName");
  const match = part?.value.match(/GMT([+-]\d+)(?::?(\d+))?/);
  if (!match) return 0;
  const hours = parseInt(match[1], 10);
  const mins = match[2] ? parseInt(match[2], 10) : 0;
  return hours * 60 + (hours < 0 ? -mins : mins);
}

interface ICSComponents {
  y: number; mo: number; d: number; h: number; mi: number; s: number; isUTC: boolean;
}

function icsValueToComponents(value: string): ICSComponents {
  const isUTC = value.endsWith("Z");
  const clean = value.replace("Z", "");
  const y = parseInt(clean.slice(0, 4), 10);
  const mo = parseInt(clean.slice(4, 6), 10);
  const d = parseInt(clean.slice(6, 8), 10);
  const hasTime = clean.length > 8 && clean[8] === "T";
  const h = hasTime ? parseInt(clean.slice(9, 11), 10) : 0;
  const mi = hasTime ? parseInt(clean.slice(11, 13), 10) : 0;
  const s = hasTime ? parseInt(clean.slice(13, 15), 10) : 0;
  return { y, mo, d, h, mi, s, isUTC };
}

function componentsToUTC(c: ICSComponents): Date {
  if (c.isUTC) return new Date(Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi, c.s));
  const guessUTC = Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi, c.s);
  const offsetMin = nzOffsetMinutes(new Date(guessUTC));
  return new Date(guessUTC - offsetMin * 60000);
}

function icsDateToUTC(value: string): Date {
  return componentsToUTC(icsValueToComponents(value));
}

function ymdKey(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function fingerprintOf(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const BYDAY_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

interface RRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | null;
  interval: number;
  byday: number[];
  bymonthday: number[];
  until: Date | null;
  count: number | null;
}

function parseRRuleString(rruleText: string): RRule {
  const rule: RRule = { freq: null, interval: 1, byday: [], bymonthday: [], until: null, count: null };
  for (const part of rruleText.split(";")) {
    const [key, val] = part.split("=");
    if (!key || !val) continue;
    switch (key.toUpperCase()) {
      case "FREQ":
        if (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(val)) rule.freq = val as RRule["freq"];
        break;
      case "INTERVAL":
        rule.interval = parseInt(val, 10) || 1;
        break;
      case "BYDAY":
        rule.byday = val.split(",").map((d) => BYDAY_CODES[d.trim().slice(-2)]).filter((n) => n !== undefined);
        break;
      case "BYMONTHDAY":
        rule.bymonthday = val.split(",").map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
        break;
      case "UNTIL":
        try { rule.until = icsDateToUTC(val); } catch { /* ignore */ }
        break;
      case "COUNT":
        rule.count = parseInt(val, 10) || null;
        break;
    }
  }
  return rule;
}

function describeRRule(rule: RRule, dtstartLocal: Date): string {
  if (!rule.freq) return "Custom recurring pattern";
  const timeLabel = dtstartLocal.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit", timeZone: NZ_TZ });
  const every = rule.interval > 1 ? `Every ${rule.interval} ` : "";
  if (rule.freq === "DAILY") {
    return `${every || "Every "}${rule.interval > 1 ? "days" : "day"}, ${timeLabel}`;
  }
  if (rule.freq === "WEEKLY") {
    const days = rule.byday.length > 0
      ? rule.byday.map((d) => DAY_NAMES[d]).join("/")
      : DAY_NAMES[new Date(dtstartLocal).getUTCDay()];
    return `${rule.interval > 1 ? `Every ${rule.interval} weeks` : "Weekly"} on ${days}, ${timeLabel}`;
  }
  if (rule.freq === "MONTHLY") {
    return `${rule.interval > 1 ? `Every ${rule.interval} months` : "Monthly"}, ${timeLabel}`;
  }
  return `${rule.interval > 1 ? `Every ${rule.interval} years` : "Yearly"}, ${timeLabel}`;
}

function expandRRuleDates(startComp: ICSComponents, rule: RRule, windowStart: Date, windowEnd: Date): Date[] {
  if (!rule.freq) return [];
  const results: Date[] = [];
  const startDateOnly = Date.UTC(startComp.y, startComp.mo - 1, startComp.d);
  const hardStopDateOnly = rule.until
    ? Math.min(Date.UTC(rule.until.getUTCFullYear(), rule.until.getUTCMonth(), rule.until.getUTCDate()), windowEnd.getTime() + 2 * 86400000)
    : windowEnd.getTime() + 2 * 86400000;
  let occurrenceCount = 0;
  let cursor = startDateOnly;
  let iterations = 0;

  while (cursor <= hardStopDateOnly && iterations < MAX_ITER_DAYS) {
    iterations++;
    const cd = new Date(cursor);
    let matches = false;

    if (rule.freq === "DAILY") {
      const daysSince = Math.round((cursor - startDateOnly) / 86400000);
      matches = daysSince % rule.interval === 0;
    } else if (rule.freq === "WEEKLY") {
      const daysSince = Math.round((cursor - startDateOnly) / 86400000);
      const weekIndex = Math.floor(daysSince / 7);
      const inIntervalWeek = ((weekIndex % rule.interval) + rule.interval) % rule.interval === 0;
      const dayOk = rule.byday.length > 0
        ? rule.byday.includes(cd.getUTCDay())
        : cd.getUTCDay() === new Date(startDateOnly).getUTCDay();
      matches = inIntervalWeek && dayOk;
    } else if (rule.freq === "MONTHLY") {
      const startD = new Date(startDateOnly);
      const monthsSince = (cd.getUTCFullYear() - startD.getUTCFullYear()) * 12 + (cd.getUTCMonth() - startD.getUTCMonth());
      const inIntervalMonth = monthsSince >= 0 && monthsSince % rule.interval === 0;
      const dayOk = rule.bymonthday.length > 0
        ? rule.bymonthday.includes(cd.getUTCDate())
        : cd.getUTCDate() === startD.getUTCDate();
      matches = inIntervalMonth && dayOk;
    } else if (rule.freq === "YEARLY") {
      const startD = new Date(startDateOnly);
      const yearsSince = cd.getUTCFullYear() - startD.getUTCFullYear();
      matches = yearsSince >= 0 && yearsSince % rule.interval === 0
        && cd.getUTCMonth() === startD.getUTCMonth() && cd.getUTCDate() === startD.getUTCDate();
    }

    if (matches) {
      occurrenceCount++;
      if (rule.count && occurrenceCount > rule.count) break;
      const occInstant = componentsToUTC({
        y: cd.getUTCFullYear(), mo: cd.getUTCMonth() + 1, d: cd.getUTCDate(),
        h: startComp.h, mi: startComp.mi, s: startComp.s, isUTC: startComp.isUTC,
      });
      if (occInstant.getTime() >= windowStart.getTime() && occInstant.getTime() <= windowEnd.getTime()) {
        results.push(occInstant);
      }
    }
    cursor += 86400000;
  }
  return results;
}

interface RawEvent {
  uid: string;
  dtstart: string | null;
  dtend: string | null;
  rrule: string | null;
  exdates: string[];
  recurrenceId: string | null;
  status: string;
  summary: string;
}

function parseICSRaw(text: string): RawEvent[] {
  const lines = unfoldICS(text);
  const events: RawEvent[] = [];
  let inEvent = false;
  let cur: RawEvent | null = null;

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) {
      inEvent = true;
      cur = { uid: "", dtstart: null, dtend: null, rrule: null, exdates: [], recurrenceId: null, status: "", summary: "" };
      continue;
    }
    if (line.startsWith("END:VEVENT")) {
      inEvent = false;
      if (cur) events.push(cur);
      cur = null;
      continue;
    }
    if (!inEvent || !cur) continue;

    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx);
    const val = line.slice(idx + 1).trim();

    if (key.startsWith("UID")) cur.uid = val;
    else if (key.startsWith("DTSTART")) cur.dtstart = val;
    else if (key.startsWith("DTEND")) cur.dtend = val;
    else if (key.startsWith("RRULE")) cur.rrule = val;
    else if (key.startsWith("EXDATE")) cur.exdates.push(...val.split(","));
    else if (key.startsWith("RECURRENCE-ID")) cur.recurrenceId = val;
    else if (key.startsWith("STATUS")) cur.status = val;
    else if (key.startsWith("SUMMARY")) cur.summary = val;
  }
  return events;
}

async function getReviewRows(staffId: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/staff_recurring_event_review?staff_id=eq.${staffId}&select=*`,
    { headers: dbHeaders() },
  );
  if (!res.ok) throw new Error(`Failed to load review rows: ${res.status}`);
  return await res.json();
}

async function insertReviewRow(row: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/staff_recurring_event_review`, {
    method: "POST",
    headers: { ...dbHeaders(), Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
}

async function deleteStaleReviewRows(staffId: string, currentUids: string[]) {
  const base = `${SUPABASE_URL}/rest/v1/staff_recurring_event_review?staff_id=eq.${staffId}`;
  const url = currentUids.length > 0
    ? `${base}&event_uid=not.in.(${currentUids.map(encodeURIComponent).join(",")})`
    : base;
  await fetch(url, { method: "DELETE", headers: dbHeaders() });
}

interface BusyBlock { start: Date; end: Date; title: string; uid: string; }

Deno.serve(async () => {
  const results: Record<string, unknown>[] = [];

  try {
    const staffRes = await fetch(
      `${SUPABASE_URL}/rest/v1/staff?availability_mode=eq.calendar&ical_url=not.is.null&select=id,name,ical_url`,
      { headers: dbHeaders() },
    );
    if (!staffRes.ok) {
      return new Response(JSON.stringify({ error: `Failed to load staff list: ${staffRes.status}` }), { status: 500 });
    }
    const staffList: { id: string; name: string; ical_url: string }[] = await staffRes.json();
    console.log(`[sync-debug] Calendar-mode staff: ${staffList.map((s) => s.name).join(", ")}`);

    const now = new Date();
    const windowEnd = new Date(now.getTime() + SYNC_WINDOW_DAYS * 86400000);

    for (const staff of staffList) {
      try {
        const icsRes = await fetch(staff.ical_url);
        if (!icsRes.ok) {
          results.push({ staff: staff.name, error: `Feed fetch failed: ${icsRes.status}` });
          continue;
        }
        const icsText = await icsRes.text();
        const rawEvents = parseICSRaw(icsText);
        console.log(`[sync-debug] ${staff.name}: ${rawEvents.length} VEVENTs found`);

        const byUid = new Map<string, RawEvent[]>();
        for (const ev of rawEvents) {
          if (!ev.uid) continue;
          if (!byUid.has(ev.uid)) byUid.set(ev.uid, []);
          byUid.get(ev.uid)!.push(ev);
        }

        const existingReview = await getReviewRows(staff.id);
        const reviewByKey = new Map<string, any>();
        for (const r of existingReview) reviewByKey.set(`${r.event_uid}::${r.fingerprint}`, r);

        const busyBlocks: BusyBlock[] = [];
        const currentRecurringUids: string[] = [];
        let pendingLogged = 0, approvedExpanded = 0, ignoredCount = 0, oneOffCount = 0, parseErrors = 0, expiredSkipped = 0, noUpcomingSkipped = 0;

        for (const [uid, group] of byUid.entries()) {
          const master = group.find((e) => !e.recurrenceId);
          const overrides = group.filter((e) => e.recurrenceId);

          if (!master || !master.dtstart) { parseErrors++; continue; }
          if (master.status === "CANCELLED" && !master.rrule) continue;

          const masterTitle = unescapeICS(master.summary);

          if (!master.rrule) {
            try {
              const start = icsDateToUTC(master.dtstart);
              const end = master.dtend ? icsDateToUTC(master.dtend) : new Date(start.getTime() + 3600000);
              if (end > now && start < windowEnd) {
                busyBlocks.push({ start, end, title: masterTitle, uid });
                oneOffCount++;
              }
            } catch { parseErrors++; }
            continue;
          }

          const rule = parseRRuleString(master.rrule);
          if (staff.name === "Joolz") {
            console.log(`[sync-debug] ${staff.name} RRULE-CHECK "${master.summary}" rrule="${master.rrule}" parsedUntil=${rule.until ? rule.until.toISOString() : 'null'} now=${now.toISOString()} willSkip=${!!(rule.until && rule.until.getTime() < now.getTime())}`);
          }

          if (rule.until && rule.until.getTime() < now.getTime()) { expiredSkipped++; continue; }

          // v3: skip repeating events with no real occurrence between now and the end of the
          // sync window (e.g. a COUNT-limited series that finished years ago). Skipped events
          // are left out of currentRecurringUids, so any old pending review row for them is
          // cleaned up by the stale-row clean-up below.
          {
            const earlyStartComp = icsValueToComponents(master.dtstart);
            const earlyExdates = new Set(master.exdates.map((d) => {
              try { return ymdKey(icsDateToUTC(d.trim())); } catch { return ""; }
            }));
            const upcomingOccs = expandRRuleDates(earlyStartComp, rule, now, windowEnd)
              .filter((o) => !earlyExdates.has(ymdKey(o)));
            const upcomingOverride = overrides.some((ov) => {
              if (ov.status === "CANCELLED" || !ov.dtstart) return false;
              try {
                const s = icsDateToUTC(ov.dtstart);
                return s.getTime() >= now.getTime() && s.getTime() <= windowEnd.getTime();
              } catch { return false; }
            });
            if (upcomingOccs.length === 0 && !upcomingOverride) { noUpcomingSkipped++; continue; }
          }

          currentRecurringUids.push(uid);
          const fingerprint = fingerprintOf(`${master.rrule}|${master.summary}|${master.dtstart}`);
          const reviewRow = reviewByKey.get(`${uid}::${fingerprint}`);

          if (!reviewRow) {
            const dtstartUTC = icsDateToUTC(master.dtstart);
            await insertReviewRow({
              staff_id: staff.id,
              event_uid: uid,
              fingerprint,
              summary: master.summary || "(no title)",
              pattern_label: describeRRule(rule, dtstartUTC),
              rrule_text: master.rrule,
              status: "pending",
            });
            pendingLogged++;
            continue;
          }

          if (reviewRow.status === "ignored") { ignoredCount++; continue; }
          if (reviewRow.status !== "approved") { continue; }

          const dtstartUTC = icsDateToUTC(master.dtstart);
          const dtendUTC = master.dtend ? icsDateToUTC(master.dtend) : new Date(dtstartUTC.getTime() + 3600000);
          const durationMs = dtendUTC.getTime() - dtstartUTC.getTime();
          const startComp = icsValueToComponents(master.dtstart);
          const exdateSet = new Set(master.exdates.map((d) => {
            try { return ymdKey(icsDateToUTC(d.trim())); } catch { return ""; }
          }));
          const overrideByDate = new Map<string, RawEvent>();
          for (const ov of overrides) {
            if (!ov.recurrenceId) continue;
            try { overrideByDate.set(ymdKey(icsDateToUTC(ov.recurrenceId)), ov); } catch { /* skip */ }
          }

          const occInstants = expandRRuleDates(startComp, rule, now, windowEnd);
          for (const occStart of occInstants) {
            const dateKey = ymdKey(occStart);
            if (exdateSet.has(dateKey)) continue;

            const override = overrideByDate.get(dateKey);
            if (override) {
              if (override.status === "CANCELLED") continue;
              if (override.dtstart) {
                try {
                  const oStart = icsDateToUTC(override.dtstart);
                  const oEnd = override.dtend ? icsDateToUTC(override.dtend) : new Date(oStart.getTime() + durationMs);
                  busyBlocks.push({ start: oStart, end: oEnd, title: unescapeICS(override.summary) || masterTitle, uid });
                  continue;
                } catch { /* fall through to default */ }
              }
            }
            busyBlocks.push({ start: occStart, end: new Date(occStart.getTime() + durationMs), title: masterTitle, uid });
          }
          approvedExpanded++;
        }

        await deleteStaleReviewRows(staff.id, currentRecurringUids);

        await fetch(`${SUPABASE_URL}/rest/v1/staff_calendar_busy?staff_id=eq.${staff.id}`, {
          method: "DELETE", headers: dbHeaders(),
        });
        if (busyBlocks.length > 0) {
          const rows = busyBlocks.map((b) => ({ staff_id: staff.id, busy_start: b.start.toISOString(), busy_end: b.end.toISOString() }));
          await fetch(`${SUPABASE_URL}/rest/v1/staff_calendar_busy`, {
            method: "POST",
            headers: { ...dbHeaders(), Prefer: "return=minimal" },
            body: JSON.stringify(rows),
          });
        }

        // v4: save titles to the private details table. Never allowed to break the busy-times sync above.
        let detailsSaved = 0, detailsError = "";
        try {
          const delRes = await fetch(`${SUPABASE_URL}/rest/v1/staff_calendar_busy_details?staff_id=eq.${staff.id}`, {
            method: "DELETE", headers: dbHeaders(),
          });
          if (!delRes.ok) throw new Error(`details delete ${delRes.status}`);
          if (busyBlocks.length > 0) {
            const detailRows = busyBlocks.map((b) => ({
              staff_id: staff.id, event_uid: b.uid, title: b.title,
              busy_start: b.start.toISOString(), busy_end: b.end.toISOString(),
            }));
            const insRes = await fetch(`${SUPABASE_URL}/rest/v1/staff_calendar_busy_details`, {
              method: "POST",
              headers: { ...dbHeaders(), Prefer: "return=minimal" },
              body: JSON.stringify(detailRows),
            });
            if (!insRes.ok) throw new Error(`details insert ${insRes.status}`);
            detailsSaved = detailRows.length;
          }
        } catch (e) {
          detailsError = String(e);
          console.log(`[sync-debug] ${staff.name}: titles not saved: ${detailsError}`);
        }

        console.log(`[sync-debug] ${staff.name}: busy=${busyBlocks.length} (oneOff=${oneOffCount}, approvedRecurring=${approvedExpanded}), titlesSaved=${detailsSaved}, pendingLogged=${pendingLogged}, ignored=${ignoredCount}, expiredSkipped=${expiredSkipped}, noUpcomingSkipped=${noUpcomingSkipped}, parseErrors=${parseErrors}`);
        results.push({ staff: staff.name, busy: busyBlocks.length, oneOffCount, approvedExpanded, detailsSaved, detailsError, pendingLogged, ignoredCount, expiredSkipped, noUpcomingSkipped, parseErrors });
      } catch (err) {
        console.log(`[sync-debug] ${staff.name}: threw ${String(err)}`);
        results.push({ staff: staff.name, error: String(err) });
      }
    }

    return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
