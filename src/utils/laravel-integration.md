
# Laravel Integration Guide

This guide explains how to integrate this React application with a Laravel backend.

## Laravel API Setup

1. First, create the necessary routes in your Laravel application's `routes/api.php`:

```php
<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\API\DatasetController;
use App\Http\Controllers\API\ImageController;
use App\Http\Controllers\API\AnnotationController;

// API routes (prefix /api is already applied by the RouteServiceProvider)
Route::middleware('api')->group(function () {
    // Dataset routes
    Route::get('/datasets', [DatasetController::class, 'index']);
    Route::get('/datasets/{id}', [DatasetController::class, 'show']);
    Route::post('/datasets', [DatasetController::class, 'store']);
    Route::post('/datasets/{id}', [DatasetController::class, 'update']);
    Route::delete('/datasets/{id}', [DatasetController::class, 'destroy']);
    
    // Image routes
    Route::get('/datasets/{datasetId}/images', [ImageController::class, 'index']);
    Route::post('/datasets/{datasetId}/images', [ImageController::class, 'store']);
    Route::delete('/datasets/{datasetId}/images/{id}', [ImageController::class, 'destroy']);
    
    // Annotation routes
    Route::get('/datasets/{datasetId}/images/{imageId}/annotations', [AnnotationController::class, 'index']);
    Route::post('/datasets/{datasetId}/annotations/coco', [AnnotationController::class, 'uploadCoco']);
});
```

2. Create the necessary controllers in your Laravel application:

### Dataset Controller Example

```php
<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Models\Dataset;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class DatasetController extends Controller
{
    public function index()
    {
        $datasets = Dataset::with('tags')->get();
        
        return response()->json([
            'success' => true,
            'data' => $datasets
        ]);
    }
    
    public function show($id)
    {
        $dataset = Dataset::with('tags')->findOrFail($id);
        
        return response()->json([
            'success' => true,
            'data' => $dataset
        ]);
    }
    
    public function store(Request $request)
    {
        $data = json_decode($request->input('data'), true);
        
        $dataset = new Dataset();
        $dataset->name = $data['name'];
        $dataset->description = $data['description'];
        $dataset->type = $data['type'] ?? 'classification';
        
        // Handle logo file upload
        if ($request->hasFile('logo')) {
            $file = $request->file('logo');
            $path = $file->store('thumbnails', 'public');
            $dataset->thumbnailUrl = Storage::url($path);
        }
        
        $dataset->save();
        
        // Handle tags
        if (isset($data['tags']) && is_array($data['tags'])) {
            $dataset->syncTags($data['tags']); // Implement tag syncing in your model
        }
        
        return response()->json([
            'success' => true,
            'data' => $dataset->load('tags')
        ]);
    }
    
    public function update(Request $request, $id)
    {
        $dataset = Dataset::findOrFail($id);
        $data = json_decode($request->input('data'), true);
        
        $dataset->name = $data['name'] ?? $dataset->name;
        $dataset->description = $data['description'] ?? $dataset->description;
        $dataset->type = $data['type'] ?? $dataset->type;
        
        // Handle logo file upload
        if ($request->hasFile('logo')) {
            // Remove old thumbnail if exists
            if ($dataset->thumbnailUrl) {
                $oldPath = str_replace(Storage::url(''), '', $dataset->thumbnailUrl);
                Storage::disk('public')->delete($oldPath);
            }
            
            $file = $request->file('logo');
            $path = $file->store('thumbnails', 'public');
            $dataset->thumbnailUrl = Storage::url($path);
        }
        
        $dataset->save();
        
        // Handle tags
        if (isset($data['tags']) && is_array($data['tags'])) {
            $dataset->syncTags($data['tags']); // Implement tag syncing in your model
        }
        
        return response()->json([
            'success' => true,
            'data' => $dataset->load('tags')
        ]);
    }
    
    public function destroy($id)
    {
        $dataset = Dataset::findOrFail($id);
        
        // Delete associated files (implement with appropriate relations)
        // Delete images, annotations, etc.
        
        $dataset->delete();
        
        return response()->json([
            'success' => true,
            'data' => true
        ]);
    }
}
```

### Annotation Controller Example

```php
<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Models\Dataset;
use App\Models\Annotation;
use App\Models\Category;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class AnnotationController extends Controller
{
    public function index($datasetId, $imageId)
    {
        $annotations = Annotation::where('dataset_id', $datasetId)
            ->where('image_id', $imageId)
            ->get();
            
        return response()->json([
            'success' => true,
            'data' => $annotations
        ]);
    }
    
    public function uploadCoco(Request $request, $datasetId)
    {
        $request->validate([
            'annotation' => 'required|file|mimes:json'
        ]);
        
        $dataset = Dataset::findOrFail($datasetId);
        $file = $request->file('annotation');
        
        // Read the JSON file
        $content = file_get_contents($file->getPathname());
        $cocoData = json_decode($content, true);
        
        // Validate COCO format
        if (!isset($cocoData['categories']) || !isset($cocoData['annotations'])) {
            return response()->json([
                'success' => false,
                'error' => 'Invalid COCO format'
            ], 400);
        }
        
        // Process categories
        $categoryMap = [];
        $classStats = [];
        
        foreach ($cocoData['categories'] as $categoryData) {
            // Create or find the category
            $category = Category::firstOrCreate(
                ['name' => $categoryData['name']],
                [
                    'dataset_id' => $datasetId,
                    'color' => $this->generateRandomColor()
                ]
            );
            
            $categoryMap[$categoryData['id']] = $category->id;
            $classStats[$category->id] = [
                'className' => $category->name,
                'count' => 0,
                'color' => $category->color
            ];
        }
        
        // Process annotations
        foreach ($cocoData['annotations'] as $annotationData) {
            $categoryId = $categoryMap[$annotationData['category_id']] ?? null;
            
            if ($categoryId) {
                // Count annotations per category
                $classStats[$categoryId]['count']++;
                
                // Here you would add the actual annotations to your database
                // This depends on your specific data model
            }
        }
        
        // Format the statistics for the response
        $statistics = array_values($classStats);
        
        // Sort by count (descending)
        usort($statistics, function($a, $b) {
            return $b['count'] - $a['count'];
        });
        
        return response()->json([
            'success' => true,
            'data' => $statistics
        ]);
    }
    
    private function generateRandomColor()
    {
        $hue = mt_rand(0, 359);
        return "hsl({$hue}, 70%, 50%)";
    }
}
```

## React Integration

In your React application, you can use the API client we've created:

```tsx
import { useApi } from '@/hooks/use-api';
import { useState, useEffect } from 'react';
import { Dataset } from '@/types';

function DatasetList() {
  const { api, isConfigured } = useApi({
    baseUrl: 'https://your-laravel-app.com',
    apiKey: 'your-api-key-if-needed'
  });
  
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    if (isConfigured && api) {
      const fetchDatasets = async () => {
        const response = await api.getDatasets();
        if (response.success && response.data) {
          setDatasets(response.data);
        }
        setLoading(false);
      };
      
      fetchDatasets();
    }
  }, [api, isConfigured]);
  
  // Render your component using the datasets...
}
```

## Laravel Database Migrations

Here are example migrations for your Laravel application:

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateDatasetsTable extends Migration
{
    public function up()
    {
        Schema::create('datasets', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->text('description')->nullable();
            $table->enum('type', ['classification', 'segmentation', 'panomatic'])->default('classification');
            $table->string('thumbnailUrl')->nullable();
            $table->timestamps();
        });
    }

    public function down()
    {
        Schema::dropIfExists('datasets');
    }
}
```

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateImagesTable extends Migration
{
    public function up()
    {
        Schema::create('images', function (Blueprint $table) {
            $table->id();
            $table->foreignId('dataset_id')->constrained()->onDelete('cascade');
            $table->string('fileName');
            $table->unsignedInteger('fileSize');
            $table->unsignedInteger('width');
            $table->unsignedInteger('height');
            $table->string('url');
            $table->string('thumbnailUrl');
            $table->timestamps();
        });
    }

    public function down()
    {
        Schema::dropIfExists('images');
    }
}
```

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateCategoriesTable extends Migration
{
    public function up()
    {
        Schema::create('categories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('dataset_id')->constrained()->onDelete('cascade');
            $table->string('name');
            $table->string('color');
            $table->timestamps();
        });
    }

    public function down()
    {
        Schema::dropIfExists('categories');
    }
}
```

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateAnnotationsTable extends Migration
{
    public function up()
    {
        Schema::create('annotations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('dataset_id')->constrained()->onDelete('cascade');
            $table->foreignId('image_id')->constrained()->onDelete('cascade');
            $table->foreignId('category_id')->constrained()->onDelete('cascade');
            $table->json('bbox')->nullable(); // [x, y, width, height]
            $table->json('segmentation')->nullable(); // COCO format segmentation
            $table->unsignedFloat('area')->nullable();
            $table->timestamps();
        });
    }

    public function down()
    {
        Schema::dropIfExists('annotations');
    }
}
```
