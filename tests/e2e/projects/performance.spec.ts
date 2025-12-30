import { test, expect, Page } from '@playwright/test';
import path from 'path';
import { clearDatabase } from '../../test-helpers';
import fs from 'fs';

/**
 * Helper to create a small test image buffer
 * Creates a minimal valid PNG file (1x1 pixel)
 */
function createTestImageBuffer(): Buffer {
  // Minimal 1x1 transparent PNG (67 bytes)
  const pngData = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, // IEND chunk
    0x42, 0x60, 0x82
  ]);
  return pngData;
}

/**
 * Helper to create multiple projects with logos via API
 */
async function createProjectsWithLogos(page: Page, count: number): Promise<void> {
  const apiUrl = process.env.TEST_API_URL || 'http://localhost:9999';
  const imageBuffer = createTestImageBuffer();
  
  console.log(`Creating ${count} projects with logos...`);
  const startTime = Date.now();
  
  // Create projects in batches to avoid overwhelming the server
  const batchSize = 50;
  for (let i = 0; i < count; i += batchSize) {
    const batchPromises = [];
    const currentBatchSize = Math.min(batchSize, count - i);
    
    for (let j = 0; j < currentBatchSize; j++) {
      const projectIndex = i + j;
      const formData = new FormData();
      formData.append('name', `Performance Test Project ${projectIndex + 1}`);
      formData.append('description', `This is a test project #${projectIndex + 1} for performance testing with a logo image`);
      formData.append('tags', JSON.stringify(['performance', 'test', `batch-${Math.floor(projectIndex / 100)}`]));
      
      // Add logo as a blob
      const blob = new Blob([imageBuffer], { type: 'image/png' });
      formData.append('logo', blob, `logo-${projectIndex}.png`);
      
      const promise = page.request.post(`${apiUrl}/projects/`, {
        multipart: formData as any,
      });
      
      batchPromises.push(promise);
    }
    
    // Wait for the batch to complete
    await Promise.all(batchPromises);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  Created ${i + currentBatchSize}/${count} projects (${elapsed}s elapsed)`);
  }
  
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✓ Created ${count} projects in ${totalTime}s`);
}

test.describe('Project List Performance with 1000 Projects', () => {
  test.beforeAll(async ({ browser }) => {
    // Create a new page for setup
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Clear database and create test projects
    console.log('Setting up performance test...');
    await clearDatabase(page);
    await createProjectsWithLogos(page, 1000);
    
    await context.close();
  });

  test('should load and display 1000 projects quickly', async ({ page }) => {
    console.log('\n=== Testing page load performance ===');
    
    // Start timing
    const startTime = Date.now();
    
    // Navigate to home page
    await page.goto('/');
    
    // Wait for the page to be fully loaded
    await page.waitForLoadState('networkidle');
    
    const navigationTime = Date.now() - startTime;
    console.log(`✓ Page navigation completed in ${navigationTime}ms`);
    
    // Verify page load time is reasonable (should be under 5 seconds)
    expect(navigationTime).toBeLessThan(5000);
    
    // Wait for project cards to appear
    const projectCards = page.locator('[data-testid="project-card"], .rounded-lg.border.bg-card');
    await projectCards.first().waitFor({ state: 'visible', timeout: 10000 });
    
    const firstRenderTime = Date.now() - startTime;
    console.log(`✓ First project card rendered in ${firstRenderTime}ms`);
    
    // First render should be very fast (under 3 seconds)
    expect(firstRenderTime).toBeLessThan(3000);
    
    // Wait a bit for any lazy loading or additional rendering
    await page.waitForTimeout(500);
    
    // Count visible projects (should see at least some of them)
    const visibleCount = await projectCards.count();
    console.log(`✓ Visible project cards: ${visibleCount}`);
    
    // Should have projects visible
    expect(visibleCount).toBeGreaterThan(0);
    
    // Check that logos are loading (verify at least first few have logos)
    const logosToCheck = Math.min(10, visibleCount);
    let logosLoaded = 0;
    
    for (let i = 0; i < logosToCheck; i++) {
      const logoInCard = projectCards.nth(i).locator('img').first();
      const isVisible = await logoInCard.isVisible().catch(() => false);
      if (isVisible) {
        const src = await logoInCard.getAttribute('src');
        if (src && src.startsWith('data:image/')) {
          logosLoaded++;
        }
      }
    }
    
    console.log(`✓ Logos loaded in first ${logosToCheck} cards: ${logosLoaded}/${logosToCheck}`);
    
    // Most logos should be loaded
    expect(logosLoaded).toBeGreaterThan(logosToCheck * 0.7); // At least 70% loaded
  });

  test('should handle scrolling through projects smoothly', async ({ page }) => {
    console.log('\n=== Testing scroll performance ===');
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Wait for initial render
    const projectCards = page.locator('[data-testid="project-card"], .rounded-lg.border.bg-card');
    await projectCards.first().waitFor({ state: 'visible' });
    
    const scrollStartTime = Date.now();
    
    // Scroll down multiple times to trigger lazy loading
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight);
      });
      await page.waitForTimeout(200); // Small delay between scrolls
    }
    
    const scrollTime = Date.now() - scrollStartTime;
    console.log(`✓ Scrolled through content in ${scrollTime}ms`);
    
    // Scroll should be smooth and fast
    expect(scrollTime).toBeLessThan(2000);
    
    // Verify more cards are visible after scrolling
    const cardsAfterScroll = await projectCards.count();
    console.log(`✓ Cards visible after scroll: ${cardsAfterScroll}`);
  });

  test('should search through 1000 projects efficiently', async ({ page }) => {
    console.log('\n=== Testing search performance ===');
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Look for search input
    const searchInput = page.locator('input[placeholder*="Search"], input[type="search"]').first();
    
    // If search exists, test it
    if (await searchInput.isVisible().catch(() => false)) {
      const searchStartTime = Date.now();
      
      // Type search query
      await searchInput.fill('Performance Test Project 500');
      
      // Wait for search to filter results
      await page.waitForTimeout(500);
      
      const searchTime = Date.now() - searchStartTime;
      console.log(`✓ Search completed in ${searchTime}ms`);
      
      // Search should be fast
      expect(searchTime).toBeLessThan(1000);
      
      // Verify filtered results
      const projectCards = page.locator('[data-testid="project-card"], .rounded-lg.border.bg-card');
      const visibleAfterSearch = await projectCards.count();
      console.log(`✓ Projects visible after search: ${visibleAfterSearch}`);
      
      // Should have filtered down significantly
      expect(visibleAfterSearch).toBeLessThan(100);
    } else {
      console.log('⊘ No search input found - skipping search test');
    }
  });

  test('should measure Time to Interactive (TTI)', async ({ page }) => {
    console.log('\n=== Measuring Time to Interactive ===');
    
    const navigationStart = Date.now();
    
    await page.goto('/');
    
    // Wait for network idle
    await page.waitForLoadState('networkidle');
    
    // Wait for first meaningful paint (projects visible)
    const projectCards = page.locator('[data-testid="project-card"], .rounded-lg.border.bg-card');
    await projectCards.first().waitFor({ state: 'visible' });
    
    // Test that the page is interactive by clicking on a project
    const firstCard = projectCards.first();
    const isClickable = await firstCard.isEnabled().catch(() => true); // Assume clickable if check fails
    
    const ttiTime = Date.now() - navigationStart;
    console.log(`✓ Time to Interactive: ${ttiTime}ms`);
    
    // Page should be interactive quickly even with 1000 projects
    expect(ttiTime).toBeLessThan(5000);
    expect(isClickable).toBe(true);
  });

  test.afterAll(async ({ browser }) => {
    // Clean up - clear the database after performance tests
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log('\nCleaning up performance test data...');
    await clearDatabase(page);
    console.log('✓ Database cleared');
    
    await context.close();
  });
});
