# MÀLEE update status — 23 October 2026

Venue: 90305524. Website: https://maleepilates.com/.

## Latest confirmed interpretation

The 10- and 20-class memberships should support additional participants. Any friend may participate, including returning clients. Each participant consumes one credit; there is no separate first-time-friend voucher restriction. Capacity and remaining balance still apply.

Awaiting the owner's answer: retain the earlier bonus as 11/22 total shared credits, or use 10/20 with no bonus. Do not publish these products or enable purchase buttons until this is resolved and the products are fully configured.

## Completed

- November schedule audited: 136 sessions, 55 minutes, 9 spaces, THB 900, Bophut. Saturday Sunset Tone assigned to Yui with explicit owner approval.
- Intro 90162412: 3 classes, THB 1,800, 14 days; Starter 71996186: 5 classes, THB 4,000, 60 days. Both live, purchaser chooses activation date within 30 days.
- Private package 43795212: 5 sessions, THB 11,500, retained 30-day validity; purchaser-selected activation within 30 days and 24-hour credit cancellation policy.
- Superseded group products hidden from new sales; purchased memberships retained.
- Six regular class templates updated through VMS: Beginner 00892166, Jumpboard 01019048, Full Body Flow 10506027, Booty & Core 21823706, Morning Glow 28859647, Sunset Tone 45120497.
- Each has 720-minute minimum advance booking, 12-hour cancellation lock, Semi-Flexible 12-hour online-payment policy, and automatic cancellation two hours before start with minimum participants 1 (only empty sessions).
- Booked Halloween classes, existing bookings and purchased entitlements were not edited.
- Shared-participant website copy deployed: commit 7d4b816; Cloudflare Pages deployment https://74cd0981.malee-pilates.pages.dev. Domain content verified. 27 website tests passed.

## VMS duration fix

Isolated production-based branch: hotfix/malee-membership-day-duration.
Commit: 41303f3d3.
PR: https://github.com/Exsportia/exsportia-admin/pull/4892.

The global 60-unit validation cap incorrectly prevented 90/120 DAYS. The fix makes the day bound unit-aware while retaining the existing non-day limit. New regression tests plus existing validation tests passed locally (15 tests); CI lint, E2E IDs, full tests and production build all passed. PR merged normally at 2026-10-23 01:35 UTC as 940c07dae91f745a3c3acaf1086a8a3f82adbce3. Hosting deployment still needs verification. Repository protections were not bypassed.

## Remaining

- Verify production VMS hosting deployment of merged commit 940c07dae91f745a3c3acaf1086a8a3f82adbce3.
- Complete new 90-/120-day products after credit count confirmation. Enable additional-participant benefit; use purchaser-selected start within 30 days; verify limits and cancellation rules.
- Draft 92736697 is OFFLINE and incomplete (90 days/THB7000 but copied 5-credit allowance and missing fields); its edit screen stalls. Never publish as-is. A clean normal-UI duplicate may be necessary.
- Replace website 10-/20-class enquiry buttons with verified new product purchase links only after publication. Intro/Starter/private buy links already exist.
- Verify private-service policy separately; the private package benefit is already 24 hours.

## Policy limitation

VMS's available online-payment cancellation presets permit refunds before their cutoff. The configured 12-hour preset does not fully implement a no-cash-refund rule for direct-pay bookings. Package credit restoration is distinct. Do not represent all refund handling as automated; retain this as an explicit unresolved policy/system distinction.
