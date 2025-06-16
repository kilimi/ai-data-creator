
import { Link } from "react-router-dom";
import { Pencil, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Image } from "@/types";
import { ImageDisplayControls } from "@/components/ImageDisplayControls";
import { ImagesGrid } from "@/components/ImagesGrid";
import { PaginationControls } from "@/components/PaginationControls";
import { AnnotationSample } from "@/utils/annotations";
import { AnnotationsContent } from "@/components/AnnotationsContent";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ImagesTabContentProps {
  id: string;
  images: Image[];
  currentPage: number;
  imagesPerPage: number;
  imageSize: number;
  onImagesPerPageChange: (value: number) => void;
  onImageSizeChange: (value: number[]) => void;
  onPageChange: (page: number) => void;
  onOpenUploadDialog: () => void;
  onDeleteImage: (imageId: string) => Promise<void>;
  paginatedImages: Image[];
  totalPages: number;
  annotations?: AnnotationSample[];
  onImportAnnotations?: (files: File[]) => void;
}

export function ImagesTabContent({
  id,
  images,
  currentPage,
  imagesPerPage,
  imageSize,
  onImagesPerPageChange,
  onImageSizeChange,
  onPageChange,
  onOpenUploadDialog,
  onDeleteImage,
  paginatedImages,
  totalPages,
  annotations = [],
  onImportAnnotations,
}: ImagesTabContentProps) {
  return (
    <div className="space-y-4">
      <Tabs defaultValue="images" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="annotations">Annotations</TabsTrigger>
        </TabsList>
        
        <TabsContent value="images" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Images</h2>
            <div className="flex gap-2">
              <Button asChild>
                <Link to={`/datasets/${id}/annotate`}>
                  <Pencil className="w-4 h-4 mr-2" />
                  Annotate
                </Link>
              </Button>
              <Button onClick={onOpenUploadDialog} className="bg-blue-600 hover:bg-blue-700">
                <Upload className="w-4 h-4 mr-2" />
                Upload Images
              </Button>
            </div>
          </div>

          <ImageDisplayControls
            imagesPerPage={imagesPerPage}
            onImagesPerPageChange={onImagesPerPageChange}
            imageSize={imageSize}
            onImageSizeChange={onImageSizeChange}
          />

          <ImagesGrid
            images={paginatedImages}
            imageSize={imageSize}
            onOpenUploadDialog={onOpenUploadDialog}
            onDeleteImage={onDeleteImage}
            maxHeight="600px"
            annotations={annotations}
          />

          <PaginationControls
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={onPageChange}
          />
        </TabsContent>
        
        <TabsContent value="annotations" className="space-y-4">
          <AnnotationsContent
            id={id}
            onImportAnnotations={onImportAnnotations}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
