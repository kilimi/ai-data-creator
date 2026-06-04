# Docker layout

All container build definitions live here. Application code stays in `backend/`, `src/`, and `deploy/`.

| Path | Purpose |
|------|---------|
| `docker-compose.yml` | Full stack (includes `backend/docker-compose.yml` + `web`) |
| `docker-compose.code-mount.yml` | Optional host `backend/` bind-mount fragment |
| `backend/` | Backend/worker Dockerfiles, Compose fragment, pip lockfiles |
| `frontend/Dockerfile` | SPA + nginx image (`context`: repository root) |
| `sam/` | SAM service Dockerfile + pip lockfiles (`context`: `backend/sam_service/`) |

Run Compose from the **repository root** (or use `lai up` / `make up`, which set `cwd` there):

```bash
docker compose config
docker compose build
docker compose up -d
```

Root `docker-compose.yml` and `docker-compose.code-mount.yml` are thin `include` wrappers so existing `COMPOSE_FILE` values keep working.





docker compose --profile build build ultralytics_runtime mmyolo_runtime
docker compose build worker-gpu
docker compose up -d worker-gpu