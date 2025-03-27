
import { Navbar } from "@/components/Navbar";
import { ApiIntegrationExample } from "@/components/ApiIntegrationExample";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

const ApiSettings = () => {
  return (
    <div className="min-h-screen pb-16">
      <Navbar />
      
      <main className="container max-w-4xl pt-32 animate-fade-in">
        <div className="flex items-center mb-6">
          <Button variant="ghost" asChild className="mr-4">
            <Link to="/datasets" className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Datasets
            </Link>
          </Button>
          <h1 className="text-3xl font-bold">API Settings</h1>
        </div>
        
        <p className="text-muted-foreground mb-8">
          Configure the Laravel API integration for your application
        </p>
        
        <ApiIntegrationExample className="mb-8" />
        
        <div className="bg-muted/40 rounded-lg p-6">
          <h2 className="text-lg font-medium mb-3">Integration Information</h2>
          <p className="text-sm text-muted-foreground mb-4">
            This API client provides a standard interface for integrating your React application with a Laravel backend.
            The client handles authentication, data formatting, and error handling for all API requests.
          </p>
          
          <h3 className="text-md font-medium mb-2">Setting Up Your Laravel Backend</h3>
          <p className="text-sm text-muted-foreground mb-2">
            To ensure compatibility with this client, your Laravel backend should:
          </p>
          <ul className="list-disc text-sm text-muted-foreground pl-5 mb-4 space-y-1">
            <li>Implement the API endpoints described in the integration guide</li>
            <li>Use consistent response formatting (success/error pattern)</li>
            <li>Set appropriate CORS headers to allow requests from this application</li>
            <li>Use Laravel Sanctum or JWT for API authentication if needed</li>
          </ul>
          
          <p className="text-sm text-muted-foreground">
            See the complete integration guide in <code className="px-1 font-mono bg-muted rounded">src/utils/laravel-integration.md</code> for detailed Laravel setup instructions including controller examples and database schemas.
          </p>
        </div>
      </main>
    </div>
  );
};

export default ApiSettings;
