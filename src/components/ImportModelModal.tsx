import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileCode2, ListTree, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { getApiBaseUrl } from '@/config/api';

interface ImportModelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onImported?: () => void;
}

interface ParsedClasses {
  names: string[];
  raw: unknown;
}

/**
 * Parse a classes.json file. Accepts a few common shapes:
 *  - { "class_names": ["a","b"] }
 *  - { "names": ["a","b"] } or { "names": {"0":"a","1":"b"} }
 *  - ["a","b"]
 */
function parseClassesJson(text: string): ParsedClasses {
  const data = JSON.parse(text);
  let names: string[] = [];
  if (Array.isArray(data)) {
    names = data.map(String);
  } else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.class_names)) names = (obj.class_names as unknown[]).map(String);
    else if (Array.isArray(obj.names)) names = (obj.names as unknown[]).map(String);
    else if (obj.names && typeof obj.names === 'object') {
      names = Object.entries(obj.names as Record<string, unknown>)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, v]) => String(v));
    } else if (Array.isArray(obj.classes)) names = (obj.classes as unknown[]).map(String);
  }
  return { names, raw: data };
}

export function ImportModelModal({ open, onOpenChange, projectId, onImported }: ImportModelModalProps) {
  const { toast } = useToast();
  const onnxInputRef = useRef<HTMLInputElement | null>(null);
  const classesInputRef = useRef<HTMLInputElement | null>(null);

  const [modelName, setModelName] = useState('');
  const [onnxFile, setOnnxFile] = useState<File | null>(null);
  const [classesFile, setClassesFile] = useState<File | null>(null);
  const [classesParseError, setClassesParseError] = useState<string | null>(null);
  const [parsedClasses, setParsedClasses] = useState<ParsedClasses | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset state when re-opening
  useEffect(() => {
    if (!open) {
      setModelName('');
      setOnnxFile(null);
      setClassesFile(null);
      setClassesParseError(null);
      setParsedClasses(null);
      setSubmitting(false);
    }
  }, [open]);

  const pickOnnx = (file: File | null) => {
    if (!file) {
      setOnnxFile(null);
      return;
    }
    if (!/\.onnx$/i.test(file.name)) {
      toast({
        title: 'Unsupported file',
        description: 'Please select a .onnx model file.',
        variant: 'destructive',
      });
      return;
    }
    setOnnxFile(file);
    if (!modelName) {
      setModelName(file.name.replace(/\.onnx$/i, ''));
    }
  };

  const pickClasses = async (file: File | null) => {
    setClassesParseError(null);
    setParsedClasses(null);
    if (!file) {
      setClassesFile(null);
      return;
    }
    if (!/\.json$/i.test(file.name)) {
      setClassesParseError('classes file must be a .json file');
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseClassesJson(text);
      if (parsed.names.length === 0) {
        setClassesParseError(
          'Could not find class names. Expected { "class_names": [...] }, { "names": [...] }, or a JSON array.',
        );
        return;
      }
      setClassesFile(file);
      setParsedClasses(parsed);
    } catch (err) {
      setClassesParseError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const formatBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const canSubmit =
    !!onnxFile && !!classesFile && !!parsedClasses && parsedClasses.names.length > 0 && modelName.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !onnxFile || !classesFile) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('name', modelName.trim());
      fd.append('project_id', projectId);
      fd.append('onnx', onnxFile, onnxFile.name);
      fd.append('classes', classesFile, classesFile.name);

      const res = await fetch(`${getApiBaseUrl()}/training/import`, {
        method: 'POST',
        body: fd,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Import failed (${res.status})`);
      }

      toast({
        title: 'Model imported',
        description: `"${modelName.trim()}" was added to this project.`,
      });
      onImported?.();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Could not import model',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-primary" />
            Import Model
          </DialogTitle>
          <DialogDescription>
            Import an existing ONNX model and its class list. The model becomes available for inference in this project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Model name */}
          <div className="space-y-2">
            <Label htmlFor="import-model-name">Model name</Label>
            <Input
              id="import-model-name"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="e.g. yolo11n-crops-v1"
            />
          </div>

          {/* ONNX file */}
          <div className="space-y-2">
            <Label>Model file (.onnx)</Label>
            <input
              ref={onnxInputRef}
              type="file"
              accept=".onnx"
              className="hidden"
              onChange={(e) => pickOnnx(e.target.files?.[0] ?? null)}
            />
            {onnxFile ? (
              <div className="flex items-center gap-3 p-3 border rounded-md bg-muted/30">
                <FileCode2 className="w-5 h-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{onnxFile.name}</div>
                  <div className="text-xs text-muted-foreground">{formatBytes(onnxFile.size)}</div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setOnnxFile(null);
                    if (onnxInputRef.current) onnxInputRef.current.value = '';
                  }}
                  aria-label="Remove ONNX file"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={() => onnxInputRef.current?.click()}
              >
                <Upload className="w-4 h-4 mr-2" />
                Choose .onnx file
              </Button>
            )}
          </div>

          {/* classes.json */}
          <div className="space-y-2">
            <Label>Classes (classes.json)</Label>
            <input
              ref={classesInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => pickClasses(e.target.files?.[0] ?? null)}
            />
            {classesFile && parsedClasses ? (
              <div className="p-3 border rounded-md bg-muted/30 space-y-2">
                <div className="flex items-center gap-3">
                  <ListTree className="w-5 h-5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{classesFile.name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-green-600" />
                      {parsedClasses.names.length} classes detected
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setClassesFile(null);
                      setParsedClasses(null);
                      if (classesInputRef.current) classesInputRef.current.value = '';
                    }}
                    aria-label="Remove classes file"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-auto">
                  {parsedClasses.names.slice(0, 60).map((name, i) => (
                    <Badge key={`${name}-${i}`} variant="secondary" className="text-xs font-normal">
                      {i}: {name}
                    </Badge>
                  ))}
                  {parsedClasses.names.length > 60 && (
                    <Badge variant="outline" className="text-xs">
                      +{parsedClasses.names.length - 60} more
                    </Badge>
                  )}
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={() => classesInputRef.current?.click()}
              >
                <Upload className="w-4 h-4 mr-2" />
                Choose classes.json
              </Button>
            )}
            {classesParseError && (
              <div className="flex items-start gap-2 text-xs text-destructive">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{classesParseError}</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Accepted shapes: <code className="font-mono">{`{"class_names":[...]}`}</code>,{' '}
              <code className="font-mono">{`{"names":[...]}`}</code>, or a JSON array.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? 'Importing…' : 'Import model'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ImportModelModal;
