import { memo, useCallback, useState, useEffect, useRef } from 'react'
import { Handle, Position, NodeResizer, useReactFlow, NodeProps, Node } from '@xyflow/react'

export type BeatCardData = {
    title: string;
    content: string;
    fontSize: number;
    align: 'left' | 'center' | 'right';
    valign?: 'top' | 'center' | 'bottom';
    color?: 'yellow' | 'green' | 'blue' | 'red' | 'white';
    isCollapsed: boolean;
    userMinHeight?: number;
    snapDirection?: 'top' | 'bottom' | 'left' | 'right' | null;
    isDetachingMode?: boolean;
    onChange?: (id: string, partialData: Partial<BeatCardData>) => void;
}

export const BeatCard = memo(({ id, data, selected }: NodeProps<Node<BeatCardData>>) => {
    // Local state for instant typing feel, synced to React Flow data via onChange
    const [title, setTitle] = useState(data.title || '')
    const [content, setContent] = useState(data.content || '')

    const titleRef = useRef<HTMLInputElement>(null);
    const contentRef = useRef<HTMLTextAreaElement>(null);
    const mirrorRef = useRef<HTMLDivElement>(null);

    // Sync external data changes if any
    useEffect(() => {
        setTitle(data.title || '')
        setContent(data.content || '')
    }, [data.title, data.content])

    const cardRef = useRef<HTMLDivElement>(null);
    const [cardWidth, setCardWidth] = useState(300);

    useEffect(() => {
        if (!cardRef.current) return;
        const resizeObserver = new ResizeObserver(entries => {
            if (entries[0]) {
                setCardWidth(entries[0].contentRect.width);
            }
        });
        resizeObserver.observe(cardRef.current);
        return () => resizeObserver.disconnect();
    }, []);

    const { setNodes } = useReactFlow()

    const { fontSize = 20, align = 'left', valign = 'top', isCollapsed = false, snapDirection, color = 'yellow', userMinHeight = 200 } = data as BeatCardData

    const autoResize = useCallback(() => {
        if (isCollapsed) return; // Do not auto-resize when collapsed

        if (mirrorRef.current) {
            // Unconstrained scroll height of the internal text + paddings
            const neededHeight = mirrorRef.current.scrollHeight + 40; // 40px for header
            const targetHeight = Math.max(neededHeight, userMinHeight);

            // Only trigger a React Flow node update if the height actually needs to change 
            // beyond a small threshold to prevent infinite loop jitters.
            setNodes((nds) =>
                nds.map(n => {
                    if (n.id === id) {
                        const currentH = n.height || n.style?.height || 200;
                        if (Math.abs(Number(currentH) - targetHeight) > 5) {
                            return { ...n, height: targetHeight, style: { ...n.style, height: targetHeight } };
                        }
                    }
                    return n;
                })
            );
        }
    }, [id, setNodes, isCollapsed, userMinHeight]);

    // Trigger auto-resize whenever content changes (debounced by React queue)
    useEffect(() => {
        autoResize();
    }, [content, fontSize, cardWidth, autoResize]);

    const handleDataChange = useCallback((updates: Partial<BeatCardData>) => {
        if (data.onChange) {
            data.onChange(id, updates)
        }
    }, [id, data])

    const handleDelete = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        setNodes(nds => {
            const toDelete = new Set([id]);
            let added;
            do {
                added = false;
                nds.forEach(n => {
                    if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
                        toDelete.add(n.id);
                        added = true;
                    }
                });
            } while (added);
            return nds.filter(n => !toDelete.has(n.id));
        });
    }, [id, setNodes]);

    let snapGlowClass = '';
    if (snapDirection === 'top') snapGlowClass = 'ring-4 ring-indigo-500 shadow-[0_-10px_20px_rgba(99,102,241,0.6)]';
    if (snapDirection === 'bottom') snapGlowClass = 'ring-4 ring-indigo-500 shadow-[0_10px_20px_rgba(99,102,241,0.6)]';
    if (snapDirection === 'left') snapGlowClass = 'ring-4 ring-indigo-500 shadow-[-10px_0_20px_rgba(99,102,241,0.6)]';
    if (snapDirection === 'right') snapGlowClass = 'ring-4 ring-indigo-500 shadow-[10px_0_20px_rgba(99,102,241,0.6)]';

    let colorClasses = {
        bg: 'bg-amber-50 dark:bg-zinc-800',
        border: 'border-amber-200 dark:border-zinc-700',
        header: 'bg-amber-200/50 dark:bg-zinc-900',
        divider: 'bg-amber-300 dark:bg-zinc-600',
        btnHover: 'hover:bg-amber-300 dark:hover:bg-zinc-700'
    };
    if (color === 'green') colorClasses = { bg: 'bg-emerald-50 dark:bg-emerald-900/30', border: 'border-emerald-200 dark:border-emerald-800', header: 'bg-emerald-200/50 dark:bg-emerald-900/50', divider: 'bg-emerald-300 dark:bg-emerald-700', btnHover: 'hover:bg-emerald-300 dark:hover:bg-emerald-700' };
    if (color === 'blue') colorClasses = { bg: 'bg-blue-50 dark:bg-blue-900/30', border: 'border-blue-200 dark:border-blue-800', header: 'bg-blue-200/50 dark:bg-blue-900/50', divider: 'bg-blue-300 dark:bg-blue-700', btnHover: 'hover:bg-blue-300 dark:hover:bg-blue-700' };
    if (color === 'red') colorClasses = { bg: 'bg-rose-50 dark:bg-rose-900/30', border: 'border-rose-200 dark:border-rose-800', header: 'bg-rose-200/50 dark:bg-rose-900/50', divider: 'bg-rose-300 dark:bg-rose-700', btnHover: 'hover:bg-rose-300 dark:hover:bg-rose-700' };
    if (color === 'white') colorClasses = { bg: 'bg-white dark:bg-zinc-800', border: 'border-gray-200 dark:border-zinc-600', header: 'bg-gray-100 dark:bg-zinc-700', divider: 'bg-gray-300 dark:bg-zinc-500', btnHover: 'hover:bg-gray-200 dark:hover:bg-zinc-600' };

    return (
        <>
            {/* Resizer handle (only visible when selected) */}
            <NodeResizer
                color="#3b82f6"
                isVisible={selected}
                minWidth={150}
                minHeight={isCollapsed ? 40 : 100}
                onResizeEnd={(_, params) => {
                    handleDataChange({ userMinHeight: params.height });
                    setNodes(nds => nds.map(n => {
                        if (n.id === id) {
                            return { ...n, height: params.height, style: { ...n.style, height: params.height } };
                        }
                        return n;
                    }));
                }}
            />

            <div
                ref={cardRef}
                className={`flex flex-col ${colorClasses.bg} border-2 rounded-md transition-all 
                    ${snapGlowClass ? snapGlowClass : (selected ? 'border-blue-500 ring-2 ring-blue-500/30 shadow-md' : `${colorClasses.border} shadow-sm`)}
                `}
                style={{ width: '100%', height: '100%' }}
            >
                {/* Header (Title + Toolbar) */}
                <div className={`flex items-center justify-between ${colorClasses.header} border-b ${colorClasses.border} px-2 py-1 drag-handle cursor-move`}>
                    <input
                        ref={titleRef}
                        className="nodrag font-bold text-sm bg-transparent border-none outline-none text-gray-800 dark:text-gray-200 placeholder-amber-700/50 dark:placeholder-zinc-500 w-full min-w-0"
                        style={{ fontFamily: 'inherit' }}
                        placeholder=""
                        value={title}
                        onChange={(e) => {
                            setTitle(e.target.value)
                            handleDataChange({ title: e.target.value })
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Tab') {
                                e.preventDefault();
                                contentRef.current?.focus();
                            }
                        }}
                    />

                    {/* Toolbar Container */}
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                        {/* Formatting & Delete (Hides on small items) */}
                        <div
                            className={`flex items-center gap-1 ${cardWidth < 220 ? 'hidden' : ''}`}
                            onDoubleClick={(e) => e.stopPropagation()}
                        >
                            {/* Font Size & Align Controls */}
                            <div className={`flex items-center gap-1 mr-1 transition-opacity ${selected ? 'opacity-100' : 'opacity-0'}`}>
                                <button onClick={() => handleDataChange({ align: 'left' })} className={`p-0.5 rounded ${align === 'left' ? 'bg-blue-200 dark:bg-blue-900' : colorClasses.btnHover}`} title="좌측 정렬">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="15" y1="12" x2="3" y2="12"></line><line x1="17" y1="18" x2="3" y2="18"></line></svg>
                                </button>
                                <button onClick={() => handleDataChange({ align: 'center' })} className={`p-0.5 rounded ${align === 'center' ? 'bg-blue-200 dark:bg-blue-900' : colorClasses.btnHover}`} title="가운데 정렬">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="19" y1="12" x2="5" y2="12"></line><line x1="17" y1="18" x2="7" y2="18"></line></svg>
                                </button>
                                <div className={`w-px h-3 ${colorClasses.divider} mx-0.5`}></div>
                                <button onClick={() => handleDataChange({ fontSize: Math.max(10, fontSize - 2) })} className={`text-xs font-bold w-4 ${colorClasses.btnHover} rounded`}>-</button>
                                <span className="text-[10px] w-3 text-center">{fontSize}</span>
                                <button onClick={() => handleDataChange({ fontSize: Math.min(32, fontSize + 2) })} className={`text-xs font-bold w-4 ${colorClasses.btnHover} rounded`}>+</button>
                            </div>
                        </div>

                        <div className={`w-px h-3 ${colorClasses.divider} mx-0.5`}></div>

                        {/* Delete Button (Always Visible) */}
                        <div
                            className="bg-transparent hover:bg-red-500 hover:text-white text-gray-400 dark:text-zinc-500 rounded p-0.5 cursor-pointer transition-colors flexItems-center justify-center flex-shrink-0"
                            onClick={handleDelete}
                            title="삭제"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </div>

                        {/* Collapse / Detach Toggle (Always Visible) */}
                        <div
                            className="w-2 h-2 bg-gray-800 dark:bg-gray-200 rounded-full cursor-move hover:scale-125 transition-transform flex-shrink-0 detach-handle"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDataChange({ isCollapsed: !isCollapsed });
                            }}
                            title="클릭: 접기/펴기 | 드래그: 다른 메모지에 붙지 않고 분리 이동"
                        />
                    </div>
                </div>

                {/* Content Area */}
                {!isCollapsed && (
                    <div className={`flex-1 p-2 w-full h-full overflow-y-auto bg-transparent flex flex-col custom-scrollbar ${valign === 'center' ? 'justify-center' : valign === 'bottom' ? 'justify-end' : 'justify-start'}`}>
                        <div className="w-full relative grid h-full">
                            {/* Hidden div to auto-expand and allow flex-centering */}
                            <div
                                ref={mirrorRef}
                                className="invisible whitespace-pre-wrap break-words col-start-1 row-start-1 w-full h-max"
                                style={{
                                    fontSize: `${fontSize}px`,
                                    textAlign: align,
                                    fontFamily: 'inherit'
                                }}
                            >
                                {content + ' '}
                            </div>
                            <textarea
                                ref={contentRef}
                                className="nodrag col-start-1 row-start-1 w-full h-full bg-transparent border-none outline-none resize-none text-gray-800 dark:text-gray-200 placeholder-amber-700/40 dark:placeholder-zinc-500 overflow-hidden"
                                placeholder=""
                                value={content}
                                onChange={(e) => {
                                    setContent(e.target.value)
                                    handleDataChange({ content: e.target.value })
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Tab') {
                                        e.preventDefault();
                                        titleRef.current?.focus();
                                    }
                                }}
                                style={{
                                    fontSize: `${fontSize}px`,
                                    textAlign: align,
                                    fontFamily: 'inherit'
                                }}
                            />
                        </div>

                        {/* Floating Vertical Alignment Tools */}
                        <div className={`absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-1 z-10 transition-opacity duration-200 ${selected && cardWidth > 180 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                            <button
                                onClick={() => handleDataChange({ valign: 'top' })}
                                className={`p-0.5 rounded ${valign === 'top' ? 'bg-blue-200 dark:bg-blue-900 text-gray-800 dark:text-gray-200' : `${colorClasses.btnHover} text-gray-600 dark:text-gray-400`} transition-colors`}
                                title="상단 정렬"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="6" x2="20" y2="6"></line><line x1="4" y1="12" x2="14" y2="12"></line></svg>
                            </button>
                            <button
                                onClick={() => handleDataChange({ valign: 'center' })}
                                className={`p-0.5 rounded ${valign === 'center' ? 'bg-blue-200 dark:bg-blue-900 text-gray-800 dark:text-gray-200' : `${colorClasses.btnHover} text-gray-600 dark:text-gray-400`} transition-colors`}
                                title="중앙 정렬"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="14" y2="15"></line></svg>
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Hidden Handles for grouping / snapping logic later */}
            <Handle type="target" position={Position.Top} className="opacity-0 w-full h-2 rounded-none !top-0" />
            <Handle type="source" position={Position.Bottom} className="opacity-0 w-full h-2 rounded-none !bottom-0" />
            <Handle type="target" id="left" position={Position.Left} className="opacity-0 w-2 h-full rounded-none !left-0" />
            <Handle type="source" id="right" position={Position.Right} className="opacity-0 w-2 h-full rounded-none !right-0" />
        </>
    )
});
