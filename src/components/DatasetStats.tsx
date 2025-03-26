
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, FileImage, Layers, Tag } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DatasetStats as DatasetStatsType, StatsTimeframe } from "@/types";
import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface DatasetStatsProps {
  stats: DatasetStatsType;
}

export function DatasetStats({ stats }: DatasetStatsProps) {
  const [timeframe, setTimeframe] = useState<StatsTimeframe>("week");
  
  const chartData = stats.recentActivity.map(activity => ({
    date: formatDate(activity.date, timeframe),
    Images: activity.imagesAdded,
    Annotations: activity.annotationsAdded,
  }));
  
  return (
    <Card className="bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-xl">Dataset Statistics</CardTitle>
        <CardDescription>
          Overview and analytics of your dataset
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <StatCard 
            title="Images" 
            value={stats.imageCount} 
            icon={<FileImage className="h-4 w-4" />} 
          />
          <StatCard 
            title="Annotations" 
            value={stats.annotationCount} 
            icon={<Layers className="h-4 w-4" />} 
          />
          <StatCard 
            title="Categories" 
            value={stats.categoriesCount} 
            icon={<Tag className="h-4 w-4" />} 
          />
        </div>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-md font-medium">Recent Activity</h3>
            <div className="flex items-center space-x-1">
              {(['day', 'week', 'month'] as const).map((period) => (
                <Button
                  key={period}
                  variant={timeframe === period ? "secondary" : "ghost"}
                  size="sm"
                  className="text-xs h-7 px-2"
                  onClick={() => setTimeframe(period)}
                >
                  {capitalizeFirstLetter(period)}
                </Button>
              ))}
            </div>
          </div>
          
          <div className="h-[300px] w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{
                  top: 5,
                  right: 30,
                  left: 10,
                  bottom: 5,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--muted)" opacity={0.3} />
                <XAxis 
                  dataKey="date" 
                  stroke="var(--muted-foreground)" 
                  fontSize={12}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                />
                <YAxis 
                  stroke="var(--muted-foreground)" 
                  fontSize={12}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="Images" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar dataKey="Annotations" fill="var(--muted-foreground)" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
  return (
    <Card className="flex flex-col p-4 border border-border/50">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        <div className="rounded-full p-1.5 bg-muted text-muted-foreground">
          {icon}
        </div>
      </div>
      <p className="mt-2 text-2xl font-semibold">{value.toLocaleString()}</p>
    </Card>
  );
}

function formatDate(dateString: string, timeframe: StatsTimeframe): string {
  const date = new Date(dateString);
  
  if (timeframe === "day") {
    return `${date.getHours()}:00`;
  } else if (timeframe === "week") {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  } else if (timeframe === "month") {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } else {
    return date.toLocaleDateString(undefined, { month: 'short' });
  }
}

function capitalizeFirstLetter(string: string): string {
  return string.charAt(0).toUpperCase() + string.slice(1);
}
