# File Structure Migration

This document explains the updated file storage structure for the LAI project.

## New File Structure

Starting from this update, files are organized using the following structure:

```
projects/
├── {project_id}/
│   ├── {dataset_id}/
│   │   ├── images/
│   │   │   ├── image1.jpg
│   │   │   ├── image2.png
│   │   │   └── ...
│   │   └── annotations/
│   │       ├── annotation1.json
│   │       ├── annotation2.txt
│   │       └── ...
│   └── {another_dataset_id}/
│       ├── images/
│       └── annotations/
└── {another_project_id}/
    └── ...
```

## Previous Structure (Deprecated)

The old structure was:

```
data/
└── images/
    ├── {dataset_id}/
    │   ├── image1.jpg
    │   ├── image2.png
    │   └── ...
    └── {another_dataset_id}/
        └── ...
```

## Benefits of New Structure

1. **Better Organization**: Files are organized by project first, then dataset
2. **Separation of Concerns**: Images and annotations have dedicated folders
3. **Scalability**: Easier to manage large numbers of projects and datasets
4. **Consistency**: Augmented datasets already use this structure
5. **Backup/Migration**: Easier to backup or migrate specific projects

## Migration Process

### Automatic Migration

1. **File Migration**: Run the migration script to move existing files:
   ```bash
   cd backend
   python migrate_file_structure.py
   ```

2. **URL Updates**: The script will also update database URLs to point to the new locations

### Manual Verification

After migration, verify that:
1. Files exist in the new `projects/{project_id}/{dataset_id}/images/` locations
2. Images load correctly in the web interface
3. Augmentation processes work with both old and new file locations

## Backward Compatibility

The system maintains backward compatibility:
- Image deletion checks both old and new locations
- Augmentation processes can read from both old and new structures
- Static file serving is available for both `/data/` and `/projects/` paths

## Implementation Details

### Backend Changes

1. **Upload Endpoints**: 
   - `POST /datasets/{dataset_id}/images` now saves to `projects/{project_id}/{dataset_id}/images/`
   - `POST /datasets/{dataset_id}/import-annotations` now saves to `projects/{project_id}/{dataset_id}/annotations/`

2. **Static File Serving**:
   - Added `/projects/` mount point in FastAPI
   - Existing `/data/` mount point remains for backward compatibility

3. **File Deletion**:
   - Checks new location first, falls back to old location
   - Ensures proper cleanup of physical files

### Database Schema

No database schema changes were required. The existing `url` and `thumbnail_url` fields in the `images` table are updated to use the new path format.

### URL Format

- **Old**: `/data/images/{dataset_id}/{filename}`
- **New**: `/projects/{project_id}/{dataset_id}/images/{filename}`

## Configuration

### Required Directories

The backend automatically creates these directories on startup:
- `data/` (for backward compatibility)
- `projects/` (for new structure)

### Static File Mounts

FastAPI serves static files from:
- `/data/` → `data/` directory
- `/projects/` → `projects/` directory

## Troubleshooting

### Files Not Loading

1. Check file permissions on the `projects/` directory
2. Verify the migration script ran successfully
3. Check FastAPI logs for static file serving errors

### Migration Issues

1. Ensure you run the migration script from the `backend/` directory
2. Check that the database connection is working
3. Verify sufficient disk space for file copying

### Development Setup

For new development environments:
1. The new structure will be used automatically
2. No migration is needed for fresh installations
3. Ensure the `projects/` directory has write permissions

## Future Considerations

1. **Storage Backends**: The new structure will make it easier to implement cloud storage backends
2. **Project Export**: Individual projects can be easily exported/imported
3. **Permissions**: Project-based access control will be simpler to implement
4. **Backup Strategies**: Project-level backups become more feasible
