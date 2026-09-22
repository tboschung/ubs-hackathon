# UBS hackathon demo

```bash
cd demo
npm start
```

Runs on `http://localhost:4000`. No dependencies to install.

---

# For the dashboard team

A user hits a broken e-banking login page, files a ticket at our service desk,
and an AI agent repairs the page. **The agent does not start on its own — it
waits for you to approve the ticket.**

```
user reports  →  ticket appears in your feed  →  ⏸ AI waits
                                                      ↓
              page is fixed  ←  AI repairs  ←  you approve
```

## Endpoints

Base URL `http://localhost:4000`. No auth. CORS is open (`*`), so browser calls
from your origin work.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/tickets` | Read all tickets |
| `POST` | `/api/tickets/{id}/approve` | Release the AI to repair the fault |

`GET` also works on `/approve`, so the gate can be tripped from a browser
address bar if anything goes wrong during the demo.

## GET /api/tickets

Returns a JSON **array** in your §6 ticket contract:

```json
[
  {
    "id": "INC-2026-4819",
    "occurred_at": "2026-09-22T14:02:22.196Z",
    "title": "Something went wrong on login",
    "description": "A red box says Something went wrong when I click Login.",
    "source": "service_desk",
    "source_severity": "medium",
    "status": "awaiting_approval",
    "context": {
      "region": "CH",
      "channel": "web",
      "environment": "production",
      "error_code": null,
      "release_id": "ebanking-web-2026.09"
    },
    "ontology_tags": {
      "node_ids": ["actor:user", "platform:e_banking"],
      "edge_ids": ["edge:user_login_ebanking"],
      "symptoms": ["login_failure"],
      "tagging_method": "rules",
      "confidence": 0.96
    }
  }
]
```

Two things to know:

- **`status` is our addition** to your §6 contract. It is what drives your
  approve button. Values: `awaiting_approval` → `in_progress` → `resolved`,
  or `failed`.
- **`source` is `"service_desk"`**, so you can tell our live tickets apart from
  your own fixture data.

Ticket `TCK-4001` is a hardcoded seed and is **always** present, so you can
build against this endpoint without anyone touching the demo. Real tickets are
appended as they are filed and reset when the server restarts.

## POST /api/tickets/{id}/approve

```bash
curl -X POST localhost:4000/api/tickets/INC-2026-4819/approve
```

| Response | When |
|---|---|
| `202 {"id":"…","status":"in_progress"}` | Accepted. Repair starts. |
| `404 {"error":"unknown ticket"}` | No such id |
| `409 {"error":"already approved","status":"…"}` | Already approved — the file is never patched twice |

The repair takes **~20 seconds**, so the call returns immediately and you poll
`GET /api/tickets` to watch `in_progress → resolved`.

If you would rather show a spinner than poll, add `?wait=1` and the call blocks
until the repair finishes, then returns the diagnosis:

```json
{
  "id": "INC-2026-4819",
  "status": "resolved",
  "diagnosis": "The login handler reads document.getElementById('passwrd'), but the password input's id is 'password'…"
}
```

## Ontology tagging

Our service desk asks which service is affected, and we map that onto your §4
stable IDs with plain rules (`tagging_method: "rules"`). Examples:

| Service selected | node_ids | edge_ids | symptoms |
|---|---|---|---|
| Login & Authentication — e-banking | `actor:user`, `platform:e_banking` | `edge:user_login_ebanking` | `login_failure` |
| E-banking — Payments & transfers | `actor:user`, `actor:supplier` | `edge:user_pays_supplier` | `payment_failure` |
| Client advisor CRM | `actor:employee`, `platform:crm` | `edge:employee_login_crm` | `login_failure` |
| Internal SSO / Active Directory | `actor:employee`, `platform:hr` | `edge:employee_login_hr` | `login_failure` |

All 20 dropdown options are mapped. Anything unrecognised falls back to
`node_ids: []`, `symptoms: ["unknown"]`, `confidence: 0.3` rather than guessing.

Tickets are tagged `channel: "web"` — a genuine web login failure. They form
their own cluster rather than joining the mobile iOS A17 story, but they
highlight the same subgraph: `User --LOGS_INTO--> E-Banking`.

## Trying it end to end

1. `npm start`
2. Break `public/login.html` line 226: `getElementById('password')` →
   `getElementById('passwrd')`, save.
3. Open `localhost:4000/login.html`, log in with `fcaldas` / `1234` — a red
   "Something went wrong" box appears.
4. Click **"See an error? Please report it!"**, file the ticket.
5. `curl localhost:4000/api/tickets` — the ticket is there,
   `status: "awaiting_approval"`. **Reload the login page: still broken.**
6. Approve it. Watch the server terminal diagnose and patch the file.
7. Reload the login page — fixed.

`npm run reset` restores `public/login.html` from the snapshot if a run goes
wrong.
