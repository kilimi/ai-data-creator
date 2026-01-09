import { test, expect, Page } from '@playwright/test';

// Increase timeout for all tests in this file
test.setTimeout(60000);

// Helper function to create a test project first (datasets need a project)
async function createTestProject(page: Page, projectName: string): Promise<string> {
  await page.goto('/');
  await page.click('text=New Project');
  await expect(page).toHaveURL('/projects/new');
  
  // Fill minimal project info
  await page.fill('input#name', projectName);
  
  // Submit the form
  await page.click('button[type="submit"]:has-text("Create")');
  
  // Wait for navigation back to home page
  await page.waitForURL('/', { timeout: 20000, waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 });
  
  // Wait for the project to appear
  await expect(page.getByText(projectName).first()).toBeVisible({ timeout: 15000 });
  
  return projectName;
}

// Helper function to create a test dataset within a project
async function createTestDataset(page: Page, projectName: string, datasetName: string) {
  // Navigate to the project
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  
  // Click on the project name to navigate to project detail
  await page.getByText(projectName).first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  // Find and click on Create dropdown button
  const createButton = page.locator('button:has-text("Create")').first();
  await createButton.click();
  
  // Wait for dropdown menu to appear
  await page.waitForTimeout(500);
  
  // Click on the "Dataset" menu item
  await page.getByRole('menuitem', { name: 'Dataset', exact: true }).click();
  
  // Wait for navigation to create dataset page
  await page.waitForURL('**/projects/new/dataset', { timeout: 10000 });
  
  // Fill dataset name
  await page.fill('input[placeholder*="Vehicle Detection"]', datasetName);
  
  // Fill description
  await page.fill('textarea[placeholder*="Describe"]', 'Test dataset for deletion testing');
  
  // Submit the form
  await page.click('button[type="submit"]:has-text("Create Dataset")');
  
  // Wait for success
  await page.waitForLoadState('networkidle', { timeout: 20000 });
  
  return datasetName;
}

// Helper to navigate to project datasets page
async function navigateToProjectDatasets(page: Page, projectName: string) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  
  // Click on the project
  const projectLink = page.getByText(projectName).first();
  await projectLink.waitFor({ state: 'visible', timeout: 10000 });
  await projectLink.click({ force: true });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
}

// Helper to navigate to a specific dataset's detail page
async function navigateToDatasetDetail(page: Page, projectName: string, datasetName: string) {
  await navigateToProjectDatasets(page, projectName);
  
  // Click on the dataset
  const datasetLink = page.getByText(datasetName).first();
  await datasetLink.waitFor({ state: 'visible', timeout: 10000 });
  await datasetLink.click({ force: true });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
}

test.describe('Delete Dataset', () => {
  const timestamp = Date.now();
  const testProjectName = `Project for Delete Test ${timestamp}`;
  
  test.beforeEach(async ({ page }) => {
    // Create a test project before each test
    await createTestProject(page, testProjectName);
  });

  test('should delete dataset from dataset card dropdown menu', async ({ page }) => {
    const datasetName = `Dataset to Delete Card ${timestamp}`;
    
    // Create a test dataset
    await createTestDataset(page, testProjectName, datasetName);
    
    // Navigate to project datasets page
    await navigateToProjectDatasets(page, testProjectName);
    
    // Wait for the dataset to be visible
    await expect(page.getByText(datasetName).first()).toBeVisible({ timeout: 15000 });
    
    // Find the dataset card and open the dropdown menu
    const datasetCard = page.locator('div').filter({ hasText: datasetName }).first();
    
    // Find and click the dropdown trigger (usually a button with MoreVertical icon)
    const dropdownTrigger = datasetCard.locator('button').filter({ has: page.locator('svg') }).first();
    await dropdownTrigger.click();
    
    // Wait for dropdown menu to appear
    await page.waitForTimeout(500);
    
    // Click on Delete option
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    
    // Wait for confirmation dialog to appear
    await page.waitForTimeout(500);
    
    // Verify confirmation dialog is visible
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    console.log('✓ Confirmation dialog is visible');
    
    // Click the confirm delete button in the dialog
    const confirmDeleteButton = confirmDialog.locator('button:has-text("Delete")');
    await confirmDeleteButton.click();
    
    // Wait for deletion to complete
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    
    // Verify success toast appears
    const successToast = page.getByText(/Dataset Deleted/i);
    await expect(successToast).toBeVisible({ timeout: 5000 });
    console.log('✓ Delete success toast is visible');
    
    // Verify the dataset is no longer visible
    await page.waitForTimeout(1000);
    await expect(page.getByText(datasetName)).not.toBeVisible({ timeout: 10000 });
    console.log('✓ Dataset is no longer visible after deletion');
  });

  test('should delete dataset from dataset detail page', async ({ page }) => {
    const datasetName = `Dataset to Delete Detail ${timestamp}`;
    
    // Create a test dataset
    await createTestDataset(page, testProjectName, datasetName);
    
    // Navigate to dataset detail page
    await navigateToDatasetDetail(page, testProjectName, datasetName);
    
    // Click on "Delete Dataset" button
    const deleteButton = page.locator('button:has-text("Delete Dataset")');
    await expect(deleteButton).toBeVisible({ timeout: 10000 });
    await deleteButton.click();
    
    // Wait for confirmation dialog to appear
    await page.waitForTimeout(500);
    
    // Verify confirmation dialog is visible
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    console.log('✓ Confirmation dialog is visible');
    
    // Verify dialog contains warning text
    await expect(page.getByText(/permanently delete/i)).toBeVisible();
    console.log('✓ Warning text is visible in dialog');
    
    // Click the confirm delete button in the dialog
    const confirmDeleteButton = confirmDialog.locator('button:has-text("Delete Dataset")');
    await confirmDeleteButton.click();
    
    // Wait for deletion to complete and navigation
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    
    // Verify we're navigated back to project datasets page
    await expect(page).toHaveURL(/\/projects\/\d+\/datasets/, { timeout: 10000 });
    console.log('✓ Navigated back to project datasets page');
    
    // Verify the dataset is no longer visible
    await page.waitForTimeout(1000);
    await expect(page.getByText(datasetName)).not.toBeVisible({ timeout: 10000 });
    console.log('✓ Dataset is no longer visible after deletion');
  });

  test('should cancel dataset deletion from confirmation dialog', async ({ page }) => {
    const datasetName = `Dataset Cancel Delete ${timestamp}`;
    
    // Create a test dataset
    await createTestDataset(page, testProjectName, datasetName);
    
    // Navigate to dataset detail page
    await navigateToDatasetDetail(page, testProjectName, datasetName);
    
    // Click on "Delete Dataset" button
    const deleteButton = page.locator('button:has-text("Delete Dataset")');
    await expect(deleteButton).toBeVisible({ timeout: 10000 });
    await deleteButton.click();
    
    // Wait for confirmation dialog to appear
    await page.waitForTimeout(500);
    
    // Verify confirmation dialog is visible
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    
    // Click the cancel button
    const cancelButton = confirmDialog.locator('button:has-text("Cancel")');
    await cancelButton.click();
    
    // Wait for dialog to close
    await page.waitForTimeout(500);
    
    // Verify dialog is closed
    await expect(confirmDialog).not.toBeVisible({ timeout: 5000 });
    console.log('✓ Confirmation dialog is closed after cancel');
    
    // Verify we're still on the dataset detail page
    await expect(page.getByText(datasetName)).toBeVisible({ timeout: 5000 });
    console.log('✓ Still on dataset detail page - deletion was cancelled');
  });

  test('should show confirmation dialog with dataset deletion warning', async ({ page }) => {
    const datasetName = `Dataset Confirm Dialog ${timestamp}`;
    
    // Create a test dataset
    await createTestDataset(page, testProjectName, datasetName);
    
    // Navigate to dataset detail page
    await navigateToDatasetDetail(page, testProjectName, datasetName);
    
    // Click on "Delete Dataset" button
    const deleteButton = page.locator('button:has-text("Delete Dataset")');
    await expect(deleteButton).toBeVisible({ timeout: 10000 });
    await deleteButton.click();
    
    // Wait for confirmation dialog to appear
    await page.waitForTimeout(500);
    
    // Verify confirmation dialog components
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    
    // Verify dialog title
    await expect(page.getByText('Delete Dataset', { exact: true })).toBeVisible();
    console.log('✓ Dialog title is visible');
    
    // Verify warning message about permanent deletion
    await expect(page.getByText(/permanently delete this dataset/i)).toBeVisible();
    console.log('✓ Permanent deletion warning is visible');
    
    // Verify warning about associated data (images and annotations)
    await expect(page.getByText(/images and annotations/i)).toBeVisible();
    console.log('✓ Warning about associated data is visible');
    
    // Verify Cancel button is present
    await expect(confirmDialog.locator('button:has-text("Cancel")')).toBeVisible();
    console.log('✓ Cancel button is visible');
    
    // Verify Delete Dataset confirm button is present
    await expect(confirmDialog.locator('button:has-text("Delete Dataset")')).toBeVisible();
    console.log('✓ Confirm delete button is visible');
  });
});
