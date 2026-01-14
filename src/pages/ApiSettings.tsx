import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { 
  ArrowLeft, 
  AlertTriangle, 
  Database, 
  Download, 
  Upload, 
  Trash2, 
  Settings as SettingsIcon, 
  CheckCircle2, 
  XCircle,
  Server,
  RefreshCw,
  HardDrive,
  Shield,
  Zap,
  ExternalLink
} from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      const apiClient = new ApiClient({ baseUrl: API_CONFIG.baseUrl });
      const result = await apiClient.testConnection();
      
      if (result.success) {
        setIsConnected(true);
        setTestResult("Backend server is running and accessible.");
      } else {
        setIsConnected(false);
        setTestResult(`${result.error}`);
      }
    } catch (error) {
      setIsConnected(false);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setTestResult(`${errorMessage}`);
    }
  };

  const handleTestConnection = async () => {
    setIsLoading(true);
    try {
      const apiClient = new ApiClient({ baseUrl: apiUrl });
      const result = await apiClient.testConnection();
      
      if (result.success) {
        setIsConnected(true);
        setTestResult("Backend server is running and accessible.");
        toast({
          title: "Connection successful",
          description: "Your backend connection is working correctly",
        });
      } else {
        setIsConnected(false);
        setTestResult(`${result.error}`);
        toast({
          title: "Connection failed",
          description: result.error || "Could not connect to the API",
          variant: "destructive",
        });
      }
    } catch (error) {
      setIsConnected(false);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setTestResult(`${errorMessage}`);
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
        setDatasets(response.data || []);
      } else {
        console.error('Failed to load datasets:', response.error);
        setDatasets([]);
      }
    } catch (error) {
      console.error('Failed to load datasets:', error);
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
    localStorage.setItem("apiBaseUrl", apiUrl);
    
    toast({
      title: "Settings saved",
      description: "API URL has been updated. Reloading app to apply changes.",
    });
    
    setTimeout(() => {
      window.location.href = "/";
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30">
      <Navbar />
      
      <main className="container max-w-6xl pt-24 pb-16 px-4 md:px-6 animate-fade-in">
        {/* Header */}
        <div className="mb-10">
          <Button variant="ghost" asChild className="mb-6 -ml-2 text-muted-foreground hover:text-foreground transition-colors">
            <Link to="/" className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Projects
            </Link>
          </Button>
          
          <div className="flex items-start gap-4">
            <div className="p-4 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 shadow-lg shadow-primary/5">
              <SettingsIcon className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
                Settings
              </h1>
              <p className="text-muted-foreground mt-2 text-lg">
                Configure your backend connection and manage your data
              </p>
            </div>
          </div>
        </div>

        {/* Connection Status Banner */}
        {isConnected !== null && (
          <div className={`mb-8 p-4 rounded-xl border-2 flex items-center gap-4 transition-all ${
            isConnected 
              ? "bg-emerald-500/5 border-emerald-500/20" 
              : "bg-red-500/5 border-red-500/20"
          }`}>
            <div className={`p-3 rounded-xl ${
              isConnected 
                ? "bg-emerald-500/10" 
                : "bg-red-500/10"
            }`}>
              {isConnected ? (
                <CheckCircle2 className="h-6 w-6 text-emerald-500" />
              ) : (
                <XCircle className="h-6 w-6 text-red-500" />
              )}
            </div>
            <div className="flex-1">
              <p className={`font-semibold ${isConnected ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {isConnected ? "Connected to Backend" : "Not Connected"}
              </p>
              <p className="text-sm text-muted-foreground">
                {testResult}
              </p>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleTestConnection}
              disabled={isLoading}
              className="flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              {isLoading ? "Testing..." : "Refresh"}
            </Button>
          </div>
        )}

        <Tabs defaultValue="connection" className="space-y-8">
          <TabsList className="grid w-full grid-cols-3 h-14 p-1.5 bg-muted/50 rounded-xl">
            <TabsTrigger value="connection" className="flex items-center gap-2 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm h-10">
              <Server className="h-4 w-4" />
              <span className="hidden sm:inline">Connection</span>
            </TabsTrigger>
            <TabsTrigger value="data" className="flex items-center gap-2 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm h-10">
              <HardDrive className="h-4 w-4" />
              <span className="hidden sm:inline">Data Management</span>
            </TabsTrigger>
            <TabsTrigger value="advanced" className="flex items-center gap-2 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm h-10">
              <Shield className="h-4 w-4" />
              <span className="hidden sm:inline">Advanced</span>
            </TabsTrigger>
          </TabsList>

          {/* Connection Tab */}
          <TabsContent value="connection" className="space-y-6">
            <Card className="border-2 shadow-lg overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-muted/50 to-transparent border-b">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-primary/10">
                    <Database className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Backend API</CardTitle>
                    <CardDescription className="text-base">
                      Configure your FastAPI backend server connection
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="space-y-3">
                  <Label htmlFor="api-url" className="text-sm font-medium flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    Backend URL
                  </Label>
                  <div className="flex gap-3">
                    <Input 
                      id="api-url"
                      value={apiUrl}
                      onChange={(e) => setApiUrl(e.target.value)}
                      placeholder="http://localhost:9999"
                      className="font-mono text-sm h-12 bg-muted/30 border-2 focus:border-primary/50"
                    />
                    <Button 
                      onClick={handleTestConnection}
                      disabled={isLoading}
                      variant="secondary"
                      className="h-12 px-6 font-medium"
                    >
                      {isLoading ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Testing...
                        </>
                      ) : "Test Connection"}
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Enter the URL where your FastAPI backend is running
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                  <div className="p-4 rounded-xl border-2 bg-muted/20 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3 mb-2">
                      <Database className="h-5 w-5 text-primary" />
                      <span className="font-medium">Datasets</span>
                    </div>
                    <p className="text-2xl font-bold text-primary">{datasets.length}</p>
                    <p className="text-sm text-muted-foreground">Available in database</p>
                  </div>
                  <div className="p-4 rounded-xl border-2 bg-muted/20 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3 mb-2">
                      <Server className="h-5 w-5 text-primary" />
                      <span className="font-medium">Status</span>
                    </div>
                    <p className={`text-2xl font-bold ${isConnected ? 'text-emerald-500' : 'text-red-500'}`}>
                      {isConnected ? 'Online' : 'Offline'}
                    </p>
                    <p className="text-sm text-muted-foreground">Backend server status</p>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-4 border-t">
                  <Button 
                    variant="outline"
                    onClick={handleGetAllDatasets}
                    disabled={isLoadingDatasets || !isConnected}
                    className="flex items-center gap-2"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {isLoadingDatasets ? "Loading..." : "View All Datasets"}
                  </Button>
                  <Button 
                    onClick={saveSettings}
                    disabled={isLoading}
                    className="px-8"
                  >
                    Save Changes
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Data Management Tab */}
          <TabsContent value="data" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Export Card */}
              <Card className="border-2 shadow-lg overflow-hidden group hover:border-primary/30 transition-colors">
                <CardHeader className="bg-gradient-to-r from-blue-500/5 to-transparent border-b">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-blue-500/10 group-hover:bg-blue-500/20 transition-colors">
                      <Download className="h-5 w-5 text-blue-500" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Export Data</CardTitle>
                      <CardDescription>
                        Download a backup of all your data
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground mb-6">
                    Create a complete backup of your projects, datasets, annotations, and images. 
                    The backup file can be used to restore your data later.
                  </p>
                  <DatabaseManager showImport={false} showClear={false} showInfo={false} />
                </CardContent>
              </Card>

              {/* Import Card */}
              <Card className="border-2 shadow-lg overflow-hidden group hover:border-primary/30 transition-colors">
                <CardHeader className="bg-gradient-to-r from-violet-500/5 to-transparent border-b">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-violet-500/10 group-hover:bg-violet-500/20 transition-colors">
                      <Upload className="h-5 w-5 text-violet-500" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Import Data</CardTitle>
                      <CardDescription>
                        Restore from a previous backup
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground mb-6">
                    Restore your projects and datasets from a backup file. 
                    This will merge the imported data with your existing data.
                  </p>
                  <DatabaseManager showExport={false} showClear={false} showInfo={false} />
                </CardContent>
              </Card>
            </div>

            {/* Stats Summary */}
            <Card className="border-2">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-muted">
                      <Database className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">Database Summary</p>
                      <p className="text-sm text-muted-foreground">
                        {datasets.length} datasets with {datasets.reduce((sum, d) => sum + d.image_count, 0)} total images
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-sm px-4 py-1">
                    {isConnected ? 'Synced' : 'Offline'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Advanced Tab */}
          <TabsContent value="advanced" className="space-y-6">
            <Card className="border-2 border-red-500/20 shadow-lg overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-red-500/5 to-transparent border-b border-red-500/20">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-red-500/10">
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                  </div>
                  <div>
                    <CardTitle className="text-lg text-red-600 dark:text-red-400">Danger Zone</CardTitle>
                    <CardDescription className="text-red-600/70 dark:text-red-400/70">
                      These actions are irreversible. Proceed with extreme caution.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <div className="p-5 rounded-xl border-2 border-red-500/20 bg-red-500/5">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-red-500/10">
                      <Trash2 className="h-5 w-5 text-red-500" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-red-600 dark:text-red-400 mb-1">
                        Clear All Data
                      </h3>
                      <p className="text-sm text-red-600/80 dark:text-red-400/80 mb-4">
                        Permanently delete all projects, datasets, annotations, and uploaded files. 
                        This action cannot be undone and all data will be lost forever.
                      </p>
                      <DatabaseManager showExport={false} showImport={false} showClear={true} showInfo={false} />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Info Card */}
            <Card className="border-2">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-muted">
                    <Shield className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Data Security</h3>
                    <p className="text-sm text-muted-foreground">
                      All your data is stored locally on your backend server. No data is sent to external services. 
                      We recommend creating regular backups using the Export feature to prevent data loss.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Datasets Dialog */}
      <Dialog open={showDatasetsDialog} onOpenChange={setShowDatasetsDialog}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              All Datasets
            </DialogTitle>
            <DialogDescription>
              {datasets.length} datasets found in the database
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 mt-4">
            <div className="space-y-3 pr-4">
              {datasets.map((dataset) => (
                <div key={dataset.id} className="p-4 rounded-xl border-2 bg-card hover:border-primary/30 transition-colors">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="font-semibold text-base">{dataset.name}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{dataset.description}</p>
                    </div>
                    <Badge variant="secondary">{dataset.image_count} images</Badge>
                  </div>
                  <div className="flex gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Database className="h-3.5 w-3.5" />
                      {dataset.annotation_count} annotations
                    </span>
                    <span>Created {new Date(dataset.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
              {datasets.length === 0 && (
                <div className="text-center py-12">
                  <Database className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                  <p className="text-muted-foreground">No datasets found</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
};
