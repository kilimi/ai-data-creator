import { test, expect } from '@playwright/test';

/**
 * Simple test to verify navigation to create project page works
 */

test('navigate to create project page', async ({ page }) => {
  // Go to home page
  await page.goto('/');
  
  // Wait for page to load with longer timeout
  await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
  
  console.log('On home page');
  
  // Click the "New Project" button
  await page.click('text=New Project');
  
  console.log('Clicked New Project button');
  
  // Wait for navigation
  await page.waitForURL('**/projects/new', { timeout: 15000 });
  
  console.log('Navigated to:', page.url());
  
  // Verify we're on the correct page
  await expect(page).toHaveURL('/projects/new');
  
  console.log('URL verification passed');
  
  // Verify the page title/heading
  await expect(page.locator('h3:has-text("New LAI Project")')).toBeVisible();
  
  console.log('Page heading found - navigation successful!');
});
