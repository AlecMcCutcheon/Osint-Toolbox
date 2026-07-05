## Learned User Preferences

- When a subsystem is broken or inconsistent, prefer a full audit and refactor over incremental patches.
- Do not edit attached plan files during implementation; execute the plan and mark todos in progress/completed.
- Confirm runtime config via startup logs and `/api/health` after env changes; a running process keeps old values until restarted.

## Learned Workspace Facts

- Environment loads from repo-root `.env` via `src/env.mjs` (not `.env.local`) unless `DOTENV_PATH` is set; exported shell variables override dotenv values.
- FlareSolverr should run via `docker compose up -d flaresolverr` with `FLARE_BASE_URL=http://127.0.0.1:8191`; stale ephemeral Docker ports (e.g. 32768) cause sub-20ms `fetch failed` / ECONNREFUSED errors.
- USPhoneBook protected fetches use the Flare engine; TruePeopleSearch uses `playwright-local` with a persistent Chrome profile at `data/playwright-profile/truepeoplesearch`.
- TruePeopleSearch session state is written through `applySourceSessionOutcome` in `src/sourceSessions.mjs`, tracking `verifiedScopes` (`homepage` vs `lookup`) in session meta.
- After the TPS session refactor, fetches proceed when session status is `ready`; successful `/results` responses prove lookup capability and challenges set `pendingVerificationUrl`.
- TPS captcha challenges redirect to `InternalCaptcha` with a `returnUrl`; verification URLs must be truepeoplesearch.com `/results` URLs, not USPhoneBook profile URLs.
- Startup banner and `/api/health` field `flareBase` reflect the effective `FLARE_BASE_URL` at runtime.
