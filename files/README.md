# 🔔 Notification Prioritization Engine
### Cyepro AI Team Hiring — Round 1 Submission

---

## 📋 Problem Statement
Design a system that classifies each incoming notification event into:
- ✅ **NOW** — Send immediately
- ⏰ **LATER** — Defer/schedule for optimal window
- 🚫 **NEVER** — Suppress entirely

---

## 🗂️ Project Structure

```
cyepro-notification-engine/
├── src/
│   ├── api/
│   │   ├── routes.js              # Express route definitions
│   │   └── middleware.js          # Auth, validation, error handling
│   ├── engine/
│   │   ├── classifier.js          # Core Now/Later/Never logic
│   │   ├── scorer.js              # Composite scoring engine
│   │   ├── deduplicator.js        # Exact + near-duplicate detection
│   │   ├── fatigueGuard.js        # Rate limiting & fatigue detection
│   │   └── conflictResolver.js    # Priority conflict resolution
│   ├── models/
│   │   ├── event.js               # Notification event schema
│   │   ├── decision.js            # Audit log schema
│   │   └── rule.js                # Configurable rule schema
│   ├── services/
│   │   ├── redisService.js        # Redis dedup + counters
│   │   ├── aiService.js           # AI context scoring (non-blocking)
│   │   ├── schedulerService.js    # Deferred notification scheduler
│   │   └── auditService.js        # Audit log writer
│   └── utils/
│       ├── fingerprint.js         # SHA-256 + SimHash utilities
│       └── logger.js              # Structured logging
├── config/
│   ├── default.js                 # Default configuration
│   └── rules.json                 # Human-configurable rules (hot-reload)
├── tests/
│   ├── classifier.test.js         # Unit tests for classifier
│   ├── deduplicator.test.js       # Dedup unit tests
│   └── api.test.js                # API integration tests
├── docs/
│   └── architecture.md            # Detailed architecture notes
├── public/
│   └── index.html                 # Interactive solution demo
├── server.js                      # Entry point
├── package.json
├── .env.example
└── README.md
```

---

## 🚀 Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/cyepro-notification-engine.git
cd cyepro-notification-engine

# 2. Install dependencies
npm install

# 3. Set environment variables
cp .env.example .env

# 4. Start Redis (required for dedup + fatigue counters)
docker run -d -p 6379:6379 redis:alpine

# 5. Start the server
npm start

# 6. Open the interactive demo
open public/index.html
```

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/notifications/evaluate` | Core decision endpoint |
| GET  | `/v1/notifications/history/:user_id` | Fatigue context lookup |
| POST | `/v1/rules` | Create/update configurable rule |
| POST | `/v1/notifications/override` | Force-send suppressed event |
| GET  | `/v1/audit/:audit_id` | Retrieve decision audit trail |

### Example Request
```bash
curl -X POST http://localhost:3000/v1/notifications/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_8821",
    "event_type": "security_alert",
    "message": "New login from Mumbai",
    "source": "auth-service",
    "priority_hint": "CRITICAL",
    "timestamp": "2025-02-25T14:00:00Z",
    "channel": "push",
    "dedupe_key": "auth_login_8821_1708",
    "expires_at": "2025-02-25T14:30:00Z"
  }'
```

### Example Response
```json
{
  "decision": "NOW",
  "score": 97,
  "reason": "CRITICAL override. Dedup: PASS. Fatigue: OK (2/5 this hr).",
  "schedule_at": null,
  "audit_id": "aud_a1b2c3d4"
}
```

---

## 🏗️ Architecture Overview

```
[Event Source] → [API Gateway / Kafka]
                        ↓
          ┌─────────────────────────────┐
          │       Pipeline Stages        │
          │  1. Expiry Guard             │
          │  2. Dedup Guard (SHA + Sim)  │
          │  3. Rules Engine (hot-load)  │
          │  4. DND / Quiet Hours        │
          │  5. Composite Scorer         │
          │  6. Fatigue Guard (Redis)    │
          │  7. AI Scorer (async)        │
          │  8. Conflict Resolver        │
          │  9. Decision Boundary        │
          └─────────────────────────────┘
                        ↓
           ┌─────────────────────────┐
           │  NOW  │  LATER  │ NEVER │
           └─────────────────────────┘
                        ↓
              [Audit Log + Metrics]
```

---

## 🧠 Decision Logic

```
Score = priorityScore(0–40)
      + eventTypeScore(0–30)
      + channelScore(0–10)
      + freshnessScore(0–10)
      - fatiguePenalty(0–30)
      + aiContextScore(–10 to +15)

Score ≥ 60  → NOW
Score ≥ 30  → LATER
Score < 30  → NEVER
```

**Hard overrides (bypass scoring):**
- `priority_hint = CRITICAL` → always **NOW**
- Duplicate detected → always **NEVER**
- `expires_at` in the past → always **NEVER**
- User opted out → always **NEVER**

---

## 🛡️ Duplicate Prevention

| Type | Method | TTL |
|------|--------|-----|
| Exact | SHA-256 of `user_id + event_type + message + source` | 10 min (transactional), 24h (promo) |
| Near-duplicate | SimHash + Hamming distance < 5 | 10 min sliding window |

---

## 😴 Alert Fatigue Strategy

- Max **5 notifications/hour** per user
- Max **2 per source/hour**
- Max **1 promotion per 4 hours** per channel
- **DND hours** — non-critical events deferred to next window
- **Digest batching** — low-priority items bundled into single delivery

---

## 🔧 Human-Configurable Rules

Edit `config/rules.json` — rules hot-reload every 30s, no redeploy needed:

```json
{
  "rule_id": "promo-cap-email",
  "condition": { "event_type": "promotion", "channel": "email" },
  "action": "DEFER",
  "max_per": { "count": 1, "window": "4h" },
  "priority": 10,
  "enabled": true
}
```

---

## 🔁 Fallback Strategy

| Failure | Behavior |
|---------|----------|
| AI service timeout (>200ms) | Skip AI score silently, proceed rules-only |
| Redis down | CRITICAL → NOW (fail-open), others → Kafka DLQ |
| DB / Rules unavailable | Use in-memory cached rule snapshot |
| Pipeline crash on CRITICAL | Failsafe catch → send NOW regardless |

---

## 📊 Key Metrics

- Decision latency P95 < 50ms
- Dedup hit rate per event type
- AI enrichment availability > 95%
- CRITICAL loss rate = **0** (alert on any non-zero)
- Per-user fatigue index trend

---

## 🛠️ Tools Used

Solution designed with **Claude (Anthropic)** for architecture ideation and interactive component generation.  
All decision logic, scoring model, schemas, API contracts, and tradeoffs were manually crafted by the candidate.

---

## 📬 Submission

Submitted to: varun@cyepro.com, hr-admin@cyepro.com
