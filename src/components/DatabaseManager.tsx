import { useState, useRef } from "react";
import { Download, Upload, Database, AlertTriangle, Info, FileArchive, Trash2, Skull } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useApi } from "@/hooks/use-api";

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

interface DatabaseManagerProps {
  showExport?: boolean;
  showImport?: boolean;
  showClear?: boolean;
  showInfo?: boolean;
}

export function DatabaseManager({ 
  showExport = true, 
  showImport = true, 
  showClear = false, 
  showInfo = true 
}: DatabaseManagerProps = {}) {
  const { api } = useApi();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [databaseInfo, setDatabaseInfo] = useState<DatabaseInfo | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState("");
  const [importMode, setImportMode] = useState<'json' | 'zip'>('zip');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDatabaseInfo = async () => {
    if (!api) return;
    
    try {
      const response = await api.getDatabaseInfo();
      if (response.success && response.data) {
        setDatabaseInfo(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch database info:', error);
    }
  };

  const handleExportDatabase = async (includeFiles: boolean = true) => {
    if (!api) {
      toast({
        title: "Error",
        description: "API not available",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);
    setExportProgress(0);
    
    try {
      const onProgress = (progress: number) => {
        setExportProgress(progress);
      };

      if (includeFiles) {
        await api.exportDatabaseWithFiles(onProgress);
      } else {
        await api.exportDatabase(onProgress);
      }
      
      toast({
        title: "Export Complete",
        description: `Database export ${includeFiles ? 'with files' : 'data only'} completed successfully.`,
      });
      setShowExportDialog(false);
    } catch (error) {
      console.error('Export failed:', error);
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Failed to export database",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const handleImportDatabase = async (file: File) => {
    if (!api) {
      toast({
        title: "Error",
        description: "API not available",
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);
    try {
      const response = await api.importDatabase(file);
      
      if (response.success) {
        toast({
          title: "Import Successful",
          description: response.data?.message || "Database imported successfully",
        });
        setShowImportDialog(false);
        // Refresh the page to show new data
        window.location.reload();
      } else {
        throw new Error(response.error || "Import failed");
      }
    } catch (error) {
      console.error('Import failed:', error);
      toast({
        title: "Import Failed",
        description: error instanceof Error ? error.message : "Failed to import database",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type
      const isValidFile = file.name.endsWith('.json') || file.name.endsWith('.zip');
      if (!isValidFile) {
        toast({
          title: "Invalid File",
          description: "Please select a JSON or ZIP file",
          variant: "destructive",
        });
        return;
      }

      // Set import mode based on file type
      setImportMode(file.name.endsWith('.zip') ? 'zip' : 'json');
      
      // Show confirmation dialog or import directly
      handleImportDatabase(file);
    }
  };

  const handleClearDatabase = async () => {
    if (!api) {
      toast({
        title: "Error",
        description: "API not available",
        variant: "destructive",
      });
      return;
    }

    if (clearConfirmText !== "DELETE ALL DATA") {
      toast({
        title: "Confirmation Required",
        description: "Please type 'DELETE ALL DATA' to confirm",
        variant: "destructive",
      });
      return;
    }

    setIsClearing(true);
    try {
      const response = await api.clearDatabase();
      
      if (response.success) {
        toast({
          title: "Database Cleared",
          description: `Successfully deleted ${response.data?.total_records_deleted || 0} records and ${response.data?.files_removed || 0} files`,
        });
        setShowClearDialog(false);
        setClearConfirmText("");
        // Refresh the page to show empty state
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        throw new Error(response.error || "Clear operation failed");
      }
    } catch (error) {
      console.error('Clear failed:', error);
      toast({
        title: "Clear Failed",
        description: error instanceof Error ? error.message : "Failed to clear database",
        variant: "destructive",
      });
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {/* Export Dialog */}
      {showExport && (
        <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogTrigger asChild>
          <Button 
            variant="outline" 
            size="sm" 
            className="flex items-center gap-2"
            onClick={fetchDatabaseInfo}
          >
            <Download className="w-4 h-4" />
            Export Database
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="w-5 h-5" />
              Export Database
            </DialogTitle>
            <DialogDescription>
              Export your entire database with all projects, datasets, and annotations.
            </DialogDescription>
          </DialogHeader>
          
          {databaseInfo && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Database Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Projects:</span>
                    <Badge variant="secondary">{databaseInfo.database_info.projects}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Datasets:</span>
                    <Badge variant="secondary">{databaseInfo.database_info.datasets}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Images:</span>
                    <Badge variant="secondary">{databaseInfo.database_info.images.toLocaleString()}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Annotations:</span>
                    <Badge variant="secondary">{databaseInfo.database_info.annotations.toLocaleString()}</Badge>
                  </div>
                </div>
                <Separator />
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Total Records:</span>
                  <Badge className="bg-primary">{databaseInfo.database_info.total_records.toLocaleString()}</Badge>
                </div>
              </CardContent>
            </Card>
          )}
          
          {isExporting && (
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Export Progress</span>
                    <span className="text-sm text-muted-foreground">
                      {exportProgress === 100 ? "100%" : `${exportProgress}%`}
                    </span>
                  </div>
                  <Progress value={exportProgress} className="w-full" />
                  <p className="text-xs text-muted-foreground text-center">
                    {exportProgress < 100 
                      ? "Preparing and downloading your database..." 
                      : "Export complete! Your download should start shortly."}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
          
          <DialogFooter className="flex-col gap-2">
            <Button 
              onClick={() => handleExportDatabase(true)}
              disabled={isExporting}
              className="w-full"
            >
              <FileArchive className="w-4 h-4 mr-2" />
              {isExporting ? "Exporting..." : "Export Complete Archive (ZIP)"}
            </Button>
            <Button 
              variant="outline"
              onClick={() => handleExportDatabase(false)}
              disabled={isExporting}
              className="w-full"
            >
              <Database className="w-4 h-4 mr-2" />
              {isExporting ? "Exporting..." : "Export Database Only (JSON)"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}

      {/* Import Dialog */}
      {showImport && (
        <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogTrigger asChild>
          <Button 
            variant="outline" 
            size="sm" 
            className="flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Import Database
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Import Database
            </DialogTitle>
            <DialogDescription>
              Import a previously exported database. This will replace all existing data.
            </DialogDescription>
          </DialogHeader>
          
          <Card className="border-destructive/20 bg-destructive/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-destructive mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">Warning</p>
                  <p className="text-sm text-muted-foreground">
                    This action will completely replace your current database. All existing projects, 
                    datasets, and annotations will be permanently deleted.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Select Import File</label>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".json,.zip"
                onChange={handleFileSelect}
                disabled={isImporting}
                className="cursor-pointer"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Supported formats: JSON (database only) or ZIP (complete archive)
              </p>
            </div>
          </div>
          
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowImportDialog(false)}
              disabled={isImporting}
            >
              Cancel
            </Button>
            <Button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isImporting ? "Importing..." : "Choose File & Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}

      {/* Clear Database Dialog */}
      {showClear && (
        <Dialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <DialogTrigger asChild>
          <Button 
            variant="destructive" 
            size="sm" 
            className="flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Clear Database
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Skull className="w-5 h-5" />
              Clear Database - DANGER ZONE
            </DialogTitle>
            <DialogDescription>
              This will permanently delete ALL data and files. This action cannot be undone!
            </DialogDescription>
          </DialogHeader>
          
          <Card className="border-destructive bg-destructive/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Skull className="w-5 h-5 text-destructive mt-0.5" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-destructive">PERMANENT DATA DESTRUCTION</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• All projects and datasets will be deleted</li>
                    <li>• All images and annotations will be removed</li>
                    <li>• All physical files will be erased</li>
                    <li>• This action is irreversible</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {databaseInfo && (
            <Card className="border-orange-200 bg-orange-50">
              <CardContent className="pt-6">
                <p className="text-sm font-medium text-orange-800 mb-2">Data to be destroyed:</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-orange-700">
                  <div>{databaseInfo.database_info.projects} Projects</div>
                  <div>{databaseInfo.database_info.datasets} Datasets</div>
                  <div>{databaseInfo.database_info.images.toLocaleString()} Images</div>
                  <div>{databaseInfo.database_info.annotations.toLocaleString()} Annotations</div>
                </div>
                <div className="mt-2 pt-2 border-t border-orange-200">
                  <div className="text-sm font-medium text-orange-800">
                    Total: {databaseInfo.database_info.total_records.toLocaleString()} records
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block text-destructive">
                Type "DELETE ALL DATA" to confirm:
              </label>
              <Input
                value={clearConfirmText}
                onChange={(e) => setClearConfirmText(e.target.value)}
                placeholder="DELETE ALL DATA"
                disabled={isClearing}
                className="font-mono"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowClearDialog(false);
                setClearConfirmText("");
              }}
              disabled={isClearing}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleClearDatabase}
              disabled={isClearing || clearConfirmText !== "DELETE ALL DATA"}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isClearing ? (
                <>
                  <Skull className="w-4 h-4 mr-2 animate-pulse" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  DESTROY ALL DATA
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}

      {/* Quick info button */}
      {showInfo && (
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={fetchDatabaseInfo}
          className="flex items-center gap-2"
        >
          <Info className="w-4 h-4" />
          <span className="sr-only">Database Info</span>
        </Button>
      )}
    </div>
  );
}
