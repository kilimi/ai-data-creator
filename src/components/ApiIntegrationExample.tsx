
import { useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface ApiIntegrationExampleProps {
  className?: string;
}

export function ApiIntegrationExample({ className }: ApiIntegrationExampleProps) {
  const [apiUrl, setApiUrl] = useState('http://localhost:8000');
  const [apiKey, setApiKey] = useState('');
  const [testResult, setTestResult] = useState<{success: boolean; message: string} | null>(null);
  
  const { api, isConfigured } = useApi({
    baseUrl: apiUrl,
    apiKey: apiKey.trim() || undefined
  });
  
  const handleTestConnection = async () => {
    if (!api) return;
    
    try {
      const response = await api.getDatasets();
      if (response.success) {
        setTestResult({
          success: true,
          message: `Connection successful! Found ${response.data?.length || 0} datasets.`
        });
      } else {
        setTestResult({
          success: false,
          message: `Connection failed: ${response.error || 'Unknown error'}`
        });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    }
  };
  
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Laravel API Integration</CardTitle>
        <CardDescription>
          Configure the connection to your Laravel backend
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="config">
          <TabsList className="mb-4">
            <TabsTrigger value="config">Configuration</TabsTrigger>
            <TabsTrigger value="usage">Usage Examples</TabsTrigger>
          </TabsList>
          
          <TabsContent value="config" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-url">API URL</Label>
              <Input 
                id="api-url"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="https://your-laravel-app.com"
              />
              <p className="text-sm text-muted-foreground">
                The base URL of your Laravel application
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="api-key">API Key (optional)</Label>
              <Input 
                id="api-key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Your API key"
                type="password"
              />
              <p className="text-sm text-muted-foreground">
                If your API requires authentication
              </p>
            </div>
            
            {testResult && (
              <Alert variant={testResult.success ? "default" : "destructive"}>
                {testResult.success ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                <AlertTitle>
                  {testResult.success ? "Connection Successful" : "Connection Failed"}
                </AlertTitle>
                <AlertDescription>
                  {testResult.message}
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>
          
          <TabsContent value="usage">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-2">Example API Methods</h3>
                <pre className="p-4 bg-muted rounded-md overflow-x-auto text-xs">
                  {`// Get all datasets
const response = await api.getDatasets();

// Create a dataset
const newDataset = await api.createDataset({
  name: 'New Dataset',
  description: 'Description',
  type: 'classification'
}, logoFile);

// Upload images
const result = await api.uploadImages(
  datasetId, 
  imageFiles
);

// Upload COCO annotations
const stats = await api.uploadCOCOAnnotations(
  datasetId, 
  annotationFile
);`}
                </pre>
              </div>
              
              <div>
                <h3 className="text-sm font-medium mb-2">Full Documentation</h3>
                <p className="text-sm text-muted-foreground">
                  See the complete Laravel integration guide in the 
                  <code className="px-1 font-mono bg-muted rounded mx-1">src/utils/laravel-integration.md</code> 
                  file, which includes Laravel controller examples and database schema information.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
      <CardFooter>
        <Button 
          onClick={handleTestConnection} 
          disabled={!isConfigured || !apiUrl}
        >
          Test Connection
        </Button>
      </CardFooter>
    </Card>
  );
}
