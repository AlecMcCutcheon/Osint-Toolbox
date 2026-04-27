# Linux Setup Guide

This guide is a Linux-focused companion to `README.md` for running `usphonebook-flare-app` on a Linux workstation or VM.

## What this guide covers

- Installing Node.js and project dependencies
- Running FlareSolverr on Linux
- Installing Playwright browser dependencies
- Using local Playwright on Linux
- Common Linux-specific troubleshooting

## Recommended Linux targets

The smoothest path is on:

- Ubuntu 22.04 / 24.04
- Debian 12 / 13

Other distros may work, but Playwright browser dependencies are best documented on Debian/Ubuntu-family systems.

## Prerequisites

Install these first:

- Node.js 24+
- `npm`
- Docker Engine and Docker Compose plugin
- Git

## Clone and install

```bash
git clone <your-repo-url>
cd usphonebook-flare-app
npm install
```

If you are upgrading an existing checkout from Node 20/22 to Node 24, reinstall dependencies after switching runtimes so native modules like `better-sqlite3` are rebuilt for the new Node ABI:

```bash
rm -rf node_modules
npm ci
```

## Create your local config

Copy the template and edit it:

```bash
cp env.example .env
```

Minimum `.env` values:

```bash
FLARE_BASE_URL=http://127.0.0.1:8191
APP_PORT=3040
```

Optional but useful on Linux:

```bash
PROTECTED_FETCH_ENGINE=auto
# SQLITE_PATH=/absolute/path/to/osint.sqlite
# CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
```

## Start FlareSolverr on Linux

If Docker is installed, the easiest route is:

```bash
docker compose up -d flaresolverr
```

The repo already includes `docker-compose.yml` exposing FlareSolverr on port `8191`.

Check that FlareSolverr is reachable:

```bash
npm run probe:flare
```

## Run the app without local Playwright

If you only want the FlareSolverr path:

```bash
npm start
```

Then open:

- `http://127.0.0.1:3040`

## Enable local Playwright on Linux

The app can use local Playwright for `playwright-local` or `auto` protected-fetch modes.

Install Playwright’s Chromium bundle and Linux dependencies:

```bash
npx playwright install --with-deps chromium
```

If you prefer to use a system Chrome binary instead of bundled Chromium, install one and set `CHROME_EXECUTABLE_PATH`.

Examples:

```bash
CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome
CHROME_EXECUTABLE_PATH=/usr/bin/chromium
CHROME_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

If `CHROME_EXECUTABLE_PATH` is not set, the app tries common Linux locations automatically and then falls back to Playwright’s bundled Chromium.

## Start the app

```bash
npm start
```

## Verify the installation

Run the project’s built-in checks:

```bash
node --test test/playwright-worker.test.mjs
npm run test:parse
npm run test:enrich
```

## Common Linux notes

### 1. Playwright fails to launch Chromium

Usually this means missing OS packages. Re-run:

```bash
npx playwright install --with-deps chromium
```

### 2. Port `8191` or `3040` is already in use

Either stop the conflicting service or change:

- `APP_PORT` in `.env`
- Docker/Flare port mapping if needed

### 3. `data/playwright-profile` is not writable

Make sure the Linux user running the app owns the repo or at least has write access to:

- `data/`
- `data/playwright-profile/`
- SQLite target path if `SQLITE_PATH` is set

A typical fix is:

```bash
chmod -R u+rwX data
```

### 4. SQLite should live outside the repo

Set:

```bash
SQLITE_PATH=/absolute/path/to/osint.sqlite
```

This is useful on shared Linux hosts or when you want persistent data on a mounted volume.

### 5. Chrome/Chromium is installed somewhere unusual

Set `CHROME_EXECUTABLE_PATH` explicitly in `.env`.

## Typical Linux workflow

### Flare-backed only

```bash
docker compose up -d flaresolverr
cp env.example .env
npm install
npm run probe:flare
npm start
```

### Flare + local Playwright auto mode

```bash
docker compose up -d flaresolverr
cp env.example .env
npm install
npx playwright install --with-deps chromium
npm run probe:flare
npm start
```

## File locations

Default local state lives here:

- SQLite DB: `data/osint.sqlite`
- Playwright profile: `data/playwright-profile/`
- Config: `.env`

## If you want the shortest possible setup

```bash
docker compose up -d flaresolverr
cp env.example .env
npm install
npx playwright install --with-deps chromium
npm start
```

If something misbehaves after that, `npm run probe:flare` and the verification commands above are the best first diagnostics.
