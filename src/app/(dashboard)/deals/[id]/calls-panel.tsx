'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { readJsonResponse } from '@/lib/fetch-json'
import type { CallNotes } from '@/lib/calls/schema'
import type { CallSuggestion } from '@/lib/calls/process'

export type CallRow = {
  id: string
  status: 'uploaded' | 'transcribing' | 'summarizing' | 'done' | 'error'
  created_at: string
  duration_seconds: number | null
  transcript: string | null
  result: CallNotes | null
  suggestions: CallSuggestion[]
  applied: string[]
  error: string | null
}

const PENDING = ['uploaded', 'transcribing', 'summarizing']

function clock(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Picks a format this browser can record (Chrome: webm, Safari/iPhone: mp4).
function recorderType() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

type Who = { callWith: 'borrower' | 'lender' | 'broker' | null; lenderId: string | null }

// Dropdown value -> who the call is with.
function parseWho(value: string): Who {
  if (value.startsWith('lender:')) return { callWith: 'lender', lenderId: value.slice(7) }
  if (value === 'borrower' || value === 'broker') return { callWith: value, lenderId: null }
  return { callWith: null, lenderId: null }
}

async function uploadCall(dealId: string, blob: Blob, durationSeconds: number | null, ext: string, who: Who) {
  const supabase = createClient()
  const storagePath = `calls/${dealId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('borrower-documents')
    .upload(storagePath, blob, { contentType: blob.type || undefined })
  if (error) throw new Error(`Upload failed: ${error.message}`)
  const res = await fetch(`/api/deals/${dealId}/calls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ storagePath, durationSeconds, ...who }),
  })
  const result = await readJsonResponse(res)
  if (!result.ok) throw new Error(result.message)
}

// Records a call on speaker through this device's microphone.
export type LenderOption = { id: string; name: string }

export function CallRecorder({
  dealId,
  borrowerName,
  dealLenders,
  otherLenders,
}: {
  dealId: string
  borrowerName: string
  dealLenders: LenderOption[]
  otherLenders: LenderOption[]
}) {
  const router = useRouter()
  const [who, setWho] = useState('')
  // Read when the recording stops (the dropdown can change mid-call).
  const whoRef = useRef('')
  function pickWho(value: string) {
    whoRef.current = value
    setWho(value)
  }
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'uploading'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const started = useRef(0)
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state !== 'recording') return
    const t = setInterval(() => setSeconds(Math.round((Date.now() - started.current) / 1000)), 1000)
    // Don't lose a recording by closing the tab.
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => {
      clearInterval(t)
      window.removeEventListener('beforeunload', warn)
    }
  }, [state])

  async function start() {
    setError(null)
    setState('starting')
    try {
      // Echo cancellation / noise suppression would filter out the other
      // person's voice coming through the speaker, so they're off.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      })
      const mimeType = recorderType()
      const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 })
      chunks.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data)
      }
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        wakeLock.current?.release().catch(() => {})
        wakeLock.current = null
        const duration = Math.round((Date.now() - started.current) / 1000)
        const blob = new Blob(chunks.current, { type: rec.mimeType || mimeType || 'audio/webm' })
        if (duration < 3 || blob.size === 0) {
          setState('idle')
          setError('That recording was too short — nothing was saved.')
          return
        }
        setState('uploading')
        try {
          await uploadCall(dealId, blob, duration, blob.type.includes('mp4') ? 'm4a' : 'webm', parseWho(whoRef.current))
          setState('idle')
          router.refresh()
        } catch (err) {
          setState('idle')
          setError(err instanceof Error ? err.message : 'Upload failed')
        }
      }
      rec.start(1000)
      recorder.current = rec
      started.current = Date.now()
      setSeconds(0)
      setState('recording')
      // Keep the screen (and the recording) awake.
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
        wakeLock.current = (await nav.wakeLock?.request('screen')) ?? null
      } catch {
        // Not supported — fine.
      }
    } catch (err) {
      setState('idle')
      setError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow the microphone for this site and try again.'
          : 'Couldn’t start recording on this device.'
      )
    }
  }

  async function uploadFile(file: File) {
    setError(null)
    setState('uploading')
    try {
      const ext = (file.name.split('.').pop() ?? 'audio').toLowerCase().replace(/[^a-z0-9]/g, '')
      await uploadCall(dealId, file, null, ext || 'audio', parseWho(who))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setState('idle')
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const picker = (
    <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
      Who&apos;s on this call?
      <select
        value={who}
        onChange={(e) => pickWho(e.target.value)}
        disabled={state === 'uploading'}
        className="max-w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
      >
        <option value="">Not sure — let AI figure it out</option>
        <option value="borrower">Borrower — {borrowerName}</option>
        <option value="broker">Referral partner / broker</option>
        {dealLenders.length > 0 && (
          <optgroup label="Lenders on this deal">
            {dealLenders.map((l) => (
              <option key={l.id} value={`lender:${l.id}`}>
                {l.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Other lenders">
          {otherLenders.map((l) => (
            <option key={l.id} value={`lender:${l.id}`}>
              {l.name}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  )

  return (
    <div className="space-y-3">
      {picker}
      {state === 'recording' ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
          </span>
          <span className="font-mono text-sm font-medium text-red-700">Recording {clock(seconds)}</span>
          <span className="text-xs text-red-700/80">Keep the call on speaker and this page open.</span>
          <button
            type="button"
            onClick={() => recorder.current?.stop()}
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
            disabled={state !== 'idle'}
            className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
            {state === 'starting' ? 'Starting…' : state === 'uploading' ? 'Saving recording…' : 'Record call'}
          </button>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={state !== 'idle'}
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
          <span className="text-xs text-slate-400">Put the call (cell, Teams or Zoom) on speaker, then hit record.</span>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}

const OWNER_LABEL: Record<string, string> = { us: 'Us', borrower: 'Borrower', lender: 'Lender', other: 'Other' }

function CallCard({ call }: { call: CallRow }) {
  const router = useRouter()
  const [picked, setPicked] = useState<Set<string>>(() => new Set(call.suggestions.map((s) => s.key).filter((k) => !call.applied.includes(k))))
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
      const result = await readJsonResponse<{ applied: number; missing: string[] }>(res)
      if (!result.ok) throw new Error(result.message)
      const { applied, missing } = result.body
      setMessage(
        `${applied} update${applied === 1 ? '' : 's'} applied.` +
          (missing.length ? ` Couldn’t find ${missing.join(', ')} in your lenders — add them on the Lenders page first.` : '')
      )
      router.refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Couldn’t apply')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('Delete this call recording and its notes? (Anything already added to the deal stays.)')) return
    await fetch(`/api/calls/${call.id}`, { method: 'DELETE' })
    router.refresh()
  }

  const meta = (
    <span className="text-xs text-slate-400">
      {when(call.created_at)}
      {call.duration_seconds ? ` · ${clock(call.duration_seconds)}` : ''}
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
        <button type="button" onClick={remove} className="text-xs text-slate-400 hover:text-red-600">
          Delete
        </button>
      </div>
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
                <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{OWNER_LABEL[s.owner]}</span>
                <span className="text-slate-700">{s.text}</span>
              </li>
            ))}
          </ul>
        </div>
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
  dealId,
  calls,
  borrowerName,
  dealLenders,
  otherLenders,
}: {
  dealId: string
  calls: CallRow[]
  borrowerName: string
  dealLenders: LenderOption[]
  otherLenders: LenderOption[]
}) {
  const router = useRouter()
  const pendingIds = calls.filter((c) => PENDING.includes(c.status)).map((c) => c.id).join(',')

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
      <CallRecorder dealId={dealId} borrowerName={borrowerName} dealLenders={dealLenders} otherLenders={otherLenders} />
      {calls.map((c) => (
        <CallCard key={`${c.id}-${c.status}-${c.applied.length}`} call={c} />
      ))}
    </div>
  )
}
