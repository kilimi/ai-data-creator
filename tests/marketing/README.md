# Marketing / demo flows

Scripted Playwright tours that produce **screenshots + video** of the app's
happy-path flows. Use the output for docs, landing pages, or product tours.

## Run

```bash
npx playwright test --config=playwright.marketing.config.ts
```

Requires the backend (`localhost:9999`) and frontend (`localhost:8080`) running.
The config starts the frontend automatically via `npm run dev`.

## Output

```
docs/flows/
  create-project-and-dataset/
    01-home.png
    02-create-project-form.png
    ...
  _raw/                       # playwright videos (.webm) + trace artifacts
```

## How it works

- `tests/marketing/global-setup.ts` clears the DB so every run starts clean.
- `tests/marketing/helpers.ts` provides:
  - `installCursor(page)` — injects a visible cursor ring so videos show clicks.
  - `shot(page, testInfo, label)` — numbered screenshot into `docs/flows/<flow>/`.
  - `mockTraining(page)` — intercepts `/api/training/**` so "train a model"
    flows complete instantly without actually training.
- Each spec under `tests/marketing/flows/` is one tour.

## Adding a new flow

1. Copy `01-create-project-and-dataset.spec.ts`.
2. Mock any expensive backend with `page.route(...)` in `beforeEach`.
3. Call `shot(page, testInfo, 'step-name')` between meaningful actions.

## Stitching into a video tour (optional)

```bash
# Speed up + concat all webm clips into one mp4
ffmpeg -i docs/flows/_raw/.../video.webm \
  -filter:v "setpts=0.6*PTS" -an docs/flows/tour.mp4
```
