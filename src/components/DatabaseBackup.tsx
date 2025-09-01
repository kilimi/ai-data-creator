import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { useApi } from '@/hooks/use-api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Download,
  Upload,
  Database,
  Archive,
  Info,
  AlertTriangle,
  CheckCircle,
  Loader2,
  HardDrive,
} from 'lucide-react';

interface DatabaseBackupProps {
  variant?: 'default' | 'compact';
}

interface DatabaseInfo {
  database_info: {
    projects: number;
    datasets: number;
    images: number;
    annotations: number;
    annotation_files: number;
    annotation_classes: number;
    image_collections: number;
    tasks: number;
    augmentations: number;
    dataset_groups: number;
    total_records: number;
  };
  timestamp: string;
}

export function DatabaseBackup({ variant = 'default' }: DatabaseBackupProps) {
  const { api } = useApi();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showInfoDialog, setShowInfoDialog] = useState(false);

  const loadDatabaseInfo = async () => {
    if (!api) return;
    
    setIsLoadingInfo(true);
    try {
      const response = await api.getDatabaseInfo();
      if (response.success && response.data) {
        setDbInfo(response.data);
      } else {
        toast({
          title: 'Error',
          description: response.error || 'Failed to load database info',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load database info',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingInfo(false);
    }
  };

  const handleExportDatabase = async () => {
    if (!api) return;
    
    setIsExporting(true);
    try {
      await api.exportDatabase();
      toast({
        title: 'Success',
        description: 'Database exported successfully',
      });
    } catch (error) {
      toast({
        title: 'Export Failed',
        description: error instanceof Error ? error.message : 'Failed to export database',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportWithFiles = async () => {
    if (!api) return;
    
    setIsExporting(true);
    try {
      await api.exportDatabaseWithFiles();
      toast({
        title: 'Success',
        description: 'Database and files exported successfully',
      });
    } catch (error) {
      toast({
        title: 'Export Failed',
        description: error instanceof Error ? error.message : 'Failed to export database with files',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportDatabase = async () => {
    if (!api || !selectedFile) return;
    
    setIsImporting(true);
    try {
      const response = await api.importDatabase(selectedFile);
      if (response.success) {
        toast({
          title: 'Success',
          description: 'Database imported successfully',
        });
        setShowImportDialog(false);
        setSelectedFile(null);
        // Reload the page to reflect changes
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        toast({
          title: 'Import Failed',
          description: response.error || 'Failed to import database',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Import Failed',
        description: error instanceof Error ? error.message : 'Failed to import database',
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type
      if (file.name.endsWith('.json') || file.name.endsWith('.zip')) {
        setSelectedFile(file);
      } else {
        toast({
          title: 'Invalid File',
          description: 'Please select a JSON or ZIP backup file',
          variant: 'destructive',
        });
      }
    }
  };

  if (variant === 'compact') {
    return (
      <div className="flex gap-2">
        <Dialog open={showInfoDialog} onOpenChange={setShowInfoDialog}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" onClick={loadDatabaseInfo}>
              <Info className="w-4 h-4 mr-2" />
              Info
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Database className="w-5 h-5" />
                Database Information
              </DialogTitle>
              <DialogDescription>
                Current database statistics and record counts
              </DialogDescription>
            </DialogHeader>
            
            {isLoadingInfo ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : dbInfo ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Projects:</span>
                      <Badge variant="secondary">{dbInfo.database_info.projects}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Datasets:</span>
                      <Badge variant="secondary">{dbInfo.database_info.datasets}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Images:</span>
                      <Badge variant="secondary">{dbInfo.database_info.images.toLocaleString()}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Annotations:</span>
                      <Badge variant="secondary">{dbInfo.database_info.annotations.toLocaleString()}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Tasks:</span>
                      <Badge variant="secondary">{dbInfo.database_info.tasks}</Badge>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Annotation Files:</span>
                      <Badge variant="secondary">{dbInfo.database_info.annotation_files}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Classes:</span>
                      <Badge variant="secondary">{dbInfo.database_info.annotation_classes}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Collections:</span>
                      <Badge variant="secondary">{dbInfo.database_info.image_collections}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Augmentations:</span>
                      <Badge variant="secondary">{dbInfo.database_info.augmentations}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Groups:</span>
                      <Badge variant="secondary">{dbInfo.database_info.dataset_groups}</Badge>
                    </div>
                  </div>
                </div>
                
                <div className="pt-4 border-t">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">Total Records:</span>
                    <Badge variant="default">{dbInfo.database_info.total_records.toLocaleString()}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Last updated: {new Date(dbInfo.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleExportDatabase} 
          disabled={isExporting}
        >
          {isExporting ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Download className="w-4 h-4 mr-2" />
          )}
          Export
        </Button>

        <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Upload className="w-4 h-4 mr-2" />
              Import
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Import Database
              </DialogTitle>
              <DialogDescription>
                Upload a backup file to restore your database
              </DialogDescription>
            </DialogHeader>
            
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Warning!</AlertTitle>
              <AlertDescription>
                This will completely replace your current database. All existing data will be lost. 
                Make sure to export a backup first if you want to keep your current data.
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              <div>
                <Label htmlFor="backup-file">Select Backup File</Label>
                <Input
                  id="backup-file"
                  type="file"
                  accept=".json,.zip"
                  onChange={handleFileSelect}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Accepts JSON database exports or ZIP files with database and files
                </p>
              </div>

              {selectedFile && (
                <div className="p-3 bg-muted rounded-lg">
                  <div className="flex items-center gap-2">
                    <HardDrive className="w-4 h-4" />
                    <span className="text-sm font-medium">{selectedFile.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-4">
                <Button
                  onClick={handleImportDatabase}
                  disabled={!selectedFile || isImporting}
                  className="flex-1"
                >
                  {isImporting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4 mr-2" />
                  )}
                  Import Database
                </Button>
                <Button variant="outline" onClick={() => setShowImportDialog(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="w-5 h-5" />
          Database Management
        </CardTitle>
        <CardDescription>
          Export, import, and manage your complete database including all projects, datasets, and files
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <h4 className="font-medium flex items-center gap-2">
              <Download className="w-4 h-4" />
              Export Options
            </h4>
            <div className="space-y-2">
              <Button
                variant="outline"
                onClick={handleExportDatabase}
                disabled={isExporting}
                className="w-full justify-start"
              >
                {isExporting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Database className="w-4 h-4 mr-2" />
                )}
                Export Database Only
              </Button>
              <p className="text-xs text-muted-foreground">
                Exports all database records as JSON (faster, smaller file)
              </p>
            </div>
            
            <div className="space-y-2">
              <Button
                variant="outline"
                onClick={handleExportWithFiles}
                disabled={isExporting}
                className="w-full justify-start"
              >
                {isExporting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Archive className="w-4 h-4 mr-2" />
                )}
                Export Database + Files
              </Button>
              <p className="text-xs text-muted-foreground">
                Exports database and all associated files as ZIP (complete backup)
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-medium flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Import & Info
            </h4>
            <div className="space-y-2">
              <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <Upload className="w-4 h-4 mr-2" />
                    Import Database
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Upload className="w-5 h-5" />
                      Import Database
                    </DialogTitle>
                    <DialogDescription>
                      Upload a backup file to restore your database
                    </DialogDescription>
                  </DialogHeader>
                  
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Warning!</AlertTitle>
                    <AlertDescription>
                      This will completely replace your current database. All existing data will be lost.
                    </AlertDescription>
                  </Alert>

                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="backup-file">Select Backup File</Label>
                      <Input
                        id="backup-file"
                        type="file"
                        accept=".json,.zip"
                        onChange={handleFileSelect}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Accepts JSON database exports or ZIP files with database and files
                      </p>
                    </div>

                    {selectedFile && (
                      <div className="p-3 bg-muted rounded-lg">
                        <div className="flex items-center gap-2">
                          <HardDrive className="w-4 h-4" />
                          <span className="text-sm font-medium">{selectedFile.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    )}

                    <div className="flex gap-2 pt-4">
                      <Button
                        onClick={handleImportDatabase}
                        disabled={!selectedFile || isImporting}
                        className="flex-1"
                      >
                        {isImporting ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <CheckCircle className="w-4 h-4 mr-2" />
                        )}
                        Import Database
                      </Button>
                      <Button variant="outline" onClick={() => setShowImportDialog(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              <p className="text-xs text-muted-foreground">
                Restore from a previous backup (JSON or ZIP)
              </p>
            </div>

            <div className="space-y-2">
              <Dialog open={showInfoDialog} onOpenChange={setShowInfoDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" onClick={loadDatabaseInfo} className="w-full justify-start">
                    <Info className="w-4 h-4 mr-2" />
                    Database Info
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Database className="w-5 h-5" />
                      Database Information
                    </DialogTitle>
                    <DialogDescription>
                      Current database statistics and record counts
                    </DialogDescription>
                  </DialogHeader>
                  
                  {isLoadingInfo ? (
                    <div className="flex items-center justify-center p-8">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : dbInfo ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-3">
                          <h4 className="font-medium text-sm">Core Data</h4>
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Projects:</span>
                              <Badge variant="secondary">{dbInfo.database_info.projects}</Badge>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Datasets:</span>
                              <Badge variant="secondary">{dbInfo.database_info.datasets}</Badge>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Images:</span>
                              <Badge variant="secondary">{dbInfo.database_info.images.toLocaleString()}</Badge>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Annotations:</span>
                              <Badge variant="secondary">{dbInfo.database_info.annotations.toLocaleString()}</Badge>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Tasks:</span>
                              <Badge variant="secondary">{dbInfo.database_info.tasks}</Badge>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <h4 className="font-medium text-sm">Supporting Data</h4>
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Annotation Files:</span>
                              <Badge variant="secondary">{dbInfo.database_info.annotation_files}</Badge>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Classes:</span>
                              <Badge variant="secondary">{dbInfo.database_info.annotation_classes}</Badge>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Collections:</span>
                              <Badge variant="secondary">{dbInfo.database_info.image_collections}</Badge>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Augmentations:</span>
                              <Badge variant="secondary">{dbInfo.database_info.augmentations}</Badge>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Groups:</span>
                              <Badge variant="secondary">{dbInfo.database_info.dataset_groups}</Badge>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="pt-4 border-t">
                        <div className="flex justify-between items-center">
                          <span className="font-medium">Total Records:</span>
                          <Badge variant="default" className="text-lg px-3 py-1">
                            {dbInfo.database_info.total_records.toLocaleString()}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          Last updated: {new Date(dbInfo.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </DialogContent>
              </Dialog>
              <p className="text-xs text-muted-foreground">
                View current database statistics
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
