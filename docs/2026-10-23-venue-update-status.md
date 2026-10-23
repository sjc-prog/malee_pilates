# MÀLEE update status — 23 October 2026

Venue 90305524 · https://maleepilates.com/

## Source documents reviewed

All pages of these client PDFs were reviewed together:
- Malee_Pilates_Soft_Opening_Guide.pdf
- Malee_Pilates_Studio_Timetable.pdf
- Malee_Pilates_Terms_and_Policy_2_Pages.pdf
- Studio_Instructor_Compensation_Policy.pdf
- Malee_Pilates_Private_Rates 2.pdf (identical to the unnumbered private-rates PDF)

Sources are in /Users/jcohen/Downloads. Instructor compensation is internal and has not been published on the website.

## Completed in production VMS

- November timetable previously audited: 136 sessions, 55 minutes, 9 spaces, THB900, Bophut. Yui Saturday Sunset Tone availability changed with explicit owner approval.
- Six regular class templates: 12-hour advance booking and cancellation, automatic cancellation of empty sessions two hours before start.
- Introduction 90162412: 3 passes / THB1800 / 14 days.
- Starter 71996186: 5 passes / THB4000 / 60 days.
- Popular 92736697: 10 total shared passes / THB7000 / 90 days.
- Ultimate 52164718: 20 total shared passes / THB13000 / 120 days.
- Private 43795212 corrected to 5 sessions / THB13500 / 60 days, with 24-hour benefit cancellation and customer-selected activation date.
- Single Private Bophut 44903938 and Nathon 82165675 corrected to THB2990 for 60 minutes. Descriptions and policy text updated.
- Old private trials and obsolete flat-price Private Group service off sale. Records retained.
- Five retired packages removed after each was verified to have no holders and explicit deletion confirmation: 57206557, 40791514, 65284488, 37439167, 47008022.
- Old intro 09441668 retained off sale because it has an existing holder.
- Membership cover images updated to the website studio photo for group packages and Yui photo for private package.
- Existing bookings and purchased entitlements were not edited. No test purchase or booking was made.

## Website changes prepared

Four aligned group package cards with matching photos and pastel colours. Two private cards replace the old three: single THB2990 and five THB13500/60 days. Removed the obsolete private trial. Added equipment, extra-person THB1000 and booking/studio policy information. Buttons link directly to the corresponding WBA products.

27 existing automated tests pass. Desktop preview checked visually. Deployment recorded in the task response.

## Explicit limitations and unresolved checks

- Customer-selected activation is configured; automatic activation on first attendance is not equivalent. The new editor does not expose the maximum advance-start limit, so enforcement of the PDF's one-month rule is not verified.
- User explicitly chose 10/20 total passes shared with any participants. This overrides the PDF's separate restricted bonus Friend Pass wording; no extra 1/2 passes are promised.
- Private services remain pay-on-arrival with one participant in checkout. The THB1000 extra-person supplement is not automated; website directs customers to arrange this with the studio.
- Private service cancellation setting shows No Limit although policy text says 24 hours. Payment-gated cancellation controls and the no-cash-refund requirement need reconciliation. Do not claim this policy is fully enforced automatically.
- Existing group online-payment cancellation presets can allow cash refunds before cutoff. This differs from the client's no-cash-refund policy; package-pass restoration is separate.
- Full signed-in mobile checkout, selected start date enforcement and participant redemption remain unverified. Public WBA pages and account-entry buttons were checked, but no customer login was available. A 312px WBA viewport overflowed its 375px minimum layout; standard-width mobile recheck remains.
- Instructor compensation PDF reviewed, but payroll rules not configured.
- Chrome connection timed out during the final review; earlier saved VMS screenshots document the changes.

## VMS duration bug

PR https://github.com/Exsportia/exsportia-admin/pull/4892 merged as 940c07dae91f745a3c3acaf1086a8a3f82adbce3. Production editor successfully saved the 90- and 120-day products. Repository protections were not bypassed.
