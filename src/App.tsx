import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ExportProvider } from "@/contexts/ExportContext";
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
import { ProjectLayout } from "./components/ProjectLayout";
import ProjectDatasets from "./pages/ProjectDatasets";
import ProjectModels from "./pages/ProjectModels";
import ProjectEvaluations from "./pages/ProjectEvaluations";
import ProjectExports from "./pages/ProjectExports";
import ProjectPipelines from "./pages/ProjectPipelines";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ExportProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/projects/new" element={<CreateProject />} />
          <Route path="/projects/new/dataset" element={<CreateDataset />} />
          
          {/* Project routes with sidebar layout */}
          <Route path="/projects/:id" element={<ProjectLayout />}>
            <Route index element={<ProjectDatasets />} />
            <Route path="datasets" element={<ProjectDatasets />} />
            <Route path="models" element={<ProjectModels />} />
            <Route path="pipelines" element={<ProjectPipelines />} />
            <Route path="evaluations" element={<ProjectEvaluations />} />
            <Route path="exports" element={<ProjectExports />} />
          </Route>
          
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
          <Route path="/settings" element={<ApiSettings />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      </TooltipProvider>
    </ExportProvider>
  </QueryClientProvider>
);

export default App;
