
import { useState, useRef } from "react";
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
import { Loader2, Image as ImageIcon, UploadCloud, X } from "lucide-react";

const datasetSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters" }).max(50, { message: "Name cannot exceed 50 characters" }),
  description: z.string().max(500, { message: "Description cannot exceed 500 characters" }).optional(),
});

type DatasetFormValues = z.infer<typeof datasetSchema>;

interface DatasetFormProps {
  initialData?: Partial<Dataset>;
  onSubmit: (data: DatasetFormValues, logoFile?: File) => void;
  loading?: boolean;
}

export function DatasetForm({ initialData, onSubmit, loading = false }: DatasetFormProps) {
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | undefined>(initialData?.thumbnailUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const form = useForm<DatasetFormValues>({
    resolver: zodResolver(datasetSchema),
    defaultValues: {
      name: initialData?.name || "",
      description: initialData?.description || "",
    },
  });
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      
      // Check if file is an image
      if (!file.type.startsWith('image/')) {
        return;
      }
      
      // Check file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        return;
      }
      
      setLogoFile(file);
      
      // Create preview URL
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
    setLogoPreview(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  
  const handleSubmit = (data: DatasetFormValues) => {
    onSubmit(data, logoFile || undefined);
  };
  
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
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
        
        {/* Logo upload section */}
        <div className="space-y-2">
          <FormLabel>Dataset Logo</FormLabel>
          <FormDescription>
            Optional logo for your dataset (max 5MB)
          </FormDescription>
          
          {!logoPreview ? (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer rounded-md border-2 border-dashed border-muted-foreground/25 hover:border-muted-foreground/50 transition-all p-8 flex flex-col items-center justify-center text-center"
            >
              <UploadCloud className="h-10 w-10 mb-2 text-muted-foreground" />
              <p className="text-muted-foreground">Click to upload a logo image</p>
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
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        
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
