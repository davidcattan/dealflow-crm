'use client'

import { useState, useTransition } from 'react'
import { DEFAULT_PROSPECT_BODY, DEFAULT_PROSPECT_SUBJECT, type ProspectTemplate } from '@/lib/prospects/email'
import { saveProspectEmail } from './actions'

// Your cold email, editable right where the drafts are made. {first_name}
// and {company} are filled in per person; your JED signature is added below.
export function EmailTemplate({ template, onSaved }: { template?: ProspectTemplate | null; onSaved: (t: ProspectTemplate) => void }) {
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState(template?.subject?.trim() || DEFAULT_PROSPECT_SUBJECT)
  const [body, setBody] = useState(template?.body?.trim() || DEFAULT_PROSPECT_BODY)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const isDefault = subject.trim() === DEFAULT_PROSPECT_SUBJECT && body.trim() === DEFAULT_PROSPECT_BODY

  const save = (s: string, b: string) =>
    startTransition(async () => {
      setNote(null)
      // Saving the standard email stores nothing, so later updates to it apply.
      const standard = s.trim() === DEFAULT_PROSPECT_SUBJECT && b.trim() === DEFAULT_PROSPECT_BODY
      const res = await saveProspectEmail(standard ? '' : s, standard ? '' : b)
      if (res && 'error' in res && res.error) setNote({ ok: false, text: res.error })
      else {
        onSaved({ subject: standard ? null : s, body: standard ? null : b })
        setNote({ ok: true, text: 'Saved — new drafts use this email.' })
      }
    })

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm">
        <span className="font-medium text-slate-800">Your email</span>
        <span className="text-xs text-slate-500">{open ? 'Hide' : `Edit · ${subject}`}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-100 px-3 py-3">
          <label className="block text-xs font-medium text-slate-600">
            Subject
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-normal text-slate-800"
            />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Email
            <textarea
              data-enter="off"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal leading-relaxed text-slate-800"
            />
          </label>
          <p className="text-xs text-slate-500">
            <code className="rounded bg-slate-100 px-1">{'{first_name}'}</code> and <code className="rounded bg-slate-100 px-1">{'{company}'}</code> are filled in for each person. Your JED signature is added after the last line.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending || !subject.trim() || !body.trim()}
              onClick={() => save(subject, body)}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
            {!isDefault && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!confirm('Go back to the standard email?')) return
                  setSubject(DEFAULT_PROSPECT_SUBJECT)
                  setBody(DEFAULT_PROSPECT_BODY)
                  save(DEFAULT_PROSPECT_SUBJECT, DEFAULT_PROSPECT_BODY)
                }}
                className="text-xs text-slate-500 hover:underline"
              >
                Reset to the standard email
              </button>
            )}
            {note && <span className={`text-xs ${note.ok ? 'text-emerald-700' : 'text-red-600'}`}>{note.text}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
