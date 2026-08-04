# BtB App Suite — Version Log

This file is the source of truth for current build versions across all app files.
Updated automatically whenever a file's `BUILD_VERSION` is bumped and pushed.
Newest entry per file goes at the top of that file's list.

---

## Push notification foundation (manifest.json, sw.js, icon-*.png, apple-touch-icon.png)
- v1.0.0 — 2026-07-30 — New: PWA manifest + service worker + placeholder "BtB" teal icon set. Lets staff_portal.html be "Added to Home Screen" (required on iPhone for background push) and lays the groundwork for phone push notifications on help alerts. No behaviour change yet — staff_portal.html doesn't register for push until the next step.

## btb_app.css
- Tracked via the `?v=` cache-busting query string on btb_app.html's stylesheet link, not an internal BUILD_VERSION (plain CSS has nowhere to put one) — bump that query string every time this file changes
- v16.4.6 — 2026-08-03 — Added .time-group-wrapper / .time-group-label styles for the new same-time booking grouping, then thickened the connecting line (4px→8px) and enlarged the shared time label (13px→17px, bold) for better readability

## btb_app.html
- v16.4.7 — 2026-08-03 — New booking (walk-in) form now has an email field and links to a real client record (find-or-create by email/phone, same pattern as enquiries.html) instead of only capturing name/phone as free text. Also added a "Don't send confirmation email" checkbox, wired to game_bookings.skip_confirmation_email.
- v16.4.6 — 2026-08-03 — Booking list: same-time bookings now group under one shared time label with a thicker connecting line, instead of repeating the time on every card. Also added a `?v=16.4.6` cache-busting query string to the btb_app.css link (btb_app.css wasn't versioned before, so CSS edits could silently be served from browser cache even after a fresh deploy). Bump this `?v=` number whenever btb_app.css changes.
- v16.4.5 — 2026-08-02 — Docs only: added a warning comment above saveGames() flagging that the game list is dual-written to the games table and settings.btb_games, and both must be kept in sync by any future code that edits games. No behaviour change.
- v16.4.4 — 2026-07-30 — Finding 13 fix: deleteProduct, toggleProdActive, triggerHelp and dismissHelp no longer silently ignore failed database saves; optimistic UI changes revert and show an alert if the save fails
- v16.4.3 — 2026-07-29 — Code quality: replaced two hardcoded "300 seconds" timer warning thresholds with a single named constant (TIMER_WARNING_THRESHOLD_SEC); no behaviour change
- v16.4.2 — 2026-07-29 — Security fix: escaped customer/staff free-text fields (name, phone, email, occasion, special-person name/age, previous game, notes) before inserting into innerHTML, closing a stored-XSS risk in booking cards and the timer banner
- v16.4.1 — 2026-07-28 — Seeded from repo (no changelog note found in code at this version)

## staff_portal.html
- v1.9.13 — 2026-08-03 — Bug fix: weekly-repeat shift date calculation now uses UTC-safe methods (setUTCDate instead of setDate) to avoid a timezone-related date-shift bug when creating repeating shifts; also cleaned up a stray merged line in the admin state variable declarations left over from a previous edit
- v1.9.12 — 2026-07-30 — New: push notification support for help alerts. "My Profile" tab now has a Notifications card where staff can turn on phone alerts (registers a service worker + push subscription tied to their staff_id). iPhone users see an "Add to Home Screen" banner first, since Apple requires the app be installed for background push to work. Doesn't send anything yet — sending is wired up in the next step.
- v1.9.11 — 2026-07-29 — Security fix (defense-in-depth): escaped recurring availability block label, game name in today's-bookings widget, and staff name/phone/email in the admin's own staff table value attributes
- v1.9.10 — 2026-07-29 — Security fix: escaped timesheet notes (admin/staff), hours-request messages, and staff name before inserting into innerHTML in the timesheet card, staff's own hours-request list, and admin's hours-request approval queue
- v1.9.9 — 2026-07-28 — Seeded from repo (no changelog note found in code at this version)

## pos.html
- v1.3.5 — 2026-07-30 — Finding 13 fix: deleteProduct, toggleProdActive, toggleProdFavourite, addProductToBooking, completeProdSale and completeQuickSale stock updates no longer silently ignore failed database saves; optimistic UI changes now revert and show an alert (or a warning note appended to the sale message) if the save fails
- v1.3.4 — 2026-07-29 — Security fixes: escaped customer/voucher free-text fields before inserting into innerHTML (name, email, phone, voucher recipient/message/notes) to close stored-XSS risk; encoded voucher search term before building PostgREST filter URL
- v1.3.3 — 2026-07-28 — Fixed login screen briefly flashing on load when already logged in — now hidden synchronously as soon as a cached session is found, before the page paints

## enquiries.html
- v1.3.2 — 2026-07-28 — Seeded from repo (code comment found was for earlier v1.3.0: "new staff-entered enquiries now also log" — may not reflect v1.3.2 changes)

## reports.html
- v1.0.6 — 2026-08-02 — Renamed sidebar back-link label from "Staff App" to "BtB App" — too easily confused with Staff Portal
- v1.0.5 — 2026-08-02 — Bug fix: sidebar "back" link pointed at staff_app.html (a file that doesn't exist); now points to btb_app.html, same as every other app's back-link
- v1.0.4 — 2026-07-29 — Security fix: escaped game name, customer name, occasion, client email/phone, and voucher buyer name before inserting into innerHTML across the outstanding-balances, bookings, no-shows, customers, and vouchers report tables
- v1.0.3 — 2026-07-28 — Single sign-on (shared localStorage session key 'btb_staff_session') + fixed login screen briefly flashing on load when already logged in

## control_room.html
- v13 — 2026-08-02 — Fixed silent failure if live game settings can't load: previously fell back to a stale 3-game hardcoded list with no indication anything was wrong. Now shows a clear "having trouble loading" screen with a refresh button instead, matching gift_voucher_request.html / booking widget pattern
- v12 — 2026-07-29 — Code quality: replaced two hardcoded "300 seconds" timer warning thresholds with a single named constant (TIMER_WARNING_THRESHOLD_SEC, kept in sync with btb_app.html's copy); no behaviour change
- v11 — 2026-07-29 — Security fix: escaped game name and customer name before inserting into innerHTML in the All Timers panel and booking picker list, closing a stored-XSS risk
- v10 — 2026-07-28 — Single sign-on (shared localStorage session key 'btb_staff_session') + fixed login screen briefly flashing on load when already logged in

## booking_widget.html
- v1.7.1 — 2026-07-28 — Seeded from repo (no changelog note found in code at this version)

## gift_voucher_request.html
- v1.1.4 — 2026-07-29 — Added phone number (0220 537 365) to the "having trouble loading" error screen
- v1.1.3 — 2026-07-29 — Fixed silent failure if live settings can't load: now shows a clear error screen with a refresh button instead of quietly continuing on stale hardcoded prices
- v1.1.2 — 2026-07-29 — Security/bug fixes: escaped confirmation-screen fields (self-XSS); fixed calcPrice() to respect each game's pricingType instead of always using tiered pricing — was mispricing VR Hour, Mini Escape Room, Board Game Cafe vouchers
- v1.1.1 — 2026-07-28 — Seeded from repo (no changelog note found in code at this version)

## waiver.html
- v1.0.2 — 2026-08-02 — Fixed silent failure if live game settings can't load: previously fell back to a stale 4-game hardcoded list with no indication anything was wrong. Now shows a clear "having trouble loading" screen with a refresh button instead, matching gift_voucher_request.html / booking widget pattern
- v1.0.1 — 2026-07-29 — Security fix: escaped roster names and role before inserting into innerHTML on the review screen, closing a same-session reflected-XSS risk on shared front-desk devices
- v1.0.0 — 2026-07-28 — Seeded from repo (no changelog note found in code at this version)

## client_profile.html
- v1.0.2 — 2026-08-02 — Single sign-on: switched from its own separate sessionStorage session ('btb_profile_user') to the shared localStorage session ('btb_staff_session') used by every other staff app
- v1.0.1 — (undated, pre-existing) — Updated links to point to the renamed clients.html (was client_overview.html)
- v1.0.0 — (undated, pre-existing) — Initial build

## clients.html
- v1.4.3 — 2026-08-02 — Removed the Enquiries nav link and the enquiry-badge's link out to enquiries.html (being retired, functionality already folded in here) — badge now just shows status, click opens the client panel like the rest of the row
- v1.4.2 — (undated, pre-existing) — Single sign-on (shared localStorage session key 'btb_staff_session') + fixed login screen briefly flashing on load when already logged in
- (earlier history not logged here before today — VERSIONS.md didn't have a section for this file until now)

## clients_mobile.html
- v1.2.5 — 2026-08-02 — Removed the Enquiries nav link (enquiries.html being retired, functionality already folded into clients.html)
- v1.2.4 — 2026-07-28 — Single sign-on (shared localStorage session key 'btb_staff_session', also fixes a token-refresh bug where refreshAuthToken() was saving to the wrong key 'btb_user' instead of 'btb_inbox_user') + fixed login screen briefly flashing on load when already logged in

## task_hub.html
- v1.2.0 — 2026-08-05 — Conditional fields: a checklist field can now be set to "only show if" another checkbox/multiple-choice field on the same checklist has a specific answer. Added depends_on_field_id/depends_on_value columns to task_template_fields; template editor has a picker to set this per field; staff fill-out form now shows/hides these fields live as answers change, and hidden fields are skipped entirely on submit (not saved, not required, not flagged for review).
- v1.1.0 — 2026-08-04 — Checklist types (Reset/Setup/Shutdown) are no longer hardcoded. Added task_checklist_types table + new "Checklist Types" sidebar item (visible to anyone with can_edit_task_templates) to add/rename/deactivate types. Both the staff-facing "Checklist type" dropdown and the admin template editor dropdown now read from this table live instead of a fixed 3-option list.
- v1.0.0 — (undated, pre-existing) — Initial build

## deepseek/script.js
- v1.7.7 — 2026-07-28 — Removed the pause before the game name pulse (now starts right as shimmer ends); reduced the gap between DATE/TIME/PLAYERS pulses from 500ms to 350ms.
- v1.7.6 — 2026-07-28 — Pulse sequence rewritten to be fully sequential (each pulse finishes before the next starts) with a 500ms gap in between, instead of overlapping; timing pulled into named constants (SHIMMER_MS, NAME_PULSE_MS, BOX_PULSE_MS, GAP_MS) for easier future tuning.
- v1.7.5 — 2026-07-28 — Pulses now play once each (was twice) at ~3x the previous duration - name pulse 3s, seat-box pulses 4s each, staggered 1.5s apart. DATE/TIME/PLAYERS text now toggles a .filled class (small TBC placeholder vs big text once a real value is chosen).
- v1.7.4 — 2026-07-28 — playTicketHighlight() now scrolls the ticket-wrapper itself into view first (it sits above .screens, so it was off-screen while the animation played); slowed the whole sequence down - shimmer 1.6s, name pulse 1s x2, seat-box pulses 1.4s x2 each staggered 900ms apart (the "end pulses" are now noticeably slower than the name pulse).
- v1.7.3 — 2026-07-28 — Added playTicketHighlight(): shimmer sweep across the ticket + sequential highlight-pulse on the game name and DATE/TIME/PLAYERS boxes, triggered when showReviewScreen() runs.
- v1.7.2 — 2026-07-28 — Fixed setStep() crash ("Cannot set properties of null") that was silently aborting goTo() before it ever reached the scroll code — this was the real root cause of the category-circle scroll bug all along (predates this session's other changes); added the same null-guard the second step-indicator loop already had.
- v1.7.1 — 2026-07-28 — (superseded by v1.7.2's real fix) Replaced setTimeout+scrollIntoView with double-rAF + manually computed window.scrollTo in goTo()/scrollScreenIntoView().
- v1.7.0 — 2026-07-28 — Redesigned game cards for Escape/VR/Cafe lists via new shared gameCardHtml() helper: full-height photo (or icon placeholder) on the left, name+price in the middle, players/duration stats column on the right.

## deepseek/index.html + deepseek/styles.css
- v1.7.12 — 2026-07-28 — Animation durations bumped slightly to match the new sequential timing: shimmerSweep 1.6s→1.9s, pulseName 3s→3.5s, pulseBox/pulseZoom 4s→4.5s.
- v1.7.11 — 2026-07-28 — Pulse animations now single-play at ~3x duration and include a text zoom (scale up) on the game name and DATE/TIME/PLAYERS values, not just a color/glow change. Added .tbc-small.filled state so ticket values display small while TBC, big once chosen.
- v1.7.10 — 2026-07-28 — Slowed shimmer/pulse animation durations to match the JS timing changes: shimmerSweep 1s→1.6s, pulseName 0.6s→1s, pulseBox 0.6s→1.4s.
- v1.7.9 — 2026-07-28 — Review screen: ticket now plays a shimmer sweep + sequential highlight-pulse (game name, then DATE/TIME/PLAYERS) when the review step loads, twice each. Game-card hover glow changed to a graduated two-tone blue (accent + accent-light layered shadows) and lift increased to -6px.
- v1.7.8 — 2026-07-28 — Game cards (Choose a room / VR / Cafe lists) now lift + glow on hover, modeled on the .cat-circle hover effect but toned down (smaller lift, softer glow) — replaces the old horizontal-slide hover.
- v1.7.7 — 2026-07-28 — Layered box-shadow on .ticket-wrapper for a stronger "floating" look; removed the hover tilt-shift (rotateY/rotateX change) since it read as an unintended skew — hover now only deepens the shadow.
- v1.7.6 — 2026-07-28 — .seat-box (DATE/TIME/PLAYERS) gets right margin on mobile so it finishes before the card edge instead of extending under the vertical barcode decoration.
- v1.7.5/v1.7.4/v1.7.3 — 2026-07-28 — Cache-busting version bumps alongside script.js/styles.css changes (previously the version query string wasn't being bumped when file contents changed, so Cloudflare/browsers kept serving stale copies).
- v1.7.3 — 2026-07-28 — Removed invalid width="100%" height="auto" attributes from beyond-the-box.svg root tag (SVG doesn't support height:auto as a raw attribute) so it falls back to viewBox sizing; various mobile ticket-stub layout fixes (stub-date right-aligned, taller stub padding, vertical barcode shown on mobile, narrower ticket-wrapper with visible background stripe).

## deepseek
- v1.7.10 — 2026-07-29 — Security fix (script.js): escaped customer name/email/phone/occasion/special-person name/age/company/school/previous-game before inserting into innerHTML on the review and confirmation screens. Fixed silent failure on settings load: added Screen 0 (index.html) shown if the live settings fetch fails, instead of continuing on the stale hardcoded game/pricing fallback with no indication anything's wrong. index.html build tag bumped to v1.7.13, script.js cache-busting query string synced to v1.7.10.
- v1.7.9 — 2026-07-30 — Widened background stripe pattern (36px→90px bands) for a calmer look; restored missing --body-font CSS variable; synced cache-busting version numbers across index.html and script.js
