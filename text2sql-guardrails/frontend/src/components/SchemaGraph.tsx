import { useEffect, useMemo, useState } from "react";
import {
  Background, BackgroundVariant, BaseEdge, Controls, EdgeLabelRenderer, Handle, MiniMap,
  Position, ReactFlow, ReactFlowProvider, applyNodeChanges, getSmoothStepPath, useReactFlow,
  type Edge, type EdgeProps, type Node, type NodeProps,
} from "@xyflow/react";
import { Graph, layout } from "@dagrejs/dagre";
import "@xyflow/react/dist/base.css";
import type { TableInfo } from "../types/api";

// Module colour = what part of the ERP a table belongs to (--mod-* tokens,
// a categorical palette kept apart from the success/danger/info colours).
const MODULES: { key: string; label: string; color: string; match: (t: string) => boolean }[] = [
  { key: "placement", label: "Placement", color: "var(--mod-placement)", match: (t) => t.startsWith("placement_") },
  { key: "library", label: "Library", color: "var(--mod-library)", match: (t) => t.startsWith("library_") },
  { key: "fees", label: "Fees", color: "var(--mod-fees)", match: (t) => t.startsWith("fee_") },
  { key: "exams", label: "Exams & marks", color: "var(--mod-exams)", match: (t) => t.startsWith("exam") || t === "marks" },
  { key: "attendance", label: "Attendance", color: "var(--mod-attendance)", match: (t) => t === "attendance" },
  { key: "academic", label: "Academic", color: "var(--mod-academic)", match: () => true },
];
const moduleOf = (t: string) => MODULES.find((m) => m.match(t))!;

const HEADER_H = 40;
const ROW_H = 22;
const FOOT_H = 24;
const NODE_W = 230;

type TableData = { table: TableInfo; keys: TableInfo["columns"]; others: number; state: "normal" | "focus" | "dim"; index: number };
type TableNode = Node<TableData, "table">;
type RelData = { state: "normal" | "focus" | "dim" };
type RelEdge = Edge<RelData, "rel">;

const fmtRows = (n?: number | null) =>
  n == null ? "" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M rows` : n >= 1e3 ? `${Math.round(n / 1e3)}k rows` : `${n} rows`;

function TableCard({ data }: NodeProps<TableNode>) {
  const mod = moduleOf(data.table.name);
  return (
    <div
      className={`erd-node erd-${data.state}`}
      style={{ width: NODE_W, animationDelay: `${Math.min(data.index, 24) * 25}ms`, ["--mod" as string]: mod.color }}
    >
      <div className="erd-head" style={{ height: HEADER_H }}>
        <span aria-hidden className="erd-dot" />
        <span className="truncate font-mono text-[12px] font-semibold">{data.table.name}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>{fmtRows(data.table.row_estimate)}</span>
      </div>
      {data.keys.map((c) => (
        <div key={c.name} className="erd-row" style={{ height: ROW_H }}>
          <Handle type="target" id={`${c.name}-t`} position={Position.Left} className="erd-handle" />
          <span aria-hidden className="material-symbols-outlined text-[13px]" style={{ color: c.is_primary_key ? "var(--accent)" : "var(--text-muted)" }}>
            {c.is_primary_key ? "key" : "link"}
          </span>
          <span className="truncate">{c.name}</span>
          <span className="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>{c.data_type.toLowerCase().split("(")[0]}</span>
          <Handle type="source" id={`${c.name}-s`} position={Position.Right} className="erd-handle" />
        </div>
      ))}
      <div className="erd-foot" style={{ height: FOOT_H }}>{data.others ? `+ ${data.others} more column${data.others > 1 ? "s" : ""}` : "all columns shown"}</div>
    </div>
  );
}

/** Power BI-style relationship line: "*" at the many (FK) end, "1" at the one (PK) end. */
function Relation({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, id }: EdgeProps<RelEdge>) {
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10 });
  const state = data?.state ?? "normal";
  const mark = (x: number, y: number, side: number, text: string) => (
    <div className={`erd-card erd-card-${state}`} style={{ transform: `translate(-50%, -50%) translate(${x + side * 12}px, ${y - 9}px)` }}>{text}</div>
  );
  return (
    <>
      <BaseEdge id={id} path={path} className={`erd-edge erd-edge-${state}`} />
      <EdgeLabelRenderer>
        {mark(sourceX, sourceY, sourcePosition === Position.Right ? 1 : -1, "*")}
        {mark(targetX, targetY, targetPosition === Position.Left ? -1 : 1, "1")}
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { table: TableCard };
const edgeTypes = { rel: Relation };

function build(tables: TableInfo[]) {
  // Columns that need a visible row: keys, plus any column another table points at.
  const referenced = new Set(tables.flatMap((t) => t.columns.filter((c) => c.references).map((c) => c.references!)));
  const edges: RelEdge[] = [];
  const g = new Graph();
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 110, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  const nodes: TableNode[] = tables.map((t, index) => {
    const keys = t.columns.filter((c) => c.is_primary_key || c.is_foreign_key || referenced.has(`${t.name}.${c.name}`));
    g.setNode(t.name, { width: NODE_W, height: HEADER_H + keys.length * ROW_H + FOOT_H });
    for (const c of t.columns) {
      if (!c.references) continue;
      const [refTable, refCol] = c.references.split(".");
      edges.push({
        id: `${t.name}.${c.name}->${c.references}`, type: "rel",
        source: t.name, sourceHandle: `${c.name}-s`, target: refTable, targetHandle: `${refCol}-t`,
        data: { state: "normal" },
      });
      g.setEdge(t.name, refTable);
    }
    return { id: t.name, type: "table", position: { x: 0, y: 0 }, data: { table: t, keys, others: t.columns.length - keys.length, state: "normal", index } };
  });

  layout(g);
  for (const n of nodes) {
    const p = g.node(n.id);
    n.position = { x: p.x - p.width / 2, y: p.y - p.height / 2 };
  }
  return { nodes, edges };
}

function Canvas({ tables, query }: { tables: TableInfo[]; query: string }) {
  const initial = useMemo(() => build(tables), [tables]);
  const [nodes, setNodes] = useState(initial.nodes);
  const flow = useReactFlow();
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Selection is derived: the search hit, until the user clicks; a click
  // (remembered with the query it was made under) wins until the query changes.
  const hit = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return (tables.find((t) => t.name.toLowerCase().includes(q))
      ?? tables.find((t) => t.columns.some((c) => c.name.toLowerCase().includes(q))))?.name ?? null;
  }, [query, tables]);
  const [click, setClick] = useState<{ id: string | null; query: string } | null>(null);
  const selected = click && click.query === query ? click.id : hit;
  const select = (id: string | null) => setClick({ id, query });

  // Neighbourhood of the selected table: itself + every table one relationship away.
  const near = useMemo(() => {
    if (!selected) return null;
    const s = new Set([selected]);
    for (const e of initial.edges) {
      if (e.source === selected) s.add(e.target);
      if (e.target === selected) s.add(e.source);
    }
    return s;
  }, [selected, initial.edges]);

  const shownNodes = useMemo(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, state: !near ? "normal" : near.has(n.id) ? "focus" : "dim" } as TableData })),
    [nodes, near],
  );
  const shownEdges = useMemo(
    () => initial.edges.map((e) => ({
      ...e,
      data: { state: !selected ? "normal" : e.source === selected || e.target === selected ? "focus" : "dim" } as RelData,
      zIndex: selected && (e.source === selected || e.target === selected) ? 1 : 0,
    })),
    [initial.edges, selected],
  );

  // Search box: fly the camera to the matching table.
  useEffect(() => {
    if (hit) flow.fitView({ nodes: [{ id: hit }], duration: reduced ? 0 : 650, maxZoom: 1.1, padding: 0.6 });
  }, [hit, flow, reduced]);

  return (
    <ReactFlow
      nodes={shownNodes}
      edges={shownEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      // All changes, not just drags: measured sizes arrive here too, and the
      // minimap skips nodes that were never measured.
      onNodesChange={(changes) => setNodes((ns) => applyNodeChanges(changes, ns))}
      onNodeClick={(_, n) => select(selected === n.id ? null : n.id)}
      onPaneClick={() => select(null)}
      fitView
      fitViewOptions={{ padding: 0.08 }}
      minZoom={0.15}
      maxZoom={1.8}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      deleteKeyCode={null}
      className={reduced ? "erd erd-still" : "erd"}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--border-hover)" />
      {/* Colours via CSS classes: SVG attributes can't resolve var(). */}
      <MiniMap pannable zoomable nodeClassName={(n) => `mod-${moduleOf(n.id).key}`} nodeColor="" maskColor="" className="erd-minimap" />
      <Controls showInteractive={false} className="erd-controls" />
    </ReactFlow>
  );
}

/** Interactive entity-relationship diagram of the live schema. */
export function SchemaGraph({ tables, query }: { tables: TableInfo[]; query: string }) {
  const present = new Set(tables.map((t) => moduleOf(t.name).key));
  return (
    <section aria-label="Table relationship diagram" className="erd-frame">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        {MODULES.filter((m) => present.has(m.key)).map((m) => (
          <span key={m.key} className="flex items-center gap-1.5 font-mono text-[11px]" style={{ color: "var(--text-secondary)" }}>
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: m.color }} />{m.label}
          </span>
        ))}
        <span className="ml-auto font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
          click a table to trace its relationships · drag to rearrange · scroll to zoom
        </span>
      </div>
      <div style={{ height: "min(72vh, 760px)", minHeight: 480 }}>
        <ReactFlowProvider>
          <Canvas tables={tables} query={query} />
        </ReactFlowProvider>
      </div>
    </section>
  );
}
