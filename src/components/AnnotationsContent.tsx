
import { Card } from "@/components/ui/card";

interface AnnotationsContentProps {
  id: string;
}

export function AnnotationsContent({ id }: AnnotationsContentProps) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Annotations</h2>
      </div>
      <Card className="p-6">
        <p className="text-muted-foreground text-center">
          Annotation functionality will be implemented here
        </p>
      </Card>
    </div>
  );
}
