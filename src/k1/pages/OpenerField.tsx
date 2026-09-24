import { useId, useRef } from 'react'
import { Plus } from '../ui/icons'

const TOKENS = [
  { raw: '{{first_name}}', label: '{First name}', name: 'First name' },
  { raw: '{{registration_number}}', label: '{Registration}', name: 'Registration' },
]
const toDisplay = (value: string) => TOKENS.reduce((text, token) => text.split(token.raw).join(token.label), value)
const toRaw = (value: string) => TOKENS.reduce((text, token) => text.split(token.label).join(token.raw), value)

export function OpenerField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId()
  const hint = useId()
  const ref = useRef<HTMLTextAreaElement>(null)
  const shown = toDisplay(value)
  const insert = (label: string) => {
    const node = ref.current
    const start = node?.selectionStart ?? shown.length
    const end = node?.selectionEnd ?? shown.length
    const next = shown.slice(0, start) + label + shown.slice(end)
    onChange(toRaw(next))
    requestAnimationFrame(() => {
      node?.focus()
      node?.setSelectionRange(start + label.length, start + label.length)
    })
  }
  return (
    <div className="k1-opener">
      <label className="k1-label" htmlFor={id}>Initial message</label>
      <textarea
        ref={ref}
        id={id}
        className="k1-textarea k1-textarea--field"
        rows={3}
        maxLength={1000}
        value={shown}
        placeholder="Hi! What can I help you with?"
        aria-describedby={hint}
        onChange={(event) => onChange(toRaw(event.target.value))}
      />
      <div className="k1-opener__foot">
        <div className="k1-opener__tokens" role="group" aria-label="Insert customer detail">
          {TOKENS.map((token) => (
            <button key={token.raw} type="button" className="k1-token" onClick={() => insert(token.label)}>
              <Plus size={12} />{token.name}
            </button>
          ))}
        </div>
        <span className="k1-opener__hint" id={hint}>Filled in per customer</span>
      </div>
    </div>
  )
}
