import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';

/**
 * Marketing / demo capture config.
 *
 * Runs scripted "happy-path" tours of the app and records video + per-step
 * screenshots for use in docs, landing pages, or product tours.
 *
 * Run with:
 *   npx playwright test --config=playwright.marketing.config.ts
 *
 * Output:
 *   docs/flows/<flow-name>/*.png   (per-step screenshots)
 *   docs/flows/<flow-name>/*.webm  (full-flow video)
 */

const testWebUrl =
  process.env.TEST_WEB_URL ||
  process.env.PLAYWRIGHT_BASE_URL ||
  'http://localhost:8080';

const customChromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const chromiumLaunchOptions =
  customChromiumPath && fs.existsSync(customChromiumPath)
    ? { executablePath: customChromiumPath }
    : undefined;

export default defineConfig({
  testDir: './tests/marketing',
  globalSetup: './tests/marketing/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [['list']],
  outputDir: 'docs/flows/_raw',
  use: {
    baseURL: testWebUrl,
    viewport: { width: 1920, height: 1080 },
    video: {
      mode: 'on',
      size: { width: 1920, height: 1080 },
    },
    screenshot: 'on',
    trace: 'off',
    actionTimeout: 15_000,
    // Slow down so cursor/UI changes are readable in the recording.
    launchOptions: { slowMo: 500, ...chromiumLaunchOptions },
  },
  projects: [
    {
      name: 'marketing-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:8080',
    reuseExistingServer: true,
    timeout: 120 * 1000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
