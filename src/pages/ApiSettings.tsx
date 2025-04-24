
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { API_CONFIG } from "@/config/api";

const ApiSettings = () => {
  const [apiUrl, setApiUrl] = useState(API_CONFIG.baseUrl);
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleTestConnection = async () => {
    try {
      const response = await fetch(`${apiUrl}/projects/`);
      if (response.ok) {
        setTestResult("Connection successful!");
      } else {
        setTestResult(`Connection failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      setTestResult(`Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
                placeholder="http://localhost:8000"
              />
              <p className="text-sm text-muted-foreground">
                The base URL of your FastAPI application
              </p>
            </div>
            
            <Button onClick={handleTestConnection}>
              Test Connection
            </Button>
            
            {testResult && (
              <div className={`p-3 mt-4 rounded-md ${testResult.includes("successful") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                {testResult}
              </div>
            )}
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
        </div>
      </main>
    </div>
  );
};

export default ApiSettings;
