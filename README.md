# Telly – Subscription-Based VoIP Calling Platform

> ## 🌐 Your app runs at → **[http://localhost:3000](http://localhost:3000)**
> ⚠️ You must **start the server first** (see below) — the URL won't work until the server is running.
> 
> **New here?** Open **[start-here.html](start-here.html)** in your browser — it detects whether the server is up and walks you through startup step-by-step.

![Telly login screen](docs/ui-screenshot.png)

Telly is a subscription-based VoIP calling platform built for East African markets. It delivers ultra-low-bandwidth voice calls (~7 MB/hour vs WhatsApp's ~20 MB+) using Opus DTX/FEC compression, integrated M-Pesa billing (KES 500/month), and a Swahili/Sheng-speaking AI assistant.

---

## 🚀 Run It Now — One Command

No database server needed — the backend uses SQLite out of the box.

**macOS / Linux:**
```bash
./start.sh
```

**Windows:**
```
start.bat
```

That's it. The script auto-creates `.env`, installs dependencies, sets up the database, and starts the server.

**Then open your browser → [http://localhost:3000](http://localhost:3000)**

> **Getting `ERR_CONNECTION_REFUSED`?** That means the server isn't running yet. Run `./start.sh` (Linux/macOS) or `start.bat` (Windows) first, then refresh.

You'll see the Telly web UI where you can:
- **Register** a new account
- **Log in** and see your dashboard
- **Search contacts** and initiate calls
- **View call history** with pagination
- **Create / delete Mediasoup SFU rooms**
- **Browse live Prometheus metrics**

### Manual steps (if you prefer)

```bash
cd backend
cp .env.example .env        # SQLite by default — no changes needed
npm install
npm run db:setup            # applies migrations, creates dev.db
npm start                   # starts on http://localhost:3000
```

### Troubleshooting

| Symptom | Fix |
|---|---|
| **ERR_CONNECTION_REFUSED** | The server isn't running yet — run `./start.sh` (or `start.bat` on Windows) from the repo root |
| **Port 3000 is already in use** | Stop the other process, or run `PORT=3001 npm start` inside `backend/` |
| **`npm install` fails** | Check you have internet access; on Windows make sure [Node.js LTS](https://nodejs.org) is installed |
| **Database errors on first run** | Delete `backend/dev.db` and re-run `npm run db:setup` |

> **Docker (backend + Redis + TURN + Prometheus + Grafana):**
> ```bash
> cd infra && docker compose up --build
> # Web UI    → http://localhost:3000
> # TURN      → turn:localhost:3478 (username: telly, password: dev-turn-password)
> # Grafana   → http://localhost:3001  (admin / telly_grafana_dev)
> # Prometheus → http://localhost:9090
> ```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Web UI  (http://localhost:3000)                            │
│  Register · Login · Contacts · Calls · Rooms · Metrics      │
└────────────────┬────────────────────────────────────────────┘
                 │ REST + Socket.io
┌────────────────▼────────────────────────────────────────────┐
│  Backend (Node.js / TypeScript)                             │
│  Express REST API  │  Socket.io Signaling  │  Prisma ORM    │
│  M-Pesa Daraja 2.0 │  Subscription Gate    │  Redis Cache   │
└────────────────┬────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────┐
│  Mediasoup SFU  │  SQLite / PostgreSQL  │  Redis  │  Bot    │
└─────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────┐
│  Mobile App (React Native)                                   │
│  iOS (CallKit + VoIP Push)  │  Android (ConnectionService)  │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
Telly/
├── backend/          # Node.js TypeScript backend
│   ├── public/       # ← Web UI (index.html — served at /)
│   ├── src/
│   │   ├── media/    # Codec configuration (Opus DTX/FEC)
│   │   ├── signaling/# Socket.io server + subscription gatekeeper
│   │   ├── billing/  # M-Pesa Daraja 2.0 integration
│   │   └── routes/   # REST API (auth, calls, contacts, rooms, metrics)
│   ├── prisma/       # SQLite schema + migrations
│   └── tests/        # Jest unit tests (97 passing)
├── mobile/           # React Native app
│   ├── android/      # Android ConnectionService + Fastlane
│   │   └── fastlane/ # build_debug, build_release, deploy_firebase, deploy_play
│   ├── ios/          # iOS CallKit + VoIP push + Fastlane
│   │   └── fastlane/ # build_debug, build_release, deploy_firebase, deploy_testflight, deploy_appstore
│   ├── src/          # Screens and services
│   ├── Gemfile       # Fastlane + plugins
│   └── FASTLANE.md   # Fastlane docs & secret setup
├── bot/              # Python AI assistant (Deepgram + GPT-4o + Azure TTS)
└── infra/            # Docker Compose + Kubernetes manifests
```

## Quick Start (detailed)

### Prerequisites
- Node.js 20+, Python 3.12+, Docker (optional)

### Backend (npm)

```bash
cd backend
cp .env.example .env   # SQLite is the default — works with zero config
npm install
npm run db:setup       # applies migrations non-interactively, creates dev.db
npm run dev            # http://localhost:3000  ← open this in your browser (alias: npm start)
npm test               # run Jest tests
```

### Bot

```bash
cd bot
pip install -r requirements.txt
python brain.py
```

### Docker (all services)

```bash
cd infra
docker compose up --build
# Web UI   → http://localhost:3000
# TURN     → turn:localhost:3478 (udp/tcp)
# Grafana  → http://localhost:3001  (admin / telly_grafana_dev)
# Prometheus → http://localhost:9090
```

### PostgreSQL production workflow

Keep local development on SQLite with `prisma/schema.prisma`, and use PostgreSQL
in production with `prisma/schema.postgres.prisma`.

```bash
cd backend
export DATABASE_URL='postgresql://telly:telly@localhost:5432/telly'
npm run db:generate:postgres
npm run db:migrate:postgres
npm run db:deploy:postgres
```

### Stress harness

Use the built-in API stress harness to validate backend readiness and reliability
under concurrent probing.

```bash
cd backend
BASE_URL=http://localhost:3000 TOTAL_REQUESTS=500 CONCURRENCY=40 npm run stress:api
```

### Call analytics summary API

Per-user reliability summary from durable analytics records:

```bash
curl -H "Authorization: Bearer <JWT>" \
    "http://localhost:3000/calls/analytics/summary?days=30"
```

### Admin control access

The backend supports admin-only control routes under `/admin/*`.

- Default admin email: `jerryphisael@gmail.com`
- Configure one or more admin emails via `ADMIN_EMAILS` in `.env`

After registering or logging in with an admin email, your account is elevated.

Example admin routes (JWT required):

```bash
# Platform overview
curl -H "Authorization: Bearer <JWT>" http://localhost:3000/admin/overview

# List users
curl -H "Authorization: Bearer <JWT>" "http://localhost:3000/admin/users?page=1&limit=25"

# Promote user to admin
curl -X PATCH -H "Content-Type: application/json" -H "Authorization: Bearer <JWT>" \
    -d '{"isAdmin":true}' http://localhost:3000/admin/users/<USER_ID>/role

# Activate subscription / update expiry
curl -X PATCH -H "Content-Type: application/json" -H "Authorization: Bearer <JWT>" \
    -d '{"isActive":true,"subscriptionExpiry":"2026-12-31T00:00:00.000Z"}' \
    http://localhost:3000/admin/users/<USER_ID>/subscription
```

### Mobile — Fastlane build & release

```bash
cd mobile
bundle install           # install Fastlane + plugins (once)

# Android
npm run fastlane:android:debug     # build debug APK
npm run fastlane:android:firebase  # distribute to Firebase testers
npm run fastlane:android:play      # upload AAB to Play Internal track

# iOS (macOS only)
npm run fastlane:ios:debug         # simulator build
npm run fastlane:ios:testflight    # upload IPA to TestFlight
```

See [mobile/FASTLANE.md](mobile/FASTLANE.md) for all lanes, required secrets, and CI/CD setup.

---

## Key Features

| Feature | Detail |
|---|---|
| **Web UI** | Single-page app served at `/` — register, call, manage rooms |
| **Ultra-low bandwidth** | Opus DTX + 16 kbps cap → ~7 MB/hour |
| **M-Pesa billing** | KES 500/month STK Push via Daraja 2.0 |
| **Subscription gate** | Redis-cached gatekeeper blocks expired users |
| **Native call UI** | iOS CallKit + Android ConnectionService |
| **AI assistant** | Swahili/Sheng via Deepgram + GPT-4o + Azure TTS |
| **Kubernetes-ready** | Mediasoup SFU on `af-south-1` (Cape Town) |
| **Fastlane CI/CD** | One-command Android (Play Store) + iOS (TestFlight/App Store) release |

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | SQLite file path (`file:./dev.db`) or PostgreSQL URL |
| `REDIS_HOST` | Redis host (default `localhost`) |
| `JWT_SECRET` | JWT signing secret |
| `MPESA_CONSUMER_KEY` | Safaricom Daraja consumer key |
| `MPESA_CONSUMER_SECRET` | Safaricom Daraja consumer secret |
| `MPESA_SHORT_CODE` | M-Pesa paybill/till number |
| `MPESA_PASS_KEY` | M-Pesa passkey |
| `MPESA_CALLBACK_URL` | Public URL for M-Pesa payment callbacks |
| `STUN_SERVERS` | Comma-separated STUN server list for ICE discovery |
| `TURN_URLS` | Comma-separated TURN URLs (`turn:...?...`) |
| `TURN_USERNAME` | TURN username for long-term credentials |
| `TURN_CREDENTIAL` | TURN password/credential |
| `TURN_ENFORCE_RELAY` | If `true`, client receives relay recommendation |
| `OPENAI_API_KEY` | OpenAI API key (bot) |
| `DEEPGRAM_API_KEY` | Deepgram API key (bot) |
| `AZURE_TTS_KEY` | Azure Cognitive Services TTS key (bot) |

No airtime, No Bundles, No WI-FI just Telly
