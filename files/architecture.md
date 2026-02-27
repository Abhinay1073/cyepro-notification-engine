# Architecture — Notification Prioritization Engine

## Pipeline Overview

```
[Event Ingress]
     │
     ▼
┌─────────────────────────────────────────────┐
│              9-Stage Pipeline                │
│                                              │
│  Stage 1 → Expiry Guard                     │
│             expires_at in past? → NEVER      │
│                                              │
│  Stage 2 → Dedup Guard                      │
│             SHA-256 exact match? → NEVER     │
│             SimHash near-dup?    → NEVER     │
│                                              │
│  Stage 3 → Rules Engine                     │
│             CRITICAL priority?  → NOW       │
│             SUPPRESS rule hit?  → NEVER     │
│             hot-reloaded JSON, no redeploy   │
│                                              │
│  Stage 4 → DND / Quiet Hours                │
│             In DND window?      → LATER     │
│                                              │
│  Stage 5 → Composite Scorer                 │
│             priority + type + channel        │
│             + freshness  → base score        │
│                                              │
│  Stage 6 → Fatigue Guard (Redis)            │
│             sliding window counters          │
│             → subtract penalty 0–30          │
│                                              │
│  Stage 7 → AI Scorer (async, 200ms cap)     │
│             context enrichment ±15           │
│             timeout → skip silently          │
│                                              │
│  Stage 8 → Conflict Resolver                │
│             urgent + noisy → LATER          │
│             not silently dropped             │
│                                              │
│  Stage 9 → Decision Boundary               │
│             score ≥ 60 → NOW               │
│             score ≥ 30 → LATER             │
│             score < 30 → NEVER             │
└─────────────────────────────────────────────┘
     │
     ▼
[Audit Log — always written regardless of decision]
```

---

## Scoring Formula

```
finalScore = priorityScore(0–40)
           + eventTypeScore(0–30)
           + channelScore(0–10)
           + freshnessScore(0–10)
           - fatiguePenalty(0–30)
           + aiContextScore(–10 to +15)

Clamped to [0, 100]
```

---

## Data Stores

| Store      | Purpose |
|------------|---------|
| Redis      | Dedup fingerprints (TTL), frequency counters (sliding window), SimHash near-dup sets |
| PostgreSQL | Audit log, user history, configurable rules |
| Kafka      | High-volume event ingress, deferred delivery queue, dead-letter queue |

---

## Failure Modes & Fallbacks

| Failure | Safe Behavior |
|---------|---------------|
| Redis down | CRITICAL → NOW (fail-open). Others → Kafka DLQ. Dedup/fatigue skipped. |
| AI service timeout (>200ms) | AI score skipped silently. `stages.ai = SKIPPED` in audit. |
| DB / rules unavailable | Last-known rule snapshot served from in-memory cache (refreshed every 30s). |
| Pipeline exception on CRITICAL | Failsafe catch → send NOW regardless. |

---

## Scalability Design

- Engine is **stateless** — scales horizontally behind a load balancer
- All shared state in **Redis** (counters, fingerprints)
- **Kafka** decouples ingest from processing at high volume
- AI scoring is **fully async** — never on the critical latency path
- Target: **P95 < 50ms** (rule-only path < 10ms)

---

## Key Metrics to Monitor

| Metric | Target | Alert When |
|--------|--------|------------|
| Decision latency P95 | < 50ms | > 100ms |
| Throughput | > baseline | < 80% baseline |
| CRITICAL loss rate | 0 | Any non-zero |
| Dedup hit rate | Stable | Sudden drop |
| AI availability | > 95% | < 90% |
| Error rate | < 0.1% | > 0.1% |
