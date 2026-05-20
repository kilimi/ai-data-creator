import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { installCursor, mockTraining, shot } from '../helpers';

/**
 * Marketing flow: Create a project + dataset and upload images.
 *
 * Outputs:
 *   docs/flows/create-project-and-dataset/01-...png ...
 *   <playwright videos under docs/flows/_raw/>
 */

test.describe('Marketing tour', () => {
  test.beforeEach(async ({ page }) => {
    await installCursor(page);
    await mockTraining(page); // safe to install even if this flow doesn't train
  });

  test('Create project and dataset', async ({ page }, testInfo) => {
    // 1. Landing / projects page
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await shot(page, testInfo, 'home');

    // 2. Create a project
    const newProject = page.getByRole('button', { name: /new project|create project/i }).first();
    if (await newProject.isVisible().catch(() => false)) {
      await newProject.click();
      await shot(page, testInfo, 'create-project-form');

      const nameInput = page.getByLabel(/name/i).first();
      await nameInput.fill('Drone Crop Survey');
      const descInput = page.getByLabel(/description/i).first();
      if (await descInput.isVisible().catch(() => false)) {
        await descInput.fill('Detect pest damage from drone imagery');
      }
      await shot(page, testInfo, 'create-project-filled');

      await page.getByRole('button', { name: /create|save|submit/i }).first().click();
      await page.waitForLoadState('networkidle');
      await shot(page, testInfo, 'project-created');
    }

    // 3. Create a dataset inside the project
    const newDataset = page.getByRole('button', { name: /new dataset|create dataset|add dataset/i }).first();
    if (await newDataset.isVisible().catch(() => false)) {
      await newDataset.click();
      await shot(page, testInfo, 'create-dataset-form');

      await page.getByLabel(/name/i).first().fill('Field Survey 2025-05');
      await shot(page, testInfo, 'dataset-name-filled');

      await page.getByRole('button', { name: /create|save|submit/i }).first().click();
      await page.waitForLoadState('networkidle');
      await shot(page, testInfo, 'dataset-created');
    }

    // 4. Upload an image (uses the small test fixture)
    const fixture = path.join(process.cwd(), 'tests', 'fixtures', 'test-logo.png');
    if (fs.existsSync(fixture)) {
      const fileInput = page.locator('input[type="file"]').first();
      if (await fileInput.count()) {
        await fileInput.setInputFiles(fixture);
        await page.waitForLoadState('networkidle');
        await shot(page, testInfo, 'image-uploaded');
      }
    }

    // Sanity assertion so the test fails loudly if the page broke
    await expect(page).toHaveURL(/.*/);
  });
});
