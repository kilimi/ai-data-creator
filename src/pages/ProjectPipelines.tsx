import React, { useState, useCallback, useRef, useEffect } from 'react';
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
import { Save, Trash2, Plus, Settings, Workflow } from 'lucide-react';
import { Project } from '@/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface OutletContext {
  project: Project | null;
  loading: boolean;
}

// Custom Node Components
const ModelInputNode = ({ data }: any) => {
  return (
    <div className="px-4 py-3 shadow-lg rounded-lg bg-blue-500 text-white border-2 border-blue-600 min-w-[200px]">
      <div className="flex items-center gap-2 mb-2">
        <Settings className="h-4 w-4" />
        <div className="font-semibold">Model Input</div>
      </div>
      {data.modelName && (
        <div className="text-xs bg-blue-600/50 px-2 py-1 rounded mt-1">
          {data.modelName}
        </div>
      )}
      {!data.modelName && (
        <div className="text-xs text-blue-200">No model selected</div>
      )}
    </div>
  );
};

const AreaThresholdNode = ({ data }: any) => {
  return (
    <div className="px-4 py-3 shadow-lg rounded-lg bg-green-500 text-white border-2 border-green-600 min-w-[200px]">
      <div className="flex items-center gap-2 mb-2">
        <Settings className="h-4 w-4" />
        <div className="font-semibold">Area Threshold</div>
      </div>
      <div className="text-xs bg-green-600/50 px-2 py-1 rounded mt-1">
        Min: {data.minArea || 0} | Max: {data.maxArea || '∞'}
      </div>
    </div>
  );
};

const ConfidenceThresholdNode = ({ data }: any) => {
  return (
    <div className="px-4 py-3 shadow-lg rounded-lg bg-purple-500 text-white border-2 border-purple-600 min-w-[200px]">
      <div className="flex items-center gap-2 mb-2">
        <Settings className="h-4 w-4" />
        <div className="font-semibold">Confidence Filter</div>
      </div>
      <div className="text-xs bg-purple-600/50 px-2 py-1 rounded mt-1">
        Min: {data.minConfidence || 0}
      </div>
    </div>
  );
};

const OutputNode = ({ data }: any) => {
  return (
    <div className="px-4 py-3 shadow-lg rounded-lg bg-orange-500 text-white border-2 border-orange-600 min-w-[200px]">
      <div className="flex items-center gap-2 mb-2">
        <Settings className="h-4 w-4" />
        <div className="font-semibold">Output</div>
      </div>
      <div className="text-xs bg-orange-600/50 px-2 py-1 rounded mt-1">
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

    // Validate pipeline has at least a model input
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
      
      // Only allow connections from output to input
      const sourceNode = nodes.find(n => n.id === params.source);
      const targetNode = nodes.find(n => n.id === params.target);
      
      if (sourceNode && targetNode) {
        // Allow connections from any node type to processing nodes or output
        // Model Input -> Area Threshold/Confidence Filter -> Output
        if (targetNode.type !== 'modelInput') {
          setEdges((eds) => addEdge({ ...params, type: 'smoothstep', animated: true }, eds));
        }
      }
    },
    [nodes, setEdges]
  );

  const addNode = (type: string) => {
    const newNode: Node = {
      id: `${type}-${Date.now()}`,
      type,
      position: { x: Math.random() * 400 + 100, y: Math.random() * 400 + 100 },
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pipeline Builder</h1>
          <p className="text-muted-foreground mt-1">
            Create and manage post-processing pipelines for model predictions
          </p>
        </div>
        <div className="flex gap-2">
          {!showPipelineList && (
            <>
              <Button variant="outline" onClick={() => {
                setShowPipelineList(true);
                setIsCreatingNew(false);
              }}>
                Back to Pipelines
              </Button>
              <Button onClick={() => setShowSaveDialog(true)} disabled={nodes.length === 0}>
                <Save className="w-4 h-4 mr-2" />
                Save Pipeline
              </Button>
            </>
          )}
          {showPipelineList && (
            <Button onClick={createNewPipeline}>
              <Plus className="w-4 h-4 mr-2" />
              New Pipeline
            </Button>
          )}
        </div>
      </div>

      {/* Pipeline List View */}
      {showPipelineList && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {savedPipelines.map((pipeline) => (
            <Card key={pipeline.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <CardTitle className="text-base">{pipeline.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <div>Nodes: {pipeline.nodes?.length || 0}</div>
                  <div>Created: {new Date(pipeline.created_at).toLocaleDateString()}</div>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => loadPipeline(pipeline.id.toString())}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => deletePipeline(pipeline.id.toString())}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {savedPipelines.length === 0 && (
            <Card className="col-span-full">
              <CardContent className="text-center py-12">
                <Workflow className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-medium mb-2">No Pipelines Yet</h3>
                <p className="text-muted-foreground mb-4">
                  Create your first pipeline to start processing model predictions
                </p>
                <Button onClick={createNewPipeline}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Pipeline
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Pipeline Builder View */}
      {!showPipelineList && (
      <div className="grid grid-cols-4 gap-4">
        {/* Node Palette */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Node Palette</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => addNode('modelInput')}
            >
              <Plus className="w-4 h-4 mr-2" />
              Model Input
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => addNode('areaThreshold')}
            >
              <Plus className="w-4 h-4 mr-2" />
              Area Threshold
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => addNode('confidenceThreshold')}
            >
              <Plus className="w-4 h-4 mr-2" />
              Confidence Filter
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => addNode('output')}
            >
              <Plus className="w-4 h-4 mr-2" />
              Output
            </Button>
          </CardContent>
        </Card>

        {/* Pipeline Canvas */}
        <div className="col-span-3">
          <Card className="h-[600px]">
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
              >
                <Background />
                <Controls />
                <MiniMap />
              </ReactFlow>
            </CardContent>
          </Card>
        </div>
      </div>
      )}

      {/* Save Pipeline Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Pipeline</DialogTitle>
            <DialogDescription>
              Enter a name for your pipeline. You can run it later from the Evaluations page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="pipeline-name">Pipeline Name</Label>
              <Input
                id="pipeline-name"
                value={pipelineName}
                onChange={(e) => setPipelineName(e.target.value)}
                placeholder="e.g., Small Object Filter"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && pipelineName.trim()) {
                    savePipeline();
                  }
                }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button onClick={savePipeline} disabled={!pipelineName.trim()}>
              <Save className="w-4 h-4 mr-2" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Node Configuration Dialog */}
      <Dialog open={showNodeConfig} onOpenChange={setShowNodeConfig}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure Node</DialogTitle>
            <DialogDescription>
              Configure the settings for {selectedNode?.type || 'this node'}
            </DialogDescription>
          </DialogHeader>
          
          {selectedNode?.type === 'modelInput' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Select Model</Label>
                <Select value={nodeConfig.modelId} onValueChange={(v) => setNodeConfig({ ...nodeConfig, modelId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a model" />
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
            </div>
          )}

          {selectedNode?.type === 'areaThreshold' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Minimum Area (pixels²)</Label>
                <Input
                  type="number"
                  value={nodeConfig.minArea}
                  onChange={(e) => setNodeConfig({ ...nodeConfig, minArea: parseFloat(e.target.value) || 0 })}
                  min="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Maximum Area (pixels², optional)</Label>
                <Input
                  type="number"
                  value={nodeConfig.maxArea}
                  onChange={(e) => setNodeConfig({ ...nodeConfig, maxArea: e.target.value })}
                  placeholder="Leave empty for no maximum"
                  min="0"
                />
              </div>
            </div>
          )}

          {selectedNode?.type === 'confidenceThreshold' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Minimum Confidence (0-1)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={nodeConfig.minConfidence}
                  onChange={(e) => setNodeConfig({ ...nodeConfig, minConfidence: parseFloat(e.target.value) || 0 })}
                  min="0"
                  max="1"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              if (selectedNode) {
                deleteNode(selectedNode.id);
              }
              setShowNodeConfig(false);
            }}>
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
            <Button onClick={saveNodeConfig}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
