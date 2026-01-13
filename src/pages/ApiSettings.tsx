import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertTriangle, Database, Download, Upload, Trash2, Settings as SettingsIcon, CheckCircle2, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { API_CONFIG } from "@/config/api";
import { useToast } from "@/components/ui/use-toast";
import { ApiClient } from "@/utils/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Dataset } from "@/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { DatabaseManager } from "@/components/DatabaseManager";
import { Separator } from "@/components/ui/separator";

export const ApiSettings = () => {
  const { toast } = useToast();
  const [apiUrl, setApiUrl] = useState(API_CONFIG.baseUrl);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [isLoadingDatasets, setIsLoadingDatasets] = useState(false);
  const [showDatasetsDialog, setShowDatasetsDialog] = useState(false);

  useEffect(() => {
    // Check connection on component mount
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      const apiClient = new ApiClient({ baseUrl: API_CONFIG.baseUrl });
      const result = await apiClient.testConnection();
      
      if (result.success) {
        setIsConnected(true);
        setTestResult("Connection successful. Your FastAPI server is accessible.");
      } else {
        setIsConnected(false);
        setTestResult(`Connection failed: ${result.error}`);
      }
    } catch (error) {
      setIsConnected(false);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setTestResult(`Connection error: ${errorMessage}`);
    }
  };

  const handleTestConnection = async () => {
    setIsLoading(true);
    try {
      const apiClient = new ApiClient({ baseUrl: apiUrl });
      const result = await apiClient.testConnection();
      
      if (result.success) {
        setIsConnected(true);
        setTestResult("Connection successful. Your FastAPI server is accessible.");
        toast({
          title: "Connection successful",
          description: "Your FastAPI connection is working correctly",
        });
      } else {
        setIsConnected(false);
        setTestResult(`Connection failed: ${result.error}`);
        toast({
          title: "Connection failed",
          description: result.error || "Could not connect to the API",
          variant: "destructive",
        });
      }
    } catch (error) {
      setIsConnected(false);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setTestResult(`Connection error: ${errorMessage}`);
      toast({
        title: "Connection error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Load datasets when connected
    if (isConnected) {
      loadDatasets();
    }
  }, [isConnected]);

  const loadDatasets = async () => {
    setIsLoadingDatasets(true);
    try {
      const apiClient = new ApiClient({ ...API_CONFIG, baseUrl: apiUrl });
      const response = await apiClient.getDatasets();
      
      if (response.success) {
        // Handle both array and null responses
        setDatasets(response.data || []);
      } else {
        const errorMsg = response.error || "Failed to fetch datasets";
        console.error('Failed to load datasets:', errorMsg);
        // Don't throw - just log, so the UI doesn't break
        setDatasets([]);
      }
    } catch (error) {
      console.error('Failed to load datasets:', error);
      // Set empty array on error so UI doesn't break
      setDatasets([]);
    } finally {
      setIsLoadingDatasets(false);
    }
  };

  const handleGetAllDatasets = async () => {
    await loadDatasets();
    setShowDatasetsDialog(true);
  };

  const saveSettings = () => {
    // Save the API URL to localStorage
    localStorage.setItem("apiBaseUrl", apiUrl);
    
    toast({
      title: "Settings saved",
      description: "API URL has been updated. Reloading app to apply changes.",
    });
    
    // Force a page reload to apply the new API URL
    setTimeout(() => {
      window.location.href = "/";
    }, 1000);
  };

  return (
    <div className="min-h-screen pb-16 bg-gradient-to-br from-background via-background to-muted/20">
      <Navbar />
      
      <main className="container max-w-5xl pt-24 px-6 animate-fade-in">
        {/* Header */}
        <div className="mb-8">
          <Button variant="ghost" asChild className="mb-4 -ml-3">
            <Link to="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              Back to Projects
            </Link>
          </Button>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-3 rounded-xl bg-primary/10">
              <SettingsIcon className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-4xl font-bold tracking-tight">Settings</h1>
              <p className="text-muted-foreground mt-1">
                Manage your application configuration and data
              </p>
            </div>
          </div>
        </div>

        {/* API Connection Card */}
        <Card className="mb-6 border-2 shadow-lg">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              <CardTitle>API Connection</CardTitle>
            </div>
            <CardDescription>
              Configure your FastAPI backend endpoint
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              <Label htmlFor="api-url" className="text-base font-medium">Backend URL</Label>
              <div className="flex gap-2">
                <Input 
                  id="api-url"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="http://localhost:9999"
                  className="font-mono text-sm"
                />
                <Button 
                  onClick={handleTestConnection}
                  disabled={isLoading}
                  variant="outline"
                  className="whitespace-nowrap"
                >
                  {isLoading ? "Testing..." : "Test"}
                </Button>
              </div>
            </div>
            
            {isConnected !== null && (
              <div className={`flex items-start gap-3 p-4 rounded-lg border-2 ${
                isConnected 
                  ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900" 
                  : "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900"
              }`}>
                {isConnected ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${isConnected ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>
                    {isConnected ? "Connection Active" : "Connection Failed"}
                  </p>
                  <p className={`text-xs mt-1 ${isConnected ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {testResult}
                  </p>
                </div>
              </div>
            )}
            
            <div className="flex justify-between items-center pt-2">
              <Button 
                variant="secondary"
                onClick={handleGetAllDatasets}
                disabled={isLoadingDatasets || !isConnected}
                size="sm"
              >
                {isLoadingDatasets ? "Loading..." : "View All Datasets"}
              </Button>
              <Button 
                onClick={saveSettings}
                disabled={isLoading}
              >
                Save Changes
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Data Management Card */}
        <Card className="mb-6 border-2 shadow-lg">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5 text-primary" />
              <CardTitle>Data Management</CardTitle>
            </div>
            <CardDescription>
              Backup and restore your workspace data
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg border-2 bg-gradient-to-br from-blue-50/50 to-transparent dark:from-blue-950/20 hover:border-primary transition-colors">
                <div className="flex items-start gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <Download className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-base mb-1">Export Data</h3>
                    <p className="text-sm text-muted-foreground">
                      Download your projects, datasets, and annotations
                    </p>
                  </div>
                </div>
                <DatabaseManager showImport={false} showClear={false} showInfo={false} />
              </div>
              
              <div className="p-4 rounded-lg border-2 bg-gradient-to-br from-purple-50/50 to-transparent dark:from-purple-950/20 hover:border-primary transition-colors">
                <div className="flex items-start gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                    <Upload className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-base mb-1">Import Data</h3>
                    <p className="text-sm text-muted-foreground">
                      Restore from a previous backup file
                    </p>
                  </div>
                </div>
                <DatabaseManager showExport={false} showClear={false} showInfo={false} />
              </div>
            </div>
            
            <Separator className="my-4" />
            
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Database className="h-4 w-4" />
                <span>{datasets.length} datasets available</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-2 border-red-200 bg-gradient-to-br from-red-50/50 to-transparent dark:from-red-950/20 dark:border-red-900 shadow-lg">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <CardTitle className="text-red-600 dark:text-red-400">Danger Zone</CardTitle>
                <CardDescription className="text-red-600/80 dark:text-red-400/80">
                  Irreversible actions - proceed with caution
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="p-4 rounded-lg border-2 border-red-200 dark:border-red-900 bg-background/50">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-700 dark:text-red-300">Clear All Data</p>
                    <p className="text-xs text-red-600/90 dark:text-red-400/90 mt-1">
                      Permanently delete all projects, datasets, annotations, and files
                    </p>
                  </div>
                </div>
                <DatabaseManager showExport={false} showImport={false} showClear={true} showInfo={false} />
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Datasets Dialog */}
      <Dialog open={showDatasetsDialog} onOpenChange={setShowDatasetsDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>All Datasets</DialogTitle>
            <DialogDescription>
              {datasets.length} datasets found in the database
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 mt-4">
            <div className="space-y-4 pr-4">
              {datasets.map((dataset) => (
                <div key={dataset.id} className="p-4 rounded-lg border bg-card">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-medium">{dataset.name}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2">{dataset.description}</p>
                    </div>
                  </div>
                  <div className="flex gap-4 text-sm text-muted-foreground">
                    <span>{dataset.image_count} images</span>
                    <span>{dataset.annotation_count} annotations</span>
                    <span>Created {new Date(dataset.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
              {datasets.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No datasets found
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
};

