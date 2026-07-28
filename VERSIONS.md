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

## deepseek/script.js
- v1.7.2 — 2026-07-28 — Fixed setStep() crash ("Cannot set properties of null") that was silently aborting goTo() before it ever reached the scroll code — this was the real root cause of the category-circle scroll bug all along (predates this session's other changes); added the same null-guard the second step-indicator loop already had.
- v1.7.1 — 2026-07-28 — (superseded by v1.7.2's real fix) Replaced setTimeout+scrollIntoView with double-rAF + manually computed window.scrollTo in goTo()/scrollScreenIntoView().
- v1.7.0 — 2026-07-28 — Redesigned game cards for Escape/VR/Cafe lists via new shared gameCardHtml() helper: full-height photo (or icon placeholder) on the left, name+price in the middle, players/duration stats column on the right.

## deepseek/index.html + deepseek/styles.css
- v1.7.8 — 2026-07-28 — Game cards (Choose a room / VR / Cafe lists) now lift + glow on hover, modeled on the .cat-circle hover effect but toned down (smaller lift, softer glow) — replaces the old horizontal-slide hover.
- v1.7.7 — 2026-07-28 — Layered box-shadow on .ticket-wrapper for a stronger "floating" look; removed the hover tilt-shift (rotateY/rotateX change) since it read as an unintended skew — hover now only deepens the shadow.
- v1.7.6 — 2026-07-28 — .seat-box (DATE/TIME/PLAYERS) gets right margin on mobile so it finishes before the card edge instead of extending under the vertical barcode decoration.
- v1.7.5/v1.7.4/v1.7.3 — 2026-07-28 — Cache-busting version bumps alongside script.js/styles.css changes (previously the version query string wasn't being bumped when file contents changed, so Cloudflare/browsers kept serving stale copies).
- v1.7.3 — 2026-07-28 — Removed invalid width="100%" height="auto" attributes from beyond-the-box.svg root tag (SVG doesn't support height:auto as a raw attribute) so it falls back to viewBox sizing; various mobile ticket-stub layout fixes (stub-date right-aligned, taller stub padding, vertical barcode shown on mobile, narrower ticket-wrapper with visible background stripe).

