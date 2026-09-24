# App

Dependency-free Python demo for email-to-ticket extraction, clustering, and alerts.

```bash
python3 app.py
```

Open <http://127.0.0.1:8000/ontology/> and press **Play**. The demo works offline; set `GEMINI_API_KEY` to enable model-based extraction on the email intake page at <http://127.0.0.1:8000/>.

Run tests with `python3 -m unittest discover -s tests`.
