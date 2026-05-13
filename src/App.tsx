import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ExportProvider } from "@/contexts/ExportContext";
import { ApiProvider } from "@/contexts/ApiContext";
import { ThemeProvider } from "@/components/ThemeProvider";

const Index = lazy(() => import("./pages/Index"));
const CreateProject = lazy(() => import("./pages/CreateProject"));
const CreateDataset = lazy(() => import("./pages/CreateDataset"));
const ProjectLayout = lazy(() =>
  import("./components/ProjectLayout").then((m) => ({ default: m.ProjectLayout })),
);
const ProjectDatasets = lazy(() => import("./pages/ProjectDatasets"));
const ProjectModels = lazy(() => import("./pages/ProjectModels"));
const ProjectEvaluations = lazy(() => import("./pages/ProjectEvaluations"));
const ProjectExports = lazy(() => import("./pages/ProjectExports"));
const EditDataset = lazy(() => import("./pages/EditDataset"));
const Dataset = lazy(() => import("@/pages/Dataset"));
const ImageAnnotation = lazy(() => import("./pages/ImageAnnotation"));
const AnnotationChoice = lazy(() => import("./pages/AnnotationChoice"));
const Classification = lazy(() => import("./pages/Classification"));
const ApiSettings = lazy(() =>
  import("./pages/ApiSettings").then((m) => ({ default: m.ApiSettings })),
);
const NotFound = lazy(() => import("./pages/NotFound"));
const HelpPage = lazy(() => import("./pages/help/HelpPage"));

function RouteFallback() {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-background"
      role="status"
      aria-label="Loading page"
    >
      <div className="h-9 w-9 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep data fresh for 30 s so navigating back to a page doesn't refetch
      // immediately — reduces redundant network round-trips.
      staleTime: 30_000,
      // Hold unused cache entries for 5 minutes
      gcTime: 5 * 60_000,
      retry: 1,
    },
  },
});

const App = () => (
  <ThemeProvider>
    <ApiProvider>
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
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/projects/new" element={<CreateProject />} />
                <Route path="/projects/new/dataset" element={<CreateDataset />} />

                <Route path="/projects/:id" element={<ProjectLayout />}>
                  <Route index element={<ProjectDatasets />} />
                  <Route path="datasets" element={<ProjectDatasets />} />
                  <Route path="models" element={<ProjectModels />} />
                  <Route path="pipelines" element={<Navigate to=".." replace />} />
                  <Route path="evaluations" element={<ProjectEvaluations />} />
                  <Route path="exports" element={<ProjectExports />} />
                </Route>

                <Route path="/projects/:id/edit" element={<EditDataset projectMode={true} />} />
                <Route path="/projects/:projectId/datasets/:id" element={<Dataset />} />
                <Route path="/projects/:projectId/datasets/:id/edit" element={<EditDataset />} />
                <Route path="/projects/:projectId/datasets/:id/annotate" element={<AnnotationChoice />} />
                <Route
                  path="/projects/:projectId/datasets/:id/annotate/classification"
                  element={<Classification />}
                />
                <Route
                  path="/projects/:projectId/datasets/:id/annotate/segmentation"
                  element={<ImageAnnotation />}
                />
                <Route path="/datasets/:id" element={<Dataset />} />
                <Route path="/datasets/:id/edit" element={<EditDataset />} />
                <Route path="/datasets/:id/annotate" element={<AnnotationChoice />} />
                <Route path="/datasets/:id/annotate/classification" element={<Classification />} />
                <Route path="/datasets/:id/annotate/segmentation" element={<ImageAnnotation />} />
                <Route path="/settings" element={<ApiSettings />} />
                <Route path="/help" element={<HelpPage />} />
                <Route path="/help/:slug" element={<HelpPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
      </ExportProvider>
    </QueryClientProvider>
  </ApiProvider>
</ThemeProvider>
);

export default App;
