import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Tag, AlertCircle, ChevronDown } from "lucide-react";
import { AnnotationSample } from "@/utils/annotations";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface AnnotationsContentProps {
  id: string;
}

export function AnnotationsContent({ id }: AnnotationsContentProps) {
  const [isDistributionOpen, setIsDistributionOpen] = useState(true);
  const [isActivityOpen, setIsActivityOpen] = useState(true);

  // Mock data (unchanged)
  const mockAnnotations = [
    {
      className: "Car",
      count: 245,
      confidence: 0.92,
      color: "#3498db"
    },
    {
      className: "Person",
      count: 189,
      confidence: 0.88,
      color: "#e74c3c"
    },
    {
      className: "Traffic Light",
      count: 67,
      confidence: 0.85,
      color: "#2ecc71"
    }
  ];

  const totalAnnotations = mockAnnotations.reduce((acc, curr) => acc + curr.count, 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold mb-1">Annotations</h2>
          <p className="text-sm text-muted-foreground">
            {totalAnnotations} annotations across {mockAnnotations.length} classes
          </p>
        </div>
        <div className="flex gap-2">
          <Button className="bg-blue-600 hover:bg-blue-700">
            <Tag className="w-4 h-4 mr-2" />
            Start Annotating
          </Button>
          <Button variant="outline" className="border-gray-700 bg-gray-800 hover:bg-gray-700">
            <Upload className="w-4 h-4 mr-2" />
            Import COCO
          </Button>
        </div>
      </div>

      <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
        <Collapsible open={isDistributionOpen} onOpenChange={setIsDistributionOpen}>
          <Card className="bg-gray-900/50 border-gray-700">
            <CollapsibleTrigger asChild>
              <Button 
                variant="ghost" 
                className="w-full flex items-center justify-between p-6 cursor-pointer hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-medium">Classes Distribution</h3>
                  <Badge variant="outline" className="bg-gray-800 border-gray-700">
                    {mockAnnotations.length} classes
                  </Badge>
                </div>
                <ChevronDown className={cn(
                  "h-5 w-5 shrink-0 text-gray-400 transition-transform duration-200",
                  isDistributionOpen ? "transform rotate-180" : ""
                )} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-6 pb-6">
                <ScrollArea className="h-[300px] pr-4">
                  <div className="space-y-4">
                    {mockAnnotations.map((annotation, index) => (
                      <div key={index} className="space-y-2">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: annotation.color }}
                            />
                            <span className="font-medium">{annotation.className}</span>
                          </div>
                          <Badge
                            variant="outline"
                            className="bg-gray-800 border-gray-700"
                          >
                            {annotation.count}
                          </Badge>
                        </div>
                        <Progress
                          value={(annotation.count / totalAnnotations) * 100}
                          className={cn(
                            "h-2 [&[role=progressbar]]:bg-gray-800",
                            "[&>div]:transition-all [&>div]:duration-500"
                          )}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${(annotation.count / totalAnnotations) * 100}%`, backgroundColor: annotation.color }}
                          />
                        </Progress>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{((annotation.count / totalAnnotations) * 100).toFixed(1)}% of total</span>
                          <span>Avg. confidence: {(annotation.confidence * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <Collapsible open={isActivityOpen} onOpenChange={setIsActivityOpen}>
          <Card className="bg-gray-900/50 border-gray-700">
            <CollapsibleTrigger asChild>
              <Button 
                variant="ghost" 
                className="w-full flex items-center justify-between p-6 cursor-pointer hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-medium">Recent Activity</h3>
                  <Badge variant="outline" className="bg-gray-800 border-gray-700">
                    Upcoming
                  </Badge>
                </div>
                <ChevronDown className={cn(
                  "h-5 w-5 shrink-0 text-gray-400 transition-transform duration-200",
                  isActivityOpen ? "transform rotate-180" : ""
                )} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-6 pb-6">
                <div className="flex items-center justify-center h-[300px] text-center">
                  <div className="text-muted-foreground">
                    <AlertCircle className="w-12 h-12 mx-auto mb-4 text-blue-500/50" />
                    <p className="mb-2">Annotation tracking will be available soon</p>
                    <p className="text-sm">
                      Track your annotation progress and review recent changes in real-time
                    </p>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>
    </div>
  );
}
