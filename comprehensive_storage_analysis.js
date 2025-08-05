// Complete localStorage analysis tool
// Copy this into browser console to see what's using space

function comprehensiveStorageAnalysis() {
  console.log('🔍 COMPREHENSIVE LOCALSTORAGE ANALYSIS');
  console.log('=====================================');
  
  let totalSize = 0;
  const items = [];
  
  // Collect all items
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    
    const value = localStorage.getItem(key);
    const keySize = key.length * 2; // UTF-16 = 2 bytes per char
    const valueSize = (value?.length || 0) * 2;
    const itemSize = keySize + valueSize;
    
    totalSize += itemSize;
    
    // Categorize
    let category = 'other';
    let datasetId = 'unknown';
    
    if (key.includes('classifications_')) {
      category = 'classifications';
      datasetId = key.replace('classifications_', '');
    } else if (key.includes('opt_classifications_')) {
      category = 'optimized_classifications';
      datasetId = key.replace('opt_classifications_', '');
    } else if (key.includes('classification_classes_')) {
      category = 'classification_classes';
      datasetId = key.replace('classification_classes_', '');
    } else if (key.includes('annotations_')) {
      category = 'annotations';
      datasetId = key.replace('annotations_', '');
    } else if (key.includes('saved_annotations_')) {
      category = 'saved_annotations';
      datasetId = key.replace('saved_annotations_', '');
    } else if (key.includes('annotation_visibility_')) {
      category = 'annotation_visibility';
      datasetId = key.replace('annotation_visibility_', '');
    } else if (key.includes('dataset-settings-')) {
      category = 'dataset_settings';
      datasetId = key.replace('dataset-settings-', '');
    }
    
    items.push({
      key,
      category,
      datasetId,
      keySize,
      valueSize,
      itemSize,
      value: value ? value.substring(0, 100) + (value.length > 100 ? '...' : '') : null
    });
  }
  
  // Sort by size
  items.sort((a, b) => b.itemSize - a.itemSize);
  
  // Format bytes
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };
  
  console.log(`📊 OVERVIEW`);
  console.log(`Total items: ${items.length}`);
  console.log(`Total size: ${formatBytes(totalSize)}`);
  console.log(`Browser limit: ~5-10 MB`);
  console.log(`Usage: ${(totalSize / (5 * 1024 * 1024) * 100).toFixed(1)}% of 5MB limit`);
  
  // Group by category
  const byCategory = items.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = { items: [], totalSize: 0, count: 0 };
    }
    acc[item.category].items.push(item);
    acc[item.category].totalSize += item.itemSize;
    acc[item.category].count++;
    return acc;
  }, {});
  
  console.log(`\n📂 BY CATEGORY`);
  Object.entries(byCategory).forEach(([category, data]) => {
    console.log(`${category}: ${data.count} items, ${formatBytes(data.totalSize)}`);
    
    // Show sample data structure for largest item
    const largest = data.items[0];
    if (largest && largest.value) {
      console.log(`  Sample: ${largest.key.substring(0, 50)}... = ${largest.value.substring(0, 100)}...`);
      
      // Try to analyze JSON structure
      try {
        const parsed = JSON.parse(localStorage.getItem(largest.key) || '{}');
        if (typeof parsed === 'object') {
          if (Array.isArray(parsed)) {
            console.log(`    Structure: Array with ${parsed.length} items`);
            if (parsed.length > 0) {
              console.log(`    Sample item: ${JSON.stringify(parsed[0]).substring(0, 100)}...`);
            }
          } else {
            const keys = Object.keys(parsed);
            console.log(`    Structure: Object with ${keys.length} keys`);
            if (keys.length > 0) {
              const sampleKey = keys[0];
              console.log(`    Sample: "${sampleKey}" -> ${JSON.stringify(parsed[sampleKey]).substring(0, 100)}...`);
            }
          }
        }
      } catch (e) {
        console.log(`    Structure: Non-JSON data`);
      }
    }
  });
  
  // Group by dataset
  const byDataset = items.reduce((acc, item) => {
    if (!acc[item.datasetId]) {
      acc[item.datasetId] = { items: [], totalSize: 0, categories: new Set() };
    }
    acc[item.datasetId].items.push(item);
    acc[item.datasetId].totalSize += item.itemSize;
    acc[item.datasetId].categories.add(item.category);
    return acc;
  }, {});
  
  console.log(`\n🗂️  BY DATASET`);
  Object.entries(byDataset).forEach(([datasetId, data]) => {
    console.log(`Dataset ${datasetId}: ${data.items.length} items, ${formatBytes(data.totalSize)}`);
    console.log(`  Categories: ${Array.from(data.categories).join(', ')}`);
    
    // Show breakdown
    const breakdown = {};
    data.items.forEach(item => {
      if (!breakdown[item.category]) breakdown[item.category] = 0;
      breakdown[item.category] += item.itemSize;
    });
    
    Object.entries(breakdown).forEach(([cat, size]) => {
      console.log(`    ${cat}: ${formatBytes(size)}`);
    });
  });
  
  console.log(`\n🏆 TOP 10 LARGEST ITEMS`);
  items.slice(0, 10).forEach((item, i) => {
    console.log(`${i + 1}. ${item.key} (${item.category}): ${formatBytes(item.itemSize)}`);
  });
  
  // Efficiency analysis for classifications
  console.log(`\n⚡ CLASSIFICATION EFFICIENCY ANALYSIS`);
  const classificationItems = items.filter(item => 
    item.category === 'classifications' || 
    item.category === 'optimized_classifications' ||
    item.category === 'classification_classes'
  );
  
  const classificationsByDataset = {};
  classificationItems.forEach(item => {
    if (!classificationsByDataset[item.datasetId]) {
      classificationsByDataset[item.datasetId] = {};
    }
    classificationsByDataset[item.datasetId][item.category] = item;
  });
  
  Object.entries(classificationsByDataset).forEach(([datasetId, data]) => {
    console.log(`Dataset ${datasetId}:`);
    
    if (data.classifications) {
      try {
        const classData = JSON.parse(localStorage.getItem(data.classifications.key) || '{}');
        const imageCount = Object.keys(classData).length;
        const totalClassifications = Object.values(classData).flat().length;
        
        console.log(`  Legacy format: ${imageCount} images, ${totalClassifications} classifications`);
        console.log(`  Size: ${formatBytes(data.classifications.itemSize)}`);
        console.log(`  Bytes per image: ${(data.classifications.itemSize / imageCount).toFixed(1)}`);
        
        // Calculate redundancy
        const allClassNames = Object.values(classData).flat();
        const uniqueClasses = new Set(allClassNames);
        const redundancy = allClassNames.length - uniqueClasses.size;
        console.log(`  Class name redundancy: ${redundancy} duplicate strings`);
        
      } catch (e) {
        console.log(`  Error parsing legacy data`);
      }
    }
    
    if (data.optimized_classifications) {
      console.log(`  Optimized format: ${formatBytes(data.optimized_classifications.itemSize)}`);
      if (data.classifications) {
        const savings = ((data.classifications.itemSize - data.optimized_classifications.itemSize) / data.classifications.itemSize * 100);
        console.log(`  Space savings: ${savings.toFixed(1)}%`);
      }
    }
    
    if (data.classification_classes) {
      try {
        const classes = JSON.parse(localStorage.getItem(data.classification_classes.key) || '[]');
        console.log(`  Classes: ${classes.length} defined (${formatBytes(data.classification_classes.itemSize)})`);
      } catch (e) {
        console.log(`  Error parsing classes`);
      }
    }
  });
  
  // Recommendations
  console.log(`\n💡 OPTIMIZATION RECOMMENDATIONS`);
  
  const annotationSize = byCategory.annotations?.totalSize || 0;
  const savedAnnotationSize = byCategory.saved_annotations?.totalSize || 0;
  const classificationSize = byCategory.classifications?.totalSize || 0;
  
  if (annotationSize > 1024 * 1024) { // > 1MB
    console.log(`⚠️  Annotation data is large (${formatBytes(annotationSize)}). Consider:`);
    console.log(`   - Compress coordinate arrays`);
    console.log(`   - Store only essential metadata`);
    console.log(`   - Use server-side storage for large datasets`);
  }
  
  if (savedAnnotationSize > 512 * 1024) { // > 512KB
    console.log(`⚠️  Saved annotation backups are large (${formatBytes(savedAnnotationSize)}). Consider:`);
    console.log(`   - Limit to 3-5 most recent backups`);
    console.log(`   - Compress backup data`);
  }
  
  if (classificationSize > 0) {
    console.log(`✅ Classification data can be optimized (currently ${formatBytes(classificationSize)})`);
    console.log(`   - Use the new OptimizedClassificationStorage`);
    console.log(`   - Expected savings: 40-70%`);
  }
  
  console.log(`\n🧹 CLEANUP SUGGESTIONS`);
  const oldDatasets = Object.keys(byDataset).filter(id => id !== 'unknown');
  if (oldDatasets.length > 3) {
    console.log(`Consider cleaning data for unused datasets:`);
    oldDatasets.slice(3).forEach(id => {
      console.log(`   Dataset ${id}: ${formatBytes(byDataset[id].totalSize)}`);
    });
  }
  
  return {
    totalSize,
    items,
    byCategory,
    byDataset,
    formatBytes
  };
}

// Usage instructions
console.log('📋 USAGE INSTRUCTIONS:');
console.log('Run: comprehensiveStorageAnalysis()');
console.log('This will show you exactly what\'s using localStorage space.');
