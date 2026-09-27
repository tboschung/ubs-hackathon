# UBS Ticket Intelligence

Hackathon prototype that turns error emails into structured tickets, clusters recurring issues, and raises visual alerts on an operational ontology.

## Live demo

<https://ubs-ticket-intelligence.tboschung.chatgpt.site>

Press **Play** to replay 100 sample tickets. When 20 related incidents occur within 30 minutes, the affected ontology nodes turn red and an alert explains the issue, a likely root cause, and a suggested fix.

The main demo incident is an iOS login spike after release 6.4.0. All affected tickets contain error A17 while Android and web remain healthy, suggesting the iOS build was accidentally shipped with the test authentication endpoint. The report recommends pausing the rollout, publishing a corrected 6.4.1 hotfix, and validating it with a canary group.

## Run the demo

```bash
cd app
python3 app.py
```

Open <http://127.0.0.1:8000/ontology/> and press **Play**. No installation or API key is required.

Optional: set `GEMINI_API_KEY` before starting the app to use Gemini for the email intake page at <http://127.0.0.1:8000/>. Without it, the app uses its deterministic offline tagger.

Run the tests:

```bash
cd app
python3 -m unittest discover -s tests
```

Rebuild the static ChatGPT Sites bundle after frontend changes:

```bash
python3 scripts/build_site.py
```

## Repository

- `app/` — runnable ticket intelligence demo
- `data/` — sample emails and generated tickets
- `scripts/` — mock-data and static-site build scripts
- `dist/` — generated static bundle for ChatGPT Sites
- `docs/` — scenario, ontology notes, diagram, and demo recording
- `experiments/` — separate hackathon experiments not used by the main demo
