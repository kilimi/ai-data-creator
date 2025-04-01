
import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { DatasetFormValues } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Tag, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Navbar } from '@/components/Navbar';

interface CreateDatasetProps {
  projectMode?: boolean;
}

const CreateDataset = ({ projectMode = false }: CreateDatasetProps) => {
  const location = useLocation();
  const projectId = location.state?.projectId;
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [currentTag, setCurrentTag] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const handleSubmit = (e: React.FormEvent) => {
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
    
    const formData: DatasetFormValues = {
      name: name.trim(),
      description: description.trim(),
      tags: tags.length > 0 ? tags : undefined,
    };

    // Simulate API call
    setTimeout(() => {
      // Create an ID for the new dataset
      const newDatasetId = Math.random().toString(36).substring(2, 11);
      
      toast({
        title: projectMode ? "Project created" : "Dataset created",
        description: `${name} has been created successfully.`,
      });
      
      if (projectMode && projectId) {
        navigate(`/projects/${projectId}`);
      } else if (projectMode) {
        navigate('/');
      } else {
        // Navigate to the edit page for the new dataset instead of the datasets listing
        navigate(`/datasets/${newDatasetId}/edit`);
      }
      
      setIsSubmitting(false);
    }, 1500);
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
              
              <div className="space-y-2">
                <Label htmlFor="tags">Tags</Label>
                <div className="flex">
                  <Input 
                    id="tags"
                    value={currentTag}
                    onChange={(e) => setCurrentTag(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Add tags (press Enter)"
                    className="flex-1"
                  />
                  <Button 
                    type="button"
                    onClick={addTag}
                    variant="outline"
                    className="ml-2"
                  >
                    <Tag className="h-4 w-4" />
                  </Button>
                </div>
                
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {tags.map(tag => (
                      <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                        {tag}
                        <button
                          type="button"
                          onClick={() => removeTag(tag)}
                          className="rounded-full hover:bg-secondary/80"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
            
            <CardFooter className="flex justify-end space-x-2">
              <Button 
                variant="outline" 
                type="button" 
                onClick={() => navigate(projectMode ? '/' : '/datasets')}
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
