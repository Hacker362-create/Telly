# Telly – Subscription-Based VoIP Calling Platform

Telly is a subscription-based VoIP calling platform built for East African markets. It delivers ultra-low-bandwidth voice calls (~7 MB/hour vs WhatsApp's ~20 MB+) using Opus DTX/FEC compression, integrated M-Pesa billing (KES 500/month), and a Swahili/Sheng-speaking AI assistant.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Mobile App (React Native)                                   │
│  iOS (CallKit + VoIP Push)  │  Android (ConnectionService)  │
└────────────────┬────────────────────────────────────────────┘
                 │ WebSocket (Socket.io)
┌────────────────▼────────────────────────────────────────────┐
│  Backend (Node.js / TypeScript)                             │
│  Express REST API  │  Socket.io Signaling  │  Prisma ORM    │
│  M-Pesa Daraja 2.0 │  Subscription Gate    │  Redis Cache   │
└────────────────┬────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────┐
│  Mediasoup SFU  │  PostgreSQL  │  Redis  │  Telly Brain Bot │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
Telly/
├── backend/          # Node.js TypeScript backend
│   ├── src/
│   │   ├── media/    # Codec configuration (Opus DTX/FEC)
│   │   ├── signaling/# Socket.io server + subscription gatekeeper
│   │   ├── billing/  # M-Pesa Daraja 2.0 integration
│   │   └── routes/   # REST API (auth, subscription)
│   ├── prisma/       # PostgreSQL schema
│   └── tests/        # Jest unit tests
├── mobile/           # React Native app
│   ├── android/      # Android ConnectionService (native call UI)
│   ├── ios/          # iOS CallKit + VoIP push
│   └── src/          # Screens and services
├── bot/              # Python AI assistant (Deepgram + GPT-4o + Azure TTS)
└── infra/            # Kubernetes manifests + Docker Compose
```

## Quick Start

### Prerequisites
- Node.js 20+, Python 3.12+, Docker

### Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in your credentials
npm run db:migrate     # run Prisma migrations
npm run dev            # start dev server on :3000
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
docker-compose up
```

---

## Key Features

| Feature | Detail |
|---|---|
| **Ultra-low bandwidth** | Opus DTX + 16 kbps cap → ~7 MB/hour |
| **M-Pesa billing** | KES 500/month STK Push via Daraja 2.0 |
| **Subscription gate** | Redis-cached gatekeeper blocks expired users |
| **Native call UI** | iOS CallKit + Android ConnectionService |
| **AI assistant** | Swahili/Sheng via Deepgram + GPT-4o + Azure TTS |
| **Kubernetes-ready** | Mediasoup SFU on `af-south-1` (Cape Town) |

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_HOST` | Redis host |
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
