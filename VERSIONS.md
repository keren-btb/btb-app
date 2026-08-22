# BtB App Suite — Version Log

This file is the source of truth for current build versions across all app files.
Updated automatically whenever a file's `BUILD_VERSION` is bumped and pushed.
Newest entry per file goes at the top of that file's list.

---

## Database (Supabase RLS — no file/BUILD_VERSION, tracked here for record)
- 2026-08-17 — Investigated "is Joolz's calendar availability working correctly" and found it wasn't:
  `staff_calendar_busy` had zero rows for her, ever, even though the sync ran successfully every 20
  minutes. Root cause: her real schedule is almost entirely recurring calendar events (Escape Room
  shifts, swim teaching, Sunday school, "Youth Joolz away"), and the sync function only ever handled
  one-off events — recurring (RRULE) events were detected and silently skipped by design. New table
  `staff_recurring_event_review` (staff_id, event_uid, fingerprint, summary, pattern_label,
  rrule_text, status pending/approved/ignored, decided_by, decided_at) added — RLS matches
  staff_availability (own rows, or admin/manager via is_admin_or_manager()). The
  `sync-calendar-availability` edge function was rewritten to actually expand RRULE patterns
  (DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, BYDAY, BYMONTHDAY, UNTIL, COUNT, EXDATE, RECURRENCE-ID
  overrides for moved/cancelled single occurrences) into real dates — but only for patterns a human
  has approved via the new review table; unseen patterns are logged as pending and skipped until
  answered. Stale review rows are cleaned up automatically when an event disappears from the feed.
  Caught and fixed a DST bug during build: the NZ offset must be re-derived per individual occurrence
  date, not reused from the first one, or events would land an hour wrong after a daylight-saving
  change (NZDT starts 27 Sept 2026, inside the 60-day sync window right now). Confirmed working
  against Joolz's real feed — her ~25 recurring events came through correctly with clean plain-
  language descriptions (e.g. "Weekly on Wednesday, 9:30 am"). Staff-side review UI shipped in
  staff_portal.html v1.9.19; admin-side review/override UI in btb_app.html still to come.
  NOTE: the edge function currently has verbose `[sync-debug]` console.log lines left in
  deliberately for ongoing verification — remove once confirmed solid over a few real sync cycles.
- 2026-08-16 — Verification only, no schema change: re-checked live RLS policies, column grants,
  and triggers against `btb_security_review.md` Finding 12 and the "revised severity ranking"
  (Findings 0-4). Confirmed all of it is already closed — `user_roles` deny-all, `hours_requests`/
  `assigned_shifts` authenticated-only and role-scoped, `staff`/`timesheets` self-edit triggers
  blocking wage/role/approval tampering on your own row, `staff_availability`/
  `staff_recurring_blocks` row-scoped. Closed via RLS + triggers, not the edge-function move the
  review originally proposed — decided not to do that rework, no live vulnerability remains. Full
  writeup in `btb_security_review.md`'s 16 Aug addendum.
- 2026-08-16 — New trigger `trg_sync_client_status_on_booking_complete` (function
  `sync_client_status_on_booking_complete`, SECURITY DEFINER) on `game_bookings`: when a booking's
  `status` changes to `completed` for the first time (fires from either btb_app.html's calendar
  toggle or control_room.html's "Save & Complete Session" — both write to the same column), the
  linked client's `clients.status` is auto-set to `complete`. If the booking is later toggled back
  off `completed`, the client's status reverts to `incomplete_booking`. Bookings with no linked
  client (`client_id` is null) are skipped. Tested end-to-end both directions on live data.
- 2026-08-15 — Closed 6 tables that were fully open to the public anon key (no login required):
  `products`, `quick_sales`, `staff_shifts`, `staff_recurring_availability`, `waivers`, and 10
  task-hub tables (`daily_task_categories`, `daily_task_instances`, `general_task_instances`,
  `general_task_tags`, `general_task_templates`, `task_checklist_types`,
  `task_instance_responses`, `task_instances`, `task_template_fields`, `task_templates`) plus
  `personal_tasks`. Also revoked anon's column-level read access to `products.purchase_price`
  (cost price). The existing `staff.can_edit_task_templates` checkbox now actually enforces
  template/category/tag edit access at the database level (previously UI-only). Full details in
  `btb_security_review.md` — Findings 17–22.

## Push notification foundation (manifest.json, sw.js, icon-*.png, apple-touch-icon.png, icon-maskable-512.png)
- v1.1.0 — 2026-08-08 — App-wide PWA: manifest.json now covers the whole suite (name "Beyond the Box Staff", start_url btb_app.html) instead of just Staff Portal. All 12 staff-reachable pages (btb_app, staff_portal, control_room, pos, reports, clients, client_profile, clients_mobile, task_hub, waiver, booking_widget, gift_voucher_request) now link the manifest/icon/theme-color tags and register the service worker, so the whole app installs as one unit. Replaced the placeholder icon set with the teal "BtB" design (icon-192, icon-512, icon-maskable-512, apple-touch-icon all regenerated to match). Generated a brand-new VAPID key pair — the old public key baked into staff_portal.html had no matching private key saved anywhere, so push could never have worked; old push_subscriptions rows (signed under the orphaned key) were cleared. Added the actual send_help_push action to the btb-admin edge function (previously nothing sent a push when a help alert fired, even though the phone-side subscribe/receive code existed) and wired triggerHelp() in btb_app.html to call it. MANUAL STEP STILL NEEDED: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be added as secrets in the Supabase dashboard before this works end-to-end — Claude has no tool access to set secrets.
- v1.0.0 — 2026-07-30 — New: PWA manifest + service worker + placeholder "BtB" teal icon set. Lets staff_portal.html be "Added to Home Screen" (required on iPhone for background push) and lays the groundwork for phone push notifications on help alerts. No behaviour change yet — staff_portal.html doesn't register for push until the next step.

## btb_app.css
- Tracked via the `?v=` cache-busting query string on btb_app.html's stylesheet link, not an internal BUILD_VERSION (plain CSS has nowhere to put one) — bump that query string every time this file changes
- v16.4.21 — 2026-08-15 — .pay-badge: removed margin-bottom and added white-space:nowrap now that it sits inline next to the ⋯ button instead of stacked in the left column.
- v16.4.20 — 2026-08-15 — Increased .booking-game font-size (13px→15px). Added .pay-badge / .pay-badge.paid / .pay-badge.owing for the new booking card payment status badge.
- v16.4.19 — 2026-08-10 — Added text-align:center to .nav-btn so wrapped two-line labels (e.g. "Task Hub") centre correctly under their icon.
- v16.4.18 — 2026-08-10 — Added .qb-btn.icon-only (compact icon-only quick-book buttons) and hover/disabled styles for the new booking-card actions menu.
- v16.4.6 — 2026-08-03 — Added .time-group-wrapper / .time-group-label styles for the new same-time booking grouping, then thickened the connecting line (4px→8px) and enlarged the shared time label (13px→17px, bold) for better readability

## btb_app.html
- v16.4.25 — 2026-08-22 — Bugfix: payment badge showed nothing at all (not even "owing") on bookings whose total_amount had never been saved to the row — e.g. bookings synced from cal.com, or added via the calendar's quick walk-in form — even when they'd been paid in full through POS. getPaymentStatus now falls back to calculating the price from the game + player count (same formula pos.html already uses for its own "Paid" badge) whenever total_amount is missing, instead of bailing out. loadBookings now also maps players_booked onto the local booking object so this fallback has the player count to work with.
- v16.4.24 — 2026-08-15 — Bugfix: payment badge showed "owing" on bookings that were actually fully paid, because it only summed payments[] and missed deposits taken via the walk-in form/POS (tracked separately in deposit_paid+deposit_amount). getPaymentStatus now matches pos.html's own "collected" formula (deposit + payments[], excluding pending invoices). loadBookings now also maps deposit_amount/deposit_paid onto the local booking object (previously not carried over from Supabase at all).
- v16.4.23 — 2026-08-15 — Cleaned up console noise: loadBookings and loadTraining now check the response is an array before processing, instead of throwing when the expected pre-login 401 (staff/game_bookings/staff_game_training have no anon SELECT by design) came back. No behaviour change — data still reloads correctly right after login.
- v16.4.22 — 2026-08-15 — Bugfix: the new payment badge (v16.4.20) crashed the whole booking list on load — b.payments comes back from Supabase as a JSON string (double-encoded inside the jsonb column) rather than an array, so .reduce() threw. getPaymentStatus now JSON.parses it safely before summing.
- v16.4.21 — 2026-08-15 — Moved the payment badge (Paid/$X owing) from under the customer name to sit directly left of the ⋯ actions button, top-right of the card.
- v16.4.20 — 2026-08-15 — Booking cards: moved Expand/Collapse into the ⋯ actions menu (removed the separate "Expand ▼/Collapse ▲" bar; clicking the card's left side still toggles it open/closed). Added a Paid/$X owing payment badge next to the customer name, calculated from total_amount vs sum of the payments array. Game name in the card title is now abbreviated ("Gregg in the Box"→"Gregg", "Saving Christmas"→"Christmas") via a small lookup table, and its font size was increased slightly (13px→15px).
- v16.4.19 — 2026-08-10 — Fixed nav bar labels (e.g. "Task Hub") not centering under their icon when the label wraps to two lines. Fixed the new booking actions (⋯) dropdown getting clipped by the card's rounded-corner overflow:hidden when the booking was collapsed — now positioned fixed to the viewport from the button's location, so it always shows in full.
- v16.4.18 — 2026-08-10 — Quick-book row is now icon-only (name on hover) so it fits on one line. Removed the "🎂 Mention: ..." birthday upsell banner from booking cards entirely. Added a ⋯ actions menu to each booking card: Call (opens phone dialer), Email (opens device mail app), Reschedule (inline date/time picker, same 90-min overlap warning as the walk-in form but lets you book over it anyway), Cancel booking (inline confirm with a checkbox to optionally send a cancellation email via Resend, logged against the client's record). Also added client_id to the locally-loaded booking objects so cancellation emails log correctly.
- v16.4.17 — 2026-08-09 — (previously undocumented) Fixed Android text-size-adjust bug — the installed (standalone) PWA rendered noticeably larger/zoomed compared to a normal browser tab, cutting off content on the right. Added text-size-adjust:100% in btb_app.css to disable it.
- v16.4.16 — 2026-08-08 — Added PWA install tags (manifest/apple-touch-icon/theme-color + service worker registration) so this page — as the app's start page — can be installed to a phone home screen along with the rest of the suite. triggerHelp() now also calls the new send_help_push action on btb-admin right after logging the help_alerts row, so raising a help alert actually sends a push notification to subscribed staff phones (previously nothing did, despite the receiving side existing).
- v16.4.15 — 2026-08-08 — Fixed calendar coming up empty on a fresh login (not a restored session) — doLogin() was reloading shift times, games, and staff with the real staff token but never bookings, so game_bookings (anon has no SELECT access, INSERT-only) stayed empty until a manual refresh. Added the missing loadBookings() call, matching what the restored-session path already did. Also removed an accidental duplicate loadShiftTimes() call in the same block.
- v16.4.14 — 2026-08-08 — Fixed misread of prior request — thickened the time-group connector line to 4px (double the original 2px), not thinner.
- v16.4.13 — 2026-08-08 — Thinned the time-group connector line (added in v16.4.12) from 2px to 1px.
- v16.4.12 — 2026-08-08 — Day-view Events calendar: when 2+ games share the same time slot, each game card now has a short horizontal teal connector line linking it to the group's vertical line on the left, centred on the card's vertical middle (works even when a card expands/collapses).
- v16.4.11 — 2026-08-08 — Moved the profile avatar button inline with the "BtB APP" title (absolute-positioned top-right) instead of its own row below, so it no longer adds extra height to the header. Shrunk avatar slightly (34px→30px) to sit cleanly alongside the title text.
- v16.4.10 — 2026-08-07 — Fixed bug where the calendar always came up empty on first login and needed a manual refresh — bookings weren't being reloaded with the real staff token like shift times/games/staff already were (the anon-key connection used before login has no read access to game_bookings). Also replaced the plain "Name · Sign out" header badge with an initials avatar + dropdown menu (Staff Portal, Control Room, Booking Widget, Gift Voucher, Sign out).
- v16.4.9 — 2026-08-06 — Page Text panel's Board Game Cafe section is now a freely-orderable list (add/delete/move-up-down) of title/body lines instead of 3 fixed fields, matching booking_widget.html v1.7.20. Pricing line's amount stays auto-calculated but its title can be renamed and moved.
- v16.4.8 — 2026-08-06 — New "Page Text" settings panel (admin only) lets staff edit the booking widget's category circle titles/tooltips, Board Game Cafe "How it works" text, and VR Casual card text — previously hardcoded, now saved to settings.btb_booking_text. Also added an optional per-game "Info tooltip" field (games.tooltip) shown as an "i" icon on that game's card in the booking widget.
- v16.4.7 — 2026-08-03 — New booking (walk-in) form now has an email field and links to a real client record (find-or-create by email/phone, same pattern as enquiries.html) instead of only capturing name/phone as free text. Also added a "Don't send confirmation email" checkbox, wired to game_bookings.skip_confirmation_email.
- v16.4.6 — 2026-08-03 — Booking list: same-time bookings now group under one shared time label with a thicker connecting line, instead of repeating the time on every card. Also added a `?v=16.4.6` cache-busting query string to the btb_app.css link (btb_app.css wasn't versioned before, so CSS edits could silently be served from browser cache even after a fresh deploy). Bump this `?v=` number whenever btb_app.css changes.
- v16.4.5 — 2026-08-02 — Docs only: added a warning comment above saveGames() flagging that the game list is dual-written to the games table and settings.btb_games, and both must be kept in sync by any future code that edits games. No behaviour change.
- v16.4.4 — 2026-07-30 — Finding 13 fix: deleteProduct, toggleProdActive, triggerHelp and dismissHelp no longer silently ignore failed database saves; optimistic UI changes revert and show an alert if the save fails
- v16.4.3 — 2026-07-29 — Code quality: replaced two hardcoded "300 seconds" timer warning thresholds with a single named constant (TIMER_WARNING_THRESHOLD_SEC); no behaviour change
- v16.4.2 — 2026-07-29 — Security fix: escaped customer/staff free-text fields (name, phone, email, occasion, special-person name/age, previous game, notes) before inserting into innerHTML, closing a stored-XSS risk in booking cards and the timer banner
- v16.4.1 — 2026-07-28 — Seeded from repo (no changelog note found in code at this version)

## staff_portal.html
- v1.9.19 — 2026-08-17 — New: calendar-mode staff (currently Joolz) now see a "New events found on your calendar" panel on the Availability tab. Part of the new recurring-calendar-event review system (see Database section below) — recurring events synced from their personal calendar need a one-time yes/no (does this pattern mean they're unavailable for GM shifts?), answered here and remembered. Includes a bulk "Ignore all pending" button since a personal calendar can surface a lot of irrelevant recurring entries (birthdays, reminders) alongside real work-relevant ones.
- v1.9.17 — 2026-08-08 — Swapped in a new VAPID_PUBLIC_KEY. The previous one had no matching private key saved anywhere (confirmed — no secret existed), so push notifications could never have actually worked despite the subscribe UI/code being in place. Existing push_subscriptions rows (signed under the old, orphaned key) were cleared — staff need to re-toggle "Alerts" on once the new VAPID secrets are added in Supabase, to get a valid subscription under the new key.
- v1.9.16 — 2026-08-07 — Bug fix: clock in/out edit fields (timesheet detail popup, Clock tab grid, and "Log Missed Shift" form) were displaying and saving times using raw UTC digits / the device's own timezone instead of NZ time, causing edited times to be off by hours or a whole date. Added isoToNzDatetimeLocal()/nzDatetimeLocalToIso() helpers so every editable clock field reliably shows and saves Pacific/Auckland time regardless of device timezone; fmtDatetime() read-only display also now explicitly pins to Pacific/Auckland
- v1.9.15 — 2026-08-07 — Bug fix: timesheet detail popup's "Manual Hours" field now auto-recalculates whenever Clock in or Clock out is edited, so a stale hours value can no longer be saved unchanged after adjusting the times (was producing wildly wrong totals like "104.86h")
- v1.9.14 — 2026-08-07 — Bug fix: manually adding/editing a clock-out time (via the timesheet detail popup's "Update & Save Times" as admin, or the Clock tab's grid Save button) now correctly moves the record out of "clocked_in" status into "pending" instead of staying stuck showing "Clocked in" after the shift is actually finished; added auto-refresh so returning to the app after it's backgrounded (phone locked/app switched) re-pulls fresh data for the tab you're on
- v1.9.13 — 2026-08-03 — Bug fix: weekly-repeat shift date calculation now uses UTC-safe methods (setUTCDate instead of setDate) to avoid a timezone-related date-shift bug when creating repeating shifts; also cleaned up a stray merged line in the admin state variable declarations left over from a previous edit
- v1.9.12 — 2026-07-30 — New: push notification support for help alerts. "My Profile" tab now has a Notifications card where staff can turn on phone alerts (registers a service worker + push subscription tied to their staff_id). iPhone users see an "Add to Home Screen" banner first, since Apple requires the app be installed for background push to work. Doesn't send anything yet — sending is wired up in the next step.
- v1.9.11 — 2026-07-29 — Security fix (defense-in-depth): escaped recurring availability block label, game name in today's-bookings widget, and staff name/phone/email in the admin's own staff table value attributes
- v1.9.10 — 2026-07-29 — Security fix: escaped timesheet notes (admin/staff), hours-request messages, and staff name before inserting into innerHTML in the timesheet card, staff's own hours-request list, and admin's hours-request approval queue
- v1.9.9 — 2026-07-28 — Seeded from repo (no changelog note found in code at this version)

## pos.html
- v1.6.2 — 2026-08-19 — Re-applied voucher name search (see v1.6.1 note below — the original push got overwritten by a concurrent commit before it could be pulled back down). "Use voucher" checkout panel: live search by buyer or recipient name as well as exact code — type 2+ characters, matching active vouchers appear below (code, value, who it's for/from), tap to apply. Added: a visible error message if the search request fails (previously failed silently, which is what caused the original version to appear broken).
- v1.6.1 — 2026-08-17 — Product Sale and Quick Sale grids now auto-adjust column count based on available screen width (CSS grid auto-fill/minmax) instead of a fixed 2 columns. Stays at 2 columns on narrow/touchscreen widths, grows to 3-4 on wider desktop browser windows. Product Sale grid capped at max-width:760px so column count doesn't keep growing on very wide monitors.
- v1.6.0 — 2026-08-17 — Product card redesign: Product Sale and Quick Sale grids now show a colour-block card (name + sub_name in white text on a coloured header, thick matching border) instead of flat uniform-colour buttons. Boardgame products get a stable per-item colour (hashed from the product id, so it doesn't reshuffle on reload) plus a ⓘ info icon that opens a popup showing description/player count/age (new openGameInfo/closeGameInfo functions, reads the sub_name/cost_new_range/description/players_min/players_max/age_recommendation columns added to products earlier this session). Cards show cost_new_range + notes bottom-left, sell_price bottom-right. Non-boardgame categories keep their existing single colour but now use the same card shape.
- v1.5.0 — 2026-08-16 — Gift voucher flow: replaced the prompt()-based "Activate" flow with an inline panel matching the rest of POS (amount paid, how-paid dropdown, editable customer email + personal message, matching the "Issue new voucher" card's styling). Activating a voucher, or issuing one paid on the spot, can now email the customer their code — new send_voucher_email action added to btb-admin edge function (v20, Resend). Customer email auto-prefills from the linked client record for vouchers requested online via gift_voucher_request.html; for vouchers issued directly in POS there's a new optional email field on the issue form. Added an "Unpay" action on active vouchers (clears paid_amount/how_paid and reverts to Requested).
- v1.4.1 — 2026-08-08 — Added PWA install tags (manifest/apple-touch-icon/theme-color + service worker registration) so this page is part of the installable staff app.
- v1.4.0 — 2026-08-06 — New: "Email receipt" button on the receipt display. Staff enters/confirms a customer email and sends a plain HTML receipt (game, add-ons, total, balance owing) via Resend, through the new send_pos_receipt_email action added to btb-admin (edge function v16). Manual only — no auto-send on sale completion, and no note/log saved yet.
- v1.3.5 — 2026-07-30 — Finding 13 fix: deleteProduct, toggleProdActive, toggleProdFavourite, addProductToBooking, completeProdSale and completeQuickSale stock updates no longer silently ignore failed database saves; optimistic UI changes now revert and show an alert (or a warning note appended to the sale message) if the save fails
- v1.3.4 — 2026-07-29 — Security fixes: escaped customer/voucher free-text fields before inserting into innerHTML (name, email, phone, voucher recipient/message/notes) to close stored-XSS risk; encoded voucher search term before building PostgREST filter URL
- v1.3.3 — 2026-07-28 — Fixed login screen briefly flashing on load when already logged in — now hidden synchronously as soon as a cached session is found, before the page paints

## enquiries.html
- v1.3.2 — 2026-07-28 — Seeded from repo (code comment found was for earlier v1.3.0: "new staff-entered enquiries now also log" — may not reflect v1.3.2 changes)

## reports.html
- v1.0.7 — 2026-08-08 — Added PWA install tags (manifest/apple-touch-icon/theme-color + service worker registration) so this page is part of the installable staff app.
- v1.0.6 — 2026-08-02 — Renamed sidebar back-link label from "Staff App" to "BtB App" — too easily confused with Staff Portal
- v1.0.5 — 2026-08-02 — Bug fix: sidebar "back" link pointed at staff_app.html (a file that doesn't exist); now points to btb_app.html, same as every other app's back-link
- v1.0.4 — 2026-07-29 — Security fix: escaped game name, customer name, occasion, client email/phone, and voucher buyer name before inserting into innerHTML across the outstanding-balances, bookings, no-shows, customers, and vouchers report tables
- v1.0.3 — 2026-07-28 — Single sign-on (shared localStorage session key 'btb_staff_session') + fixed login screen briefly flashing on load when already logged in

## control_room.html
- v14 — 2026-08-22 — GM dashboard mobile UI reorder: combined the -1min/+1min timer buttons into a single stacked +/− button so the Reset button no longer runs off phone screens. New top-to-bottom field order: Name+Players Booked -> Front Desk & Intake Booking Notes -> Ask For Help button -> Game Timer -> Clues Given -> Gamemaster Log & Room Reset Notes -> Group Name for Photo / Time Taken -> Review Status -> Actual Players in Room -> Save & Complete Session. Removed the "Slot: --:--" line and "Booking Source" text from the header (redundant once name/players sit at top), and removed the "📝 Session Logging Details" section header/"In-Room Entry" badge (all fields underneath kept, just no longer under that heading).
- 2026-08-09 — Wired triggerHelpAlert() (the Control Room's own separate "Ask for Help" button/function) to call the new send_help_push action. This was missed in the earlier PWA/push rollout — only btb_app.html's triggerHelp() was wired up, so raising a help alert from Control Room specifically logged the alert but never sent a push notification.
- 2026-08-08 — Added PWA install tags (manifest/apple-touch-icon/theme-color + service worker registration) so this page is part of the installable staff app. (This file has no internal BUILD_VERSION counter like the others — noting the change here without a version number.)
- v13 — 2026-08-02 — Fixed silent failure if live game settings can't load: previously fell back to a stale 3-game hardcoded list with no indication anything was wrong. Now shows a clear "having trouble loading" screen with a refresh button instead, matching gift_voucher_request.html / booking widget pattern
- v12 — 2026-07-29 — Code quality: replaced two hardcoded "300 seconds" timer warning thresholds with a single named constant (TIMER_WARNING_THRESHOLD_SEC, kept in sync with btb_app.html's copy); no behaviour change
- v11 — 2026-07-29 — Security fix: escaped game name and customer name before inserting into innerHTML in the All Timers panel and booking picker list, closing a stored-XSS risk
- v10 — 2026-07-28 — Single sign-on (shared localStorage session key 'btb_staff_session') + fixed login screen briefly flashing on load when already logged in

## booking_widget.html
- v1.7.22 — 2026-08-08 — Added PWA install tags (manifest/apple-touch-icon/theme-color + service worker registration) so this page is part of the installable staff app (used for staff admin preview — customers still reach it normally via the website, this doesn't change that).
- v1.7.21 — 2026-08-06 — Game card & VR Casual tooltips now open upward from the "i" icon (with a matching pointer arrow), same direction as the Step 1 category circle tooltips, instead of opening downward.
- v1.7.20 — 2026-08-06 — Board Game Cafe "How it works" panel is now a freely-orderable list of title/body lines (bookingText.cafeInfo.items) instead of 3 fixed fields — titles are editable and lines can be added/removed/reordered from the Page Text panel. Pricing line stays live-calculated but can be renamed/reordered.
- v1.7.19 — 2026-08-06 — Fixed VR Casual card tooltip not opening on tap — CSS only revealed a card-tooltip that was a direct child of the open card, but the VR casual icon/tooltip sits one level deeper in a wrapper div. Switched to a descendant selector.
- v1.7.18 — 2026-08-06 — Made page copy editable via settings (key: btb_booking_text) instead of hardcoded — the 4 category circle titles/tooltips, the cafe "How it works" panel text, and the VR casual card title/sub. Also added an optional "i" tooltip icon to game cards (Escape/VR/Cafe), driven by a new per-game `tooltip` field, and to the VR casual card. All fall back to today's wording if settings/field is blank, so nothing changes until edited.
- v1.7.17 — 2026-08-06 — Board Game Cafe "How it works" pricing line was a hardcoded "$2 per person per hour" that never updated when the rate was raised to $4 in settings. Now pulls the rate and minimum players live from bookingConfig, same as the price tag above it, so it can't go stale again.
- v1.7.16 — 2026-08-06 — Fixed reflected-XSS in the two enquiry thank-you popups (name/contact and first/phone/email now escaped via escapeHtml()). Also restored the submitContactEnquiry thank-you message text, which had gone missing.
- v1.7.15 — 2026-08-05 — Fixed confirm-booking arrow (was rendering as a broken curved blob pushed to the right). Now a simple straight down-pointing arrow stacked above the label, positioned under the ticket-main column so it starts under the ticket and points down onto the page.
- v1.7.14 — 2026-08-05 — Added a red curved arrow + "Confirm booking below" label under the ticket on the review screen, pointing down toward the Confirm Booking button. Shown/hidden alongside the Replay animation button.
- v1.7.13 — 2026-08-05 — Removed Game/Date/Time/Players rows from the review card underneath the ticket, since the ticket above already shows all four. Review card now starts with Name/Email/Phone.
- v1.7.12 — 2026-08-05 — Fixed "Have you played with us before?" showing "First time" as already selected when it first becomes visible (was silently auto-answered while hidden, stale answer stuck around once shown). Added a "Replay animation" button on the ticket, visible only on the review screen. Ticket highlight animation nudged slightly slower per feedback (~6.8s total, up from v1.7.11's ~5s).
- v1.7.11 — 2026-08-05 — Replaced realistic-looking placeholder names ("Sarah Robinson" / "sarah@example.com") with neutral placeholders across booking, contact, and enquiry forms. Fixed scroll race that could leave the review-screen ticket animation off-screen. Ticket highlight animation reworked: red flash instead of teal, game name now gets a matching red box (not just text pulse), sequence overlaps and runs much faster (~5s total, down from ~20s). Note: v1.7.1 entry below is stale — actual file has progressed well past that point (merged deepseek/ build, SSO, security fixes, etc.) without matching VERSIONS.md entries; recommend a full changelog reconciliation next time this file is substantially touched.
- v1.7.1 — 2026-07-28 — Seeded from repo (no changelog note found in code at this version)

## gift_voucher_request.html
- v1.1.5 — 2026-08-08 — Added PWA install tags (manifest/apple-touch-icon/theme-color + service worker registration) so this page is part of the installable staff app (used for staff admin preview — customers still reach it normally via the website, this doesn't change that).
- v1.1.4 — 2026-07-29 — Added phone number (0220 537 365) to the "having trouble loading" error screen
- v1.1.3 — 2026-07-29 — Fixed silent failure if live settings can't load: now shows a clear error screen with a refresh button instead of quietly continuing on stale hardcoded prices
- v1.1.2 — 2026-07-29 — Security/bug fixes: escaped confirmation-screen fields (self-XSS); fixed calcPrice() to respect each game's pricingType instead of always using tiered pricing — was mispricing VR Hour, Mini Escape Room, Board Game Cafe vouchers
- v1.1.1 — 2026-07-28 — Seeded from repo (no changelog note found in code at this version)

## waiver.html
- v1.0.3 — 2026-08-08 — Added PWA install tags (manifest/apple-touch-icon/theme-color + service worker registration) so this page is part of the installable staff app.
- v1.0.2 — 2026-08-02 — Fixed silent failure if live game settings can't load: previously fell back to a stale 4-game hardcoded list with no indication anything was wrong. Now shows a clear "having trouble loading" screen with a refresh button instead, matching gift_voucher_request.html / booking widget pattern
- v1.0.1 — 2026-07-29 — Security fix: escaped roster names and role before inserting into innerHTML on the review screen, closing a same-session reflected-XSS risk on shared front-desk devices
- v1.0.0 — 2026-07-28 — Seeded from repo (no changelog note found in code at this version)

## client_profile.html
- v1.0.3 — 2026-08-08 — Added PWA install tags (manifest/apple-touch-icon/theme-color + service worker registration) so this page is part of the installable staff app.
- v1.0.2 — 2026-08-02 — Single sign-on: switched from its own separate sessionStorage session ('btb_profile_user') to the shared localStorage session ('btb_staff_session') used by every other staff app
- v1.0.1 — (undated, pre-existing) — Updated links to point to the renamed clients.html (was client_overview.html)
- v1.0.0 — (undated, pre-existing) — Initial build

## clients.html
- v1.5.4 — 2026-08-10 — Status filter changed from pill/chip buttons to a dropdown select (matches the Source filter style). Removed now-unused .filter-chip CSS.
- v1.5.2 — 2026-08-08 — Added PWA install tags (manifest/apple-touch-icon/theme-color + service worker registration) so this page is part of the installable staff app. (Note: code's internal BUILD_VERSION had already reached v1.5.1 before this — ahead of what was last logged here; gap not reconciled.)
- v1.4.3 — 2026-08-02 — Removed the Enquiries nav link and the enquiry-badge's link out to enquiries.html (being retired, functionality already folded in here) — badge now just shows status, click opens the client panel like the rest of the row
- v1.4.2 — (undated, pre-existing) — Single sign-on (shared localStorage session key 'btb_staff_session') + fixed login screen briefly flashing on load when already logged in
- (earlier history not logged here before today — VERSIONS.md didn't have a section for this file until now)

## clients_mobile.html
- v1.3.1 — 2026-08-08 — Added PWA install tags (manifest/apple-touch-icon/theme-color + service worker registration) so this page is part of the installable staff app. (Note: code's internal BUILD_VERSION had already reached v1.3.0 before this — ahead of what was last logged here; gap not reconciled.)
- v1.2.5 — 2026-08-02 — Removed the Enquiries nav link (enquiries.html being retired, functionality already folded into clients.html)
- v1.2.4 — 2026-07-28 — Single sign-on (shared localStorage session key 'btb_staff_session', also fixes a token-refresh bug where refreshAuthToken() was saving to the wrong key 'btb_user' instead of 'btb_inbox_user') + fixed login screen briefly flashing on load when already logged in

## task_hub.html
- v1.7.1 — 2026-08-10 — Daily Tasks list now groups templated tasks under expandable category headers (Opening/Shutdown/Tech/etc, with a done-count badge), instead of one flat list. Tasks with no category fall into "Uncategorized". One-off tasks still show separately below, ungrouped.
- v1.7.0 — 2026-08-10 — Added Daily Categories admin screen (new daily_task_categories table, same add/rename/activate pattern as Checklist Types) so Opening/Shutdown/Tech-style categories can be managed in-app. Grouped/expandable display on the Daily Tasks tab itself is a follow-up step, not yet done.
- v1.6.2 — 2026-08-08 — Added PWA install tags (manifest/apple-touch-icon/theme-color + service worker registration) so this page is part of the installable staff app.
- v1.6.1 — 2026-08-05 — General Tasks: added Every 3 months, Every 6 months, and Yearly to the repeat options (alongside daily/weekly/monthly). Quarters start Jan/Apr/Jul/Oct, half-years start Jan/Jul, years start Jan 1 — same auto-refresh mechanism as the other repeat options.
- v1.6.0 — 2026-08-05 — General Tasks tab is live: a new sidebar item (visible to everyone) showing tasks assigned to a specific person, a role, or open to anyone. Each task has a title, optional instructions, urgency (Low/Medium/High/Urgent), tags, and either a one-off due date or a repeat schedule (daily/weekly/monthly — auto-generates a fresh occurrence each period like Daily Tasks does). Staff only see tasks relevant to them (their own, their role, or unassigned); admins/managers with template-edit permission see everything and get a "New task" button plus an edit/deactivate option on each task. Marking a task done prompts for an optional completion note, visible afterwards next to "Done by [name]".
- v1.5.0 — 2026-08-05 — First piece of General Tasks (role/person-assigned tasks, separate from Daily Tasks and Room Checklists). Added general_task_tags, general_task_templates, general_task_instances tables. New "Task Tags" sidebar item lets you add/rename/deactivate tags (same pattern as Checklist Types). The actual General Tasks task list/tab is not built yet — this is just the tags and the underlying tables.
- v1.4.1 — 2026-08-05 — Daily Task History now displays as a compact table (Task / Status / Done by / Time) instead of stacked cards, so it takes up much less room on screen.
- v1.4.0 — 2026-08-05 — Daily Task History: admins/managers now have a "History" link on the Daily Tasks screen that opens a date picker and shows every daily task (recurring + one-off) recorded on any past day, including who completed it and when, or "Not done" if it wasn't.
- v1.3.0 — 2026-08-05 — Daily Tasks screen now has a quick "Add a one-off task for today" box, separate from the recurring Task Templates system. These one-off tasks only exist for today (daily_task_instances.template_id is NULL, with a plain text label instead), show "Added by [staff] · one-off" in their meta line, and can be checked off or deleted like any other daily task — they never repeat or carry over to future days on their own.
- v1.2.0 — 2026-08-05 — Conditional fields: a checklist field can now be set to "only show if" another checkbox/multiple-choice field on the same checklist has a specific answer. Added depends_on_field_id/depends_on_value columns to task_template_fields; template editor has a picker to set this per field; staff fill-out form now shows/hides these fields live as answers change, and hidden fields are skipped entirely on submit (not saved, not required, not flagged for review).
- v1.1.0 — 2026-08-04 — Checklist types (Reset/Setup/Shutdown) are no longer hardcoded. Added task_checklist_types table + new "Checklist Types" sidebar item (visible to anyone with can_edit_task_templates) to add/rename/deactivate types. Both the staff-facing "Checklist type" dropdown and the admin template editor dropdown now read from this table live instead of a fixed 3-option list.
- v1.0.0 — (undated, pre-existing) — Initial build


