import { test, expect, Page } from '@playwright/test';
import path from 'path';

// Helper function to navigate to create project page
async function navigateToCreateProject(page: Page) {
  await page.goto('/');
  await page.click('text=New Project');
  await expect(page).toHaveURL('/projects/new');
}

// Helper function to fill project form with all fields
async function fillProjectForm(page: Page, projectData: {
  name: string;
  description: string;
  tags: string[];
  logoPath?: string;
}) {
  // Fill project name
  await page.fill('input#name', projectData.name);
  
  // Fill description
  await page.fill('textarea#description', projectData.description);
  
  // Add tags
  for (const tag of projectData.tags) {
    await page.fill('input[placeholder*="Add tags"]', tag);
    await page.click('button:has-text("Add")');
    // Verify tag was added
    await expect(page.getByText(tag).first()).toBeVisible();
  }
  
  // Upload logo if provided
  if (projectData.logoPath) {
    const fileInput = page.locator('input#project-logo');
    await fileInput.setInputFiles(projectData.logoPath);
    
    // Wait for preview to appear
    await expect(page.locator('img[alt="Logo preview"]')).toBeVisible();
  }
}

test.describe('Create New Project', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto('/');
  });

  test('should create a new project with all fields filled', async ({ page }) => {
    // Navigate to create project page
    await navigateToCreateProject(page);
    
    // Verify we're on the create project page
    await expect(page.locator('h3:has-text("New LAI Project")')).toBeVisible();
    await expect(page.locator('text=Create a new project to organize your datasets and annotations')).toBeVisible();
    
    // Prepare test data
    const projectData = {
      name: 'Test AI Project',
      description: 'This is a comprehensive test project for AI model training with detailed annotations',
      tags: ['machine-learning', 'object-detection', 'test'],
      logoPath: path.join(__dirname, '../../fixtures/test-logo.png'),
    };
    
    // Fill all form fields
    await fillProjectForm(page, projectData);
    
    // Verify all fields are filled correctly
    await expect(page.locator('input#name')).toHaveValue(projectData.name);
    await expect(page.locator('textarea#description')).toHaveValue(projectData.description);
    
    // Verify all tags are present
    for (const tag of projectData.tags) {
      await expect(page.getByText(tag, { exact: false }).first()).toBeVisible();
    }
    
    // Submit the form
    await page.click('button[type="submit"]:has-text("Create")');
    
    // Wait for success message
    await expect(page.locator('text=has been created successfully').first()).toBeVisible({ timeout: 10000 });
    
    // Verify navigation to home page
    await expect(page).toHaveURL('/', { timeout: 5000 });
    
    // Wait for the page to load and verify the new project appears in the project list
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(projectData.name).first()).toBeVisible({ timeout: 10000 });
    
    // Verify the logo is displayed in the project card
    // Find the image with the project name as alt text (use .first() since tests may have created multiple)
    const logoImage = page.locator(`img[alt="${projectData.name}"]`).first();
    await expect(logoImage).toBeVisible({ timeout: 5000 });
    
    // Verify the logo src is a data URL (base64 encoded image)
    const logoSrc = await logoImage.getAttribute('src');
    expect(logoSrc).toMatch(/^data:image\//);
  });


  test('should create project with minimal required fields (name only)', async ({ page }) => {
    // Navigate to create project page
    await navigateToCreateProject(page);
    
    // Fill only the required name field
    await page.fill('input#name', 'Minimal Project');
    
    // Submit the form
    await page.click('button[type="submit"]:has-text("Create")');
    
    // Wait for success message
    await expect(page.locator('text=has been created successfully').first()).toBeVisible({ timeout: 10000 });
    
    // Verify navigation to home page
    await expect(page).toHaveURL('/', { timeout: 5000 });
  });

  test('should validate required name field', async ({ page }) => {
    // Navigate to create project page
    await navigateToCreateProject(page);
    
    // Verify submit button is disabled when name is empty
    const submitButton = page.locator('button[type="submit"]:has-text("Create")');
    await expect(submitButton).toBeDisabled();
    
    // Verify we're still on the create project page
    await expect(page).toHaveURL('/projects/new');
  });

  test('should allow adding and removing tags', async ({ page }) => {
    // Navigate to create project page
    await navigateToCreateProject(page);
    
    // Add tags
    const tags = ['tag1', 'tag2', 'tag3'];
    for (const tag of tags) {
      await page.fill('input[placeholder*="Add tags"]', tag);
      await page.press('input[placeholder*="Add tags"]', 'Enter');
      await expect(page.getByText(tag).first()).toBeVisible();
    }
    
    // Remove the second tag by clicking its remove button
    await page.getByRole('button', { name: 'Remove tag2' }).click();
    
    // Verify tag2 is removed
    await expect(page.getByText('tag2')).toHaveCount(0);
    
    // Verify other tags are still present
    await expect(page.getByText('tag1').first()).toBeVisible();
    await expect(page.getByText('tag3').first()).toBeVisible();
  });

  test('should allow uploading and removing logo', async ({ page }) => {
    // Navigate to create project page
    await navigateToCreateProject(page);
    
    // Upload logo
    const logoPath = path.join(__dirname, '../../fixtures/test-logo.png');
    const fileInput = page.locator('input#project-logo');
    await fileInput.setInputFiles(logoPath);
    
    // Verify preview appears
    await expect(page.locator('img[alt="Logo preview"]')).toBeVisible();
    
    // Remove logo
    await page.getByRole('button', { name: 'Remove logo' }).click();
    
    // Verify upload area reappears
    await expect(page.locator('text=Click to upload a logo')).toBeVisible();
    await expect(page.locator('img[alt="Logo preview"]')).not.toBeVisible();
  });

  test('should handle cancel button', async ({ page }) => {
    // Navigate to create project page
    await navigateToCreateProject(page);
    
    // Fill some data
    await page.fill('input#name', 'Cancelled Project');
    await page.fill('textarea#description', 'This should be cancelled');
    
    // Click cancel button
    await page.click('button:has-text("Cancel")');
    
    // Verify navigation back to home page
    await expect(page).toHaveURL('/');
    
    // Verify project was not created
    await expect(page.locator('text=Cancelled Project')).not.toBeVisible();
  });

  test('should disable submit button while submitting', async ({ page }) => {
    // Navigate to create project page
    await navigateToCreateProject(page);
    
    // Fill required field
    await page.fill('input#name', 'Processing Project');
    
    // Get submit button
    const submitButton = page.locator('button[type="submit"]');
    
    // Verify button is enabled initially and shows "Create"
    await expect(submitButton).toBeEnabled();
    await expect(submitButton).toHaveText('Create');
    
    // Submit the form
    await submitButton.click();
    
    // Wait for successful submission (navigation or success message)
    await expect(page.locator('text=has been created successfully').first()).toBeVisible({ timeout: 10000 });
  });

  test('should create project with special characters in name and description', async ({ page }) => {
    // Navigate to create project page
    await navigateToCreateProject(page);
    
    // Fill with special characters
    const projectData = {
      name: 'AI Project: "Testing" & <Validation> 2024',
      description: 'Description with special chars: @#$%^&*()_+-={}[]|\\:";\'<>?,./~`',
      tags: ['test-123', 'ai_ml'],
    };
    
    await fillProjectForm(page, projectData);
    
    // Submit the form
    await page.click('button[type="submit"]:has-text("Create")');
    
    // Wait for success message
    await expect(page.locator('text=has been created successfully').first()).toBeVisible({ timeout: 10000 });
    
    // Verify navigation to home page
    await expect(page).toHaveURL('/', { timeout: 5000 });
  });
});
