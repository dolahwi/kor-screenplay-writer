import { Node, mergeAttributes, InputRule } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'

export type ScreenplayFormat = 'scene' | 'action' | 'dialogue'

const FORMATS: ScreenplayFormat[] = ['scene', 'action', 'dialogue']

export const ScreenplayBlock = Node.create({
    name: 'screenplayBlock',
    priority: 1000,

    group: 'block',
    content: 'inline*',

    addAttributes() {
        return {
            format: {
                default: 'action',
                parseHTML: element => element.getAttribute('data-format') || 'action',
                renderHTML: attributes => {
                    return {
                        'data-format': attributes.format,
                        class: `sp-${attributes.format}`
                    }
                },
            },
        }
    },

    parseHTML() {
        return [
            { tag: 'p[data-format]' },
        ]
    },

    renderHTML({ HTMLAttributes }) {
        return ['p', mergeAttributes(HTMLAttributes), 0]
    },

    addKeyboardShortcuts() {
        return {
            Tab: () => {
                const { state, dispatch } = this.editor.view
                const { selection } = state
                const { $from, empty } = selection

                // Korean IME Fix
                if (this.editor.view.composing) {
                    this.editor.view.dom.blur()
                    this.editor.view.dom.focus()
                }

                const node = $from.parent
                if (node.type.name !== this.name) {
                    if (dispatch) {
                        const tr = state.tr.setNodeMarkup($from.before(), this.type, { format: 'scene' })
                        dispatch(tr)
                    }
                    return true
                }

                if (empty && $from.parentOffset === 0) {
                    const currentFormat = node.attrs.format as ScreenplayFormat
                    const currentIndex = FORMATS.indexOf(currentFormat)
                    const nextIndex = (currentIndex + 1) % FORMATS.length
                    const nextFormat = FORMATS[nextIndex]

                    if (dispatch) {
                        const tr = state.tr.setNodeMarkup($from.before(), undefined, { format: nextFormat })
                        dispatch(tr)
                    }
                    return true
                }

                if (dispatch) {
                    const tr = state.tr.insertText('\t')
                    dispatch(tr)
                }
                return true
            },

            'Shift-Tab': () => {
                const { state, dispatch } = this.editor.view
                const { selection } = state
                const { $from, empty } = selection

                const node = $from.parent
                if (node.type.name !== this.name) {
                    if (dispatch) {
                        const tr = state.tr.setNodeMarkup($from.before(), this.type, { format: 'action' })
                        dispatch(tr)
                    }
                    return true
                }

                if (empty && $from.parentOffset === 0) {
                    const currentFormat = node.attrs.format as ScreenplayFormat
                    let prevIndex = FORMATS.indexOf(currentFormat) - 1
                    if (prevIndex < 0) prevIndex = FORMATS.length - 1
                    const prevFormat = FORMATS[prevIndex]

                    if (dispatch) {
                        const tr = state.tr.setNodeMarkup($from.before(), undefined, { format: prevFormat })
                        dispatch(tr)
                    }
                    return true
                }
                return false
            },

            Enter: () => {
                const { state, dispatch } = this.editor.view
                const { selection } = state
                const { $from } = selection

                const node = $from.parent
                if (node.type.name !== this.name) return false

                const currentFormat = node.attrs.format as ScreenplayFormat

                if (dispatch) {
                    // "지문 에서 엔터 누르면 대사로 변경."
                    // "대사에서 엔터 누르면 새로운 대사 인물 블록 생성."
                    let nextFormat: ScreenplayFormat = 'action'
                    if (currentFormat === 'action' || currentFormat === 'dialogue') {
                        nextFormat = 'dialogue'
                    }

                    const tr = state.tr.split($from.pos, 1, [{ type: this.type, attrs: { format: nextFormat } }])
                    dispatch(tr.scrollIntoView())
                }
                return true
            },

            'Shift-Enter': () => {
                const { state } = this.editor.view
                const { selection } = state
                const { $from } = selection

                const node = $from.parent
                if (node.type.name !== this.name) return false

                // "지문에서 시프트 엔터 누르면 지문 내에서 줄바꿈"
                // "대사에서 시프트 엔터 누르면 대사 내에서 줄바꿈."
                return this.editor.commands.setHardBreak()
            },

            'Mod-1': () => {
                return this.editor.commands.updateAttributes(this.name, { format: 'scene' })
            },

            'Mod-2': () => {
                return this.editor.commands.updateAttributes(this.name, { format: 'action' })
            },

            'Mod-3': () => {
                return this.editor.commands.updateAttributes(this.name, { format: 'dialogue' })
            },
        }
    },


    addInputRules() {
        return [
            new InputRule({
                find: /^ㅆ\s?$/,
                handler: ({ state, range }) => {
                    const { tr, doc } = state
                    const $start = doc.resolve(range.from)

                    // Parse previous scene headings to find the highest number
                    let lastSceneNum = 0
                    doc.nodesBetween(0, range.from, (node) => {
                        if (node.type.name === 'screenplayBlock' && node.attrs.format === 'scene') {
                            const match = node.textContent.match(/S#\s*(\d+)/)
                            if (match) {
                                const num = parseInt(match[1], 10)
                                if (num > lastSceneNum) {
                                    lastSceneNum = num
                                }
                            }
                        }
                    })

                    const nextSceneNum = lastSceneNum + 1

                    // Change format to scene (must use this.type to ensure it's a screenplayBlock)
                    tr.setNodeMarkup($start.before(), this.type, { format: 'scene' })
                    tr.insertText(`S# ${nextSceneNum}. `, range.from, range.to)
                }
            })
        ]
    }
})
