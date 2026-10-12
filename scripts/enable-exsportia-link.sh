#!/bin/bash
# Switches ON the link between the MÀLEE sign-up and the Exsportia back office, in production.
#
# After this, everyone who claims the opening gift becomes an account and a contact in venue 90305524
# (vms.exsportia.com/venues/90305524). New people get Exsportia's "choose your password" email; people who
# already have an Exsportia account skip the code and go straight in.
#
# To switch it OFF again: delete the EXSPORTIA_API secret on the malee-pilates Pages project
# (Cloudflare dashboard > Workers & Pages > malee-pilates > Settings > Variables and secrets) and redeploy.
set -e
cd "$(dirname "$0")/.."

put() { printf '%s' "$2" | npx --yes wrangler@4.137.0 pages secret put "$1" --project-name malee-pilates; }

put EXSPORTIA_API 'https://us-central1-exsportia-prod.cloudfunctions.net/production'
put EXSPORTIA_VENUE_ID '90305524'
put EXSPORTIA_FIREBASE_KEY 'AIzaSyAYHyCUTCnbdfYugUTLILxkoglI6Jb-7qo'   # exsportia-prod web key, public in the booking app

# Secrets reach the site on the next deployment, so push an empty commit to trigger one.
git commit --allow-empty -m "Switch on the Exsportia back-office link"
git push origin coming-soon-password-preview
echo "Done. Live in about a minute."
