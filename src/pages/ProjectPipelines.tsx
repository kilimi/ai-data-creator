import React, { useState, useCallback, useEffect } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import ReactFlow, {
  Node,
  Edge,
  addEdge,
  Background,
  Controls,
  MiniMap,
  Connection,
  useNodesState,
  useEdgesState,
  MarkerType,
  NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useApi } from '@/hooks/use-api';
import { 
  Save, 
  Trash2, 
  Plus, 
  Settings, 
  Workflow, 
  Box, 
  Target, 
  Gauge, 
  ArrowRight,
  ChevronLeft,
  Sparkles,
  Layers,
  Filter,
  Percent,
  Calendar,
  Edit3,
  Play,
  MoreVertical,
  Copy,
  CheckCircle2
} from 'lucide-react';
import { Project } from '@/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Slider } from '@/components/ui/slider';

interface OutletContext {
  project: Project | null;
  loading: boolean;
}

// Custom Node Components with modern design
const ModelInputNode = ({ data }: any) => {
  return (
    <div className="px-4 py-3 shadow-lg rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white border border-blue-400/30 min-w-[180px] backdrop-blur-sm">
      <div className="flex items-center gap-2.5 mb-2">
        <div className="p-1.5 bg-white/20 rounded-lg">
          <Box className="h-4 w-4" />
        </div>
        <span className="font-semibold text-sm">Model Input</span>
      </div>
      {data.modelName && (
        <div className="text-xs bg-white/20 px-2.5 py-1.5 rounded-lg mt-1.5 truncate font-medium">
          {data.modelName}
        </div>
      )}
      {!data.modelName && (
        <div className="text-xs text-blue-100/80 italic">Click to configure</div>
      )}
    </div>
  );
};

const AreaThresholdNode = ({ data }: any) => {
  return (
    <div className="px-4 py-3 shadow-lg rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white border border-emerald-400/30 min-w-[180px] backdrop-blur-sm">
      <div className="flex items-center gap-2.5 mb-2">
        <div className="p-1.5 bg-white/20 rounded-lg">
          <Target className="h-4 w-4" />
        </div>
        <span className="font-semibold text-sm">Area Filter</span>
      </div>
      <div className="flex items-center gap-2 text-xs bg-white/20 px-2.5 py-1.5 rounded-lg mt-1.5 font-medium">
        <span>{data.minArea || 0}</span>
        <ArrowRight className="h-3 w-3" />
        <span>{data.maxArea || '∞'}</span>
      </div>
    </div>
  );
};

const ConfidenceThresholdNode = ({ data }: any) => {
  return (
    <div className="px-4 py-3 shadow-lg rounded-xl bg-gradient-to-br from-violet-500 to-violet-600 text-white border border-violet-400/30 min-w-[180px] backdrop-blur-sm">
      <div className="flex items-center gap-2.5 mb-2">
        <div className="p-1.5 bg-white/20 rounded-lg">
          <Gauge className="h-4 w-4" />
        </div>
        <span className="font-semibold text-sm">Confidence</span>
      </div>
      <div className="text-xs bg-white/20 px-2.5 py-1.5 rounded-lg mt-1.5 font-medium flex items-center gap-1.5">
        <Percent className="h-3 w-3" />
        <span>Min: {((data.minConfidence || 0.25) * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
};

const OutputNode = ({ data }: any) => {
  return (
    <div className="px-4 py-3 shadow-lg rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white border border-amber-400/30 min-w-[180px] backdrop-blur-sm">
      <div className="flex items-center gap-2.5 mb-2">
        <div className="p-1.5 bg-white/20 rounded-lg">
          <Layers className="h-4 w-4" />
        </div>
        <span className="font-semibold text-sm">Output</span>
      </div>
      <div className="text-xs bg-white/20 px-2.5 py-1.5 rounded-lg mt-1.5 font-medium">
        {data.outputCount || 0} detections
      </div>
    </div>
  );
};

const nodeTypes: NodeTypes = {
  modelInput: ModelInputNode,
  areaThreshold: AreaThresholdNode,
  confidenceThreshold: ConfidenceThresholdNode,
  output: OutputNode,
};

// Node palette item component
const NodePaletteItem = ({ icon: Icon, label, color, onClick }: { 
  icon: any; 
  label: string; 
  color: string; 
  onClick: () => void;
}) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center gap-1 transition-all hover:scale-105 active:scale-95 ${color} text-white shadow-lg hover:shadow-xl`}
        >
          <Icon className="h-5 w-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export default function ProjectPipelines() {
  const { id } = useParams<{ id: string }>();
  const { project } = useOutletContext<OutletContext>();
  const { toast } = useToast();
  const { api } = useApi();
  
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [showNodeConfig, setShowNodeConfig] = useState(false);
  const [trainingTasks, setTrainingTasks] = useState<any[]>([]);
  const [savedPipelines, setSavedPipelines] = useState<any[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string | null>(null);
  const [pipelineName, setPipelineName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showPipelineList, setShowPipelineList] = useState(true);
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  // Node configuration state
  const [nodeConfig, setNodeConfig] = useState({
    modelId: '',
    minArea: 0,
    maxArea: '',
    minConfidence: 0.25,
  });

  useEffect(() => {
    if (id) {
      fetchTrainingTasks();
      fetchSavedPipelines();
    }
  }, [id]);

  const fetchSavedPipelines = async () => {
    try {
      const response = await fetch(`http://localhost:9999/pipelines/?project_id=${id}`);
      if (response.ok) {
        const data = await response.json();
        setSavedPipelines(data.pipelines || []);
      }
    } catch (error) {
      console.error('Error fetching pipelines:', error);
    }
  };

  const fetchTrainingTasks = async () => {
    try {
      const response = await fetch(`http://localhost:9999/tasks/?project_id=${id}&task_type=yolo_training&status=completed`);
      const data = await response.json();
      setTrainingTasks(data || []);
    } catch (error) {
      console.error('Error fetching training tasks:', error);
    }
  };

  const savePipeline = async () => {
    if (!pipelineName.trim()) {
      toast({
        title: 'Pipeline name required',
        description: 'Please enter a name for the pipeline.',
        variant: 'destructive',
      });
      return;
    }

    const modelNode = nodes.find(n => n.type === 'modelInput');
    if (!modelNode || !modelNode.data.modelId) {
      toast({
        title: 'Invalid pipeline',
        description: 'Pipeline must have a configured Model Input node.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const response = await fetch('http://localhost:9999/pipelines/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: parseInt(id || '0'),
          name: pipelineName.trim(),
          nodes: nodes,
          edges: edges,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to save pipeline');
      }

      toast({
        title: 'Pipeline saved',
        description: `Pipeline "${pipelineName}" has been saved.`,
      });

      setShowSaveDialog(false);
      setPipelineName('');
      fetchSavedPipelines();
    } catch (error) {
      toast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Failed to save pipeline',
        variant: 'destructive',
      });
    }
  };

  const loadPipeline = (pipelineId: string) => {
    const pipeline = savedPipelines.find(p => p.id.toString() === pipelineId);
    if (pipeline) {
      setNodes(pipeline.nodes || []);
      setEdges(pipeline.edges || []);
      setSelectedPipeline(pipelineId);
      setShowPipelineList(false);
      setIsCreatingNew(false);
      toast({
        title: 'Pipeline loaded',
        description: `Loaded pipeline "${pipeline.name}".`,
      });
    }
  };

  const deletePipeline = async (pipelineId: string) => {
    if (!confirm('Are you sure you want to delete this pipeline?')) {
      return;
    }

    try {
      const response = await fetch(`http://localhost:9999/pipelines/${pipelineId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete pipeline');
      }

      toast({
        title: 'Pipeline deleted',
        description: 'Pipeline has been deleted.',
      });

      fetchSavedPipelines();
      if (selectedPipeline === pipelineId) {
        setNodes([]);
        setEdges([]);
        setSelectedPipeline(null);
      }
    } catch (error) {
      toast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : 'Failed to delete pipeline',
        variant: 'destructive',
      });
    }
  };

  const createNewPipeline = () => {
    setNodes([]);
    setEdges([]);
    setSelectedPipeline(null);
    setShowPipelineList(false);
    setIsCreatingNew(true);
  };

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      
      const sourceNode = nodes.find(n => n.id === params.source);
      const targetNode = nodes.find(n => n.id === params.target);
      
      if (sourceNode && targetNode) {
        if (targetNode.type !== 'modelInput') {
          setEdges((eds) => addEdge({ 
            ...params, 
            type: 'smoothstep', 
            animated: true,
            style: { stroke: '#94a3b8', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' }
          }, eds));
        }
      }
    },
    [nodes, setEdges]
  );

  const addNode = (type: string) => {
    const newNode: Node = {
      id: `${type}-${Date.now()}`,
      type,
      position: { x: Math.random() * 300 + 150, y: Math.random() * 300 + 100 },
      data: {
        label: type,
        ...(type === 'modelInput' ? { modelName: '' } : {}),
        ...(type === 'areaThreshold' ? { minArea: 0, maxArea: '' } : {}),
        ...(type === 'confidenceThreshold' ? { minConfidence: 0.25 } : {}),
        ...(type === 'output' ? { outputCount: 0 } : {}),
      },
    };
    setNodes((nds) => [...nds, newNode]);
  };

  const onNodeClick = (event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setNodeConfig({
      modelId: node.data.modelId || '',
      minArea: node.data.minArea || 0,
      maxArea: node.data.maxArea || '',
      minConfidence: node.data.minConfidence || 0.25,
    });
    setShowNodeConfig(true);
  };

  const saveNodeConfig = () => {
    if (!selectedNode) return;

    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === selectedNode.id) {
          const updatedData = { ...node.data };
          
          if (node.type === 'modelInput') {
            const selectedTask = trainingTasks.find(t => t.id.toString() === nodeConfig.modelId);
            updatedData.modelId = nodeConfig.modelId;
            updatedData.modelName = selectedTask?.name || '';
          } else if (node.type === 'areaThreshold') {
            updatedData.minArea = nodeConfig.minArea;
            updatedData.maxArea = nodeConfig.maxArea;
          } else if (node.type === 'confidenceThreshold') {
            updatedData.minConfidence = nodeConfig.minConfidence;
          }
          
          return { ...node, data: updatedData };
        }
        return node;
      })
    );
    
    setShowNodeConfig(false);
    setSelectedNode(null);
    toast({
      title: 'Node configured',
      description: 'Node settings have been saved.',
    });
  };

  const deleteNode = (nodeId: string) => {
    setNodes((nds) => nds.filter((node) => node.id !== nodeId));
    setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {!showPipelineList && (
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => {
                setShowPipelineList(true);
                setIsCreatingNew(false);
              }}
              className="shrink-0"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
                <Workflow className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">
                  {showPipelineList ? 'Pipelines' : isCreatingNew ? 'New Pipeline' : 'Edit Pipeline'}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {showPipelineList ? 'Create and manage post-processing pipelines' : 'Drag nodes to build your pipeline'}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {!showPipelineList && (
            <Button onClick={() => setShowSaveDialog(true)} disabled={nodes.length === 0}>
              <Save className="w-4 h-4 mr-2" />
              Save
            </Button>
          )}
          {showPipelineList && (
            <Button onClick={createNewPipeline} className="gap-2">
              <Plus className="w-4 h-4" />
              <span>New Pipeline</span>
            </Button>
          )}
        </div>
      </div>

      {/* Pipeline List View */}
      {showPipelineList && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {savedPipelines.map((pipeline) => (
            <Card 
              key={pipeline.id} 
              className="group hover:shadow-lg transition-all hover:border-primary/30 cursor-pointer"
              onClick={() => loadPipeline(pipeline.id.toString())}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-violet-500/5 border border-violet-500/20">
                      <Workflow className="h-4 w-4 text-violet-500" />
                    </div>
                    <div>
                      <CardTitle className="text-base group-hover:text-primary transition-colors">
                        {pipeline.name}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Calendar className="h-3 w-3" />
                        {new Date(pipeline.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => {
                        e.stopPropagation();
                        loadPipeline(pipeline.id.toString());
                      }}>
                        <Edit3 className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => {
                        e.stopPropagation();
                        // TODO: Duplicate pipeline
                      }}>
                        <Copy className="h-4 w-4 mr-2" />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={(e) => {
                          e.stopPropagation();
                          deletePipeline(pipeline.id.toString());
                        }}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    <Layers className="h-3 w-3 mr-1" />
                    {pipeline.nodes?.length || 0} nodes
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Ready
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
          
          {/* Empty State */}
          {savedPipelines.length === 0 && (
            <Card className="col-span-full border-dashed">
              <CardContent className="text-center py-16">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                  <Workflow className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">No Pipelines Yet</h3>
                <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                  Create your first pipeline to automate post-processing of model predictions
                </p>
                <Button onClick={createNewPipeline} className="gap-2">
                  <Sparkles className="w-4 h-4" />
                  Create Pipeline
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Pipeline Builder View */}
      {!showPipelineList && (
        <div className="flex gap-4 h-[calc(100vh-220px)]">
          {/* Node Palette - Vertical */}
          <div className="flex flex-col gap-2 p-2 bg-muted/50 rounded-xl border">
            <NodePaletteItem
              icon={Box}
              label="Model Input"
              color="bg-gradient-to-br from-blue-500 to-blue-600"
              onClick={() => addNode('modelInput')}
            />
            <NodePaletteItem
              icon={Target}
              label="Area Filter"
              color="bg-gradient-to-br from-emerald-500 to-emerald-600"
              onClick={() => addNode('areaThreshold')}
            />
            <NodePaletteItem
              icon={Gauge}
              label="Confidence"
              color="bg-gradient-to-br from-violet-500 to-violet-600"
              onClick={() => addNode('confidenceThreshold')}
            />
            <NodePaletteItem
              icon={Layers}
              label="Output"
              color="bg-gradient-to-br from-amber-500 to-orange-500"
              onClick={() => addNode('output')}
            />
          </div>

          {/* Pipeline Canvas */}
          <Card className="flex-1 overflow-hidden">
            <CardContent className="p-0 h-full">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={onNodeClick}
                nodeTypes={nodeTypes}
                fitView
                className="bg-muted/30"
              >
                <Background color="#94a3b8" gap={20} size={1} />
                <Controls className="bg-background border rounded-lg shadow-lg" />
                <MiniMap 
                  className="bg-background border rounded-lg shadow-lg !bottom-4 !right-4"
                  nodeColor={(node) => {
                    switch (node.type) {
                      case 'modelInput': return '#3b82f6';
                      case 'areaThreshold': return '#10b981';
                      case 'confidenceThreshold': return '#8b5cf6';
                      case 'output': return '#f59e0b';
                      default: return '#64748b';
                    }
                  }}
                />
              </ReactFlow>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Node Configuration Dialog */}
      <Dialog open={showNodeConfig} onOpenChange={setShowNodeConfig}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${
                selectedNode?.type === 'modelInput' ? 'bg-blue-500/20 text-blue-500' :
                selectedNode?.type === 'areaThreshold' ? 'bg-emerald-500/20 text-emerald-500' :
                selectedNode?.type === 'confidenceThreshold' ? 'bg-violet-500/20 text-violet-500' :
                'bg-amber-500/20 text-amber-500'
              }`}>
                {selectedNode?.type === 'modelInput' && <Box className="h-5 w-5" />}
                {selectedNode?.type === 'areaThreshold' && <Target className="h-5 w-5" />}
                {selectedNode?.type === 'confidenceThreshold' && <Gauge className="h-5 w-5" />}
                {selectedNode?.type === 'output' && <Layers className="h-5 w-5" />}
              </div>
              Configure {selectedNode?.type === 'modelInput' ? 'Model Input' :
                         selectedNode?.type === 'areaThreshold' ? 'Area Filter' :
                         selectedNode?.type === 'confidenceThreshold' ? 'Confidence Filter' : 'Output'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            {selectedNode?.type === 'modelInput' && (
              <div className="space-y-3">
                <Label className="text-sm font-medium">Trained Model</Label>
                <Select
                  value={nodeConfig.modelId}
                  onValueChange={(value) => setNodeConfig(prev => ({ ...prev, modelId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a trained model" />
                  </SelectTrigger>
                  <SelectContent>
                    {trainingTasks.map((task) => (
                      <SelectItem key={task.id} value={task.id.toString()}>
                        {task.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedNode?.type === 'areaThreshold' && (
              <>
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Minimum Area (px²)</Label>
                  <Input
                    type="number"
                    value={nodeConfig.minArea}
                    onChange={(e) => setNodeConfig(prev => ({ ...prev, minArea: parseInt(e.target.value) || 0 }))}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Maximum Area (px²)</Label>
                  <Input
                    type="text"
                    value={nodeConfig.maxArea}
                    onChange={(e) => setNodeConfig(prev => ({ ...prev, maxArea: e.target.value }))}
                    placeholder="No limit"
                  />
                </div>
              </>
            )}

            {selectedNode?.type === 'confidenceThreshold' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Minimum Confidence</Label>
                  <span className="text-lg font-semibold text-primary">
                    {(nodeConfig.minConfidence * 100).toFixed(0)}%
                  </span>
                </div>
                <Slider
                  value={[nodeConfig.minConfidence * 100]}
                  onValueChange={(value) => setNodeConfig(prev => ({ ...prev, minConfidence: value[0] / 100 }))}
                  max={100}
                  min={0}
                  step={1}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Predictions below this confidence will be filtered out
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            {selectedNode && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  deleteNode(selectedNode.id);
                  setShowNodeConfig(false);
                  setSelectedNode(null);
                }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            )}
            <Button onClick={saveNodeConfig} className="flex-1">
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save Pipeline Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/20">
                <Save className="h-5 w-5 text-primary" />
              </div>
              Save Pipeline
            </DialogTitle>
            <DialogDescription>
              Give your pipeline a name to save it for later use
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={pipelineName}
              onChange={(e) => setPipelineName(e.target.value)}
              placeholder="My Pipeline"
              className="h-12"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button onClick={savePipeline}>
              <Save className="w-4 h-4 mr-2" />
              Save Pipeline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
