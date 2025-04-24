import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { DatasetFormValues } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Tag, X, UploadCloud, Image as ImageIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Navbar } from '@/components/Navbar';
import { API_CONFIG } from '@/config/api';

interface CreateDatasetProps {
  projectMode?: boolean;
}

const CreateDataset = ({ projectMode = false }: CreateDatasetProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Get projectId from location state
  const projectId = location.state?.projectId;
  
  // Debug logging
  console.log("Create Dataset - Location state:", location.state);
  console.log("Create Dataset - Project ID:", projectId);
  console.log("Create Dataset - Project mode:", projectMode);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [currentTag, setCurrentTag] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [datasetType, setDatasetType] = useState('classification');

  // Only redirect if we're in dataset mode (not project mode) and there's no project ID
  useEffect(() => {
    if (!projectMode && !projectId) {
      console.log("Create Dataset - No project ID found, redirecting to projects list...");
      toast({
        title: "Error",
        description: "Please select a project first",
        variant: "destructive",
      });
      navigate('/');
      return;
    }
  }, [projectMode, projectId, navigate, toast]);

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

  const addTag = () => {
    if (currentTag.trim() && !tags.includes(currentTag.trim())) {
      setTags([...tags, currentTag.trim()]);
      setCurrentTag('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
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

    if (!projectMode && !projectId) {
      toast({
        title: "Error",
        description: "No project selected. Please create a dataset from within a project.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('description', description.trim());
      
      if (!projectMode) {
        // Dataset creation mode
        formData.append('type', datasetType);
        formData.append('project_id', String(projectId)); // Ensure project_id is always a string
      } else {
        // Project creation mode
        formData.append('type', 'project');
        formData.append('is_project', 'true');
      }

      if (tags.length > 0) {
        formData.append('tags', JSON.stringify(tags));
      }

      if (logoFile) {
        formData.append('logo', logoFile);
      }

      // Use different endpoints based on mode
      const endpoint = projectMode ? 'projects' : 'datasets';
      const apiUrl = `${API_CONFIG.baseUrl}/${endpoint}/`;
      
      console.log(`Submitting to ${apiUrl} with project_id:`, projectId);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || `HTTP error! status: ${response.status}`);
      }

      toast({
        title: "Success",
        description: `${name} has been created successfully.`,
      });

      // Navigate based on the mode
      if (projectMode) {
        navigate('/'); // Go to projects list after creating a project
      } else {
        navigate(`/projects/${projectId}`); // Go back to project detail after creating a dataset
      }
    } catch (err) {
      console.error('Error creating:', err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to create. Please try again.",
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
            <CardTitle className="text-2xl">
              {projectMode ? "Create New Project" : "Create New Dataset"}
            </CardTitle>
            <CardDescription>
              {projectMode 
                ? "Create a new project to organize related datasets" 
                : "Create a new dataset to manage your data"
              }
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

              {!projectMode && (
                <div className="space-y-2">
                  <Label>Dataset Type</Label>
                  <div className="flex flex-col space-y-2">
                    <label className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name="datasetType"
                        value="classification"
                        checked={datasetType === 'classification'}
                        onChange={(e) => setDatasetType(e.target.value)}
                        className="rounded-full"
                      />
                      <span>Classification</span>
                    </label>
                    <label className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name="datasetType"
                        value="segmentation"
                        checked={datasetType === 'segmentation'}
                        onChange={(e) => setDatasetType(e.target.value)}
                        className="rounded-full"
                      />
                      <span>Segmentation</span>
                    </label>
                    <label className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name="datasetType"
                        value="panomatic"
                        checked={datasetType === 'panomatic'}
                        onChange={(e) => setDatasetType(e.target.value)}
                        className="rounded-full"
                      />
                      <span>Panomatic</span>
                    </label>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Logo</Label>
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
                onClick={() => navigate(projectMode ? '/' : `/projects/${projectId}`)}
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

export default CreateDataset;
