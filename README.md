# MÀLEE Pilates website

The dedicated website repository for MÀLEE Pilates.

## Contents

- `site/` — the production static website and its images
- `wrangler.jsonc` — Cloudflare Workers static-assets deployment configuration
- `site/_worker.js` — the public/preview routing and preview password gate

## Local preview

Open `site/index.html` in a browser, or run a local static server from the repository root.

## Deployment

After the Cloudflare project and custom domain are confirmed, deploy the current website with:

```bash
npx wrangler deploy
```

The custom domain should be attached in the Cloudflare project after the first deployment. DNS is already managed in Cloudflare.

### Private preview

The public root path serves the Coming Soon page. The complete site is available at `/preview/` after entering the `PREVIEW_PASSWORD` Cloudflare Worker secret. Set this secret with Wrangler before deploying; never add it to this repository.

## Source history

This repository was seeded from the latest MÀLEE launch-site variant previously developed in the Genius Crew proposals project. That project remains the reusable template source; future MÀLEE production work belongs here.
