'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { readJsonResponse } from '@/lib/fetch-json'
import type { CallSuggestion } from '@/lib/calls/process'
import { clock, useCallRecorder } from '@/components/call-recorder-provider'

export type CallRow = {
  id: string
  status: 'uploaded' | 'transcribing' | 'summarizing' | 'done' | 'error'
  created_at: string
  duration_seconds: number | null
  transcript: string | null
  // Deal and lender calls share these fields (plus their own extras).
  result: {
    title: string
    summary: string
    key_points: string[]
    next_steps: {
      text: string
      owner: 'us' | 'borrower' | 'lender' | 'other'
    }[]
  } | null
  suggestions: CallSuggestion[]
  applied: string[]
  error: string | null
  call_with?: string | null
  lender_id?: string | null
}

const PENDING = ['uploaded', 'transcribing', 'summarizing']

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

type Who = {
  callWith: 'borrower' | 'lender' | 'broker' | null
  lenderId: string | null
}

// Dropdown value -> who the call is with.
function parseWho(value: string): Who {
  if (value.startsWith('lender:')) return { callWith: 'lender', lenderId: value.slice(7) }
  if (value === 'borrower' || value === 'broker') return { callWith: value, lenderId: null }
  return { callWith: null, lenderId: null }
}

// Where a recording goes: a deal's calls or a lender's, and how the red
// "Recording" bar names it.
export type CallTarget = {
  uploadUrl: string
  pathPrefix: string
  label: string
  href: string
}

// An existing recording file (e.g. from Zoom) uploaded by hand.
async function uploadFileCall(target: CallTarget, file: File, who: Who) {
  const supabase = createClient()
  const ext = (file.name.split('.').pop() ?? 'audio').toLowerCase().replace(/[^a-z0-9]/g, '') || 'audio'
  const storagePath = `${target.pathPrefix}${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('borrower-documents')
    .upload(storagePath, file, { contentType: file.type || undefined })
  if (error) throw new Error(`Upload failed: ${error.message}`)
  const res = await fetch(target.uploadUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      storagePaths: [storagePath],
      durationSeconds: null,
      ...who,
    }),
  })
  const result = await readJsonResponse(res)
  if (!result.ok) throw new Error(result.message)
}

export type LenderOption = { id: string; name: string }

// Deal calls ask who's on the call; lender calls already know.
export type WhoOptions = {
  borrowerName: string
  dealLenders: LenderOption[]
  otherLenders: LenderOption[]
}

// The dropdown value for who a saved call was with.
function whoValue(call: CallRow) {
  if (call.call_with === 'lender' && call.lender_id) return `lender:${call.lender_id}`
  if (call.call_with === 'borrower' || call.call_with === 'broker') return call.call_with
  return ''
}

// "with Fairview" / "with Gabby Huguenin" for a call card.
function whoLabel(call: CallRow, options: WhoOptions) {
  if (call.call_with === 'borrower') return `with ${options.borrowerName}`
  if (call.call_with === 'broker') return 'with the referral partner'
  if (call.call_with === 'lender' && call.lender_id) {
    const l = [...options.dealLenders, ...options.otherLenders].find((x) => x.id === call.lender_id)
    return l ? `with ${l.name}` : null
  }
  return null
}

function WhoSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: WhoOptions }) {
  return (
    <label className="flex flex-wrap items-center gap-2">
      Who&apos;s on this call?
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal text-slate-800"
      >
        <option value="">Not sure — let AI figure it out</option>
        <option value="borrower">Borrower — {options.borrowerName}</option>
        <option value="broker">Referral partner / broker</option>
        {options.dealLenders.length > 0 && (
          <optgroup label="Lenders on this deal">
            {options.dealLenders.map((l) => (
              <option key={l.id} value={`lender:${l.id}`}>
                {l.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Other lenders">
          {options.otherLenders.map((l) => (
            <option key={l.id} value={`lender:${l.id}`}>
              {l.name}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  )
}

// The Record button. The recording itself runs in CallRecorderProvider
// (above every page), so it keeps going if you leave this page.
export function CallRecorder({ target, whoOptions, hint }: { target: CallTarget; whoOptions?: WhoOptions; hint: string }) {
  const router = useRouter()
  const rec = useCallRecorder()
  const [who, setWho] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const here = rec.target?.uploadUrl === target.uploadUrl
  const busy = rec.state !== 'idle'

  function pickWho(value: string) {
    setWho(value)
    // Changing it mid-call updates the call being recorded.
    if (here) {
      const w = parseWho(value)
      rec.setWho(w.callWith, w.lenderId)
    }
  }

  function start() {
    setError(null)
    const w = whoOptions ? parseWho(who) : { callWith: 'lender' as const, lenderId: null }
    rec.start({ ...target, ...w })
  }

  async function uploadFile(file: File) {
    setError(null)
    setUploading(true)
    try {
      await uploadFileCall(target, file, whoOptions ? parseWho(who) : { callWith: 'lender', lenderId: null })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const picker = whoOptions && (
    <div className="text-sm text-slate-600">
      <WhoSelect value={who} onChange={pickWho} options={whoOptions} />
    </div>
  )

  return (
    <div className="space-y-3">
      {picker}
      {here && rec.state === 'recording' ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <span className="font-mono text-sm font-medium text-red-700">● Recording {clock(rec.seconds)}</span>
          <span className="text-xs text-red-700/80">
            Keep the call on speaker. You can move around the CRM — it keeps recording.
          </span>
          <button
            type="button"
            onClick={rec.stop}
            className="ml-auto rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            Stop &amp; write notes
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={start}
            disabled={busy || uploading}
            className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
            {rec.state === 'starting' && here
              ? 'Starting…'
              : rec.state === 'uploading' || uploading
                ? 'Saving recording…'
                : busy
                  ? 'Recording another call…'
                  : 'Record call'}
          </button>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy || uploading}
            className="text-sm text-slate-500 hover:underline disabled:opacity-50"
          >
            or upload a recording
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,video/mp4,.m4a,.mp3,.wav,.webm,.mp4"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
          />
          <span className="text-xs text-slate-400">{hint}</span>
        </div>
      )}
      {(error || (here || rec.state === 'idle' ? rec.error : null)) && (
        <p className="text-sm text-red-600">{error ?? rec.error}</p>
      )}
    </div>
  )
}

const OWNER_LABEL: Record<string, string> = {
  us: 'Us',
  borrower: 'Borrower',
  lender: 'Lender',
  other: 'Other',
}

type Notes = NonNullable<CallRow['result']>
type Owner = Notes['next_steps'][number]['owner']

// Edits a call's title, summary, key points and next steps (its summary in
// Updates is kept in step).
function EditNotes({
  call,
  notes,
  whoOptions,
  onDone,
}: {
  call: CallRow
  notes: Notes
  whoOptions?: WhoOptions
  onDone: () => void
}) {
  const router = useRouter()
  const [title, setTitle] = useState(notes.title)
  const [summary, setSummary] = useState(notes.summary)
  const [points, setPoints] = useState(notes.key_points.length ? [...notes.key_points] : [''])
  const [steps, setSteps] = useState(notes.next_steps.map((x) => ({ ...x })))
  const [who, setWho] = useState(whoValue(call))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = 'w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm'

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/calls/${call.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title,
          summary,
          key_points: points,
          next_steps: steps,
          ...(whoOptions ? { who: parseWho(who) } : {}),
        }),
      })
      const result = await readJsonResponse(res)
      if (!result.ok) throw new Error(result.message)
      router.refresh()
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-enter-save className="mt-2 space-y-3">
      {whoOptions && (
        <div className="text-xs font-medium text-slate-600">
          <WhoSelect value={who} onChange={setWho} options={whoOptions} />
        </div>
      )}
      <label className="block text-xs font-medium text-slate-600">
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={`mt-1 ${input}`} />
      </label>
      <label className="block text-xs font-medium text-slate-600">
        Summary
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} className={`mt-1 ${input}`} />
      </label>
      <div>
        <p className="text-xs font-medium text-slate-600">Key points</p>
        <ul className="mt-1 space-y-2">
          {points.map((point, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                value={point}
                onChange={(e) => setPoints(points.map((x, j) => (j === i ? e.target.value : x)))}
                className={`min-w-0 flex-1 ${input}`}
              />
              <button
                type="button"
                onClick={() => setPoints(points.filter((_, j) => j !== i))}
                className="text-xs text-slate-400 hover:text-red-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setPoints([...points, ''])} className="mt-2 text-xs text-slate-600 hover:underline">
          + Add key point
        </button>
      </div>
      <div>
        <p className="text-xs font-medium text-slate-600">Next steps</p>
        <ul className="mt-1 space-y-2">
          {steps.map((step, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <select
                value={step.owner}
                onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, owner: e.target.value as Owner } : x)))}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
              >
                {Object.entries(OWNER_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <input
                value={step.text}
                onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                className={`min-w-0 flex-1 ${input}`}
              />
              <button
                type="button"
                onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                className="text-xs text-slate-400 hover:text-red-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setSteps([...steps, { text: '', owner: 'us' }])}
          className="mt-2 text-xs text-slate-600 hover:underline"
        >
          + Add next step
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-save
          onClick={save}
          disabled={saving || !summary.trim()}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onDone} className="rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100">
          Cancel
        </button>
        <span className="text-xs text-slate-400">Enter saves</span>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  )
}

function CallCard({ call, whoOptions }: { call: CallRow; whoOptions?: WhoOptions }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(call.suggestions.map((s) => s.key).filter((k) => !call.applied.includes(k))),
  )
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [showTranscript, setShowTranscript] = useState(false)
  const notes = call.result

  async function apply() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/calls/${call.id}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys: [...picked] }),
      })
      const result = await readJsonResponse<{
        applied: number
        missing: string[]
      }>(res)
      if (!result.ok) throw new Error(result.message)
      const { applied, missing } = result.body
      setMessage(
        `${applied} update${applied === 1 ? '' : 's'} applied.` +
          (missing.length ? ` Couldn’t find ${missing.join(', ')} in your lenders — add them on the Lenders page first.` : ''),
      )
      router.refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Couldn’t apply')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (
      !confirm(
        'Delete this call? The recording, its notes, and the updates it added to the deal are removed. Status or detail changes you applied from it stay as they are.',
      )
    )
      return
    await fetch(`/api/calls/${call.id}`, { method: 'DELETE' })
    router.refresh()
  }

  const meta = (
    <span className="text-xs text-slate-400">
      {when(call.created_at)}
      {call.duration_seconds ? ` · ${clock(call.duration_seconds)}` : ''}
      {whoOptions && whoLabel(call, whoOptions) ? ` · ${whoLabel(call, whoOptions)}` : ''}
    </span>
  )

  if (call.status !== 'done' || !notes) {
    return (
      <div className="rounded-lg border border-slate-200 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-slate-700">Call recording {meta}</span>
          <button type="button" onClick={remove} className="text-xs text-slate-400 hover:text-red-600">
            Delete
          </button>
        </div>
        {call.status === 'error' ? (
          <p className="mt-1 text-red-600">{call.error ?? 'Something went wrong.'}</p>
        ) : (
          <p className="mt-1 text-slate-500">
            {call.status === 'summarizing'
              ? 'Writing the notes…'
              : 'Turning the recording into text… (usually a minute or two — you can leave this page)'}
          </p>
        )}
      </div>
    )
  }

  const open = call.suggestions.filter((s) => !call.applied.includes(s.key))
  return (
    <div className="rounded-lg border border-slate-200 p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-slate-900">
          📞 {notes.title} {meta}
        </span>
        <span className="flex gap-3">
          {!editing && (
            <button type="button" onClick={() => setEditing(true)} className="text-xs text-slate-400 hover:text-slate-700">
              Edit
            </button>
          )}
          <button type="button" onClick={remove} className="text-xs text-slate-400 hover:text-red-600">
            Delete
          </button>
        </span>
      </div>
      {editing ? (
        <EditNotes call={call} notes={notes} whoOptions={whoOptions} onDone={() => setEditing(false)} />
      ) : (
        <>
          <p className="mt-2 text-slate-700">{notes.summary}</p>
          {notes.key_points.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-slate-600">
              {notes.key_points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}

          {notes.next_steps.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase text-slate-500">Next steps</p>
              <ul className="mt-1 space-y-1">
                {notes.next_steps.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                      {OWNER_LABEL[s.owner]}
                    </span>
                    <span className="text-slate-700">{s.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {call.suggestions.length > 0 && (
        <div className="mt-3 rounded-md bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">Suggested updates — tick the right ones</p>
          <ul className="mt-2 space-y-1.5">
            {call.suggestions.map((s) => {
              const done = call.applied.includes(s.key)
              return (
                <li key={s.key}>
                  <label className={`flex items-start gap-2 ${done ? 'text-slate-400' : 'text-slate-700'}`}>
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      disabled={done || busy}
                      checked={done || picked.has(s.key)}
                      onChange={(e) => {
                        const next = new Set(picked)
                        if (e.target.checked) next.add(s.key)
                        else next.delete(s.key)
                        setPicked(next)
                      }}
                    />
                    <span>
                      {s.label}
                      {done && <span className="ml-1 text-xs text-emerald-600">✓ applied</span>}
                      {s.detail && <span className="block text-xs text-slate-400">{s.detail}</span>}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          {open.length > 0 && (
            <button
              type="button"
              onClick={apply}
              disabled={busy || ![...picked].some((k) => !call.applied.includes(k))}
              className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? 'Applying…' : 'Apply selected'}
            </button>
          )}
          {message && <p className="mt-2 text-xs text-slate-600">{message}</p>}
        </div>
      )}

      {call.transcript && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowTranscript((v) => !v)} className="text-xs text-slate-500 hover:underline">
            {showTranscript ? 'Hide transcript' : 'Show transcript'}
          </button>
          {showTranscript && (
            <pre className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-xs text-slate-600">
              {call.transcript}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export function CallsPanel({
  calls,
  target,
  whoOptions,
  hint = 'Put the call (cell, Teams or Zoom) on speaker, then hit record.',
}: {
  calls: CallRow[]
  target: CallTarget
  whoOptions?: WhoOptions
  hint?: string
}) {
  const router = useRouter()
  const pendingIds = calls
    .filter((c) => PENDING.includes(c.status))
    .map((c) => c.id)
    .join(',')

  // While a call is processing, nudge it along and refresh when it changes.
  useEffect(() => {
    if (!pendingIds) return
    let stopped = false
    const ids = pendingIds.split(',')
    const statuses = new Map(calls.map((c) => [c.id, c.status as string]))
    const tick = async () => {
      for (const id of ids) {
        try {
          const res = await fetch(`/api/calls/${id}/check`, { method: 'POST' })
          const body = (await res.json()) as { status?: string }
          if (!stopped && body.status && body.status !== statuses.get(id)) {
            statuses.set(id, body.status)
            router.refresh()
          }
        } catch {
          // Try again next tick.
        }
      }
    }
    tick()
    const t = setInterval(tick, 8000)
    return () => {
      stopped = true
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the set of pending calls changes
  }, [pendingIds])

  return (
    <div className="space-y-4">
      <CallRecorder target={target} whoOptions={whoOptions} hint={hint} />
      {calls.map((c) => (
        <CallCard key={`${c.id}-${c.status}-${c.applied.length}`} call={c} whoOptions={whoOptions} />
      ))}
    </div>
  )
}
