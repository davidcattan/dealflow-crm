'use client'

import { useEffect } from 'react'

// Enter saves whatever you're editing, anywhere in the CRM; Shift+Enter
// adds a new line in a text box.
// - Inside a [data-enter-save] block, Enter clicks its [data-save] button.
// - Otherwise inside a <form>, Enter submits the form (text boxes too).
// - [data-enter="off"] opts a box out (big paste areas, the AI chat).
export function EnterToSave() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.isComposing || e.defaultPrevented) return
      const el = e.target as HTMLElement | null
      if (!el) return
      const isTextArea = el instanceof HTMLTextAreaElement
      const isInput =
        el instanceof HTMLInputElement && !['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'range', 'color'].includes(el.type)
      if (!isTextArea && !isInput) return
      if (el.closest('[data-enter="off"]')) return

      const scope = el.closest<HTMLElement>('[data-enter-save]')
      if (scope) {
        const button = scope.querySelector<HTMLButtonElement>('button[data-save]')
        if (button && !button.disabled) {
          e.preventDefault()
          button.click()
        }
        return
      }
      const form = (el as HTMLInputElement | HTMLTextAreaElement).form
      if (form) {
        e.preventDefault()
        form.requestSubmit()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return null
}
