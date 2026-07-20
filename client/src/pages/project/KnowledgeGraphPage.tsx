import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  MapPin,
  Building2,
  Network,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Loader2,
  FileText,
  Filter,
  List,
} from "lucide-react";
import ForceGraph2D from "react-force-graph-2d";
import { useLocation } from "wouter";

// ─── Types ──────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  type: string;
  // ForceGraph2D adds these at runtime
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  context: string | null;
}

// ─── Color mapping ──────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  person: "#f97316",       // orange
  location: "#22c55e",     // green
  organization: "#6366f1", // indigo
  document: "#64748b",     // slate
};

const TYPE_ICONS: Record<string, typeof Users> = {
  person: Users,
  location: MapPin,
  organization: Building2,
  document: FileText,
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function KnowledgeGraphPage({ projectId }: { projectId: number }) {
  const [, navigate] = useLocation();
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const graphRef = useRef<any>(null);

  const { data: graphData, isLoading: graphLoading } = trpc.entities.graph.useQuery({ projectId });
  const { data: stats, isLoading: statsLoading } = trpc.entities.stats.useQuery({ projectId });
  const { data: entityList } = trpc.entities.list.useQuery({ projectId });

  const reindexMutation = trpc.entities.reindexAll.useMutation();
  const utils = trpc.useUtils();

  // Build filtered graph data for ForceGraph2D
  const filteredGraph = useMemo(() => {
    if (!graphData) return { nodes: [], links: [] };

    let nodes = graphData.nodes as GraphNode[];
    let edges = graphData.edges as GraphLink[];

    if (activeFilter !== "all") {
      // Keep only nodes of the selected type + all document nodes connected to them
      const filteredEntityIds = new Set(
        nodes.filter((n) => n.type === activeFilter).map((n) => n.id),
      );
      const connectedDocIds = new Set(
        edges
          .filter((e) => filteredEntityIds.has(e.target as string))
          .map((e) => e.source as string),
      );
      nodes = nodes.filter(
        (n) => filteredEntityIds.has(n.id) || connectedDocIds.has(n.id),
      );
      const nodeIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter(
        (e) => nodeIds.has(e.source as string) && nodeIds.has(e.target as string),
      );
    }

    return {
      nodes: nodes.map((n) => ({ ...n })),
      links: edges.map((e) => ({ ...e })),
    };
  }, [graphData, activeFilter]);

  // Node canvas renderer
  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label = node.label || "";
    const type = node.type || "document";
    const color = TYPE_COLORS[type] || "#94a3b8";
    const isDocument = type === "document";
    const isSelected = selectedNode?.id === node.id;
    const radius = isDocument ? 4 : 6;
    const fontSize = Math.max(10 / globalScale, 1.5);

    // Draw node circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();

    // Selection ring
    if (isSelected) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 / globalScale;
      ctx.stroke();
    }

    // Label
    if (globalScale > 0.8 || isSelected) {
      ctx.font = `${isSelected ? "bold " : ""}${fontSize}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#e2e8f0";
      const maxLen = isDocument ? 15 : 25;
      const displayLabel = label.length > maxLen ? label.slice(0, maxLen) + "…" : label;
      ctx.fillText(displayLabel, node.x, node.y + radius + 2);
    }
  }, [selectedNode]);

  // Handle node click
  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode((prev: GraphNode | null) => (prev?.id === node.id ? null : node));
    if (graphRef.current) {
      graphRef.current.centerAt(node.x, node.y, 500);
      graphRef.current.zoom(3, 500);
    }
  }, []);

  // Zoom controls
  const handleZoomIn = () => graphRef.current?.zoom(graphRef.current.zoom() * 1.5, 300);
  const handleZoomOut = () => graphRef.current?.zoom(graphRef.current.zoom() / 1.5, 300);
  const handleFitAll = () => graphRef.current?.zoomToFit(400, 40);

  // Handle reindex
  const handleReindex = async () => {
    await reindexMutation.mutateAsync({ projectId });
    utils.entities.graph.invalidate();
    utils.entities.stats.invalidate();
    utils.entities.list.invalidate();
  };

  // Get connected entities for selected node
  const selectedConnections = useMemo(() => {
    if (!selectedNode || !graphData) return [];
    const connected = graphData.edges
      .filter(
        (e) =>
          (e.source as string) === selectedNode.id ||
          (e.target as string) === selectedNode.id,
      )
      .map((e) => {
        const otherId =
          (e.source as string) === selectedNode.id
            ? (e.target as string)
            : (e.source as string);
        const otherNode = graphData.nodes.find((n) => n.id === otherId);
        return {
          id: otherId,
          label: otherNode?.label || otherId,
          type: otherNode?.type || "unknown",
          context: e.context,
        };
      });
    return connected;
  }, [selectedNode, graphData]);

  const isEmpty = !graphLoading && (!graphData || graphData.nodes.length === 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Network className="h-5 w-5 text-indigo-400" />
          <div>
            <h2 className="text-lg font-semibold">Entity Graph</h2>
            <p className="text-sm text-muted-foreground">
              Visual connections between people, places, and organizations
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground gap-1.5"
            onClick={() => navigate("/entities")}
          >
            <List className="w-3.5 h-3.5" />
            List view
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReindex}
            disabled={reindexMutation.isPending}
          >
            {reindexMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Extract Entities
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      {stats && !statsLoading && (
        <div className="flex items-center gap-4 px-6 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-orange-400" />
            <span className="text-sm">{stats.persons} People</span>
          </div>
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-green-400" />
            <span className="text-sm">{stats.locations} Places</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-indigo-400" />
            <span className="text-sm">{stats.organizations} Organizations</span>
          </div>
          <div className="text-sm text-muted-foreground ml-auto">
            {stats.total} total entities
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Graph area */}
        <div className="flex-1 relative bg-background">
          {graphLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <Network className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium mb-2">No entities extracted yet</h3>
              <p className="text-sm text-muted-foreground max-w-md mb-4">
                Entities are automatically extracted when you review documents. You can also
                click "Extract Entities" to process all reviewed documents at once.
              </p>
              <Button
                onClick={handleReindex}
                disabled={reindexMutation.isPending}
              >
                {reindexMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Extract Entities from Reviewed Documents
              </Button>
            </div>
          ) : (
            <>
              {/* Filter tabs */}
              <div className="absolute top-3 left-3 z-10">
                <Tabs value={activeFilter} onValueChange={setActiveFilter}>
                  <TabsList className="bg-background/80 backdrop-blur">
                    <TabsTrigger value="all" className="text-xs">
                      <Filter className="h-3 w-3 mr-1" /> All
                    </TabsTrigger>
                    <TabsTrigger value="person" className="text-xs">
                      <Users className="h-3 w-3 mr-1" /> People
                    </TabsTrigger>
                    <TabsTrigger value="location" className="text-xs">
                      <MapPin className="h-3 w-3 mr-1" /> Places
                    </TabsTrigger>
                    <TabsTrigger value="organization" className="text-xs">
                      <Building2 className="h-3 w-3 mr-1" /> Orgs
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {/* Zoom controls */}
              <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8 bg-background/80 backdrop-blur" onClick={handleZoomIn}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8 bg-background/80 backdrop-blur" onClick={handleZoomOut}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8 bg-background/80 backdrop-blur" onClick={handleFitAll}>
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </div>

              {/* Legend */}
              <div className="absolute bottom-3 left-3 z-10 flex items-center gap-3 bg-background/80 backdrop-blur rounded-md px-3 py-2">
                {Object.entries(TYPE_COLORS).map(([type, color]) => (
                  <div key={type} className="flex items-center gap-1.5">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs capitalize text-muted-foreground">{type}</span>
                  </div>
                ))}
              </div>

              <ForceGraph2D
                ref={graphRef}
                graphData={filteredGraph}
                nodeId="id"
                nodeCanvasObject={paintNode}
                nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, 8, 0, 2 * Math.PI);
                  ctx.fillStyle = color;
                  ctx.fill();
                }}
                linkColor={() => "rgba(100, 116, 139, 0.3)"}
                linkWidth={1}
                onNodeClick={handleNodeClick}
                backgroundColor="transparent"
                cooldownTicks={100}
                onEngineStop={() => graphRef.current?.zoomToFit(400, 40)}
                enableNodeDrag={true}
              />
            </>
          )}
        </div>

        {/* Detail panel */}
        {selectedNode && (
          <div className="w-80 border-l border-border bg-muted/20 overflow-y-auto">
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: TYPE_COLORS[selectedNode.type] || "#94a3b8" }}
                />
                <Badge variant="outline" className="capitalize text-xs">
                  {selectedNode.type}
                </Badge>
              </div>
              <h3 className="text-lg font-semibold mb-1">{selectedNode.label}</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Connected to {selectedConnections.length} {selectedNode.type === "document" ? "entities" : "documents"}
              </p>

              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  Connections
                </h4>
                {selectedConnections.map((conn, i) => {
                  const Icon = TYPE_ICONS[conn.type] || FileText;
                  return (
                    <Card key={i} className="bg-background">
                      <CardContent className="p-3">
                        <div className="flex items-start gap-2">
                          <Icon
                            className="h-4 w-4 mt-0.5 shrink-0"
                            style={{ color: TYPE_COLORS[conn.type] || "#94a3b8" }}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{conn.label}</p>
                            <Badge variant="outline" className="capitalize text-[10px] mt-1">
                              {conn.type}
                            </Badge>
                            {conn.context && (
                              <p className="text-xs text-muted-foreground mt-1.5 line-clamp-3">
                                "{conn.context}"
                              </p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                {selectedConnections.length === 0 && (
                  <p className="text-sm text-muted-foreground">No connections found</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
