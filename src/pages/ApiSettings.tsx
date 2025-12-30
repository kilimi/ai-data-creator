import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertTriangle } from "lucide-react";
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

export const ApiSettings = () => {
  const { toast } = useToast();
  const [apiUrl, setApiUrl] = useState(API_CONFIG.baseUrl);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showDatasetsDialog, setShowDatasetsDialog] = useState(false);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [isLoadingDatasets, setIsLoadingDatasets] = useState(false);
  const [databaseInfo, setDatabaseInfo] = useState<{
    database_name: string;
    database_type: string;
    database_host: string;
  } | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);

  useEffect(() => {
    // Check connection on component mount
    checkConnection();
    loadDatabaseInfo();
  }, []);

  const loadDatabaseInfo = async () => {
    try {
      const apiClient = new ApiClient({ baseUrl: apiUrl });
      const response = await apiClient.getDatabaseConnectionInfo();
      
      if (response.success && response.data) {
        setDatabaseInfo(response.data);
      }
    } catch (error) {
      console.error('Failed to load database info:', error);
    }
  };

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
      
      if (response.success && response.data) {
        setDatasets(response.data);
      } else {
        throw new Error(response.error || "Failed to fetch datasets");
      }
    } catch (error) {
      console.error('Failed to load datasets:', error);
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
    <div className="min-h-screen pb-16">
      <Navbar />
      
      <main className="container max-w-4xl pt-32 animate-fade-in">
        <div className="flex items-center mb-6">
          <Button variant="ghost" asChild className="mr-4">
            <Link to="/" className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Projects
            </Link>
          </Button>
          <h1 className="text-3xl font-bold">API Settings</h1>
        </div>
        
        <p className="text-muted-foreground mb-8">
          Configure the FastAPI integration for your application
        </p>
        
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>FastAPI Connection</CardTitle>
            <CardDescription>
              Configure the connection to your FastAPI backend
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-url">API URL</Label>
              <Input 
                id="api-url"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="http://localhost:9999"
              />
              <p className="text-sm text-muted-foreground">
                The base URL of your FastAPI application (e.g., http://localhost:9999)
              </p>
            </div>
            
            {isConnected !== null && (
              <div className={`p-3 rounded-md ${isConnected ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                <p className="text-sm font-medium">
                  {isConnected 
                    ? "✅ Current API connection is working" 
                    : "❌ Current API connection is not working"}
                </p>
                <p className="text-xs mt-1">{testResult}</p>
              </div>
            )}
            
            <div className="flex space-x-2">
              <Button 
                onClick={handleTestConnection}
                disabled={isLoading}
              >
                {isLoading ? "Testing..." : "Test Connection"}
              </Button>
              <Button 
                variant="secondary"
                onClick={handleGetAllDatasets}
                disabled={isLoadingDatasets || !isConnected}
              >
                {isLoadingDatasets ? "Loading..." : "Get All Datasets"}
              </Button>
              <Button 
                variant="outline" 
                onClick={saveSettings}
                disabled={isLoading}
              >
                Save Settings
              </Button>
            </div>
          </CardContent>
        </Card>
        
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Database</CardTitle>
            <CardDescription>
              Current database connection and available datasets
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {databaseInfo && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-muted-foreground">Database Name</Label>
                    <p className="text-sm font-mono bg-muted px-3 py-2 rounded-md">{databaseInfo.database_name}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-muted-foreground">Database Type</Label>
                    <p className="text-sm bg-muted px-3 py-2 rounded-md">{databaseInfo.database_type}</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-medium text-muted-foreground">Host</Label>
                  <p className="text-sm font-mono bg-muted px-3 py-2 rounded-md">{databaseInfo.database_host}</p>
                </div>
              </div>
            )}
            
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-medium">Datasets in Current Database</Label>
                <Badge variant="secondary">{datasets.length} total</Badge>
              </div>
              
              {isLoadingDatasets ? (
                <div className="text-sm text-muted-foreground">Loading datasets...</div>
              ) : datasets.length > 0 ? (
                <div className="space-y-2">
                  <select
                    id="dataset-select"
                    className="w-full px-3 py-2 border rounded-md bg-background"
                    value={selectedDatasetId || ''}
                    onChange={(e) => setSelectedDatasetId(e.target.value)}
                  >
                    <option value="">-- Select a dataset --</option>
                    {datasets.map((dataset) => (
                      <option key={dataset.id} value={dataset.id}>
                        {dataset.name} ({dataset.image_count} images, {dataset.annotation_count} annotations)
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Select a dataset to view or manage it
                  </p>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground bg-muted/50 px-3 py-2 rounded-md">
                  No datasets found in this database. Create a project and dataset to get started.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Database Management</CardTitle>
            <CardDescription>
              Backup and restore your complete workspace including all projects, datasets, annotations, and files
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Complete Database Backup & Restore</p>
                <p className="text-sm text-muted-foreground">
                  Export your entire workspace or import from a previous backup
                </p>
              </div>
              <DatabaseManager />
            </div>
          </CardContent>
        </Card>
        
        {/* Danger Zone */}
        <Card className="mb-8 border-red-200 bg-red-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Danger Zone
            </CardTitle>
            <CardDescription className="text-red-600">
              Irreversible actions that will permanently destroy data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-red-700">Clear All Data</p>
                <p className="text-sm text-red-600">
                  Permanently delete all projects, datasets, annotations, and files
                </p>
              </div>
              <DatabaseManager showExport={false} showImport={false} showClear={true} showInfo={false} />
            </div>
          </CardContent>
        </Card>
        
        <div className="bg-muted/40 rounded-lg p-6">
          <h2 className="text-lg font-medium mb-3">FastAPI Integration</h2>
          <p className="text-sm text-muted-foreground mb-4">
            This application integrates with a FastAPI backend for data management.
            The backend handles projects, datasets, images, and annotations.
          </p>
          
          <h3 className="text-md font-medium mb-2">API Endpoints</h3>
          <ul className="list-disc text-sm text-muted-foreground pl-5 mb-4 space-y-1">
            <li>GET /projects/ - List all projects</li>
            <li>POST /projects/ - Create a new project</li>
            <li>GET /projects/{'{id}'} - Get project details</li>
            <li>GET /datasets/ - List all datasets</li>
            <li>POST /datasets/ - Create a new dataset</li>
            <li>GET /datasets/{'{id}'} - Get dataset details</li>
          </ul>
          
          <h3 className="text-md font-medium mb-2">FastAPI Setup</h3>
          <p className="text-sm text-muted-foreground mb-1">
            Make sure your FastAPI backend is running and accessible at the URL above.
          </p>
          <p className="text-sm text-muted-foreground">
            The backend service should have CORS enabled to allow requests from this application.
          </p>
        </div>
      </main>

      <Dialog open={showDatasetsDialog} onOpenChange={setShowDatasetsDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>All Datasets</DialogTitle>
            <DialogDescription>
              Showing all datasets across all projects
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

// export default ApiSettings;
