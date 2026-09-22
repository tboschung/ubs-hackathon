# UBS hackathon demo

```bash
cd demo
npm start
```

Runs on `http://localhost:4000`. No dependencies to install.

## Endpoints for the dashboard

No auth, CORS open.

| Method | Path | What it does |
|---|---|---|
| `GET` | `/api/tickets` | All tickets, JSON array in the §6 ticket contract |
| `POST` | `/api/tickets/{id}/approve` | Releases the AI to repair the fault |

```bash
curl localhost:4000/api/tickets
curl -X POST localhost:4000/api/tickets/INC-2026-4819/approve
```

Tickets arrive as `awaiting_approval` and **nothing happens until you approve**.
Repair takes ~20 s, so approve returns `202` immediately — poll the feed and
watch `status` go `in_progress` → `resolved`.

`TCK-4001` is a seed ticket that is always present, so the endpoint works before
anyone has used the demo.
