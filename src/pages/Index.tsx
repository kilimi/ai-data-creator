import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/Navbar";
import { Link } from "react-router-dom";
import { ArrowRight, Database, FolderPlus, Search, PlusCircle, Tag } from "lucide-react";
import { ProjectCard, ProjectCardSkeleton } from "@/components/ProjectCard";
import { useState, useEffect } from "react";
import { Project } from "@/types";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

// Mock data for projects
const mockProjects: Project[] = [
  {
    id: "1",
    name: "Autonomous Vehicles",
    description: "Computer vision datasets for self-driving cars and other autonomous vehicles",
    createdAt: "2023-05-10T08:20:00Z",
    thumbnailUrl: "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
    datasets: [
      {
        id: "1",
        name: "Vehicle Detection",
        description: "Urban traffic dataset with annotations for cars, trucks, and pedestrians",
        type: "classification",
        tags: ["traffic", "vehicles", "urban"],
        createdAt: "2023-06-15T10:30:00Z",
        imageCount: 1250,
        annotationCount: 4932,
        thumbnailUrl: "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
        projectId: "1"
      },
      {
        id: "4",
        name: "Aerial Photography",
        description: "Drone imagery for geographic feature detection and mapping",
        type: "segmentation",
        tags: ["aerial", "drone", "geography"],
        createdAt: "2023-08-17T16:20:00Z",
        imageCount: 527,
        annotationCount: 1432,
        thumbnailUrl: "https://images.unsplash.com/photo-1508138221679-760a23a2285b?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
        projectId: "1"
      }
    ]
  },
  {
    id: "2",
    name: "Healthcare Imagery",
    description: "Medical imaging datasets for disease detection and diagnosis",
    createdAt: "2023-09-05T14:15:00Z",
    thumbnailUrl: "https://images.unsplash.com/photo-1530497610245-94d3c16cda28?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
    datasets: [
      {
        id: "3",
        name: "Medical Imagery",
        description: "X-ray and MRI scans with annotated features for disease detection",
        type: "panomatic",
        tags: ["medical", "xray", "healthcare"],
        createdAt: "2023-11-03T09:45:00Z",
        imageCount: 615,
        annotationCount: 1845,
        thumbnailUrl: "https://images.unsplash.com/photo-1530497610245-94d3c16cda28?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
        projectId: "2"
      }
    ]
  },
  {
    id: "3",
    name: "Retail Analytics",
    description: "Product recognition and retail analytics datasets",
    createdAt: "2023-07-22T11:30:00Z",
    thumbnailUrl: "https://images.unsplash.com/photo-1534723328310-e82dad3ee43f?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
    datasets: [
      {
        id: "2",
        name: "Retail Products",
        description: "Product recognition dataset with shelf items and packaging",
        type: "segmentation",
        tags: ["retail", "products", "packaging"],
        createdAt: "2023-09-22T14:15:00Z",
        imageCount: 873,
        annotationCount: 3218,
        thumbnailUrl: "https://images.unsplash.com/photo-1534723328310-e82dad3ee43f?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
        projectId: "3"
      }
    ]
  },
  {
    id: "4",
    name: "Natural Environment",
    description: "Nature and wildlife monitoring datasets",
    createdAt: "2023-10-12T09:45:00Z",
    thumbnailUrl: "https://images.unsplash.com/photo-1557008075-7f2c5efa4cfd?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
    datasets: [
      {
        id: "5",
        name: "Wildlife Monitoring",
        description: "Camera trap imagery of wildlife with species annotations",
        type: "classification",
        tags: ["wildlife", "nature", "animals"],
        createdAt: "2023-10-05T11:40:00Z",
        imageCount: 942,
        annotationCount: 2854,
        thumbnailUrl: "https://images.unsplash.com/photo-1557008075-7f2c5efa4cfd?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
        projectId: "4"
      }
    ]
  },
  {
    id: "5",
    name: "Industrial Applications",
    description: "Datasets for industrial quality control and defect detection",
    createdAt: "2023-07-05T15:30:00Z",
    thumbnailUrl: "https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
    datasets: [
      {
        id: "6",
        name: "Industrial Defects",
        description: "Manufacturing quality control with annotated defect regions",
        type: "panomatic",
        tags: ["industrial", "manufacturing", "quality"],
        createdAt: "2023-07-29T08:50:00Z",
        imageCount: 318,
        annotationCount: 563,
        thumbnailUrl: "https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
        projectId: "5"
      }
    ]
  }
];

const Index = () => {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  
  useEffect(() => {
    // Simulate API call
    const fetchData = async () => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      setProjects(mockProjects);
      setLoading(false);
    };
    
    fetchData();
  }, []);
  
  // Filter projects based on search query
  const filteredProjects = projects.filter(project => {
    return searchQuery === "" || 
      project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.datasets.some(dataset => 
        dataset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        dataset.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
  });
  
  return (
    <div className="min-h-screen pb-16">
      <Navbar />
      
      <section className="pt-32 pb-12 px-4 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
        <div className="container relative z-10 max-w-5xl text-center mx-auto animate-fade-in">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-balance mb-6">
            Vision AI Dataset Management
          </h1>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto mb-8">
            Create, curate, and annotate high-quality datasets for computer vision. 
            Organize your work in projects and manage datasets with ease.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Button asChild size="lg" className="gap-2">
              <Link to="/projects/new">
                <FolderPlus className="w-4 h-4" />
                Create New Project
              </Link>
            </Button>
          </div>
        </div>
      </section>
      
      <section className="container max-w-6xl py-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
          <h2 className="text-2xl font-bold">Projects</h2>
          
          <div className="relative flex items-center w-full md:w-auto">
            <Search className="absolute left-3 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search projects..."
              className="pl-9 pr-4"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        
        <div>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Array(4).fill(0).map((_, i) => (
                <ProjectCardSkeleton key={i} />
              ))}
            </div>
          ) : filteredProjects.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {filteredProjects.map(project => (
                <ProjectCard key={project.id} project={project} />
              ))}
              
              <Card className="overflow-hidden border-dashed border-2 hover:border-primary/50 transition-colors">
                <Link to="/projects/new" className="flex flex-col items-center justify-center h-full py-12 text-muted-foreground hover:text-primary transition-colors">
                  <PlusCircle className="h-12 w-12 mb-4" />
                  <p className="text-lg font-medium">Create New Project</p>
                </Link>
              </Card>
            </div>
          ) : (
            <div className="text-center py-16">
              <h3 className="text-lg font-medium mb-2">No projects found</h3>
              <p className="text-muted-foreground mb-6">
                {searchQuery 
                  ? `No projects matching your search criteria`
                  : "You haven't created any projects yet."
                }
              </p>
              <Button asChild>
                <Link to="/projects/new">
                  <FolderPlus className="w-4 h-4 mr-2" />
                  Create your first project
                </Link>
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default Index;
