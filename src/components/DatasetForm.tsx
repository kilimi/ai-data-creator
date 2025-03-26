
import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dataset } from "@/types";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Loader2, Image as ImageIcon } from "lucide-react";

const datasetSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters" }).max(50, { message: "Name cannot exceed 50 characters" }),
  description: z.string().max(500, { message: "Description cannot exceed 500 characters" }).optional(),
  thumbnailUrl: z.string().url({ message: "Please enter a valid URL" }).optional(),
});

type DatasetFormValues = z.infer<typeof datasetSchema>;

interface DatasetFormProps {
  initialData?: Partial<Dataset>;
  onSubmit: (data: DatasetFormValues) => void;
  loading?: boolean;
}

export function DatasetForm({ initialData, onSubmit, loading = false }: DatasetFormProps) {
  const [thumbnailPreview, setThumbnailPreview] = useState<string | undefined>(initialData?.thumbnailUrl);
  
  const form = useForm<DatasetFormValues>({
    resolver: zodResolver(datasetSchema),
    defaultValues: {
      name: initialData?.name || "",
      description: initialData?.description || "",
      thumbnailUrl: initialData?.thumbnailUrl || "",
    },
  });
  
  const handleThumbnailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const url = e.target.value;
    form.setValue("thumbnailUrl", url);
    setThumbnailPreview(url);
  };
  
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Dataset name field */}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Dataset Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g., Vehicle Detection Dataset" {...field} />
              </FormControl>
              <FormDescription>
                A short, descriptive name for your dataset
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* Dataset description field */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="Describe the purpose and contents of this dataset..." 
                  className="resize-none min-h-[120px]"
                  {...field} 
                />
              </FormControl>
              <FormDescription>
                Optional description to help you remember what this dataset contains
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* Thumbnail URL field */}
        <FormField
          control={form.control}
          name="thumbnailUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Thumbnail URL</FormLabel>
              <FormControl>
                <Input 
                  placeholder="https://example.com/image.jpg" 
                  {...field} 
                  onChange={handleThumbnailChange}
                />
              </FormControl>
              <FormDescription>
                Optional URL for dataset thumbnail image
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* Thumbnail preview */}
        {thumbnailPreview && (
          <div className="rounded-md border overflow-hidden aspect-video relative">
            <img 
              src={thumbnailPreview} 
              alt="Thumbnail preview" 
              className="w-full h-full object-cover"
              onError={() => setThumbnailPreview(undefined)}
            />
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
              <Button 
                variant="secondary" 
                size="sm" 
                onClick={() => {
                  form.setValue("thumbnailUrl", "");
                  setThumbnailPreview(undefined);
                }}
              >
                Clear Image
              </Button>
            </div>
          </div>
        )}
        
        {!thumbnailPreview && (
          <div className="rounded-md border border-dashed p-8 flex flex-col items-center justify-center text-muted-foreground">
            <ImageIcon className="h-10 w-10 mb-2" />
            <p>No thumbnail image provided</p>
            <p className="text-sm">Add a URL to see a preview</p>
          </div>
        )}
        
        {/* Form actions */}
        <div className="flex justify-end space-x-4 pt-4">
          <Button 
            type="button" 
            variant="outline" 
            onClick={() => window.history.back()}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Dataset
          </Button>
        </div>
      </form>
    </Form>
  );
}
