// Diagnostic script to check annotation-image matching
// Run this in browser console when viewing dataset 20

console.log('=== ANNOTATION DIAGNOSTIC ===');

// Load the annotation file
fetch('c:/Users/Lilita/Downloads/WR_OR_copy2_export (4).json')
  .then(res => res.json())
  .then(data => {
    console.log('\n📄 Annotation File Info:');
    console.log(`- Total images referenced: ${data.images.length}`);
    console.log(`- Total annotations: ${data.annotations.length}`);
    console.log(`- Categories: ${data.categories.map(c => c.name).join(', ')}`);
    
    console.log('\n🖼️ First 10 image filenames in annotation file:');
    data.images.slice(0, 10).forEach(img => {
      console.log(`  - ${img.file_name} (COCO ID: ${img.id})`);
    });
    
    console.log('\n📊 Annotations per image (first 10):');
    const annotationsPerImage = {};
    data.annotations.forEach(ann => {
      annotationsPerImage[ann.image_id] = (annotationsPerImage[ann.image_id] || 0) + 1;
    });
    Object.entries(annotationsPerImage).slice(0, 10).forEach(([imgId, count]) => {
      const imgInfo = data.images.find(img => img.id == imgId);
      console.log(`  - ${imgInfo?.file_name || 'Unknown'} (ID ${imgId}): ${count} annotations`);
    });
    
    console.log('\n⚠️ To fix the visibility issue:');
    console.log('1. Check if these images exist in dataset 20 with EXACT same filenames');
    console.log('2. If not, upload images with matching filenames OR update the JSON');
    console.log('3. After fixing, re-import the annotation file');
  })
  .catch(err => {
    console.error('Could not load annotation file:', err);
    console.log('\n💡 Alternative: Paste this in console while on the dataset page:');
    console.log(`
// Check current dataset images
const images = /* images array from React state */;
console.log('Current dataset images:', images?.map(img => img.fileName).slice(0, 10));
    `);
  });
