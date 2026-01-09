import { chromium, FullConfig } from '@playwright/test';

/**
 * Global setup - runs once before all tests
 * Clears the test database to ensure clean state
 */
async function globalSetup(config: FullConfig) {
  console.log('🧹 Clearing test database before running tests...');
  
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  try {
    // Clear the database using the API endpoint
    const apiUrl = process.env.TEST_API_URL || 'http://localhost:9999';
    
    const response = await page.request.delete(`${apiUrl}/database/clear`);
    
    if (response.ok()) {
      const data = await response.json();
      console.log('✅ Test database cleared successfully');
      console.log(`   - Records deleted: ${data.total_records_deleted}`);
      console.log(`   - Files removed: ${data.files_removed}`);
    } else {
      console.warn('⚠️  Failed to clear test database:', response.status());
      console.warn('   Tests may run with existing data');
    }
  } catch (error) {
    console.error('❌ Error clearing test database:', error);
    console.warn('   Tests will continue but may fail due to existing data');
  } finally {
    await browser.close();
  }
}

export default globalSetup;
