import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { caption, installCaptionOverlay, installCursor, mockTraining, shot, step } from '../helpers';

/**
 * Marketing flow:
 *   Home → Create Project → Create Dataset → Upload a small drone dataset.
 *
 * The drone images live in tests/fixtures/drone-dataset/ and are downloaded
 * on demand by tests/marketing/global-setup.ts (cached after first run).
 *
 * Each meaningful step is captioned and screenshotted so the resulting
 * video doubles as a narrated walkthrough.
 */

const PROJECT_NAME = `Drone Crop Survey ${Date.now()}`;
const DATASET_NAME = 'Field Survey 2025-05';
const DRONE_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'drone-dataset');

function listDroneImages(): string[] {
  if (!fs.existsSync(DRONE_DIR)) return [];
  return fs
    .readdirSync(DRONE_DIR)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .map((f) => path.join(DRONE_DIR, f))
    .sort();
}

test.describe('Marketing tour', () => {
  test.beforeEach(async ({ page }) => {
    await installCursor(page);
    await installCaptionOverlay(page);
    await mockTraining(page);
  });

  test('Create project and dataset', async ({ page }, testInfo) => {
    // ── 1. Home ───────────────────────────────────────────────────────────
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await step(
      page,
      testInfo,
      'home',
      'Welcome to LAI — let’s build a computer-vision project from scratch.',
    );

    // ── 2. Open "New Project" ─────────────────────────────────────────────
    const newProjectLink = page
      .locator('main')
      .getByRole('link', { name: /new project/i })
      .first();
    await expect(newProjectLink).toBeVisible({ timeout: 15_000 });
    await caption(page, 'Start by creating a new project from the home screen.');
    await newProjectLink.click();
    await expect(page).toHaveURL(/\/projects\/new$/);
    await page.waitForLoadState('networkidle');
    await step(
      page,
      testInfo,
      'create-project-empty',
      'Give your project a name, description, and a few tags.',
    );

    // ── 3. Fill project form ──────────────────────────────────────────────
    await page.fill('input#name', PROJECT_NAME);
    await page.fill(
      'textarea#description',
      'Detect pest damage in field crops from drone imagery.',
    );
    for (const tag of ['drone', 'agriculture', 'detection']) {
      await page.fill('input[placeholder*="Add tags"]', tag);
      await page.press('input[placeholder*="Add tags"]', 'Enter');
    }
    await step(
      page,
      testInfo,
      'create-project-filled',
      `Project: “${PROJECT_NAME}” — tagged for drone agriculture detection.`,
    );

    // ── 4. Submit project ─────────────────────────────────────────────────
    await caption(page, 'Click Create to spin up the project.');
    await page.click('button[type="submit"]:has-text("Create")');
    await page.waitForURL('/', { timeout: 20_000, waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(PROJECT_NAME).first()).toBeVisible({ timeout: 15_000 });
    await step(
      page,
      testInfo,
      'project-created-home',
      'Project created — it now appears on your home dashboard.',
    );

    // ── 5. Open the project ───────────────────────────────────────────────
    const projectCard = page.locator('main').getByText(PROJECT_NAME, { exact: false }).first();
    await projectCard.waitFor({ state: 'visible', timeout: 20_000 });
    await projectCard.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    await step(
      page,
      testInfo,
      'project-page',
      'Inside the project — datasets, models and exports all live here.',
    );

    // ── 6. Open "Create → Dataset" dropdown ───────────────────────────────
    await caption(page, 'Now add a dataset to hold your drone imagery.');
    const createButton = page.locator('button:has-text("Create")').first();
    await createButton.click();
    await page.waitForTimeout(400);
    await shot(page, testInfo, 'create-dropdown-open');
    await page.getByRole('menuitem', { name: 'Dataset', exact: true }).click();
    await page.waitForURL('**/projects/**/dataset', { timeout: 10_000 });
    await page.waitForLoadState('networkidle');
    await step(
      page,
      testInfo,
      'create-dataset-empty',
      'Datasets bundle your images and annotations into one workspace.',
    );

    // ── 7. Fill dataset form ──────────────────────────────────────────────
    await page.fill('input[placeholder*="Vehicle Detection"]', DATASET_NAME);
    const datasetDesc = page.locator('textarea[placeholder*="Describe"]').first();
    if (await datasetDesc.isVisible().catch(() => false)) {
      await datasetDesc.fill('May 2025 drone survey — six aerial frames over crop fields.');
    }
    await step(
      page,
      testInfo,
      'create-dataset-filled',
      `Dataset: “${DATASET_NAME}” — naming by survey date keeps things tidy.`,
    );

    // ── 8. Submit dataset ─────────────────────────────────────────────────
    await caption(page, 'Create the dataset to get an upload workspace.');
    await page.click('button[type="submit"]:has-text("Create Dataset")');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(DATASET_NAME).first()).toBeVisible({ timeout: 15_000 });
    await step(
      page,
      testInfo,
      'dataset-created',
      'Dataset ready — time to feed it some drone images.',
    );

    // ── 9. Open the dataset ───────────────────────────────────────────────
    await page.locator('main').getByRole('link', { name: DATASET_NAME }).first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    await step(
      page,
      testInfo,
      'dataset-page-empty',
      'Empty dataset — drag-and-drop or use the upload button to add images.',
    );

    // ── 10. Upload the drone dataset ──────────────────────────────────────
    const images = listDroneImages();
    if (images.length > 0) {
      const fileInput = page.locator('input[type="file"]').first();
      if (await fileInput.count()) {
        await caption(
          page,
          `Uploading ${images.length} aerial drone images from our sample dataset…`,
        );
        await fileInput.setInputFiles(images);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2500); // let thumbnails render
        await step(
          page,
          testInfo,
          'images-uploaded',
          `${images.length} drone images uploaded — uploads run in the background.`,
        );
      }
    } else {
      await caption(page, 'No sample images found — skipping upload step.');
      await page.waitForTimeout(800);
    }

    // ── 11. Outro ─────────────────────────────────────────────────────────
    await caption(page, 'Next up: annotate, train, and evaluate. ✨');
    await page.waitForTimeout(1800);

    await expect(page).toHaveURL(/.*/);
  });
});
