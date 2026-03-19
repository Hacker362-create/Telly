# Telly – Subscription-Based VoIP Calling Platform

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
npm run dev                 # starts on http://localhost:3000
```

> **Docker (backend + Redis + Prometheus + Grafana):**
> ```bash
> cd infra && docker compose up --build
> # Web UI    → http://localhost:3000
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
│   ├── android/      # Android ConnectionService (native call UI)
│   ├── ios/          # iOS CallKit + VoIP push
│   └── src/          # Screens and services
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
npm run dev            # http://localhost:3000  ← open this in your browser
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
# Grafana  → http://localhost:3001  (admin / telly_grafana_dev)
# Prometheus → http://localhost:9090
```

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
| `OPENAI_API_KEY` | OpenAI API key (bot) |
| `DEEPGRAM_API_KEY` | Deepgram API key (bot) |
| `AZURE_TTS_KEY` | Azure Cognitive Services TTS key (bot) |

No airtime, No Bundles, No WI-FI just Telly
