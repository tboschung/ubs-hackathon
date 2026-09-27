# UBS Ticket Intelligence

Hackathon prototype that turns error emails into structured tickets, clusters recurring issues, and raises visual alerts on an operational ontology.

## Run the demo

```bash
cd app
python3 app.py
```

Open <http://127.0.0.1:8000/ontology/> and press **Play**. No installation or API key is required.

Optional: set `GEMINI_API_KEY` before starting the app to use Gemini for the email intake page at <http://127.0.0.1:8000/>. Without it, the app uses its deterministic offline tagger.

## Repository

- `app/` — runnable ticket intelligence demo
- `data/` — sample emails and generated tickets
- `scripts/` — mock-data generator
- `docs/` — scenario, ontology notes, diagram, and demo recording
- `experiments/` — separate hackathon experiments not used by the main demo
