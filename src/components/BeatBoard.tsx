'use client'

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    Edge,
    Node,
    NodeChange,
    ReactFlowProvider,
    useReactFlow,
    useOnSelectionChange,
    Panel,
    BackgroundVariant,
    SelectionMode
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { BeatCard, BeatCardData } from './BeatCard'

const initialEdges: Edge[] = []

const isDescendant = (nodes: Node[], currentTarget: string, potentialDescendantId: string): boolean => {
    let current = nodes.find(n => n.id === potentialDescendantId);
    while (current?.parentId) {
        if (current.parentId === currentTarget) return true;
        current = nodes.find(n => n.id === current!.parentId);
    }
    return false;
}

const getAbsPos = (nodesList: Node[], node: Node) => {
    let x = (node as any).internals?.positionAbsolute?.x ?? (node as any).positionAbsolute?.x;
    let y = (node as any).internals?.positionAbsolute?.y ?? (node as any).positionAbsolute?.y;

    if (x !== undefined && y !== undefined && !isNaN(x) && !isNaN(y)) {
        return { x, y };
    }

    x = node.position.x;
    y = node.position.y;
    let curr = node;
    while (curr.parentId) {
        const p = nodesList.find(n => n.id === curr.parentId);
        if (p) {
            x += p.position.x;
            y += p.position.y;
            curr = p;
        } else {
            break;
        }
    }
    return { x, y };
}

const getDimensions = (node: Node) => {
    return {
        w: node.measured?.width ?? (node as any).width ?? 300,
        h: node.measured?.height ?? (node as any).height ?? 200
    }
}

function BeatBoardContent({ onViewChange, initialData }: { onViewChange?: (view: 'writer' | 'board', data?: any) => void, initialData?: any }) {
    const [nodes, setNodes, onNodesChangeCore] = useNodesState<Node<BeatCardData>>([])
    const [edges, setEdges, onEdgesChangeCore] = useEdgesState(initialEdges)
    const { screenToFlowPosition, getNodes: getRfNodes, setViewport, getViewport } = useReactFlow()

    // Pan vs Select toggle (Req 4)
    const [interactionMode, setInteractionMode] = useState<'pan' | 'select'>('pan')

    // Undo/Redo History (Req 5 & 6)
    const history = useRef({
        past: [] as { nodes: Node<BeatCardData>[], edges: Edge[] }[],
        future: [] as { nodes: Node<BeatCardData>[], edges: Edge[] }[]
    })

    const pushHistory = useCallback((newNodes: Node<BeatCardData>[], newEdges: Edge[]) => {
        history.current.past.push({
            nodes: JSON.parse(JSON.stringify(newNodes)),
            edges: JSON.parse(JSON.stringify(newEdges))
        })
        if (history.current.past.length > 50) history.current.past.shift()
        history.current.future = []
    }, [])

    const undo = useCallback(() => {
        if (history.current.past.length === 0) return
        const currentNodes = getRfNodes() as Node<BeatCardData>[]
        const currentEdges = edges
        const previous = history.current.past.pop()!

        history.current.future.push({
            nodes: JSON.parse(JSON.stringify(currentNodes)),
            edges: JSON.parse(JSON.stringify(currentEdges))
        })

        setNodes(previous.nodes)
        setEdges(previous.edges)
    }, [edges, getRfNodes, setNodes, setEdges])

    const redo = useCallback(() => {
        if (history.current.future.length === 0) return
        const currentNodes = getRfNodes() as Node<BeatCardData>[]
        const currentEdges = edges
        const next = history.current.future.pop()!

        history.current.past.push({
            nodes: JSON.parse(JSON.stringify(currentNodes)),
            edges: JSON.parse(JSON.stringify(currentEdges))
        })

        setNodes(next.nodes)
        setEdges(next.edges)
    }, [edges, getRfNodes, setNodes, setEdges])

    // Global Undo/Redo listener
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                if (e.shiftKey) {
                    e.preventDefault();
                    redo();
                } else {
                    e.preventDefault();
                    undo();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo]);

    useEffect(() => {
        if (initialData) {
            if (initialData.nodes) {
                setNodes(initialData.nodes);
                // Initialize history with initial state
                history.current.past = [{ nodes: initialData.nodes, edges: initialData.edges || [] }];
                history.current.future = [];
            }
            if (initialData.edges) setEdges(initialData.edges);
            if (initialData.canvasBg) setCanvasBg(initialData.canvasBg);
            if (initialData.viewport) {
                requestAnimationFrame(() => {
                    setViewport(initialData.viewport);
                });
            }
        }
    }, [initialData, setNodes, setEdges, setViewport]);

    const onEdgesChange = useCallback((changes: any) => {
        pushHistory(nodes, edges);
        onEdgesChangeCore(changes);
    }, [nodes, edges, pushHistory, onEdgesChangeCore]);

    const onNodesChange = useCallback((changes: NodeChange<Node<BeatCardData>>[]) => {
        const isSignificantChange = changes.some(c =>
            (c.type === 'position' && !c.dragging) || // Drag stopped
            c.type === 'remove' ||
            c.type === 'add'
        );

        if (isSignificantChange) {
            pushHistory(nodes, edges);
        }
        const filtered = changes.filter(c => {
            if (c.type === 'position' && c.dragging) {
                const n = nodes.find(node => node.id === c.id);
                // Prevent children from moving relative to their parents during standard group drag (fixes 2x delta bug)
                if (n && n.parentId && !n.data.isDetachingMode) return false;
            }
            return true;
        });
        onNodesChangeCore(filtered);
    }, [nodes, onNodesChangeCore]);

    // Layout Modals State
    const [isManualOpen, setIsManualOpen] = useState(false)
    const [isChangelogOpen, setIsChangelogOpen] = useState(false)
    const [canvasBg, setCanvasBg] = useState<'grid' | 'white' | 'gray' | 'black'>(initialData?.canvasBg || 'grid');

    // Handle updates fired from inside the BeatCard components
    const handleNodeDataChange = useCallback((id: string, partialData: Partial<BeatCardData>) => {
        pushHistory(getRfNodes() as Node<BeatCardData>[], edges);
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === id) {
                    const newData = { ...node.data, ...partialData };
                    let newStyle = { ...node.style };

                    if ('isCollapsed' in partialData) {
                        const currentHeight = node.measured?.height ?? node.height ?? node.style?.height ?? 200;
                        if (partialData.isCollapsed) {
                            (newData as any)._prevHeight = currentHeight;
                            newStyle.height = 42;
                        } else {
                            newStyle.height = (node.data as any)._prevHeight ?? 200;
                        }
                    }

                    return {
                        ...node,
                        height: newStyle.height ? Number(newStyle.height) : undefined, // Force explicit height for resizer override
                        data: newData,
                        style: newStyle
                    }
                }
                return node
            })
        )
    }, [setNodes])

    // Memoize the nodeTypes object to prevent re-rendering the entire canvas
    const nodeTypes = useMemo(() => ({ beatCard: BeatCard }), [])

    useOnSelectionChange({
        onChange: ({ nodes: selectedNodes }: { nodes: Node[] }) => {
            if (selectedNodes.length === 0) return;
            if (selectedNodes.some((n: Node) => n.data.isDetachingMode)) return;

            const rfNodes = getRfNodes();
            const getRoot = (id: string) => {
                let curr = rfNodes.find((n: Node) => n.id === id);
                if (!curr) return null;
                let root = curr;
                while (root.parentId) {
                    const p = rfNodes.find((n: Node) => n.id === root.parentId);
                    if (!p) break;
                    root = p;
                }
                return root;
            };

            const rootsToSelect = new Set<string>();
            selectedNodes.forEach((n: Node) => {
                const root = getRoot(n.id);
                if (root) rootsToSelect.add(root.id);
            });

            if (rootsToSelect.size === 0) return;

            setNodes(nds => {
                let hasChanges = false;
                const newNodes = nds.map((n) => {
                    const root = getRoot(n.id);
                    if (root && rootsToSelect.has(root.id) && !n.selected) {
                        hasChanges = true;
                        return { ...n, selected: true };
                    }
                    return n;
                });
                return hasChanges ? newNodes : nds;
            });
        }
    });

    const onNodeDragStart = useCallback((event: React.MouseEvent, node: Node) => {
        const isDetachHandle = (event.target as HTMLElement).closest('.detach-handle');
        if (isDetachHandle) {
            setNodes(nds => nds.map(n => {
                if (n.id === node.id) {
                    return { ...n, data: { ...n.data, isDetachingMode: true }, selected: true };
                }
                // Deselect everything else so it doesn't drag along
                if (n.selected) {
                    return { ...n, selected: false };
                }
                return n;
            }));
        }
    }, [setNodes]);

    const onNodeDrag = useCallback((event: React.MouseEvent, node: Node) => {
        const rfNodes = getRfNodes();

        setNodes((nds) => {
            // If dragging a child within a train (and not detaching it), don't compute new snaps. The root handles it.
            if (node.parentId && !node.data.isDetachingMode) return nds;

            let targetNodeId: string | null = null;
            let targetSnapDir: 'top' | 'bottom' | 'left' | 'right' | null = null;
            const GAP = 0;
            const SNAP_DIST = 35; // increased magnet distance for stability

            const { x: nAx, y: nAy } = getAbsPos(rfNodes, node);
            const { w: nAw, h: nAh } = getDimensions(node);

            for (const b of rfNodes) {
                if (b.id === node.id || isDescendant(rfNodes, node.id, b.id)) continue;

                const { x: nBx, y: nBy } = getAbsPos(rfNodes, b);
                const { w: nBw, h: nBh } = getDimensions(b);

                // Check Snap Right
                if (Math.abs(nAx - (nBx + nBw + GAP)) < SNAP_DIST && Math.abs(nAy - nBy) < SNAP_DIST) {
                    targetNodeId = b.id;
                    targetSnapDir = 'right';
                    break;
                }
                // Check Snap Left
                if (Math.abs((nAx + nAw + GAP) - nBx) < SNAP_DIST && Math.abs(nAy - nBy) < SNAP_DIST) {
                    targetNodeId = b.id;
                    targetSnapDir = 'left';
                    break;
                }
                // Check Snap Bottom
                if (Math.abs(nAx - nBx) < SNAP_DIST && Math.abs(nAy - (nBy + nBh + GAP)) < SNAP_DIST) {
                    targetNodeId = b.id;
                    targetSnapDir = 'bottom';
                    break;
                }
                // Check Snap Top
                if (Math.abs(nAx - nBx) < SNAP_DIST && Math.abs((nAy + nAh + GAP) - nBy) < SNAP_DIST) {
                    targetNodeId = b.id;
                    targetSnapDir = 'top';
                    break;
                }
            }

            // Optimization: Only update if changed
            let hasChanges = false;
            const updatedNodes = nds.map((n) => {
                const isTarget = n.id === targetNodeId;
                const currentSnapDir = n.data.snapDirection;
                const newSnapDir = isTarget ? targetSnapDir : null;

                if (currentSnapDir !== newSnapDir) {
                    hasChanges = true;
                    return {
                        ...n,
                        data: {
                            ...n.data,
                            snapDirection: newSnapDir,
                        }
                    };
                }
                return n;
            });

            return hasChanges ? updatedNodes : nds;
        });
    }, [setNodes, getRfNodes]);

    const onNodeDragStop = useCallback((event: React.MouseEvent, node: Node) => {
        const rfNodes = getRfNodes();

        setNodes((nds) => {
            const isDetaching = node.data.isDetachingMode;

            // If dropping a child within a train (and not detaching), don't compute snaps, let the root handle it.
            if (node.parentId && !isDetaching) return nds;

            let targetNode = null;
            let snapOffset = { x: 0, y: 0 };
            const GAP = 0;
            const SNAP_DIST = 35;

            const { x: nAx, y: nAy } = getAbsPos(rfNodes, node);
            const { w: nAw, h: nAh } = getDimensions(node);

            if (!isDetaching) {
                for (const b of rfNodes) {
                    if (b.id === node.id || isDescendant(rfNodes, node.id, b.id)) continue;

                    const { x: nBx, y: nBy } = getAbsPos(rfNodes, b);
                    const { w: nBw, h: nBh } = getDimensions(b);

                    // Check Snap Right
                    if (Math.abs(nAx - (nBx + nBw + GAP)) < SNAP_DIST && Math.abs(nAy - nBy) < SNAP_DIST) {
                        targetNode = b;
                        snapOffset = { x: Math.round(nBw + GAP), y: 0 };
                        break;
                    }
                    // Check Snap Left
                    if (Math.abs((nAx + nAw + GAP) - nBx) < SNAP_DIST && Math.abs(nAy - nBy) < SNAP_DIST) {
                        targetNode = b;
                        snapOffset = { x: -Math.round(nAw + GAP), y: 0 };
                        break;
                    }
                    // Check Snap Bottom
                    if (Math.abs(nAx - nBx) < SNAP_DIST && Math.abs(nAy - (nBy + nBh + GAP)) < SNAP_DIST) {
                        targetNode = b;
                        snapOffset = { x: 0, y: Math.round(nBh + GAP) };
                        break;
                    }
                    // Check Snap Top
                    if (Math.abs(nAx - nBx) < SNAP_DIST && Math.abs((nAy + nAh + GAP) - nBy) < SNAP_DIST) {
                        targetNode = b;
                        snapOffset = { x: 0, y: -Math.round(nAh + GAP) };
                        break;
                    }
                }
            }

            let updatedNodes = nds.map(n => {
                let newData = { ...n.data };
                if (newData.snapDirection) delete newData.snapDirection;
                if (newData.isDetachingMode && n.id === node.id) delete newData.isDetachingMode;
                return { ...n, data: newData };
            });

            if (targetNode) {
                return updatedNodes.map((n) => {
                    if (n.id === node.id) {
                        return {
                            ...n,
                            parentId: targetNode!.id,
                            position: snapOffset
                        };
                    }
                    return n;
                });
            } else if (node.parentId != null || isDetaching) {
                // Determine if it really was dropped far away, or just dragged
                // If it was dragged, nAx and nAy represent its absolute position. We detach it.
                return updatedNodes.map((n) => {
                    if (n.id === node.id) {
                        return {
                            ...n,
                            parentId: undefined, // Fully detach from parent
                            position: { x: nAx, y: nAy }
                        };
                    }
                    return n;
                });
            }

            return updatedNodes;
        });
    }, [setNodes, getRfNodes]);

    const handleAddBeat = useCallback(() => {
        pushHistory(nodes, edges);
        const newNode: Node<BeatCardData> = {
            id: `beat-${Date.now()}`,
            type: 'beatCard',
            position: { x: window.innerWidth / 2 - 150, y: window.innerHeight / 2 - 100 },
            selected: true,
            data: {
                title: '',
                content: '',
                fontSize: 20,
                align: 'left',
                isCollapsed: false,
                onChange: handleNodeDataChange
            },
            style: { width: 300, height: 200 }
        }
        setNodes((nds) => [...nds, newNode])
    }, [handleNodeDataChange, setNodes])

    const handlePaneDoubleClick = useCallback((event: React.MouseEvent) => {
        // Only trigger if clicking directly on the pane/background, not on a node
        if ((event.target as HTMLElement).closest('.react-flow__node')) return;

        pushHistory(nodes, edges);
        const position = screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
        });
        const newNode: Node<BeatCardData> = {
            id: `beat-${Date.now()}`,
            type: 'beatCard',
            position,
            selected: true,
            data: {
                title: '',
                content: '',
                fontSize: 20,
                align: 'left',
                isCollapsed: false,
                onChange: handleNodeDataChange
            },
            style: { width: 300, height: 200 }
        };
        setNodes((nds) => [...nds, newNode]);
    }, [screenToFlowPosition, setNodes, handleNodeDataChange]);

    const onNodeDoubleClick = useCallback((event: React.MouseEvent, node: Node) => {
        pushHistory(nodes, edges);
        const newNode: Node<BeatCardData> = {
            ...node,
            id: `beat-${Date.now()}`,
            position: { x: node.position.x + 40, y: node.position.y + 40 },
            parentId: undefined, // Detach duplicate from parent
            selected: true,
            data: {
                ...(node.data as BeatCardData),
                content: '' // Req 2: Reset content on clone
            }
        };
        setNodes((nds) => [...nds, newNode]);
    }, [nodes, edges, pushHistory, setNodes])

    const handleEditorReturn = useCallback(() => {
        const currentNodes = getRfNodes()
        const currentViewport = getViewport()
        if (onViewChange) {
            onViewChange('writer', {
                nodes: currentNodes,
                edges,
                canvasBg,
                viewport: currentViewport
            });
        }
    }, [edges, getRfNodes, onViewChange, canvasBg, getViewport]);


    const hasSelection = nodes.some(n => n.selected);

    return (
        <div className="w-full h-screen bg-gray-50 dark:bg-zinc-950 flex flex-col relative">
            {/* Top Toolbar */}
            <div className="no-print border-b bg-gray-50 flex items-center justify-between px-4 py-2 shrink-0 z-[100]">
                <div className="flex items-center gap-3 hidden sm:flex">
                    <button
                        onClick={handleEditorReturn}
                        className="text-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors font-serif font-bold"
                    >
                        Kor Screenplay Writer
                    </button>
                    <button
                        onClick={() => onViewChange?.('board')}
                        className="text-lg text-gray-900 dark:text-gray-100 font-sans font-black"
                    >
                        Kor BeatBoard
                    </button>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={handleAddBeat}
                        className="flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-md shadow-sm transition-colors text-sm font-medium"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        새 메모지 추가
                    </button>
                </div>
            </div>

            {/* Bottom Left Buttons (Manual, Credit) */}
            <div className="fixed bottom-4 sm:bottom-6 left-4 sm:left-6 flex flex-col gap-2 z-[100]">
                <div
                    onClick={() => setIsManualOpen(true)}
                    className="flex items-center justify-center p-2 rounded-lg bg-gray-50/90 dark:bg-zinc-800/90 hover:bg-gray-200 dark:hover:bg-zinc-700 shadow-sm border border-gray-200 dark:border-zinc-700 cursor-pointer backdrop-blur transition-all shrink-0 hover:shadow-md active:scale-95 group"
                    title="비트보드 사용법 열기"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600 dark:text-gray-300 group-hover:text-blue-600 transition-colors"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                    <span className="font-bold text-gray-700 dark:text-gray-200 hidden sm:block pr-1">설명서</span>
                </div>

            </div>

            {/* Left Toolbar (Undo/Redo, Tool Toggles) */}
            <div className="absolute top-[88px] left-4 z-50 flex flex-col gap-3">
                <div className="flex flex-col bg-white/90 dark:bg-zinc-800/90 rounded-lg shadow-md border border-gray-200 dark:border-zinc-700 backdrop-blur p-1">
                    <button
                        onClick={undo}
                        disabled={history.current.past.length === 0}
                        className="p-2 rounded hover:bg-gray-100 dark:hover:bg-zinc-700 text-gray-700 dark:text-gray-300 disabled:opacity-30 disabled:hover:bg-transparent"
                        title="실행 취소 (Cmd/Ctrl + Z)"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
                    </button>
                    <button
                        onClick={redo}
                        disabled={history.current.future.length === 0}
                        className="p-2 rounded hover:bg-gray-100 dark:hover:bg-zinc-700 text-gray-700 dark:text-gray-300 disabled:opacity-30 disabled:hover:bg-transparent"
                        title="다시 실행 (Cmd/Ctrl + Shift + Z)"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" /></svg>
                    </button>
                </div>

                <div className="flex flex-col bg-white/90 dark:bg-zinc-800/90 rounded-lg shadow-md border border-gray-200 dark:border-zinc-700 backdrop-blur p-1">
                    <button
                        onClick={() => setInteractionMode('pan')}
                        className={`p-2 rounded transition-colors ${interactionMode === 'pan' ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-zinc-700 text-gray-700 dark:text-gray-300'}`}
                        title="이동 모드 (드래그시 화면 이동)"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" /><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" /><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></svg>
                    </button>
                    <button
                        onClick={() => setInteractionMode('select')}
                        className={`p-2 rounded transition-colors ${interactionMode === 'select' ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-zinc-700 text-gray-700 dark:text-gray-300'}`}
                        title="선택 모드 (드래그시 다중 선택 창)"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" /><path d="m11 11 10 10" /><path d="m16 21 5 .01L21 16" /></svg>
                    </button>
                </div>
            </div>

            {/* Manual Modal (Minimal version for BeatBoard) */}
            {isManualOpen && (
                <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-2xl p-6 w-full max-w-2xl max-h-[85vh] flex flex-col gap-4 overflow-hidden">
                        <div className="flex justify-between items-center border-b border-gray-200 dark:border-zinc-700 pb-3 shrink-0">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-500"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
                                비트보드 사용 설명서
                            </h2>
                            <button onClick={() => setIsManualOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none p-2">&times;</button>
                        </div>

                        <div className="overflow-y-auto pr-2 pb-4 text-sm text-gray-700 dark:text-gray-300 space-y-6">
                            <section>
                                <h3 className="font-bold text-base text-gray-900 dark:text-gray-100 mb-2 border-l-4 border-indigo-500 pl-2">1. 메모지 생성 및 이동</h3>
                                <ul className="list-disc pl-5 space-y-1.5">
                                    <li>좌측 상단의 <strong>[새 메모지 추가]</strong> 버튼을 누르면 화면 중앙에 비트 카드가 생성됩니다.</li>
                                    <li>카드 상단의 제목표시줄을 잡고 드래그하여 자유롭게 이동할 수 있습니다.</li>
                                </ul>
                            </section>

                            <section>
                                <h3 className="font-bold text-base text-gray-900 dark:text-gray-100 mb-2 border-l-4 border-emerald-500 pl-2">2. 자석 그룹화 (기차놀이) 및 분리</h3>
                                <ul className="list-disc pl-5 space-y-1.5">
                                    <li>메모지를 다른 메모지의 상/하/좌/우 테두리 근처로 드래그하면 <strong>자석처럼 착! 달라붙어 그룹화</strong> 됩니다.</li>
                                    <li>달라붙은 기준 메모지(부모)를 이동시키면, 연결된 모든 메모지가 기차처럼 함께 움직입니다.</li>
                                    <li><strong>그룹에서 분리하기:</strong> 메모지 우측 상단의 <strong>검은색 동그라미</strong>를 잡고 드래그하면, 해당 메모지만 그룹에서 분리되며 다른 메모지에 달라붙지 않고 자유롭게 이동할 수 있습니다.</li>
                                </ul>
                            </section>

                            <section>
                                <h3 className="font-bold text-base text-gray-900 dark:text-gray-100 mb-2 border-l-4 border-red-500 pl-2">3. 메모지 삭제하기</h3>
                                <ul className="list-disc pl-5 space-y-1.5">
                                    <li>메모지를 클릭하여 선택하면 화면 하단 중앙에 휴지통 아이콘이 나타납니다.</li>
                                    <li>이 휴지통 아이콘을 클릭하거나, 선택한 메모지를 휴지통 위로 드래그 앤 드롭하면 해당 메모지(및 연결된 자식 하위 그룹 전체)가 삭제됩니다.</li>
                                </ul>
                            </section>

                            <section>
                                <h3 className="font-bold text-base text-gray-900 dark:text-gray-100 mb-2 border-l-4 border-amber-500 pl-2">4. 캔버스 줌 & 패닝</h3>
                                <ul className="list-disc pl-5 space-y-1.5">
                                    <li>마우스 휠이나 트랙패드를 두 손가락으로 위아래로 굴려 <strong>화면을 확대/축소</strong> 할 수 있습니다.</li>
                                    <li>빈 캔버스를 클릭하고 드래그하면 보드 전체를 이동할 수 있습니다.</li>
                                </ul>
                            </section>

                            <section>
                                <h3 className="font-bold text-base text-gray-900 dark:text-gray-100 mb-2 border-l-4 border-fuchsia-500 pl-2">5. 색상 커스텀 (팔레트)</h3>
                                <ul className="list-disc pl-5 space-y-1.5">
                                    <li>화면 우측 상단의 <strong>동그라미 팔레트 메뉴</strong>를 사용해보세요.</li>
                                    <li>메모지를 클릭해서 <strong>선택(파란 테두리)</strong>한 뒤 상단의 색상 버튼을 누르면 해당 <strong>메모지의 색상(5종)</strong>이 바뀝니다. 드래그로 여러 개를 잡아 한 번에 바꿀 수도 있습니다.</li>
                                    <li>하단의 색상 버튼을 누르면 전체 <strong>도화지의 배경(4종)</strong>이 즉시 변경됩니다.</li>
                                </ul>
                            </section>

                            <section>
                                <h3 className="font-bold text-base text-gray-900 dark:text-gray-100 mb-2 border-l-4 border-blue-500 pl-2">6. 데이터 연동 및 저장 (.json)</h3>
                                <ul className="list-disc pl-5 space-y-1.5">
                                    <li>비트보드에는 별도의 복잡한 저장 버튼이 없습니다.</li>
                                    <li>작업을 마치고 <strong>Kor Screenplay Writer</strong> 항목을 눌러 에디터 화면으로 이동하기만 하면 <strong>작업 내역이 자동으로 상위 데이터에 동기화</strong>됩니다.</li>
                                    <li>이후 에디터 화면 우측 상단의 <strong>[저장하기]</strong>를 누르면, 여러분의 시나리오 원고와 비트보드의 메모지 작업 내역이 단 하나의 <strong>.json 파일로 완벽히 묶여 컴퓨터에 저장</strong>됩니다.</li>
                                </ul>
                            </section>

                            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-8 pt-4 border-t border-gray-100 dark:border-zinc-800 leading-relaxed">
                                문의/건의 사항 <a href="mailto:jungw02@naver.com" className="text-blue-500 hover:text-blue-600 underline underline-offset-2">jungw02@naver.com</a>
                            </div>
                        </div>

                        <div className="flex justify-end pt-2 border-t border-gray-100 dark:border-zinc-800 shrink-0">
                            <button
                                onClick={() => setIsManualOpen(false)}
                                className="bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-800 dark:text-gray-200 font-bold py-2 px-8 rounded-md transition-colors shadow-sm"
                            >
                                닫기
                            </button>
                        </div>
                    </div>
                </div >
            )
            }

            {/* Canvas area */}
            <div
                className={`flex-1 w-full relative beatboard-container font-serif transition-colors duration-300 ${canvasBg === 'black' ? 'bg-zinc-900' :
                    canvasBg === 'gray' ? 'bg-gray-300 dark:bg-zinc-700' :
                        canvasBg === 'white' ? 'bg-white dark:bg-zinc-900' :
                            'bg-transparent'
                    }`}
                onDoubleClick={handlePaneDoubleClick}
                onWheelCapture={(e) => {
                    // Prevent zooming or panning on normal scroll by intercepting the wheel event
                    if (!e.metaKey && !e.ctrlKey) {
                        e.stopPropagation();
                    }
                }}
            >
                <style>{`
                    .beatboard-container .react-flow__node,
                    .beatboard-container input,
                    .beatboard-container textarea {
                        font-family: inherit;
                    }
                    .react-flow__attribution {
                        pointer-events: none;
                        user-select: none;
                        display: none;
                    }
                `}</style>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onNodeDragStart={onNodeDragStart}
                    onNodeDrag={onNodeDrag}
                    onNodeDragStop={onNodeDragStop}
                    onNodeDoubleClick={onNodeDoubleClick}
                    panOnDrag={interactionMode === 'pan'}
                    selectionOnDrag={interactionMode === 'select'}
                    panActivationKeyCode="Space"
                    selectionMode={SelectionMode.Partial}
                    zoomOnDoubleClick={false}
                    defaultViewport={{ x: 0, y: 0, zoom: 0.9 }}
                    fitView={false}
                    minZoom={0.2}
                    maxZoom={4}
                >
                    {canvasBg === 'grid' && <Background variant={BackgroundVariant.Dots} color="#ccc" gap={20} size={1.5} />}
                    <Controls style={{ left: 16, bottom: 180, display: 'flex', flexDirection: 'column', gap: 4 }} className="bg-white/80 dark:bg-zinc-800/80 p-0.5 rounded-md shadow-sm backdrop-blur" />
                    <MiniMap zoomable pannable className="rounded-lg shadow-md overflow-hidden border border-gray-200 dark:border-zinc-700 !bg-white/80 dark:!bg-zinc-900/80 backdrop-blur" />
                    <Panel position="top-right" className="bg-white/90 dark:bg-zinc-800/90 p-2 rounded-lg shadow-md border border-gray-200 dark:border-zinc-700 backdrop-blur flex flex-col gap-3 mr-4 mt-4">
                        {/* Note Colors */}
                        <div className="flex flex-col gap-1.5 items-center">
                            <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400">메모지</span>
                            <div className="flex flex-col gap-1.5">
                                {['yellow', 'green', 'blue', 'red', 'white'].map(color => (
                                    <button
                                        key={color}
                                        onClick={() => {
                                            setNodes(nds => nds.map(n => {
                                                if (n.selected) {
                                                    return { ...n, data: { ...n.data, color: color as any } };
                                                }
                                                return n;
                                            }));
                                        }}
                                        className={`w-5 h-5 rounded-full border border-gray-200 dark:border-zinc-600 hover:scale-110 transition-transform shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-400 dark:focus:ring-offset-zinc-800
                                            ${color === 'yellow' ? 'bg-amber-100' :
                                                color === 'green' ? 'bg-emerald-100' :
                                                    color === 'blue' ? 'bg-blue-100' :
                                                        color === 'red' ? 'bg-rose-100' : 'bg-white'}
                                        `}
                                        title={`${color} 메모지`}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="w-full h-px bg-gray-200 dark:bg-zinc-700"></div>

                        {/* Canvas Colors */}
                        <div className="flex flex-col gap-1.5 items-center">
                            <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400">도화지</span>
                            <div className="flex flex-col gap-1.5">
                                {['grid', 'white', 'gray', 'black'].map(bg => (
                                    <button
                                        key={bg}
                                        onClick={() => setCanvasBg(bg as any)}
                                        className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-400 dark:focus:ring-offset-zinc-800
                                            ${canvasBg === bg ? 'border-blue-500' : 'border-transparent'}
                                            ${bg === 'grid' ? 'bg-[url("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMSIgZmlsbD0iI2NjYyIvPjwvc3ZnPg==")] bg-white' :
                                                bg === 'white' ? 'bg-white border-gray-300' :
                                                    bg === 'gray' ? 'bg-gray-300' : 'bg-zinc-800'}
                                        `}
                                        title={`${bg} 도화지`}
                                    />
                                ))}
                            </div>
                        </div>
                    </Panel>
                </ReactFlow>
            </div>
        </div >
    )
}

export default function BeatBoard(props: { onViewChange?: (view: 'writer' | 'board', data?: any) => void, initialData?: any }) {
    return (
        <ReactFlowProvider>
            <BeatBoardContent {...props} />
        </ReactFlowProvider>
    )
}
