import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Datasets from "./pages/Datasets";
import DatasetDetail from "./pages/DatasetDetail";
import NotFound from "./pages/NotFound";
import CreateDataset from "./pages/CreateDataset";
import EditDataset from "./pages/EditDataset";
import { ApiSettings } from "./pages/ApiSettings";
import CreateProject from "./pages/CreateProject";
import Dataset from "@/pages/Dataset";
import ImageAnnotation from "./pages/ImageAnnotation";
import AnnotationChoice from "./pages/AnnotationChoice";
import Classification from "./pages/Classification";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/projects/new" element={<CreateProject />} />
          <Route path="/projects/new/dataset" element={<CreateDataset />} />
          <Route path="/projects/:id" element={<DatasetDetail projectMode={true} />} />
          <Route path="/projects/:id/edit" element={<EditDataset projectMode={true} />} />
          <Route path="/projects/:projectId/datasets/:id" element={<Dataset />} />
          <Route path="/projects/:projectId/datasets/:id/edit" element={<EditDataset />} />
          <Route path="/projects/:projectId/datasets/:id/annotate" element={<AnnotationChoice />} />
          <Route path="/projects/:projectId/datasets/:id/annotate/classification" element={<Classification />} />
          <Route path="/projects/:projectId/datasets/:id/annotate/segmentation" element={<ImageAnnotation />} />
          {/* Keep legacy routes for backward compatibility */}
          <Route path="/datasets/:id" element={<Dataset />} />
          <Route path="/datasets/:id/edit" element={<EditDataset />} />
          <Route path="/datasets/:id/annotate" element={<AnnotationChoice />} />
          <Route path="/datasets/:id/annotate/classification" element={<Classification />} />
          <Route path="/datasets/:id/annotate/segmentation" element={<ImageAnnotation />} />
          <Route path="/api-settings" element={<ApiSettings />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
