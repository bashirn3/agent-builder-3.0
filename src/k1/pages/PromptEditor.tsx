import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useRef, type ReactNode } from 'react'
import { applyFormat, type Format } from '../ui/format'
import { Bold, Heading, Italic, List, ListOrdered, Maximize2 } from '../ui/icons'

const TOOLS: Array<{ kind: Format; label: string; icon: ReactNode; keys?: string } | 'sep'> = [
  { kind: 'bold', label: 'Bold', icon: <Bold />, keys: 'Mod-b' },
  { kind: 'italic', label: 'Italic', icon: <Italic />, keys: 'Mod-i' },
  { kind: 'heading', label: 'Heading', icon: <Heading /> },
  'sep',
  { kind: 'bullet', label: 'Bulleted list', icon: <List /> },
  { kind: 'number', label: 'Numbered list', icon: <ListOrdered /> },
]

// Markdown stays the source of truth (the agent reads it verbatim); the editor
// only styles it, so nothing is rewritten on load or save.
const markdownStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '17px', fontWeight: '600', color: 'var(--k1-ink)' },
  { tag: tags.heading2, fontSize: '16px', fontWeight: '600', color: 'var(--k1-ink)' },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontSize: '15px', fontWeight: '600', color: 'var(--k1-ink)' },
  { tag: tags.strong, fontWeight: '600', color: 'var(--k1-ink)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.processingInstruction, tags.list], color: 'var(--k1-placeholder)' },
  { tag: tags.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12.5px' },
  { tag: tags.link, color: 'var(--k1-para)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--k1-muted)' },
])

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.55', overflow: 'auto' },
  '.cm-content': { padding: '10px 12px', caretColor: 'var(--k1-ink)', color: 'var(--k1-ink)' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--k1-ink)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'rgba(9, 9, 11, 0.12) !important' },
  '.cm-placeholder': { color: 'var(--k1-placeholder)' },
})

export function PromptEditor({ id, value, onChange, readOnly, describedBy, onExpand, size = 'panel', label, placeholder }: {
  id: string
  value: string
  onChange: (value: string) => void
  readOnly: boolean
  describedBy?: string
  onExpand?: () => void
  size?: 'panel' | 'dialog'
  label?: string
  placeholder?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const editable = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const format = (kind: Format) => {
    const view = viewRef.current
    if (!view || readOnly) return
    const { from, to } = view.state.selection.main
    const current = view.state.doc.toString()
    const next = applyFormat(current, from, to, kind)
    view.dispatch({ changes: { from: 0, to: current.length, insert: next.value }, selection: { anchor: next.start, head: next.end }, userEvent: 'input.format' })
    view.focus()
  }
  const formatRef = useRef(format)
  formatRef.current = format

  useEffect(() => {
    if (!hostRef.current) return
    const shortcuts = TOOLS.flatMap((tool) => (tool !== 'sep' && tool.keys ? [{ key: tool.keys, run: () => { formatRef.current(tool.kind); return true } }] : []))
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...shortcuts, ...defaultKeymap, ...historyKeymap]),
          markdown(),
          syntaxHighlighting(markdownStyle),
          EditorView.lineWrapping,
          editorTheme,
          editable.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.contentAttributes.of({
            id,
            role: 'textbox',
            'aria-multiline': 'true',
            spellcheck: 'true',
            ...(label ? { 'aria-label': label } : {}),
            ...(describedBy ? { 'aria-describedby': describedBy } : {}),
          }),
          ...(placeholder ? [placeholderExt(placeholder)] : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) })
  }, [readOnly])

  return (
    <div className={`k1-editor k1-editor--${size}${readOnly ? ' is-readonly' : ''}`}>
      <div className="k1-editor__toolbar" role="toolbar" aria-label="Formatting" aria-controls={id}>
        {TOOLS.map((tool, index) => tool === 'sep' ? <span key={`sep-${index}`} className="k1-editor__sep" aria-hidden="true" /> : (
          <button
            key={tool.kind}
            type="button"
            className="k1-editor__tool"
            aria-label={tool.label}
            title={tool.keys ? `${tool.label} (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}${tool.keys.slice(-1).toUpperCase()})` : tool.label}
            disabled={readOnly}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format(tool.kind)}
          >
            {tool.icon}
          </button>
        ))}
        {onExpand && (
          <button type="button" className="k1-editor__tool k1-editor__expand" aria-label="Expand instructions" title="Expand" onClick={onExpand}>
            <Maximize2 size={14} strokeWidth={1.75} />
          </button>
        )}
      </div>
      <div ref={hostRef} className="k1-editor__input k1-editor__cm" />
    </div>
  )
}
