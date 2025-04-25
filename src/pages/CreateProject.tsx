import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { X, UploadCloud } from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { createApiClient } from '@/utils/api';
import { API_CONFIG } from '@/config/api';

const CreateProject = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      
      if (!file.type.startsWith('image/')) {
        toast({
          title: "Error",
          description: "Please upload an image file",
          variant: "destructive",
        });
        return;
      }
      
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "Error",
          description: "Image size should be less than 5MB",
          variant: "destructive",
        });
        return;
      }
      
      setLogoFile(file);
      
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setLogoPreview(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      toast({
        title: "Error",
        description: "Please enter a name",
        variant: "destructive",
      });
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('description', description.trim()); // Send description as is, backend will handle empty string
      
      if (logoFile) {
        formData.append('logo', logoFile);
      }

      const apiClient = createApiClient(API_CONFIG);
      const result = await apiClient.createProject(formData);
      
      if (!result.success) {
        throw new Error(result.error || "Failed to create project");
      }

      toast({
        title: "Success",
        description: `${name} has been created successfully.`,
      });
      
      navigate('/');
    } catch (err) {
      console.error('Error creating project:', err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to create project. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen pb-16">
      <Navbar />
      
      <div className="container max-w-3xl pt-32 pb-12 px-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Create New Project</CardTitle>
            <CardDescription>
              Create a new project to organize related datasets
            </CardDescription>
          </CardHeader>
          
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input 
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter a name"
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea 
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter a description (optional)"
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Project Logo</Label>
                <div className="space-y-4">
                  {!logoPreview ? (
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="cursor-pointer rounded-md border-2 border-dashed border-muted-foreground/25 hover:border-muted-foreground/50 transition-all p-8 flex flex-col items-center justify-center text-center"
                    >
                      <UploadCloud className="h-10 w-10 mb-2 text-muted-foreground" />
                      <p className="text-muted-foreground">Click to upload a logo</p>
                      <p className="text-xs text-muted-foreground">SVG, PNG, JPG (max 5MB)</p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                    </div>
                  ) : (
                    <div className="relative rounded-md overflow-hidden border h-48 flex items-center justify-center">
                      <img 
                        src={logoPreview} 
                        alt="Logo preview" 
                        className="max-w-full max-h-full object-contain"
                      />
                      <Button 
                        variant="destructive" 
                        size="icon" 
                        onClick={handleRemoveLogo}
                        className="absolute top-2 right-2 h-8 w-8"
                        type="button"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
            
            <CardFooter className="flex justify-end space-x-2">
              <Button 
                variant="outline" 
                type="button" 
                onClick={() => navigate('/')}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isSubmitting || !name.trim()}
              >
                {isSubmitting ? 'Creating...' : 'Create'}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
};

export default CreateProject;
