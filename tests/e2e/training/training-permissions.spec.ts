import { test, expect, Page } from '@playwright/test';

// Helper function to create a test project
async function createTestProject(page: Page, projectName: string): Promise<string> {
  await page.goto('/');
  await page.click('text=New Project');
  await expect(page).toHaveURL('/projects/new');
  
  await page.fill('input#name', projectName);
  await page.click('button[type="submit"]:has-text("Create")');
  
  await page.waitForURL('/', { timeout: 20000, waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 });
  await expect(page.getByText(projectName).first()).toBeVisible({ timeout: 15000 });
  
  return projectName;
}

// Helper function to create a test dataset
async function createTestDataset(page: Page, projectName: string, datasetName: string) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByText(projectName).first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  const createButton = page.locator('button:has-text("Create")').first();
  await createButton.click();
  await page.waitForTimeout(500);
  await page.getByRole('menuitem', { name: 'Dataset', exact: true }).click();
  await page.waitForURL('**/projects/new/dataset', { timeout: 10000 });
  
  await page.fill('input[placeholder*="Vehicle Detection"]', datasetName);
  await page.click('button[type="submit"]:has-text("Create Dataset")');
  await expect(page.locator('text=has been created successfully').first()).toBeVisible({ timeout: 10000 });
  await page.waitForLoadState('networkidle');
}

// Helper function to navigate to models page and start training
async function navigateToModelsAndStartTraining(page: Page, projectName: string) {
  // Navigate to project
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByText(projectName).first().click();
  await page.waitForLoadState('networkidle');
  
  // Navigate to Models page
  await page.click('a:has-text("Models")');
  await page.waitForURL('**/models', { timeout: 10000 });
  await page.waitForLoadState('networkidle');
  
  // Click Train Model button
  await page.click('button:has-text("Train Model")');
  await page.waitForTimeout(1000);
}

test.describe('Training Permission Error', () => {
  const timestamp = Date.now();
  const testProjectName = `Permission Test Project ${timestamp}`;
  const testDatasetName = `Permission Test Dataset ${timestamp}`;
  
  test.beforeEach(async ({ page }) => {
    // Create test project and dataset
    await createTestProject(page, testProjectName);
    await createTestDataset(page, testProjectName, testDatasetName);
  });

  test('should not have permission errors when starting training', async ({ page }) => {
    // Navigate to models page
    await navigateToModelsAndStartTraining(page, testProjectName);
    
    // Wait for training modal to appear
    await expect(page.locator('text=Train Model').first()).toBeVisible({ timeout: 5000 });
    
    // Select the dataset (should be visible in the modal)
    // Wait for dataset selection to be available
    await page.waitForTimeout(1000);
    
    // Look for dataset in the training modal
    const datasetOption = page.locator(`text=${testDatasetName}`).first();
    if (await datasetOption.isVisible({ timeout: 5000 })) {
      await datasetOption.click();
    }
    
    // Select YOLO model type
    const yoloCard = page.locator('text=YOLO').first();
    if (await yoloCard.isVisible({ timeout: 3000 })) {
      await yoloCard.click();
    }
    
    // Start training (this will create a new task with a new task_id)
    const startButton = page.locator('button:has-text("Start Training")').first();
    if (await startButton.isVisible({ timeout: 3000 })) {
      await startButton.click();
    }
    
    // Wait for training to start
    await page.waitForTimeout(2000);
    
    // Navigate to models page to see the training task
    await page.goto(`/projects/*/models`);
    await page.waitForLoadState('networkidle');
    
    // Wait for the training task to appear in the list
    await page.waitForTimeout(3000);
    
    // Check for any error messages related to permissions
    const errorMessages = page.locator('text=/permission|Permission|Errno 13/i');
    const errorCount = await errorMessages.count();
    
    // Verify no permission errors are displayed
    expect(errorCount).toBe(0);
    
    // Check task status - it should not be "failed" due to permissions
    // Look for the training task in the table
    const taskRows = page.locator('table tbody tr');
    const rowCount = await taskRows.count();
    
    let foundTask = false;
    for (let i = 0; i < rowCount; i++) {
      const row = taskRows.nth(i);
      const statusBadge = row.locator('span, button').filter({ hasText: /Failed|Running|Pending|Completed/ });
      if (await statusBadge.isVisible({ timeout: 1000 })) {
        const statusText = await statusBadge.textContent();
        
        // If task is failed, check the error message
        if (statusText?.includes('Failed')) {
          // Click on the status to see error details
          await statusBadge.click();
          await page.waitForTimeout(1000);
          
          // Check for permission errors in the error details
          const errorDetail = page.locator('text=/permission|Permission|Errno 13/i');
          const hasPermissionError = await errorDetail.count() > 0;
          
          // Fail the test if permission error is found
          expect(hasPermissionError).toBe(false);
        }
        
        foundTask = true;
        break;
      }
    }
    
    // Verify we found at least one task
    expect(foundTask).toBe(true);
  });

  test('should handle training task creation with proper directory permissions', async ({ page }) => {
    // This test verifies that when a new training task is created,
    // it gets a unique task_id and creates directories with proper permissions
    
    // Navigate to models page
    await navigateToModelsAndStartTraining(page, testProjectName);
    
    // Start a training task
    await page.waitForTimeout(1000);
    const startButton = page.locator('button:has-text("Start Training")').first();
    if (await startButton.isVisible({ timeout: 5000 })) {
      await startButton.click();
    }
    
    // Wait for task to be created
    await page.waitForTimeout(3000);
    
    // Navigate to models page to see tasks
    await page.goto(`/projects/*/models`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // Get the task ID from the first task row
    const taskRows = page.locator('table tbody tr');
    const firstRow = taskRows.first();
    
    // Extract task ID (usually in the first column)
    const taskIdCell = firstRow.locator('td').first();
    const taskIdText = await taskIdCell.textContent();
    const taskId = taskIdText?.trim().replace('#', '') || '';
    
    // Verify task ID is a number (indicates it's a valid task)
    expect(taskId).toMatch(/^\d+$/);
    
    // Click on the task to see details
    await firstRow.click();
    await page.waitForTimeout(1000);
    
    // Check for any permission-related errors in the task details
    const errorText = page.locator('text=/permission|Permission|Errno 13|Permission denied/i');
    const hasError = await errorText.count() > 0;
    
    // The test should pass if no permission errors are found
    expect(hasError).toBe(false);
  });

  test('should verify training directories are created with correct permissions', async ({ page }) => {
    // This test checks that the backend properly creates directories
    // by making an API call to verify the training task structure
    
    const apiUrl = process.env.TEST_API_URL || 'http://localhost:9999';
    
    // Create a training task via API
    // First, get project ID
    const projectsResponse = await page.request.get(`${apiUrl}/projects/`);
    const projectsData = await projectsResponse.json();
    const project = projectsData.find((p: any) => p.name === testProjectName);
    
    if (!project) {
      test.skip();
      return;
    }
    
    // Get dataset ID
    const datasetsResponse = await page.request.get(`${apiUrl}/projects/${project.id}/datasets/list`);
    const datasetsData = await datasetsResponse.json();
    const dataset = datasetsData.data?.find((d: any) => d.name === testDatasetName);
    
    if (!dataset) {
      test.skip();
      return;
    }
    
    // Start a training task
    const trainingResponse = await page.request.post(`${apiUrl}/training/yolo/start`, {
      data: {
        project_id: project.id,
        dataset_configs: [{
          dataset_id: dataset.id,
          annotation_file_id: null,
          image_collection: null,
          split: { train: 0.8, val: 0.2, test: 0.0 }
        }],
        model_type: 'yolo11n-seg.pt',
        epochs: 1, // Minimal epochs for test
        batch_size: 1,
        image_size: 640,
        device: 'cpu', // Use CPU for testing
        task_name: `Permission Test Training ${timestamp}`
      }
    });
    
    expect(trainingResponse.ok()).toBe(true);
    const trainingData = await trainingResponse.json();
    expect(trainingData.success).toBe(true);
    expect(trainingData.task_id).toBeDefined();
    
    const taskId = trainingData.task_id;
    
    // Wait a bit for the task to start and create directories
    await page.waitForTimeout(5000);
    
    // Check task status via API
    const taskResponse = await page.request.get(`${apiUrl}/tasks/${taskId}`);
    expect(taskResponse.ok()).toBe(true);
    const taskData = await taskResponse.json();
    
    // Verify task was created
    expect(taskData.id).toBe(taskId);
    
    // Check if task has failed with permission error
    if (taskData.status === 'failed') {
      const errorMessage = taskData.error_message || '';
      const hasPermissionError = /permission|Permission|Errno 13|Permission denied/i.test(errorMessage);
      
      // Fail the test if permission error occurred
      expect(hasPermissionError).toBe(false);
      
      if (hasPermissionError) {
        console.error('Permission error detected:', errorMessage);
      }
    }
    
    // Verify task metadata contains directory information
    if (taskData.task_metadata) {
      const resultsDir = taskData.task_metadata.results_dir;
      if (resultsDir) {
        // The results_dir should be set, indicating directories were created
        expect(resultsDir).toContain(`task_${taskId}`);
      }
    }
  });
});
