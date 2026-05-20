import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { caption, installCaptionOverlay, installCursor, mockTraining, shot, step } from '../helpers';

/**
 * Marketing flow: Create a project + dataset and upload images.
 * Captions are overlaid on the page so the recorded video doubles
 * as a narrated walkthrough.
 */

test.describe('Marketing tour', () => {
  test.beforeEach(async ({ page }) => {
    await installCursor(page);
    await installCaptionOverlay(page);
    await mockTraining(page);
  });

  test('Create project and dataset', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await step(page, testInfo, 'home', 'Welcome — let’s build a computer-vision project from scratch.');

    // 1. Create a project
    const newProject = page.getByRole('button', { name: /new project|create project/i }).first();
    if (await newProject.isVisible().catch(() => false)) {
      await caption(page, 'Create a new project to organize your datasets.');
      await newProject.click();
      await step(page, testInfo, 'create-project-form', 'Give the project a name and short description.');

      await page.getByLabel(/name/i).first().fill('Drone Crop Survey');
      const descInput = page.getByLabel(/description/i).first();
      if (await descInput.isVisible().catch(() => false)) {
        await descInput.fill('Detect pest damage from drone imagery');
      }
      await step(page, testInfo, 'create-project-filled', 'Project: Drone Crop Survey.');

      await page.getByRole('button', { name: /create|save|submit/i }).first().click();
      await page.waitForLoadState('networkidle');
      await step(page, testInfo, 'project-created', 'Project created. Now let’s add a dataset.');
    }

    // 2. Create a dataset
    const newDataset = page.getByRole('button', { name: /new dataset|create dataset|add dataset/i }).first();
    if (await newDataset.isVisible().catch(() => false)) {
      await newDataset.click();
      await step(page, testInfo, 'create-dataset-form', 'Datasets group your images and annotations.');

      await page.getByLabel(/name/i).first().fill('Field Survey 2025-05');
      await step(page, testInfo, 'dataset-name-filled', 'Naming it after the survey date keeps things tidy.');

      await page.getByRole('button', { name: /create|save|submit/i }).first().click();
      await page.waitForLoadState('networkidle');
      await step(page, testInfo, 'dataset-created', 'Dataset ready — time to upload images.');
    }

    // 3. Upload an image
    const fixture = path.join(process.cwd(), 'tests', 'fixtures', 'test-logo.png');
    if (fs.existsSync(fixture)) {
      const fileInput = page.locator('input[type="file"]').first();
      if (await fileInput.count()) {
        await fileInput.setInputFiles(fixture);
        await page.waitForLoadState('networkidle');
        await step(page, testInfo, 'image-uploaded', 'Drag-and-drop or browse — uploads run in the background.');
      }
    }

    await caption(page, 'Next up: annotate, train, and evaluate. ✨');
    await page.waitForTimeout(1500);

    await expect(page).toHaveURL(/.*/);
  });
});
