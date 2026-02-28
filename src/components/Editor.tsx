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
    let rawSearch = ''
    let baseText = '' // The text before the search query that we should keep

    const locMatch = text.match(/^(S#\s\d+\.\s*)(.*?)$/)
    const timeMatch = text.match(/^(S#\s\d+\.\s+(?:내부|외부|내부\/외부|외부\/내부)\s*-\s*)(.*)$/)

    if (timeMatch) {
        promptType = 'time'
        const prefix = timeMatch[1]
        const locationDetailAndTime = timeMatch[2]

        const secondHyphenMatch = locationDetailAndTime.match(/^(.*?\s*-\s*)(.*)$/)
        if (secondHyphenMatch) {
            baseText = prefix + secondHyphenMatch[1]
            rawSearch = secondHyphenMatch[2]
            search = rawSearch.trim()
        } else {
            const lastWordMatch = locationDetailAndTime.match(/^(.*?(?:^|\s+))([^\s]*)$/)
            if (lastWordMatch) {
                if (lastWordMatch[1] === "" && lastWordMatch[2] !== "") {
                    baseText = prefix
                    rawSearch = lastWordMatch[2]
                    search = rawSearch.trim()
                } else {
                    baseText = prefix + lastWordMatch[1]
                    rawSearch = lastWordMatch[2]
                    search = rawSearch.trim()
                }
            } else {
                baseText = prefix
                rawSearch = locationDetailAndTime
                search = rawSearch.trim()
            }
        }
    } else if (locMatch && !locMatch[2].includes('-')) {
        promptType = 'location'
        baseText = locMatch[1] // "S# 1. "
        rawSearch = locMatch[2]
        search = rawSearch.trim()
    }

    if (!promptType) return { promptType: null, matches: [], search: '', rawSearch: '', baseText: '' }

    const currentList = promptType === 'location' ? SCENE_OPTIONS : TIME_OPTIONS
    const searchChoseong = getChoseong(search)

    // Always include exact or Choseong matches, fallback to full list if no search query.
    const matches = search ? currentList.filter(o =>
        o.startsWith(search) || getChoseong(o).startsWith(searchChoseong)
    ) : currentList

    return { promptType, matches, search, rawSearch, baseText }
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
    const [isManualOpen, setIsManualOpen] = useState(false)
    const [isShowCredit, setIsShowCredit] = useState(false)
    const [isSansFont, setIsSansFont] = useState(false)

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

    // Global suppression for prompt/autocomplete after selection via Enter
    const insertSuppressionRef = useRef(false)
    const backspaceSuppressionRef = useRef(false)

    // Global Font Override
    useEffect(() => {
        if (isSansFont) {
            document.documentElement.style.setProperty('--sp-font-family', 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif')
        } else {
            document.documentElement.style.removeProperty('--sp-font-family')
        }
    }, [isSansFont])

    const checkScenePrompt = (editor: any): boolean => {
        if (insertSuppressionRef.current) {
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
            const currentText = node.textContent.slice(0, $from.parentOffset)
            const { promptType, matches, search, rawSearch } = getScenePromptMatches(currentText)

            if (promptType && matches.length > 0) {
                if (promptActiveRef.current && rawSearch !== search && rawSearch.endsWith(' ')) {
                    setTimeout(() => {
                        view.dispatch(state.tr.delete(state.selection.from - 1, state.selection.from))
                        const nextIdx = (promptIndexRef.current + 1) % matches.length
                        promptIndexRef.current = nextIdx
                        setScenePrompt(prev => prev.active ? { ...prev, index: nextIdx } : prev)
                    }, 0)
                    return true
                }

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
            const text = node.textContent.slice(0, $from.parentOffset)
            const matchFull = text.match(/^S#\s\d+\.\s+(.+)$/)
            if (matchFull) {
                const rawSearch = matchFull[1]
                const search = rawSearch.trim()
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
                    if (acActiveRef.current && rawSearch !== search && rawSearch.endsWith(' ')) {
                        setTimeout(() => {
                            view.dispatch(state.tr.delete(state.selection.from - 1, state.selection.from))
                            const nextIdx = (acIndexRef.current + 1) % matches.length
                            acIndexRef.current = nextIdx
                            setAutoComplete(prev => prev.active ? { ...prev, index: nextIdx } : prev)
                        }, 0)
                        return true
                    }

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
                const rawSearch = text
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
                    if (acActiveRef.current && rawSearch !== search && rawSearch.endsWith(' ')) {
                        setTimeout(() => {
                            view.dispatch(state.tr.delete(state.selection.from - 1, state.selection.from))
                            const nextIdx = (acIndexRef.current + 1) % matches.length
                            acIndexRef.current = nextIdx
                            setAutoComplete(prev => prev.active ? { ...prev, index: nextIdx } : prev)
                        }, 0)
                        return true
                    }

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
            if (insertSuppressionRef.current) {
                acSuppressedRef.current = true
                promptSuppressedRef.current = true
                insertSuppressionRef.current = false
            } else if (backspaceSuppressionRef.current) {
                acSuppressedRef.current = true
                promptSuppressedRef.current = true
                backspaceSuppressionRef.current = false
            } else {
                acSuppressedRef.current = false
                promptSuppressedRef.current = false
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
                    backspaceSuppressionRef.current = true

                    if (acActiveRef.current) {
                        acSuppressedRef.current = true
                        acActiveRef.current = false
                        setAutoComplete({ active: false })
                    }
                    if (promptActiveRef.current) {
                        promptSuppressedRef.current = true
                        promptActiveRef.current = false
                        setScenePrompt({ active: false })
                    }

                    // Custom Bulk Delete for Scene Attributes
                    const { state } = view
                    const { $from, empty } = state.selection
                    if (empty && $from.parent.type.name === 'screenplayBlock' && $from.parent.attrs.format === 'scene') {
                        const textBeforeCursor = $from.parent.textContent.slice(0, $from.parentOffset)
                        const blockWords = ["내부", "외부", "내부/외부", "외부/내부", ...TIME_OPTIONS]

                        for (const word of blockWords) {
                            if (textBeforeCursor.endsWith(word)) {
                                const beforeWord = textBeforeCursor.slice(0, -word.length)
                                // Ensure it's not a partial match inside a normal location word (e.g., '시내부' shouldn't bulk delete '내부')
                                if (beforeWord === '' || beforeWord.match(/[\s-]$/)) {
                                    event.preventDefault()
                                    const tr = state.tr.delete($from.pos - word.length, $from.pos)
                                    view.dispatch(tr.scrollIntoView())
                                    return true
                                }
                            }
                        }

                        // Check for spacing/hyphen blocks or arbitrary words
                        if (textBeforeCursor.endsWith(' - ')) {
                            event.preventDefault()
                            const tr = state.tr.delete($from.pos - 3, $from.pos)
                            view.dispatch(tr.scrollIntoView())
                            return true
                        } else if (textBeforeCursor.match(/\s+([^\s]+)$/)) {
                            // Delete the last full word
                            const match = textBeforeCursor.match(/\s+([^\s]+)$/)
                            if (match && match[1]) {
                                // Only do this if we are past the "S# 1. " part
                                const prefixMatch = textBeforeCursor.match(/^(S#\s\d+\.\s*)/)
                                if (prefixMatch && textBeforeCursor.length - match[1].length >= prefixMatch[1].length) {
                                    event.preventDefault()
                                    const tr = state.tr.delete($from.pos - match[1].length, $from.pos)
                                    view.dispatch(tr.scrollIntoView())
                                    return true
                                }
                            }
                        }
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

                        insertSuppressionRef.current = true
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

                        const st = view.state
                        const fromPos = st.selection.$from
                        const currentText = fromPos.parent.textContent.slice(0, fromPos.parentOffset)

                        const { promptType, baseText } = getScenePromptMatches(currentText)
                        let newText = ''

                        if (promptType === 'location') {
                            newText = baseText + option + ' - '
                        } else if (promptType === 'time') {
                            const cleanBase = baseText.replace(/[\s-]+$/, '')
                            newText = cleanBase + ' - ' + option
                        } else {
                            // Fallback
                            newText = currentText
                        }

                        insertSuppressionRef.current = true
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

                {/* Bottom Left Buttons (Manual, Font, Credit) */}
                <div className="no-print fixed bottom-4 sm:bottom-6 left-4 sm:left-6 flex flex-col gap-2 z-40">
                    <div
                        className="bg-white dark:bg-zinc-800 border dark:border-zinc-700 shadow-lg rounded-full px-4 py-2 sm:py-2.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-700 flex items-center justify-center transition-colors group"
                        onClick={() => setIsSansFont(!isSansFont)}
                        title="폰트 변경"
                    >
                        <span className="font-bold text-gray-700 dark:text-gray-200 text-xs sm:text-sm group-hover:text-blue-600 transition-colors">
                            {isSansFont ? '고딕체' : '명조체'}
                        </span>
                    </div>

                    <div
                        className="bg-white dark:bg-zinc-800 border dark:border-zinc-700 shadow-lg rounded-full p-2.5 sm:p-3 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-700 flex items-center justify-center gap-2 transition-colors group"
                        onClick={() => setIsManualOpen(true)}
                        title="설명서 보기"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600 dark:text-gray-300 group-hover:text-blue-600 transition-colors"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                        <span className="font-bold text-gray-700 dark:text-gray-200 hidden sm:block pr-1">설명서</span>
                    </div>

                    <div
                        className="bg-white dark:bg-zinc-800 border dark:border-zinc-700 shadow-lg rounded-full px-4 py-2 sm:py-2.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-700 flex items-center justify-center transition-colors group"
                        onClick={() => setIsShowCredit(true)}
                        title="만든이"
                    >
                        <span className="font-bold text-gray-700 dark:text-gray-200 text-xs uppercase tracking-widest group-hover:text-blue-600 transition-colors">WHO</span>
                    </div>
                </div>
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

            {/* Manual Modal */}
            {isManualOpen && (
                <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-2xl p-6 w-full max-w-2xl max-h-[85vh] flex flex-col gap-4 overflow-hidden">
                        <div className="flex justify-between items-center border-b border-gray-200 dark:border-zinc-700 pb-3 shrink-0">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
                                단축키 및 사용 설명서
                            </h2>
                            <button onClick={() => setIsManualOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none p-2">&times;</button>
                        </div>

                        <div className="overflow-y-auto pr-2 pb-4 text-sm text-gray-700 dark:text-gray-300 space-y-6">

                            <section>
                                <h3 className="font-bold text-base text-gray-900 dark:text-gray-100 mb-2 border-l-4 border-blue-500 pl-2">1. 기본 서식 단축키 (Mac/Win 공통)</h3>
                                <ul className="list-disc pl-5 space-y-1.5">
                                    <li><kbd className="bg-gray-100 dark:bg-zinc-800 border px-1.5 py-0.5 rounded text-xs">F1</kbd> 또는 <kbd className="bg-gray-100 dark:bg-zinc-800 border px-1.5 py-0.5 rounded text-xs">Cmd/Ctrl + 1</kbd> : <strong>씬 제목 (Scene)</strong> 블록으로 변경</li>
                                    <li><kbd className="bg-gray-100 dark:bg-zinc-800 border px-1.5 py-0.5 rounded text-xs">F2</kbd> 또는 <kbd className="bg-gray-100 dark:bg-zinc-800 border px-1.5 py-0.5 rounded text-xs">Cmd/Ctrl + 2</kbd> : <strong>지문 (Action)</strong> 블록으로 변경</li>
                                    <li><kbd className="bg-gray-100 dark:bg-zinc-800 border px-1.5 py-0.5 rounded text-xs">F3</kbd> 또는 <kbd className="bg-gray-100 dark:bg-zinc-800 border px-1.5 py-0.5 rounded text-xs">Cmd/Ctrl + 3</kbd> : <strong>대사 (Dialogue)</strong> 블록으로 변경</li>
                                    <li className="text-gray-500 mt-1">※ 씬 제목 환경에서 `엔터`를 치면 자동으로 지문 환경으로 넘어가는 등 똑똑하게 자동 전환됩니다.</li>
                                </ul>
                            </section>

                            <section>
                                <h3 className="font-bold text-base text-gray-900 dark:text-gray-100 mb-2 border-l-4 border-emerald-500 pl-2">2. 장소/인물 자동 완성 (최근 사용)</h3>
                                <ul className="list-disc pl-5 space-y-1.5">
                                    <li><strong>초성 검색 지원</strong>: `학교`를 찾을 때 `ㅎㄱ`만 입력해도 이전에 썼던 장소/인물 목록 창(초록색)이 뜹니다.</li>
                                    <li><strong>이동 및 선택</strong>: 목록이 떴을 때 <kbd className="bg-gray-100 dark:bg-zinc-800 border px-1.5 py-0.5 rounded text-xs">Spacebar</kbd> 또는 <kbd className="bg-gray-100 dark:bg-zinc-800 border px-1.5 py-0.5 rounded text-xs">위/아래 방향키</kbd>로 이동하고 <kbd className="bg-gray-100 dark:bg-zinc-800 border px-1.5 py-0.5 rounded text-xs">Enter</kbd>로 선택합니다.</li>
                                    <li><strong>메뉴 닫기</strong>: 마음에 드는 게 없거나 직접 입력하고 싶다면 무시하고 계속 타이핑하시거나 <kbd className="bg-gray-100 dark:bg-zinc-800 border px-1.5 py-0.5 rounded text-xs">ESC</kbd>를 누르면 창이 닫힙니다.</li>
                                </ul>
                            </section>

                            <section>
                                <h3 className="font-bold text-base text-gray-900 dark:text-gray-100 mb-2 border-l-4 border-indigo-500 pl-2">3. 씬 제목 스마트 입력 기능</h3>
                                <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-md border border-blue-100 dark:border-blue-800 text-sm mb-2">
                                    <strong>타이핑 예시:</strong> `S# 1. 내부` 띄어쓰기 `학교 앞` 띄어쓰기 `낮`
                                </div>
                                <ul className="list-disc pl-5 space-y-1.5">
                                    <li>장소 (`-` 기호 앞부분) 를 입력하고 스페이스바를 치면 <strong>내부/외부 (파란색)</strong> 목록이 뜹니다.</li>
                                    <li>시간 (`-` 기호 뒷부분) 위치에서 스페이스바를 치면 <strong>시간 대(아침, 낮, 밤 등)</strong> 목록이 뜹니다.</li>
                                    <li>엔터를 쳐서 목록을 선택하면 <strong>자동으로 띄어쓰기와 붙임표( - )가 삽입</strong>되어 형식을 깔끔하게 맞춥니다.</li>
                                </ul>
                            </section>

                            <section>
                                <h3 className="font-bold text-base text-gray-900 dark:text-gray-100 mb-2 border-l-4 border-red-500 pl-2">4. 스마트 삭제 (Backspace)</h3>
                                <ul className="list-disc pl-5 space-y-1.5">
                                    <li>씬 제목 줄에서 백스페이스를 눌러 텍스트를 지울 때, <strong>장소 단어("우리 학교"), 내부/외부 형식, 시간대("아침"), 연결자(" - ")가 "단어 덩어리" 단위로 한 번에 삭제</strong>되어 수정이 매우 편리합니다.</li>
                                    <li>글자를 지우는 도중에는 팝업 메뉴가 뜨지 않습니다. 다 지우고 다시 스페이스바를 톡 치면 그때 유용한 정보 목록이 나타납니다.</li>
                                </ul>
                            </section>

                            <section>
                                <h3 className="font-bold text-base text-gray-900 dark:text-gray-100 mb-2 border-l-4 border-purple-500 pl-2">5. 저장 및 내보내기</h3>
                                <ul className="list-disc pl-5 space-y-1.5">
                                    <li><strong>저장하기 (.json)</strong>: 현재 작업 중인 시나리오 원본 데이터를 컴퓨터에 파일로 저장합니다.</li>
                                    <li><strong>불러오기</strong>: 다운로드 받았던 .json 파일을 가져와서 하던 작업을 계속할 수 있습니다.</li>
                                    <li><strong>PDF 저장</strong>: 우측 하단의 `표지 편집` 버튼을 눌러 제목과 이름을 세팅한 뒤, 상단 <strong>PDF 저장</strong> 버튼을 누르면 인쇄소에 보낼 수 있는 한국 표준 A4 규격의 시나리오 PDF가 생성됩니다.</li>
                                </ul>
                            </section>

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
                </div>
            )}

            {/* Credit Overlay */}
            {isShowCredit && (
                <div
                    className="fixed inset-0 bg-black z-[100] flex items-center justify-center overflow-hidden cursor-pointer"
                    onClick={() => setIsShowCredit(false)}
                >
                    <div
                        className="text-[40vw] md:text-[90vh] leading-none font-black text-white tracking-tighter select-none drop-shadow-[0_0_30px_rgba(255,255,255,0.4)] hover:scale-[1.02] transition-transform duration-500"
                        style={{ fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}
                    >
                        HWI
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
