# LAI

Annotation and dataset stack. The **`lai`** CLI drives **Docker Compose** (Docker Engine + Compose **v2.24+** required).

## Run the stack

```bash
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -U pip && pip install -e .

lai install-gui    # browser wizard: data directory + port (or: lai install)
lai up             # docker compose up -d (no rebuild)
lai up --build     # same, but rebuild images first
```

Open **`http://localhost:<WEB_PORT>`** (default **8089**). Stop: `lai down`.

**On Debian/Ubuntu:** do not `pip install` on system Python (PEP 668). Use the venv above or **`pipx install -e .`**.

## Develop the web UI only

```bash
npm ci
npm run dev
```

Uses Vite (see `package.json`). The full app runs in Docker via `lai up`.

## Repo layout

- `src/` — React frontend
- `backend/` — API, workers, database migrations, `docker-compose` fragment
- `lai/` — Python CLI (`pip install -e .`)
- `deploy/` — production frontend image (nginx)
- `scripts/` — `install.sh`, SAM check helper

## Tests

npm run test:e2e


## License

Add your license here.
