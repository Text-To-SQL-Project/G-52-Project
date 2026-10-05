# Text-to-SQL v2 Plan

Decisions already made:
- **BYOK pool:** the admin manages the API keys.
- **Google sign-in:** links to existing accounts only.
- **Back-translation check:** runs in parallel with showing the answer.

Each section lists what exists, what changes, and how it's checked. Build order is at the end.

---

## 0. Working method (token efficiency)
- **Ponytail (full)** for every coding task: reuse before adding. The frontend already has `gsap`, `motion`, `lenis`, `three` and `recharts`, so **no new animation libraries**. Run `/ponytail-review` on each section's diff.
- **One section = one session = one commit.** Start a fresh session per section. CLAUDE.md is kept short; this file is the shared context.
- **Skills used on demand:**
  - `ui-ux-pro-max`: palette, font pairing and motion presets.
  - `21st.dev` MCP: 2–3 landing components only (hero, feature grid, CTA), adapted to our tokens rather than pasted as-is.
  - `dataviz`: ERD and chart colours.
  - `simplify` / `code-review`: before each commit.
- **Playwright (installed)** is the only check for UI sections, with one spec per section. No manual screenshot loops.
- **Turn off the `21st` MCP server outside section 7.** Its 30+ tool definitions cost tokens on every turn.

---

## 1. Speed: answer in under 3 seconds — DONE
**Today:** `/query` runs the SQL-generation AI call → back-translation AI call → execute → result sanity, one after another (`app/api/routes.py` ~L326). That's two AI round-trips on the critical path, with a 60 s timeout.

**Changes**
1. **Back-translation off the critical path.** Execute and respond right away, with that signal marked `pending`. A background thread computes it and stores it in history. A new endpoint, `GET /query/{id}/signals`, returns it; the frontend polls once or twice and animates the updated confidence score.
2. **Fast model for the check:** a separate `CHECK_MODEL` setting (e.g. `claude-haiku-4-5`) for back-translation. SQL generation keeps `LLM_MODEL`.
3. **The pool routes by latency** (section 3): LiteLLM `routing_strategy="latency-based-routing"` picks the fastest healthy key/provider.
4. **Database limits:** `SET LOCAL statement_timeout = '2s'` on the read-only engine, result cap of `LIMIT 500` (applied in `guardrails.py` if missing), and a check that the SQLAlchemy connection pool is sized (`pool_size`/`pre_ping`) in `db.py`.
5. **Prompt:** Anthropic prompt caching is already on for the schema system prompt. Keep that path as is.
6. **AI timeout 60 s → 8 s on the app path** (the eval keeps its own setting), with fallback to the next pool model.
7. **Per-stage timing:** log a timing for each stage and return a `Server-Timing` header so Playwright can assert it.

**Budget:** generation ≤ 2.0 s + execution ≤ 0.3 s + overhead ≤ 0.3 s ≈ 2.6 s at p50.

**Done when:** a Playwright test runs 10 standard questions and the p90 of `Server-Timing: total` is under 3000 ms.

**Guard:** `eval/` results stay reproducible. The Anthropic default path and `LLM_PROVIDER=anthropic` behaviour are untouched; all of the above is gated to the app path.

---

## 2. Production hardening — DONE
Smallest set that matters, in this order:
1. **Rate limits:** a small in-memory token bucket on `/login`, `/auth/google` and `/query`, per IP and per user. Stdlib only. `ponytail:` note: single process; move to Redis when running several workers.
2. **Security headers** from one middleware: CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`.
3. **CORS** limited to the env `CORS_ORIGINS` (already present); refuse `*` in prod.
4. **Startup checks** (`startup_checks.py` exists): require `SECRET_KEY`, `KEY_ENCRYPTION_KEY` and `GOOGLE_CLIENT_ID` when `ENV=prod`.
5. **Server:** `uvicorn --workers N --proxy-headers` in the Dockerfile, and `/healthz` (DB ping).
6. **Frontend:** the nginx config gets gzip/brotli and immutable caching for `/assets/*`; three.js and the landing page are lazy-loaded so the workspace bundle stays small.
7. **Logs:** JSON logs with a request id; never log keys or tokens.

**Done when:** `pytest` passes, and a Playwright request test checks the headers and the 429 on the 11th login attempt within a minute.

---

## 3. BYOK AI pool (LiteLLM, admin-managed) — DONE
**Built as a separate service.** Every LiteLLM release requires `openai<3`, which conflicts with this project's pinned `openai==3.7.0`, so LiteLLM runs as its own container rather than inside the app.
- **`litellm` service** (`docker-compose.yml` + `litellm/config.yaml`), with its own `litellm-db` Postgres. It stores keys encrypted (`LITELLM_SALT_KEY`) and handles latency-based routing, 2 retries, and a 30 s cooldown for failing keys. Bound to `127.0.0.1:4000`.
- **App side:** `app/llm_pool.py` plus a `litellm` provider in `llm_client.py`, reusing the existing OpenAI-style client, so no new Python dependency was needed.
  - `APP_LLM_PROVIDER=auto`: app queries use the pool whenever it has a key.
  - eval keeps `LLM_PROVIDER`, using a per-request ContextVar.
- **Admin API** `/v1/admin/llm-pool` (list / add / delete / health): keys are never returned, and only a 4-character hint is stored.
- **Admin UI:** "AI key pool" panel.
- **Dropped from the original plan:** the enable/disable toggle (remove and re-add instead) and the `cryptography` dependency (the proxy encrypts the keys).

---

## 4. Google sign-in (links to existing accounts only) — DONE
- `seed/33_user_email.sql`: nullable `app.users.email`, unique case-insensitively. `readonly_app` can't read it.
- **Public endpoint:** `GET /auth/providers` exposes `GOOGLE_CLIENT_ID`. The client ID is configured server-side, so the frontend needs no rebuild.
- **`POST /auth/google`** (shares the login rate limit):
  - verifies the token with `google-auth` (signature, audience, expiry, issuer) and requires `email_verified`;
  - looks up an **active** user by email and issues the existing session token;
  - an unknown email gets 403, and nothing is auto-created.
- **Admin API:** `GET /v1/admin/users` and `PATCH /v1/admin/users/{id}` (link/unlink, 409 on a duplicate email).
- **UI:** Google's official button on the login screen (only shown when configured), and an Admin "Google sign-in" panel.
- **CSP:** the nginx policy allows Google Identity Services, and the referrer policy sends the origin only.
- **Setup:** create an OAuth "Web application" client ID in Google Cloud and set `GOOGLE_CLIENT_ID` (see `.env.example`).

---

## 5. Light/dark theme — DONE
- Hard-coded colours (33 distinct values, about 160 uses) were replaced with tokens by a one-shot codemod; chart series and three.js were mapped by hand. Translucent colours use `R G B` tokens: `rgb(var(--accent-rgb) / 0.12)`.
- `:root` (dark) and `:root[data-theme="light"]` (warm paper, amber-700 accent). `--text-ghost` is decorative only.
- `public/theme-init.js` sets the theme before first paint (saved choice, else the OS setting). It's CSP-safe, with no inline script.
- `useTheme` follows OS changes until the user chooses and syncs across tabs. `ThemeToggle` (NavBar and login) is a hand-drawn SVG sun/moon morph with a View Transitions circular reveal; under reduced motion it simply swaps.
- Theme-aware: the Google button (filled_black / outline), SQL syntax colours (One Dark / One Light), and Recharts (CSS vars work directly).
- **Contrast:** `e2e/theme.spec.ts` runs axe on 5 screens × 2 themes and finds **0 violations**. It caught and fixed 63, including the dark theme's own `--text-muted` (4.17:1, despite its comment claiming ≥4.5).
- **Also fixed:** a never-rendered signal glow (`var()` plus hex alpha), and the SQL typing animation now respects reduced motion.
- **Left for section 7:** the orb's indigo/cyan WebGL colours (unchanged; they read on both themes).

---

## 6. Landing page → sign in — DONE
- **Routing:** signed-out visitors see `LandingScreen` at `/`; "Sign in" goes to `/login`, using real browser history (Back works, and the URL is linkable). Signed-in users never see the landing page: any URL is normalised to `/`.
- **Sections:**
  1. Hero: word-by-word headline reveal, a drifting amber gradient mesh with scroll parallax, and the orb.
  2. Live demo console: GSAP loops question → SQL → rows → confidence, including a blocked `DROP TABLE`, and pauses when off screen.
  3. Five-step pipeline with a scroll-scrubbed progress rail.
  4. The project's published eval numbers.
  5. The three roles.
  6. Final call to action.
- **Motion:** Lenis smooth scroll and ScrollTrigger reveals (already-installed dependencies, nothing new). Everything is disabled under reduced motion, where the demo shows a static, complete example.
- **21st.dev:** its scroll-progress / timeline components were used as reference only. They're shadcn/framer-based, and the same patterns are about 20 lines with the GSAP + Lenis already installed.
- **Size:** a lazy 28 KB gzip chunk, never downloaded once you're signed in.
- **Tests:** `e2e/landing.spec.ts` covers routing, Back, deep links, signed-in skip, the reduced-motion demo, and no sideways scroll at 375 px. The `theme.spec` landing audit finds 0 contrast violations in both themes.

---

## 7. UI/UX overhaul with heavy motion
Uses the existing stack only: `motion` for components, `gsap` for timelines and scroll, `lenis`, `three`.
- **Design system:** `ui-ux-pro-max` picks a palette that keeps the amber/obsidian identity in dark mode and adds a warm light mode. Spacing, radius and elevation become tokens.
- **Motion layer:** shared presets in `src/motion.ts` (spring, stagger, page transition), plus:
  - layout animations on panels;
  - shared-element transitions from the question to the SQL panel to results;
  - magnetic buttons;
  - gradient borders that animate on focus;
  - result rows that stagger in;
  - the confidence gauge animating when the parallel check finishes (section 1).
- **Components:** the 21st.dev MCP provides about 3 landing components; everything else is restyled in place, with no component rewrites without a reason.
- **UX fixes:** loading skeletons everywhere, keyboard shortcuts (⌘/Ctrl+Enter to run, `/` to focus), empty and error states, mobile layout.
- **Guardrails on the motion itself:**
  - `prefers-reduced-motion` turns animations into simple fades;
  - only transform and opacity are animated, so no layout thrash;
  - three.js is paused when its tab is hidden;
  - Lighthouse performance ≥ 85 on the workspace.

**Done when:** Playwright visual snapshots of every screen pass in both themes, and the workspace shows no long tasks over 200 ms during a query.

---

## 8. Schema Explorer: Power BI-style relationship graph
**Today:** `/schema` already returns `is_foreign_key` + `references` for each column (`app/schema/introspect.py`), so no backend change is needed.
- Add `@xyflow/react` (React Flow) and `@dagrejs/dagre` for the automatic layout. This is the one justified new dependency: pan, zoom, drag, minimap and edge routing would be weeks of custom work.
- **Nodes:** one card per table showing the name, row count, and columns with 🔑 for primary keys and 🔗 for foreign keys.
- **Edges:** FK → PK, with `1 —— *` cardinality labels as in Power BI, and animated dashes on hover.
- **Interactions:**
  - clicking a table highlights its neighbours and dims everything else;
  - search jumps to and zooms on a table;
  - a toggle between Graph and the existing List view;
  - layouts are grouped by module (academic, exams, fees, library, placement), each with its own colour;
  - minimap, fit-view and PNG export.
- Admin only, as now (commit `2f8798b`).

**Done when:** Playwright opens the graph and checks there are 25 nodes and as many edges as the API reports foreign keys, then clicks `students` and checks its neighbours are highlighted.

---

## Build order and effort
| # | Section | Depends on | Size |
|---|---|---|---|
| 1 | Speed under 3 s | — | M |
| 2 | Hardening | — | S |
| 3 | AI pool | 1 (latency routing) | M |
| 4 | Google sign-in ✓ | 2 (rate limits) | S |
| 5 | Theme tokens + toggle ✓ | — | M (mostly mechanical) |
| 6 | Landing page ✓ | 5 | M |
| 7 | UI/motion overhaul | 5, 6 | L |
| 8 | Relationship graph | 5 | M |

Sections 1–4 are backend and 5–8 are frontend. The two tracks don't touch the same files, so they can run in parallel.

## New dependencies (only these)
- **Backend:** `google-auth` (LiteLLM runs as a container, see section 3)
- **Frontend:** `@xyflow/react`, `@dagrejs/dagre`, `@axe-core/playwright` (dev)

## Environment variables added
`CHECK_MODEL`, `APP_LLM_TIMEOUT_SECONDS`, `KEY_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID`, `ENV`

## Not doing (until needed)
- Per-user keys: the admin pool was chosen.
- Auto-creating accounts from Google sign-in: it would break row-level-security links.
- Redis-backed rate limits: add them when running more than one worker host.
- Response caching: answers depend on the user's row-level-security scope, so a cache would have to be keyed per user. Skipped until profiling shows repeated questions.
