# BtB App Suite — Version Log

This file is the source of truth for current build versions across all app files.
Updated automatically whenever a file's `BUILD_VERSION` is bumped and pushed.
Newest entry per file goes at the top of that file's list.

---

## btb_app.html
- v16.4.1 — 2026-07-28 — Seeded from repo (no changelog note found in code at this version)

## staff_portal.html
- v1.9.9 — 2026-07-28 — Seeded from repo (no changelog note found in code at this version)

## pos.html
- v1.3.3 — 2026-07-28 — Fixed login screen briefly flashing on load when already logged in — now hidden synchronously as soon as a cached session is found, before the page paints

## enquiries.html
- v1.3.2 — 2026-07-28 — Seeded from repo (code comment found was for earlier v1.3.0: "new staff-entered enquiries now also log" — may not reflect v1.3.2 changes)

## reports.html
- v1.0.3 — 2026-07-28 — Single sign-on (shared localStorage session key 'btb_staff_session') + fixed login screen briefly flashing on load when already logged in

## control_room.html
- v10 — 2026-07-28 — Single sign-on (shared localStorage session key 'btb_staff_session') + fixed login screen briefly flashing on load when already logged in

## booking_widget.html
- v1.7.1 — 2026-07-28 — Seeded from repo (no changelog note found in code at this version)

## gift_voucher_request.html
- v1.1.1 — 2026-07-28 — Seeded from repo (no changelog note found in code at this version)

## waiver.html
- v1.0.0 — 2026-07-28 — Seeded from repo (no changelog note found in code at this version)

## client_inbox.html
- v1.2.4 — 2026-07-28 — Single sign-on (shared localStorage session key 'btb_staff_session', also fixes a token-refresh bug where refreshAuthToken() was saving to the wrong key 'btb_user' instead of 'btb_inbox_user') + fixed login screen briefly flashing on load when already logged in
