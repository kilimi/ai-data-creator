import { chromium, FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

/**
 * Marketing global setup:
 *  1. (Optionally) clear a TEST DB so flows start clean.
 *  2. Download a small "drone" sample dataset to tests/fixtures/drone-dataset/
 *     so the marketing tour can upload real-looking aerial imagery.
 *  3. Ensure docs/flows/ exists for screenshots/videos.
 */

const apiUrl = () => process.env.TEST_API_URL || 'http://localhost:9999';

// Public aerial / drone Unsplash photos (stable CDN URLs, free to use).
// Downloaded once and cached under tests/fixtures/drone-dataset/.
const DRONE_DATASET: Array<{ name: string; url: string }> = [
  { name: 'aerial-fields-01.jpg',   url: 'https://images.unsplash.com/photo-1473968512647-3e447244af8f?w=1280&q=80&fm=jpg' },
  { name: 'aerial-forest-02.jpg',   url: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1280&q=80&fm=jpg' },
  { name: 'aerial-mountain-03.jpg', url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1280&q=80&fm=jpg' },
  { name: 'aerial-coast-04.jpg',    url: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1280&q=80&fm=jpg' },
  { name: 'aerial-lake-05.jpg',     url: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1280&q=80&fm=jpg' },
  { name: 'aerial-forest-06.jpg',   url: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1280&q=80&fm=jpg' },
];

export const DRONE_DATASET_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'drone-dataset');

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // follow redirect
        download(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error(`timeout downloading ${url}`)));
  });
}

async function ensureDroneDataset() {
  fs.mkdirSync(DRONE_DATASET_DIR, { recursive: true });
  for (const item of DRONE_DATASET) {
    const dest = path.join(DRONE_DATASET_DIR, item.name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 10_000) continue;
    try {
      console.log(`⬇️  [marketing] downloading ${item.name}`);
      await download(item.url, dest);
    } catch (err) {
      console.warn(`⚠️  [marketing] could not download ${item.name}:`, (err as Error).message);
    }
  }
}

async function globalSetup(_config: FullConfig) {
  const customChromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const launchOptions =
    customChromiumPath && fs.existsSync(customChromiumPath)
      ? { executablePath: customChromiumPath }
      : undefined;
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();

  try {
    const base = apiUrl();

    // SAFETY: refuse to wipe the dev database. Require an explicit opt-in env var
    // AND a non-default API URL (test backend on a different port).
    const explicitOptIn = process.env.MARKETING_ALLOW_DB_CLEAR === '1';
    const looksLikeDevApi = base.includes('localhost:9999') || base.includes('127.0.0.1:9999');
    if (!explicitOptIn || looksLikeDevApi) {
      console.warn(
        '⛔ [marketing] Skipping DB clear. To wipe, set TEST_API_URL to a test backend ' +
          '(NOT localhost:9999) and MARKETING_ALLOW_DB_CLEAR=1. Current API:', base,
      );
    } else {
      console.log('🧹 [marketing] Clearing database at', base);
      const clearRes = await page.request.delete(`${base}/database/clear`);
      if (!clearRes.ok()) {
        console.warn('⚠️  [marketing] DB clear failed:', clearRes.status());
      } else {
        console.log('✅ [marketing] DB cleared');
      }
    }

    // Download the drone sample dataset (cached).
    await ensureDroneDataset();

    // Make sure output dir exists
    const out = path.join(process.cwd(), 'docs', 'flows');
    fs.mkdirSync(out, { recursive: true });
  } finally {
    await browser.close();
  }
}

export default globalSetup;
