# VoltRide — Route-Aware Private Vehicle Sharing (Static HTML/CSS)

A static, no-build HTML/CSS port of the VoltRide carpooling frontend. Pure HTML, CSS, and vanilla JavaScript — no React, no Next.js, no TypeScript, no Tailwind, no build step. Open any `.html` file in a browser and it works.

## What this is

| Item | Original (Next.js) | This version |
|------|--------------------|--------------|
| Framework | React 18 / Next.js 14 | Plain HTML5 |
| Styling | Tailwind CSS | Custom CSS (css/styles.css) |
| Language | TypeScript | Vanilla JavaScript (js/main.js) |
| Build step | Required (`npm run dev`) | None |
| Assets | Icons/SVG in components | /assets/*.svg |

The goal was to preserve the **unique design template** (the "Indigo + Lime Night Mobility" look) while removing every framework dependency.

## Design template — "Indigo + Lime Night Mobility"

The site uses a consistent dark-first visual language defined in `css/styles.css` (~500 CSS custom properties plus component classes).

### Color tokens (root)
- `--color-bg` / `--color-surface` / `--color-panel` / `--color-glass`
- `--color-iris` (primary accent), `--color-lime` (secondary accent)
- `--color-ink` / `--color-ink-soft` / `--color-muted` (text)
- `--color-border` / `--color-border-soft`

### Signature motifs (CSS classes you can reuse)
| Class | Purpose |
|-------|---------|
| `.hud-corners` | HUD-style corner brackets around a block |
| `.route-draw` | Self-drawing animated route line |
| `.soft-pulse` | Gentle pulsing animation for live pins |
| `.aurora` | Background glow blobs |
| `.grid-drift` | Subtle moving road grid |
| `.streak` | Speed streaks / motion lines |
| `.glass` | Semi-transparent frosted panel |
| `.roadline` | Road divider kicker text |

### Reusable component classes
| Class | Description |
|-------|-------------|
| `.panel` | Card/panel wrapper with border + shadow |
| `.card` | Content card variant |
| `.btn`, `.btn--primary`, `.btn--iris`, `.btn--ghost` | Buttons |
| `.badge`, `.pill` | Status chips |
| `.route-strip` | Origin → destination strip |
| `.live-track` | Live map/tracking panel |
| `.publish-card` | Trip publish card |
| `.search-form` | Search form layout |
| `.page-main` | Page container with max-width |

### Theme
Toggle between light and dark via `data-theme` on `<html>`. Default is dark.

## Directory structure

```
frontend/
  index.html            Landing page (hero, vehicle art, live corridor, features, roles)
  search.html           Ride search form (from/to, date, time, seats)
  trips.html            Driver console (publish panel, upcoming trips, live track)
  requests.html         Booking requests
  analytics.html        Impact dashboard
  garage.html           Driver vehicle management
  me.html               Profile page
  login.html            Sign in
  register.html         Sign up
  verify.html           Email/phone verification
  css/styles.css        All design tokens, motifs, and component classes
  js/main.js            Theme toggle, mobile nav, reduced-motion support
  assets/vehicle.svg    Re-themed vehicle artwork
  tpl_header.html       Shared page header frame (for adding new pages)
  tpl_footer.html       Shared page footer frame (for adding new pages)
```

## How to run locally

**Option 1 — double-click (simplest)**
Open any `.html` file directly in Chrome, Edge, Firefox, or Safari.

**Option 2 — local server (recommended for relative links)**
From the `frontend/` folder, run:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000/index.html`.

No `npm install`, no build, no environment variables required.

## Adding a new page

Use the shared frames so the nav and footer stay consistent:

1. Copy `tpl_header.html` → `newpage.html`
2. Insert your page content between `<main>` and `</main>`
3. Add a nav link in `tpl_header.html` (and `tpl_footer.html` if desired)
4. Link `css/styles.css` and `js/main.js` exactly as the other pages do

## Browser support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile Safari & Chrome on Android

Reduced-motion is respected via `prefers-reduced-motion`.

## Notes

- All styling lives in `css/styles.css`; there is no inline CSS on the pages.
- The only JavaScript is `js/main.js` (theme toggle, mobile nav toggle). Page content is static HTML.
- SVG assets live in `assets/`.
- This is a static port; backend integration (auth, trip search, booking) would need to be wired separately.
