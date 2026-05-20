import { chromium, FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Marketing global setup: clear the DB and seed a clean baseline so flows
 * always start from a known state. Each flow then builds the data it needs
 * to capture (and can also mock backend calls for things like training).
 */

const apiUrl = () => process.env.TEST_API_URL || 'http://localhost:9999';

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
    console.log('🧹 [marketing] Clearing database...');
    const clearRes = await page.request.delete(`${base}/database/clear`);
    if (!clearRes.ok()) {
      console.warn('⚠️  [marketing] DB clear failed:', clearRes.status());
    } else {
      console.log('✅ [marketing] DB cleared');
    }

    // Make sure output dir exists
    const out = path.join(process.cwd(), 'docs', 'flows');
    fs.mkdirSync(out, { recursive: true });
  } finally {
    await browser.close();
  }
}

export default globalSetup;
