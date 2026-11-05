# Development rules

- This is a loopback-only, single-process personal application. Cloud deployment is a separate design.
- Never read or modify a user's real ledger for tests. Use a temporary TIME_LEDGER_HOME and a random loopback port.
- Preserve stable IDs, time intervals, manual choices and historical records. Migrations require preview, backup, revision checks and explicit conflict handling.
- Keep elapsed coverage, accumulated activity time and agent execution time separate.
- Never commit data, backups, sessions, memory, logs, personal screenshots, credentials or local environment files.
- New defaults must be generic; personal habits belong in optional configuration or user-owned data.
- Verify meaningful changes with unit tests, typecheck, production build and isolated integration tests.
- Do not claim public deployment, independent backup or user adoption from a passing local test.
