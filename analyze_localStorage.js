// Script to analyze localStorage usage
// Run this in browser console to see actual storage usage

function analyzeLocalStorage() {
  const analysis = {
    totalSize: 0,
    totalItems: 0,
    categories: {},
    largestItems: []
  };
  
  // Iterate through all localStorage items
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    
    const value = localStorage.getItem(key);
    const size = (key.length + (value ? value.length : 0)) * 2; // Unicode characters = 2 bytes
    
    analysis.totalSize += size;
    analysis.totalItems++;
    
    // Categorize by key pattern
    let category = 'other';
    if (key.includes('classifications_')) category = 'classifications';
    else if (key.includes('annotations_')) category = 'annotations';
    else if (key.includes('saved_annotations_')) category = 'saved_annotations';
    else if (key.includes('annotation_visibility_')) category = 'annotation_visibility';
    else if (key.includes('dataset-settings-')) category = 'dataset_settings';
    
    if (!analysis.categories[category]) {
      analysis.categories[category] = { count: 0, size: 0, items: [] };
    }
    
    analysis.categories[category].count++;
    analysis.categories[category].size += size;
    analysis.categories[category].items.push({ key, size });
    
    // Track largest items
    analysis.largestItems.push({ key, size, category });
  }
  
  // Sort largest items
  analysis.largestItems.sort((a, b) => b.size - a.size);
  analysis.largestItems = analysis.largestItems.slice(0, 10);
  
  return analysis;
}

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Generate report
function generateReport() {
  const analysis = analyzeLocalStorage();
  
  console.log('=== LOCALSTORAGE USAGE ANALYSIS ===');
  console.log(`Total items: ${analysis.totalItems}`);
  console.log(`Total size: ${formatBytes(analysis.totalSize)}`);
  console.log(`Browser limit: ~5-10 MB (varies by browser)`);
  console.log(`Usage: ${((analysis.totalSize / (5 * 1024 * 1024)) * 100).toFixed(1)}% of typical 5MB limit`);
  
  console.log('\n=== BY CATEGORY ===');
  Object.entries(analysis.categories).forEach(([category, data]) => {
    console.log(`${category}: ${data.count} items, ${formatBytes(data.size)}`);
    
    // Show largest items in category
    const largest = data.items.sort((a, b) => b.size - a.size).slice(0, 3);
    largest.forEach(item => {
      console.log(`  - ${item.key}: ${formatBytes(item.size)}`);
    });
  });
  
  console.log('\n=== TOP 10 LARGEST ITEMS ===');
  analysis.largestItems.forEach((item, index) => {
    console.log(`${index + 1}. ${item.key} (${item.category}): ${formatBytes(item.size)}`);
  });
  
  return analysis;
}

// Sample data structure analysis for classifications
function analyzeClassificationStructure() {
  console.log('\n=== CLASSIFICATION DATA STRUCTURE ANALYSIS ===');
  
  // Find classification entries
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.includes('classifications_')) {
      const data = localStorage.getItem(key);
      if (data) {
        try {
          const parsed = JSON.parse(data);
          const imageCount = Object.keys(parsed).length;
          const totalClassifications = Object.values(parsed).flat().length;
          const avgClassificationsPerImage = totalClassifications / imageCount;
          
          console.log(`Dataset ${key}:`);
          console.log(`  Images: ${imageCount}`);
          console.log(`  Total classifications: ${totalClassifications}`);
          console.log(`  Avg classifications per image: ${avgClassificationsPerImage.toFixed(2)}`);
          console.log(`  Data size: ${formatBytes(data.length * 2)}`);
          console.log(`  Size per image: ${formatBytes((data.length * 2) / imageCount)}`);
          
          // Sample structure
          const sampleKey = Object.keys(parsed)[0];
          if (sampleKey) {
            console.log(`  Sample entry: ${sampleKey} -> [${parsed[sampleKey].join(', ')}]`);
          }
        } catch (e) {
          console.log(`  Error parsing ${key}`);
        }
      }
    }
  }
}

// Run analysis
console.log('Copy and paste this into browser console to analyze localStorage usage:');
console.log('generateReport(); analyzeClassificationStructure();');
