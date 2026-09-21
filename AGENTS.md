# AGENTS.md

## Project context

- This is an empty repository prepared for a hackathon taking place tomorrow.
- Optimize for a reliable, demonstrable prototype that can be built and iterated on quickly.
- Keep the scope focused on the core user journey and defer non-essential features.

## Working guidelines

- Prefer simple, efficient solutions over premature abstraction or infrastructure.
- Keep code modular, readable, and reasonably organized as the project grows.
- Avoid new dependencies unless they clearly save time or reduce risk.
- Make small, reversible changes and preserve existing work.
- Validate the main demo flow after meaningful changes; prioritize graceful failure and useful error messages.
- Keep setup and run commands current in the README so another teammate can start quickly.
- Never commit secrets, credentials, personal data, or production endpoints; provide an `.env.example` when configuration is needed.
- Use mock or sample data when an external integration would threaten demo reliability.
- Favor a polished end-to-end happy path over broad but incomplete functionality.
