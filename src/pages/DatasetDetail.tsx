
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Link, useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import { Dataset, DatasetStats, Image } from "@/types";
import { useToast } from "@/components/ui/use-toast";
import { UploadCard } from "@/components/UploadCard";
import { DatasetStats as DatasetStatsComponent } from "@/components/DatasetStats";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Download, 
  FileImage, 
  Loader2, 
  Pencil, 
  Trash2, 
  Upload, 
  UploadCloud 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useImageLoad } from "@/utils/animations";

// Mock data for a single dataset
const getMockDataset = (id: string): Dataset => ({
  id,
  name: "Vehicle Detection",
  description: "Urban traffic dataset with annotations for cars, trucks, and pedestrians. This dataset contains images of vehicles in various lighting conditions and environments.",
  createdAt: "2023-06-15T10:30:00Z",
  imageCount: 1250,
  annotationCount: 4932,
  thumbnailUrl: "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
});

// Mock statistics data
const getMockStats = (): DatasetStats => ({
  imageCount: 1250,
  annotationCount: 4932,
  categoriesCount: 15,
  recentActivity: [
    { date: "2023-09-01T00:00:00Z", imagesAdded: 110, annotationsAdded: 422 },
    { date: "2023-09-02T00:00:00Z", imagesAdded: 42, annotationsAdded: 185 },
    { date: "2023-09-03T00:00:00Z", imagesAdded: 65, annotationsAdded: 310 },
    { date: "2023-09-04T00:00:00Z", imagesAdded: 23, annotationsAdded: 98 },
    { date: "2023-09-05T00:00:00Z", imagesAdded: 78, annotationsAdded: 256 },
    { date: "2023-09-06T00:00:00Z", imagesAdded: 52, annotationsAdded: 187 },
    { date: "2023-09-07T00:00:00Z", imagesAdded: 91, annotationsAdded: 340 },
  ],
});

// Mock images data
const getMockImages = (): Image[] => [
  {
    id: "1",
    datasetId: "1",
    fileName: "car_001.jpg",
    fileSize: 1254000,
    width: 1920,
    height: 1080,
    url: "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=500&q=60",
    uploadedAt: "2023-06-15T11:30:00Z",
    annotationsCount: 5,
  },
  {
    id: "2",
    datasetId: "1",
    fileName: "car_002.jpg",
    fileSize: 1542000,
    width: 1920,
    height: 1080,
    url: "https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=500&q=60",
    uploadedAt: "2023-06-15T12:15:00Z",
    annotationsCount: 3,
  },
  {
    id: "3",
    datasetId: "1",
    fileName: "car_003.jpg",
    fileSize: 1326000,
    width: 1920,
    height: 1080,
    url: "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=500&q=60",
    uploadedAt: "2023-06-15T13:45:00Z",
    annotationsCount: 4,
  },
  {
    id: "4",
    datasetId: "1",
    fileName: "car_004.jpg",
    fileSize: 1428000,
    width: 1920,
    height: 1080,
    url: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=500&q=60",
    uploadedAt: "2023-06-15T14:20:00Z",
    annotationsCount: 6,
  },
  {
    id: "5",
    datasetId: "1",
    fileName: "car_005.jpg",
    fileSize: 1598000,
    width: 1920,
    height: 1080,
    url: "https://images.unsplash.com/photo-1511919884226-fd3cad34687c?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1511919884226-fd3cad34687c?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=500&q=60",
    uploadedAt: "2023-06-15T15:10:00Z",
    annotationsCount: 7,
  },
  {
    id: "6",
    datasetId: "1",
    fileName: "car_006.jpg",
    fileSize: 1345000,
    width: 1920,
    height: 1080,
    url: "https://images.unsplash.com/photo-1526726538690-5cbf956ae2fd?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1526726538690-5cbf956ae2fd?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=500&q=60",
    uploadedAt: "2023-06-15T16:05:00Z",
    annotationsCount: 4,
  },
];

const DatasetDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const [images, setImages] = useState<Image[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const { toast } = useToast();
  
  useEffect(() => {
    // Simulate API calls
    const fetchData = async () => {
      await new Promise(resolve => setTimeout(resolve, 1200));
      if (id) {
        setDataset(getMockDataset(id));
        setStats(getMockStats());
        setImages(getMockImages());
      }
      setLoading(false);
    };
    
    fetchData();
  }, [id]);
  
  const handleImageUpload = (files: File[]) => {
    toast({
      title: "Upload started",
      description: `Uploading ${files.length} images...`,
    });
    
    // Simulate upload delay
    setTimeout(() => {
      toast({
        title: "Upload complete",
        description: `Successfully uploaded ${files.length} images.`,
      });
    }, 2000);
  };
  
  const handleAnnotationUpload = (files: File[]) => {
    toast({
      title: "Processing annotations",
      description: `Processing ${files.length} COCO annotation files...`,
    });
    
    // Simulate processing delay
    setTimeout(() => {
      toast({
        title: "Annotations added",
        description: `Successfully processed ${files.length} annotation files.`,
      });
    }, 2500);
  };
  
  if (loading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="container max-w-7xl pt-32 flex justify-center items-center">
          <div className="flex flex-col items-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-4 text-muted-foreground">Loading dataset...</p>
          </div>
        </div>
      </div>
    );
  }
  
  if (!dataset) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="container max-w-7xl pt-32 text-center">
          <h1 className="text-2xl font-bold mb-4">Dataset not found</h1>
          <p className="text-muted-foreground mb-6">
            The dataset you're looking for doesn't exist or has been deleted.
          </p>
          <Button asChild>
            <Link to="/datasets">Return to datasets</Link>
          </Button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen pb-20">
      <Navbar />
      
      <div className="h-48 bg-gradient-to-r from-primary/10 to-primary/5 relative overflow-hidden">
        {dataset.thumbnailUrl && (
          <>
            <div className="absolute inset-0 bg-black/20" />
            <img 
              src={dataset.thumbnailUrl} 
              alt={dataset.name}
              className="w-full h-full object-cover opacity-30"
            />
          </>
        )}
      </div>
      
      <main className="container max-w-7xl relative -mt-16 animate-fade-in">
        <div className="bg-card rounded-xl p-6 shadow-sm border">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="bg-primary/10 text-primary text-xs font-medium rounded-full px-2.5 py-0.5">
                  {new Date(dataset.createdAt).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </div>
              </div>
              
              <h1 className="text-3xl font-bold text-balance">{dataset.name}</h1>
              <p className="text-muted-foreground mt-2 max-w-3xl">
                {dataset.description}
              </p>
            </div>
            
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="flex items-center gap-1.5">
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
              <Button variant="outline" size="sm" className="flex items-center gap-1.5 text-destructive border-destructive/20 hover:bg-destructive/10">
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
              <Button size="sm" className="flex items-center gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
            </div>
          </div>
          
          <Tabs 
            defaultValue="overview" 
            value={activeTab} 
            onValueChange={setActiveTab}
            className="mt-6"
          >
            <TabsList className="grid w-full grid-cols-4 md:w-auto md:inline-flex">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="images">Images</TabsTrigger>
              <TabsTrigger value="annotations">Annotations</TabsTrigger>
              <TabsTrigger value="upload">Upload</TabsTrigger>
            </TabsList>
            
            <TabsContent value="overview" className="mt-6">
              {stats && <DatasetStatsComponent stats={stats} />}
            </TabsContent>
            
            <TabsContent value="images" className="mt-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">Images</h2>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="flex items-center gap-1.5"
                  onClick={() => setActiveTab("upload")}
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  Upload Images
                </Button>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {images.map((image) => (
                  <ImageCard key={image.id} image={image} />
                ))}
              </div>
            </TabsContent>
            
            <TabsContent value="annotations" className="mt-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">Annotations</h2>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="flex items-center gap-1.5"
                  onClick={() => setActiveTab("upload")}
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload Annotations
                </Button>
              </div>
              
              <div className="bg-muted/30 rounded-lg p-8 text-center">
                <h3 className="text-lg font-medium mb-2">Annotation Viewer</h3>
                <p className="text-muted-foreground mb-4">
                  Select an image first to view its annotations
                </p>
                <Button variant="secondary" size="sm">
                  Browse Images
                </Button>
              </div>
            </TabsContent>
            
            <TabsContent value="upload" className="mt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <h2 className="text-xl font-semibold mb-4">Upload Images</h2>
                  <UploadCard
                    title="Add Images to Dataset"
                    description="Drag and drop images or click to browse"
                    accept="image/jpeg,image/png,image/webp"
                    onFilesSelected={handleImageUpload}
                    type="images"
                  />
                </div>
                
                <div>
                  <h2 className="text-xl font-semibold mb-4">Upload Annotations</h2>
                  <UploadCard
                    title="Add COCO Annotations"
                    description="Upload JSON files in COCO format"
                    accept=".json"
                    onFilesSelected={handleAnnotationUpload}
                    type="annotations"
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
};

interface ImageCardProps {
  image: Image;
}

function ImageCard({ image }: ImageCardProps) {
  const imageLoaded = useImageLoad(image.thumbnailUrl);
  
  return (
    <div className="relative group overflow-hidden rounded-md border bg-card hover-card hover:border-primary/20">
      <div className="relative aspect-square overflow-hidden">
        {!imageLoaded && (
          <div className="absolute inset-0 bg-muted animate-pulse" />
        )}
        <img
          src={image.thumbnailUrl}
          alt={image.fileName}
          className={cn(
            "h-full w-full object-cover transition-all duration-300",
            !imageLoaded && "opacity-0",
            imageLoaded && "opacity-100"
          )}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      
      <div className="p-2.5">
        <h3 className="font-medium text-sm truncate">{image.fileName}</h3>
        <div className="flex justify-between items-center text-xs text-muted-foreground mt-1">
          <span>
            {image.width}x{image.height}
          </span>
          <span>
            {Math.round(image.fileSize / 1024)} KB
          </span>
        </div>
      </div>
      
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent translate-y-full group-hover:translate-y-0 transition-transform duration-200">
        <div className="flex justify-center gap-1">
          <Button size="sm" variant="secondary" className="h-7 px-2.5 text-xs w-full">
            View
          </Button>
        </div>
      </div>
      
      {image.annotationsCount > 0 && (
        <div className="absolute top-2 right-2 bg-primary text-primary-foreground text-xs font-medium rounded-full px-1.5 py-0.5 shadow-sm">
          {image.annotationsCount} <span className="hidden sm:inline">annotations</span>
        </div>
      )}
    </div>
  );
}

export default DatasetDetail;
