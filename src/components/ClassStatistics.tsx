
import { Progress } from "@/components/ui/progress";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";

interface ClassStatisticsProps {
  statistics: {
    className: string;
    count: number;
    color: string;
  }[];
}

export function ClassStatistics({ statistics }: ClassStatisticsProps) {
  // Calculate the total count for percentage calculations
  const totalCount = statistics.reduce((sum, stat) => sum + stat.count, 0);
  
  return (
    <div className="space-y-6">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12"></TableHead>
            <TableHead>Class</TableHead>
            <TableHead className="text-right">Count</TableHead>
            <TableHead className="text-right">Percentage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {statistics.map((stat, index) => {
            const percentage = totalCount > 0 ? (stat.count / totalCount) * 100 : 0;
            
            return (
              <TableRow key={index}>
                <TableCell>
                  <div 
                    className="w-4 h-4 rounded-full" 
                    style={{ backgroundColor: stat.color }}
                  />
                </TableCell>
                <TableCell className="font-medium">{stat.className}</TableCell>
                <TableCell className="text-right">{stat.count.toLocaleString()}</TableCell>
                <TableCell className="text-right">{percentage.toFixed(1)}%</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      
      <div className="space-y-2">
        <h3 className="text-sm font-medium mb-2">Distribution</h3>
        <div className="flex h-4 w-full overflow-hidden rounded-full">
          {statistics.map((stat, index) => {
            const width = totalCount > 0 ? (stat.count / totalCount) * 100 : 0;
            return (
              <div
                key={index}
                className="h-full transition-all"
                style={{
                  width: `${width}%`,
                  backgroundColor: stat.color,
                  minWidth: width > 0 ? '4px' : '0'
                }}
                title={`${stat.className}: ${stat.count} (${width.toFixed(1)}%)`}
              />
            );
          })}
        </div>
        <div className="pt-2">
          {statistics.map((stat, index) => (
            <div key={index} className="flex items-center justify-between my-1">
              <div className="flex items-center">
                <div 
                  className="w-3 h-3 rounded-full mr-2" 
                  style={{ backgroundColor: stat.color }}
                />
                <span className="text-sm">{stat.className}</span>
              </div>
              <div className="w-full max-w-[180px]">
                <Progress 
                  value={totalCount > 0 ? (stat.count / totalCount) * 100 : 0} 
                  className="h-2"
                  indicatorClassName="bg-primary"
                />
              </div>
              <span className="text-sm text-muted-foreground ml-2 w-12 text-right">
                {totalCount > 0 ? ((stat.count / totalCount) * 100).toFixed(1) : 0}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
