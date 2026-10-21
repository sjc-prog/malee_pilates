# MÀLEE Pilates website

The dedicated website repository for MÀLEE Pilates.

## Contents

- `site/` — the production static website and its images
- `wrangler.jsonc` — Cloudflare Workers static-assets deployment configuration
- `site/_worker.js` — the public/private routing and preview password gate

## Local preview

Open `site/index.html` in a browser, or run a local static server from the repository root.

## Deployment

After the Cloudflare project and custom domain are confirmed, deploy the current website with:

```bash
npx wrangler deploy
```

The custom domain should be attached in the Cloudflare project after the first deployment. DNS is already managed in Cloudflare.

### Public site and private areas

From 21 Oct 2026 the root (`site/index.html`) is the public landing page: Free Class Day, offers, classes, packages, teachers, first visit, find us. Every booking button deep-links into the booking portal (`https://wba.exsportia.com/90305524/...`: `class/schedule/select-session`, `class/<classId>/select-session`, `subscription/<id>`, `instructor/<id>/select-service`, `instructor-service/<serviceId>/select-instructor`). Wording tagged `.pre` / `.post` switches itself after Free Class Day (31 Oct 2026, 20:00 Koh Samui time). The old Coming Soon page is kept at `/v0/`.

The earlier versions (`/v1/` to `/v6/`), `/versions/`, the full `/preview/` site and `/client-review/` stay behind the `PREVIEW_PASSWORD` Cloudflare Worker secret. Set it with Wrangler before deploying.

## Source history

This repository was seeded from the latest MÀLEE launch-site variant previously developed in the Genius Crew proposals project. That project remains the reusable template source; future MÀLEE production work belongs here.
