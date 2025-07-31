import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AnnotationSample } from "@/utils/annotations";
import { Trash2 } from "lucide-react";

interface DeleteClassDialogProps {
  isOpen: boolean;
  onClose: () => void;
  className: string;
  annotations: AnnotationSample[];
  onDelete: (className: string) => void;
}

export function DeleteClassDialog({
  isOpen,
  onClose,
  className,
  annotations,
  onDelete,
}: DeleteClassDialogProps) {
  const classCount = annotations.filter(ann => ann.className === className).length;

  const handleDelete = () => {
    onDelete(className);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-gray-900 text-white border-gray-700">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-red-500" />
            Delete Class
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Are you sure you want to delete the "{className}" class? This will remove {classCount} annotation{classCount !== 1 ? 's' : ''} permanently.
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Class
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}