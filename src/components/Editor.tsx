'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { ScreenplayBlock, ScreenplayFormat } from '@/lib/ScreenplayExtension'
import { generateAndDownloadPDF } from '@/lib/pdfGenerator'
import { useEffect, useState, useRef } from 'react'

const FORMAT_LABELS: Record<ScreenplayFormat, string> = {
    scene: '씬(S#) ⌘1',
    action: '지문 ⌘2',
    dialogue: '대사 ⌘3',
}

const SCENE_OPTIONS = ['내부', '외부', '내부/외부', '외부/내부']
const TIME_OPTIONS = ['아침', '낮', '저녁', '밤', '새벽']

const CHOSEONG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const getChoseong = (str: string) => {
    let result = "";
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i) - 44032;
        if (code > -1 && code < 11172) {
            result += CHOSEONG[Math.floor(code / 588)];
        } else {
            result += str.charAt(i);
        }
    }
    return result;
}

const getScenePromptMatches = (text: string) => {
    let promptType: 'location' | 'time' | null = null
    let search = ''

    const locMatch = text.match(/^S#\s\d+\.\s*(.*?)$/)
    const timeMatch = text.match(/^S#\s\d+\.\s+(내부|외부|내부\/외부|외부\/내부)\s*-\s*(.*?)$/)

    if (timeMatch && !timeMatch[2].includes('-')) {
        promptType = 'time'
        search = timeMatch[2].trim()
    } else if (locMatch && !locMatch[1].includes('-')) {
        promptType = 'location'
        search = locMatch[1].trim()
    }

    if (!promptType) return { promptType: null, matches: [], search: '' }

    const currentList = promptType === 'location' ? SCENE_OPTIONS : TIME_OPTIONS
    const searchChoseong = getChoseong(search)

    // Always include exact or Choseong matches, fallback to full list if no search query.
    const matches = search ? currentList.filter(o =>
        o.startsWith(search) || getChoseong(o).startsWith(searchChoseong)
    ) : currentList

    return { promptType, matches, search }
}

interface TitlePageData {
    title: string;
    author: string;
    contact: string;
}

export default function Editor() {
    const [currentFormat, setCurrentFormat] = useState<ScreenplayFormat>('action')
    const [isImeComposing, setIsImeComposing] = useState(false)
    const [fileHandle, setFileHandle] = useState<any>(null)

    // Title Page State
    const [titlePage, setTitlePage] = useState<TitlePageData>({ title: '', author: '', contact: '' })
    const [isTitleModalOpen, setIsTitleModalOpen] = useState(false)
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Scene Prompt State
    const promptActiveRef = useRef(false)
    const promptTypeRef = useRef<'location' | 'time'>('location')
    const promptIndexRef = useRef(0)
    const promptItemsRef = useRef<string[]>([])
    const promptSearchRef = useRef('')
    const promptSuppressedRef = useRef(false)
    const [scenePrompt, setScenePrompt] = useState<{ active: false } | { active: true; type: 'location' | 'time'; top: number; left: number; items: string[]; index: number }>({ active: false })

    // Auto-Complete State
    const acActiveRef = useRef(false)
    const acItemsRef = useRef<string[]>([])
    const acIndexRef = useRef(0)
    const acSearchRef = useRef('')
    const acSuppressedRef = useRef(false)
    const [autoComplete, setAutoComplete] = useState<{ active: false } | { active: true; top: number; left: number; items: string[]; index: number }>({ active: false })

    const checkScenePrompt = (editor: any): boolean => {
        if (promptSuppressedRef.current) {
            if (promptActiveRef.current) {
                promptActiveRef.current = false
                setScenePrompt({ active: false })
            }
            return false
        }

        const { state, view } = editor
        const { $from } = state.selection
        const node = $from.parent

        if (node.type.name === 'screenplayBlock' && node.attrs.format === 'scene') {
            const { promptType, matches, search } = getScenePromptMatches(node.textContent)

            if (promptType && matches.length > 0) {
                try {
                    const coords = view.coordsAtPos(state.selection.from)
                    promptActiveRef.current = true
                    promptTypeRef.current = promptType
                    promptItemsRef.current = matches
                    promptSearchRef.current = search

                    if (promptIndexRef.current >= matches.length) promptIndexRef.current = 0

                    setScenePrompt({
                        active: true,
                        type: promptType,
                        top: coords.bottom + window.scrollY,
                        left: coords.left + window.scrollX,
                        items: matches,
                        index: promptIndexRef.current
                    })
                } catch (e) {
                    // Ignore transient coordinate errors
                }
                return true
            }
        }

        if (promptActiveRef.current) {
            promptActiveRef.current = false
            setScenePrompt({ active: false })
        }
        return false
    }

    const checkAutoComplete = (editor: any): boolean => {
        if (acSuppressedRef.current) {
            if (acActiveRef.current) {
                acActiveRef.current = false
                setAutoComplete({ active: false })
            }
            return false
        }

        const { state, view } = editor
        const { $from } = state.selection
        const node = $from.parent

        if (node.type.name !== 'screenplayBlock') {
            if (acActiveRef.current) {
                acActiveRef.current = false
                setAutoComplete({ active: false })
            }
            return false
        }

        const format = node.attrs.format

        if (format === 'scene') {
            const text = node.textContent
            const matchFull = text.match(/^S#\s\d+\.\s+(.+)$/)
            if (matchFull) {
                const search = matchFull[1].trim()
                if (!search) {
                    if (acActiveRef.current) {
                        acActiveRef.current = false
                        setAutoComplete({ active: false })
                    }
                    return false
                }
                const scenes = new Set<string>()
                state.doc.descendants((n: any) => {
                    if (n.type.name === 'screenplayBlock' && n.attrs.format === 'scene' && n !== node) {
                        const m = n.textContent.match(/^S#\s\d+\.\s+(.+)$/)
                        if (m) scenes.add(m[1].trim())
                    }
                })

                const searchChoseong = getChoseong(search)
                const matches = Array.from(scenes).filter(s => {
                    if (s === search) return false;
                    return s.startsWith(search) || getChoseong(s).startsWith(searchChoseong);
                }).slice(0, 10)

                if (matches.length > 0) {
                    try {
                        const coords = view.coordsAtPos(state.selection.from)
                        acActiveRef.current = true
                        acItemsRef.current = matches
                        acSearchRef.current = search
                        if (acIndexRef.current >= matches.length) acIndexRef.current = 0

                        setAutoComplete({
                            active: true,
                            top: coords.bottom + window.scrollY,
                            left: coords.left + window.scrollX,
                            items: matches,
                            index: acIndexRef.current
                        })
                    } catch (e) { }
                    return true
                }
            }
        } else if (format === 'dialogue') {
            const text = node.textContent
            if (!text.includes('\t') && text.trim().length > 0) {
                const search = text.trim()
                const chars = new Set<string>()
                state.doc.descendants((n: any) => {
                    if (n.type.name === 'screenplayBlock' && n.attrs.format === 'dialogue' && n !== node) {
                        const tabIdx = n.textContent.indexOf('\t')
                        if (tabIdx !== -1) {
                            const c = n.textContent.substring(0, tabIdx).trim()
                            if (c) chars.add(c)
                        }
                    }
                })

                const searchChoseong = getChoseong(search)
                const matches = Array.from(chars).filter(c => {
                    if (c === search) return false;
                    return c.startsWith(search) || getChoseong(c).startsWith(searchChoseong);
                }).slice(0, 10)

                if (matches.length > 0) {
                    try {
                        const coords = view.coordsAtPos(state.selection.from)
                        acActiveRef.current = true
                        acItemsRef.current = matches
                        acSearchRef.current = search
                        if (acIndexRef.current >= matches.length) acIndexRef.current = 0

                        setAutoComplete({
                            active: true,
                            top: coords.bottom + window.scrollY,
                            left: coords.left + window.scrollX,
                            items: matches,
                            index: acIndexRef.current
                        })
                    } catch (e) { }
                    return true
                }
            }
        }

        if (acActiveRef.current) {
            acActiveRef.current = false
            setAutoComplete({ active: false })
        }
        return false
    }

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit,
            ScreenplayBlock,
            Placeholder.configure({
                placeholder: ({ node }) => {
                    return 'S# 1. 텅 빈 방 안 - 밤\n\n지문을 입력하세요...\n\n인물 \t대사...'
                },
                emptyEditorClass: 'is-editor-empty',
            }),
        ],
        content: '',
        onUpdate: ({ editor }) => {
            acSuppressedRef.current = false
            promptSuppressedRef.current = false
            const acActive = checkAutoComplete(editor)
            if (acActive) {
                if (promptActiveRef.current) {
                    promptActiveRef.current = false
                    setScenePrompt({ active: false })
                }
            } else {
                checkScenePrompt(editor)
            }
        },
        onSelectionUpdate: ({ editor }) => {
            // When selection changes, determine active format
            const { $from } = editor.state.selection
            const node = $from.parent
            if (node.type.name === 'screenplayBlock') {
                setCurrentFormat(node.attrs.format as ScreenplayFormat)
            }
            const acActive = checkAutoComplete(editor)
            if (acActive) {
                if (promptActiveRef.current) {
                    promptActiveRef.current = false
                    setScenePrompt({ active: false })
                }
            } else {
                checkScenePrompt(editor)
            }
        },
        editorProps: {
            handleKeyDown: (view, event) => {
                if (event.key === 'Backspace') {
                    if (acActiveRef.current) {
                        event.preventDefault()
                        acSuppressedRef.current = true
                        acActiveRef.current = false
                        setAutoComplete({ active: false })

                        // Open scene prompt fallback
                        const { state } = view
                        const node = state.selection.$from.parent
                        if (node.type.name === 'screenplayBlock' && node.attrs.format === 'scene') {
                            const { promptType, matches, search } = getScenePromptMatches(node.textContent)
                            if (promptType && matches.length > 0) {
                                promptActiveRef.current = true
                                promptTypeRef.current = promptType
                                promptItemsRef.current = matches
                                promptSearchRef.current = search
                                promptIndexRef.current = 0
                                promptSuppressedRef.current = false
                                try {
                                    const coords = view.coordsAtPos(state.selection.from)
                                    setScenePrompt({ active: true, type: promptType, top: coords.bottom + window.scrollY, left: coords.left + window.scrollX, items: matches, index: 0 })
                                } catch (e) { }
                            }
                        }
                        return true
                    } else if (promptActiveRef.current) {
                        event.preventDefault()
                        promptSuppressedRef.current = true
                        promptActiveRef.current = false
                        setScenePrompt({ active: false })
                        return true
                    }
                }

                if (acActiveRef.current) {
                    if (event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar') {
                        event.preventDefault()
                        const nextIdx = (acIndexRef.current + 1) % acItemsRef.current.length
                        acIndexRef.current = nextIdx
                        setAutoComplete(prev => prev.active ? { ...prev, index: nextIdx } : prev)
                        return true
                    }
                    if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        const nextIdx = (acIndexRef.current + 1) % acItemsRef.current.length
                        acIndexRef.current = nextIdx
                        setAutoComplete(prev => prev.active ? { ...prev, index: nextIdx } : prev)
                        return true
                    }
                    if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        const nextIdx = (acIndexRef.current - 1 + acItemsRef.current.length) % acItemsRef.current.length
                        acIndexRef.current = nextIdx
                        setAutoComplete(prev => prev.active ? { ...prev, index: nextIdx } : prev)
                        return true
                    }
                    if (event.key === 'Enter') {
                        event.preventDefault()
                        const option = acItemsRef.current[acIndexRef.current]

                        const st = view.state
                        const fromPos = st.selection.$from
                        const currentText = fromPos.parent.textContent
                        let newText = ''

                        if (fromPos.parent.attrs.format === 'scene') {
                            const m = currentText.match(/^(S#\s\d+\.\s*)/)
                            newText = (m ? m[1] : 'S# 1. ') + option
                        } else {
                            const m = currentText.match(/^(\s*)/)
                            newText = (m ? m[1] : '') + option
                        }

                        const tr = st.tr.delete(fromPos.start(), fromPos.pos).insertText(newText)
                        view.dispatch(tr.scrollIntoView())

                        acActiveRef.current = false
                        setAutoComplete({ active: false })
                        return true
                    }
                    if (event.key === 'Escape') {
                        event.preventDefault()
                        acSuppressedRef.current = true
                        acActiveRef.current = false
                        setAutoComplete({ active: false })
                        return true
                    }
                }

                if (promptActiveRef.current) {
                    if (event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar') {
                        event.preventDefault()
                        const nextIdx = (promptIndexRef.current + 1) % promptItemsRef.current.length
                        promptIndexRef.current = nextIdx
                        setScenePrompt(prev => prev.active ? { ...prev, index: nextIdx } : prev)
                        return true
                    }
                    if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        const nextIdx = (promptIndexRef.current + 1) % promptItemsRef.current.length
                        promptIndexRef.current = nextIdx
                        setScenePrompt(prev => prev.active ? { ...prev, index: nextIdx } : prev)
                        return true
                    }
                    if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        const nextIdx = (promptIndexRef.current - 1 + promptItemsRef.current.length) % promptItemsRef.current.length
                        promptIndexRef.current = nextIdx
                        setScenePrompt(prev => prev.active ? { ...prev, index: nextIdx } : prev)
                        return true
                    }
                    if (event.key === 'Enter') {
                        event.preventDefault()
                        const option = promptItemsRef.current[promptIndexRef.current]

                        let insertStr = option
                        if (promptTypeRef.current === 'location') {
                            insertStr += ' - '
                        }

                        const st = view.state
                        const fromPos = st.selection.$from
                        const currentText = fromPos.parent.textContent
                        let newText = ''

                        if (promptTypeRef.current === 'location') {
                            const m = currentText.match(/^(S#\s\d+\.\s*)/)
                            newText = (m ? m[1] : 'S# 1. ') + insertStr
                        } else {
                            const m = currentText.match(/^(S#\s\d+\.\s+(?:내부|외부|내부\/외부|외부\/내부)\s*-\s*)/)
                            newText = (m ? m[1] : 'S# 1. 외부 - ') + insertStr
                        }

                        const tr = st.tr.delete(fromPos.start(), fromPos.pos).insertText(newText)
                        view.dispatch(tr.scrollIntoView())

                        promptActiveRef.current = false
                        setScenePrompt({ active: false })
                        return true
                    }
                    if (event.key === 'Escape') {
                        promptActiveRef.current = false
                        promptSuppressedRef.current = true
                        setScenePrompt({ active: false })
                        return true
                    }
                }


                if (event.key === 'Tab') {
                    // Force prevent the browser from moving focus to the toolbar (outside editor)
                    event.preventDefault()
                    // Return false so TipTap's own keymap (addKeyboardShortcuts) can still process the Tab
                    return false
                }

                if (event.key === 'F1' || (event.metaKey && event.key === '1')) {
                    event.preventDefault()
                    setFormat('scene')
                    return true
                }
                if (event.key === 'F2' || (event.metaKey && event.key === '2')) {
                    event.preventDefault()
                    setFormat('action')
                    return true
                }
                if (event.key === 'F3' || (event.metaKey && event.key === '3')) {
                    event.preventDefault()
                    setFormat('dialogue')
                    return true
                }
                return false
            }
        },
        onTransaction: ({ transaction }) => {
            // IME Composition fix - if transaction has meta related to composition, we can handle it if needed
            // Tiptap usually handles this, but Korean Mac sometimes jumps.
            // We will add event listeners on the DOM element instead for deeper control
        }
    })

    useEffect(() => {
        // Handle Korean IME Issue
        const handleCompositionStart = () => setIsImeComposing(true)
        const handleCompositionEnd = () => setIsImeComposing(false)

        document.addEventListener('compositionstart', handleCompositionStart)
        document.addEventListener('compositionend', handleCompositionEnd)

        return () => {
            document.removeEventListener('compositionstart', handleCompositionStart)
            document.removeEventListener('compositionend', handleCompositionEnd)
        }
    }, [])

    if (!editor) {
        return null
    }

    const handleSave = async () => {
        if (!editor) return

        const saveData = {
            version: 2,
            titlePage,
            document: editor.getJSON()
        }
        const jsonString = JSON.stringify(saveData)

        try {
            if ('showSaveFilePicker' in window) {
                let handle = fileHandle
                if (!handle) {
                    handle = await (window as any).showSaveFilePicker({
                        suggestedName: 'script.json',
                        types: [{
                            description: 'JSON Files',
                            accept: { 'application/json': ['.json'] },
                        }],
                    })
                    setFileHandle(handle)
                }
                const writable = await handle.createWritable()
                await writable.write(jsonString)
                await writable.close()
                alert('저장되었습니다.')
            } else {
                // Fallback for iOS/iPadOS Safari
                const blob = new Blob([jsonString], { type: "application/json" })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = 'script.json'
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                URL.revokeObjectURL(url)
                alert('다운로드 폴더에 저장되었습니다.')
            }
        } catch (err) {
            console.error(err)
        }
    }

    const handleLoad = async () => {
        if (!editor) return

        const processFileContent = (content: string) => {
            try {
                const json = JSON.parse(content)
                // V2 Document Extraction & Title Page Restoration
                let docToLoad = json
                if (json.version === 2 && json.document) {
                    docToLoad = json.document
                    if (json.titlePage) {
                        setTitlePage(json.titlePage)
                    }
                } else {
                    // Legacy V1 Document loaded - clear title page
                    setTitlePage({ title: '', author: '', contact: '' })
                }

                // Migrate legacy 4-format system ('character') to new 3-format system ('dialogue')
                const migrateFormat = (node: any) => {
                    if (node.type === 'screenplayBlock' && node.attrs && node.attrs.format === 'character') {
                        node.attrs.format = 'dialogue'
                    }
                    if (node.content && Array.isArray(node.content)) {
                        node.content.forEach(migrateFormat)
                    }
                }
                if (docToLoad.type === 'doc' && docToLoad.content) {
                    docToLoad.content.forEach(migrateFormat)
                }

                editor.commands.setContent(docToLoad)
                alert('불러왔습니다.')
            } catch (e) {
                alert('잘못된 파일 형식입니다.')
            }
        }

        try {
            if ('showOpenFilePicker' in window) {
                const [handle] = await (window as any).showOpenFilePicker({
                    types: [{
                        description: 'JSON Files',
                        accept: { 'application/json': ['.json'] },
                    }],
                })
                setFileHandle(handle)
                const file = await handle.getFile()
                const content = await file.text()
                processFileContent(content)
            } else {
                // Fallback for iOS/iPadOS Safari: trigger actual DOM input
                if (fileInputRef.current) {
                    fileInputRef.current.click()
                }
            }
        } catch (err) {
            console.error(err)
        }
    }

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (re) => {
            const content = re.target?.result as string
            if (content) {
                try {
                    const json = JSON.parse(content)
                    // V2 Document Extraction & Title Page Restoration
                    let docToLoad = json
                    if (json.version === 2 && json.document) {
                        docToLoad = json.document
                        if (json.titlePage) {
                            setTitlePage(json.titlePage)
                        }
                    } else {
                        setTitlePage({ title: '', author: '', contact: '' })
                    }

                    const migrateFormat = (node: any) => {
                        if (node.type === 'screenplayBlock' && node.attrs && node.attrs.format === 'character') {
                            node.attrs.format = 'dialogue'
                        }
                        if (node.content && Array.isArray(node.content)) {
                            node.content.forEach(migrateFormat)
                        }
                    }
                    if (docToLoad.type === 'doc' && docToLoad.content) {
                        docToLoad.content.forEach(migrateFormat)
                    }

                    editor?.commands.setContent(docToLoad)
                    alert('불러왔습니다.')
                } catch (err) {
                    alert('잘못된 파일 형식입니다.')
                }
            }
        }
        reader.readAsText(file)
        // Reset input so the same file can be loaded again if needed
        e.target.value = ''
    }

    const setFormat = (format: ScreenplayFormat) => {
        // Apply format to current block
        const { state, dispatch } = editor.view
        const { selection } = state
        const { $from, $to } = selection

        editor.chain().focus().command(({ tr, dispatch }) => {
            if (dispatch) {
                tr.setNodeMarkup($from.before(), undefined, { format })
            }
            return true
        }).run()
    }

    const handleGeneratePdf = async () => {
        if (!editor || isGeneratingPdf) return;
        setIsGeneratingPdf(true);
        try {
            await generateAndDownloadPDF(titlePage, editor.getJSON());
        } catch (e) {
            console.error('PDF generation failed:', e);
            alert('PDF 생성에 실패했습니다. (네트워크 연결을 확인해주세요)');
        } finally {
            setIsGeneratingPdf(false);
        }
    }

    return (
        <div className="flex flex-col h-screen overflow-hidden">
            {/* Top Toolbar (Optional, hidden on print) */}
            <div className="no-print border-b bg-gray-50 flex items-center justify-between px-4 py-2 shrink-0">
                <div className="font-bold text-lg hidden sm:block">Kor Screenplay Writer</div>
                <div className="flex gap-2">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileInputChange}
                        accept=".json,application/json"
                        className="hidden"
                    />
                    <button onClick={handleLoad} className="px-3 py-1 bg-white border rounded shadow-sm hover:bg-gray-50 text-sm">불러오기</button>
                    <button onClick={handleSave} className="px-3 py-1 bg-blue-600 text-white border rounded shadow-sm hover:bg-blue-700 text-sm">저장하기</button>
                    <button
                        onClick={handleGeneratePdf}
                        disabled={isGeneratingPdf}
                        className={`px-3 py-1 text-white border rounded shadow-sm text-sm font-medium transition-colors ${isGeneratingPdf ? 'bg-indigo-400 border-indigo-400 cursor-not-allowed' : 'bg-indigo-600 border-indigo-700 hover:bg-indigo-700'}`}
                    >
                        {isGeneratingPdf ? '생성 중...' : 'PDF 저장'}
                    </button>
                </div>
            </div>

            {/* Editor Area */}
            <div className="flex-1 overflow-auto bg-gray-100 dark:bg-zinc-900 pb-[100px] sm:pb-0 relative">
                <EditorContent editor={editor} className="h-full" />

                {/* Scene Auto-prompt Overlay */}
                {scenePrompt.active && (
                    <div
                        className="fixed z-50 bg-white dark:bg-zinc-800 border shadow-xl rounded-md p-1.5 text-sm flex flex-col gap-1 min-w-32 max-h-48 overflow-y-auto"
                        style={{ top: scenePrompt.top + 8, left: scenePrompt.left }}
                    >
                        {scenePrompt.items.map((opt, i) => (
                            <div
                                key={opt}
                                className={`px-3 py-1.5 rounded cursor-default transition-colors ${scenePrompt.index === i ? 'bg-blue-600 text-white font-medium' : 'text-gray-800 dark:text-gray-200'}`}
                            >
                                {opt}
                            </div>
                        ))}
                    </div>
                )}

                {/* Auto-Complete Overlay */}
                {autoComplete.active && (
                    <div
                        className="fixed z-50 bg-white dark:bg-zinc-800 border shadow-xl rounded-md p-1.5 text-sm flex flex-col gap-1 min-w-32 max-h-48 overflow-y-auto"
                        style={{ top: autoComplete.top + 8, left: autoComplete.left }}
                    >
                        <div className="px-2 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">최근 사용</div>
                        {autoComplete.items.map((opt, i) => (
                            <div
                                key={opt}
                                className={`px-3 py-1.5 rounded cursor-default transition-colors truncate ${autoComplete.index === i ? 'bg-emerald-600 text-white font-medium' : 'text-gray-800 dark:text-gray-200'}`}
                            >
                                {opt}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Title Page Indicator */}
            <div
                className="no-print fixed bottom-16 sm:bottom-24 right-4 sm:right-6 bg-white dark:bg-zinc-800 border dark:border-zinc-700 shadow-lg rounded-full px-4 py-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-700 flex items-center gap-2 z-40 transition-colors"
                onClick={() => setIsTitleModalOpen(true)}
            >
                <span className="font-bold max-w-[150px] truncate">{titlePage.title || '문서 제목 없음'}</span>
                <span className="text-gray-400 text-xs">표지 편집</span>
            </div>

            {/* Title Page Modal */}
            {isTitleModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-2xl p-6 w-full max-w-md flex flex-col gap-4">
                        <div className="flex justify-between items-center border-b border-gray-200 dark:border-zinc-700 pb-3">
                            <h2 className="text-xl font-bold">시나리오 표지 설정</h2>
                            <button onClick={() => setIsTitleModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none">&times;</button>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">작품 제목</label>
                            <input
                                type="text"
                                value={titlePage.title}
                                onChange={e => setTitlePage(p => ({ ...p, title: e.target.value }))}
                                className="border rounded-md p-2.5 focus:ring-2 focus:ring-blue-500 outline-none dark:bg-zinc-800 dark:border-zinc-700 transition-all text-sm"
                                placeholder="작품 제목을 입력하세요"
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">지은이</label>
                            <input
                                type="text"
                                value={titlePage.author}
                                onChange={e => setTitlePage(p => ({ ...p, author: e.target.value }))}
                                className="border rounded-md p-2.5 focus:ring-2 focus:ring-blue-500 outline-none dark:bg-zinc-800 dark:border-zinc-700 transition-all text-sm"
                                placeholder="지은이 이름을 입력하세요"
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">연락처 / 비고</label>
                            <textarea
                                value={titlePage.contact}
                                onChange={e => setTitlePage(p => ({ ...p, contact: e.target.value }))}
                                className="border rounded-md p-2.5 h-24 resize-none focus:ring-2 focus:ring-blue-500 outline-none dark:bg-zinc-800 dark:border-zinc-700 transition-all text-sm leading-relaxed"
                                placeholder="이메일, 전화번호, 또는 초고 작성일 등"
                            ></textarea>
                        </div>

                        <div className="flex justify-end mt-2">
                            <button
                                onClick={() => setIsTitleModalOpen(false)}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-8 rounded-md transition-colors shadow-sm"
                            >
                                완료
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Touch Toolbar (Bottom fixed on mobile, or just floating) */}
            <div className="no-print fixed bottom-0 left-0 right-0 bg-white border-t p-2 sm:p-4 shadow-[0_-2px_10px_rgba(0,0,0,0.1)] flex justify-center gap-2 overflow-x-auto">
                {(Object.keys(FORMAT_LABELS) as ScreenplayFormat[]).map((fmt) => (
                    <button
                        key={fmt}
                        onClick={() => setFormat(fmt)}
                        className={`px-4 py-2 rounded-full whitespace-nowrap transition-colors ${currentFormat === fmt
                            ? 'bg-blue-600 text-white shadow-md'
                            : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
                            }`}
                    >
                        {FORMAT_LABELS[fmt]}
                    </button>
                ))}
            </div>
        </div>
    )
}
