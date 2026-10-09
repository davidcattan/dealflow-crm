'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { readJsonResponse } from '@/lib/fetch-json'
import {
  appendChunk,
  clearSession,
  loadSegments,
  loadSession,
  saveSession,
  type RecordingSession,
  type RecordingTarget,
} from '@/lib/calls/recording-store'

// Call recording lives here, above every page, so it keeps going while you
// move around the CRM (a red bar shows on every page). Every second of
// audio is also saved on this device, so a closed tab, refresh or locked
// phone leaves an "unfinished recording" you can continue or save.

type State = 'idle' | 'starting' | 'recording' | 'uploading'

type Recorder = {
  state: State
  seconds: number
  target: RecordingTarget | null
  error: string | null
  start: (target: RecordingTarget) => Promise<void>
  stop: () => void
  setWho: (callWith: RecordingTarget['callWith'], lenderId: string | null) => void
}

const Ctx = createContext<Recorder | null>(null)

export function useCallRecorder() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCallRecorder must be used inside CallRecorderProvider')
  return ctx
}

export function clock(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

// Picks a format this browser can record (Chrome: webm, Safari/iPhone: mp4).
function recorderType() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

const totalSeconds = (s: RecordingSession) => s.segments.reduce((n, x) => n + x.seconds, 0)
// Saved within this long = still being recorded (in another tab).
const LIVE_MS = 20_000

// Uploads every segment and creates the call. Throws on failure (the
// recording stays saved on the device).
async function uploadSession(session: RecordingSession) {
  const blobs = await loadSegments(session)
  if (!blobs.length) throw new Error('Nothing was recorded.')
  const supabase = createClient()
  const storagePaths: string[] = []
  for (const [i, blob] of blobs.entries()) {
    const ext = blob.type.includes('mp4') ? 'm4a' : 'webm'
    const path = `${session.target.pathPrefix}${Date.now()}-${i + 1}.${ext}`
    const { error } = await supabase.storage.from('borrower-documents').upload(path, blob, { contentType: blob.type || undefined })
    if (error) throw new Error(`Upload failed: ${error.message}`)
    storagePaths.push(path)
  }
  const res = await fetch(session.target.uploadUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      storagePaths,
      durationSeconds: totalSeconds(session),
      callWith: session.target.callWith,
      lenderId: session.target.lenderId,
    }),
  })
  const result = await readJsonResponse(res)
  if (!result.ok) throw new Error(result.message)
}

export function CallRecorderProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [state, setState] = useState<State>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<RecordingSession | null>(null)
  // An unfinished recording found on this device (not being recorded now).
  const [unfinished, setUnfinished] = useState<RecordingSession | null>(null)

  const sessionRef = useRef<RecordingSession | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const segmentStarted = useRef(0)
  const userStopped = useRef(false)
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null)

  const persist = useCallback(async () => {
    const s = sessionRef.current
    if (!s) return
    const seg = s.segments[s.segments.length - 1]
    if (seg && recorder.current?.state === 'recording') seg.seconds = Math.round((Date.now() - segmentStarted.current) / 1000)
    await saveSession(s).catch(() => {})
  }, [])

  // On load: is there a recording left over from before?
  const [elsewhere, setElsewhere] = useState<string | null>(null)
  useEffect(() => {
    loadSession()
      .then((s) => {
        if (!s || totalSeconds(s) === 0) return
        // Saved seconds ago = it's still being recorded in another tab.
        if (Date.now() - s.updatedAt < LIVE_MS) setElsewhere(s.target.label)
        else setUnfinished(s)
      })
      .catch(() => {})
  }, [])

  // While recording: tick the clock, save progress, warn before closing.
  useEffect(() => {
    if (state !== 'recording') return
    const t = setInterval(() => {
      const s = sessionRef.current
      if (!s) return
      setSeconds(s.priorSeconds + Math.round((Date.now() - segmentStarted.current) / 1000))
    }, 1000)
    const save = setInterval(persist, 5000)
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    // Leaving the page or hiding the app: save what we have right now.
    const hide = () => {
      recorder.current?.requestData()
      persist()
    }
    window.addEventListener('pagehide', hide)
    document.addEventListener('visibilitychange', hide)
    return () => {
      clearInterval(t)
      clearInterval(save)
      window.removeEventListener('beforeunload', warn)
      window.removeEventListener('pagehide', hide)
      document.removeEventListener('visibilitychange', hide)
    }
  }, [state, persist])

  const finish = useCallback(
    async (s: RecordingSession) => {
      setState('uploading')
      setError(null)
      try {
        await uploadSession(s)
        await clearSession(s.id)
        setSession(null)
        sessionRef.current = null
        setUnfinished(null)
        setState('idle')
        router.refresh()
      } catch (err) {
        setState('idle')
        setSession(null)
        sessionRef.current = null
        setUnfinished(s)
        setError(err instanceof Error ? err.message : 'Upload failed')
      }
    },
    [router]
  )

  // Starts a new segment for `s` (a new call, or continuing one).
  const record = useCallback(
    async (s: RecordingSession) => {
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
        s.priorSeconds = totalSeconds(s)
        s.segments.push({ mimeType: rec.mimeType || mimeType || 'audio/webm', seconds: 0 })
        const segment = s.segments.length - 1
        await saveSession(s)

        rec.ondataavailable = (e) => {
          if (e.data.size) appendChunk(s.id, segment, e.data).catch(() => {})
        }
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop())
          wakeLock.current?.release().catch(() => {})
          wakeLock.current = null
          s.segments[segment].seconds = Math.round((Date.now() - segmentStarted.current) / 1000)
          await saveSession(s).catch(() => {})
          recorder.current = null
          if (userStopped.current) {
            userStopped.current = false
            // Give the last chunk a moment to be written.
            await new Promise((r) => setTimeout(r, 300))
            if (totalSeconds(s) < 3) {
              await clearSession(s.id).catch(() => {})
              setSession(null)
              sessionRef.current = null
              setState('idle')
              setError('That recording was too short — nothing was saved.')
              return
            }
            await finish(s)
          } else {
            // Stopped by the device (phone locked, mic taken, etc.).
            setSession(null)
            sessionRef.current = null
            setState('idle')
            setUnfinished(s)
            setError('The recording was interrupted. Everything up to that point is saved.')
          }
        }
        // The mic going away (phone call took it, device unplugged…) ends the segment.
        stream.getAudioTracks().forEach((t) => (t.onended = () => rec.state !== 'inactive' && rec.stop()))

        rec.start(1000)
        recorder.current = rec
        segmentStarted.current = Date.now()
        sessionRef.current = s
        setSession(s)
        setUnfinished(null)
        setSeconds(s.priorSeconds)
        setState('recording')
        try {
          const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
          wakeLock.current = (await nav.wakeLock?.request('screen')) ?? null
        } catch {
          // Not supported — fine.
        }
      } catch (err) {
        if (s.segments.length && s.segments[s.segments.length - 1].seconds === 0) s.segments.pop()
        setState('idle')
        if (totalSeconds(s) > 0) setUnfinished(s)
        setError(
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'Microphone access was blocked. Allow the microphone for this site and try again.'
            : 'Couldn’t start recording on this device.'
        )
      }
    },
    [finish]
  )

  const start = useCallback(
    async (target: RecordingTarget) => {
      if (state !== 'idle') return
      if (unfinished) {
        setError('Finish the unfinished recording at the top first — continue it, save it or discard it.')
        return
      }
      await record({ id: crypto.randomUUID(), target, priorSeconds: 0, segments: [], updatedAt: Date.now() })
    },
    [state, unfinished, record]
  )

  const stop = useCallback(() => {
    if (!recorder.current) return
    userStopped.current = true
    recorder.current.stop()
  }, [])

  const setWho = useCallback((callWith: RecordingTarget['callWith'], lenderId: string | null) => {
    const s = sessionRef.current
    if (!s) return
    s.target = { ...s.target, callWith, lenderId }
    saveSession(s).catch(() => {})
  }, [])

  async function discard() {
    if (!unfinished) return
    if (!confirm('Delete this unfinished recording? It can’t be recovered.')) return
    await clearSession(unfinished.id).catch(() => {})
    setUnfinished(null)
    setError(null)
  }

  return (
    <Ctx.Provider value={{ state, seconds, target: session?.target ?? null, error, start, stop, setWho }}>
      {(state === 'recording' || state === 'starting') && session && (
        <div className="sticky top-0 z-40 border-b border-red-200 bg-red-50" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-6">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
            </span>
            <span className="font-mono font-medium text-red-700">Recording {clock(seconds)}</span>
            <Link href={session.target.href} className="truncate text-red-800 underline">
              {session.target.label}
            </Link>
            <span className="hidden text-xs text-red-700/80 md:inline">Keeps going while you move around the CRM.</span>
            <button
              type="button"
              onClick={stop}
              className="ml-auto rounded-md bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700"
            >
              Stop &amp; write notes
            </button>
          </div>
        </div>
      )}
      {state === 'uploading' && (
        <div className="sticky top-0 z-40 border-b border-slate-200 bg-slate-100 px-4 py-2 text-center text-sm text-slate-700">
          Saving the recording and sending it for notes…
        </div>
      )}
      {state === 'idle' && unfinished && (
        <div className="sticky top-0 z-40 border-b border-amber-300 bg-amber-50" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 text-sm sm:px-6">
            <span className="text-amber-900">
              Unfinished call recording ({clock(totalSeconds(unfinished))}) for{' '}
              <Link href={unfinished.target.href} className="font-medium underline">
                {unfinished.target.label}
              </Link>
              {error && <span className="ml-2 text-amber-800">— {error}</span>}
            </span>
            <span className="ml-auto flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => record(unfinished)}
                className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
              >
                ● Continue recording
              </button>
              <button
                type="button"
                onClick={() => finish(unfinished)}
                className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
              >
                Save &amp; write notes
              </button>
              <button type="button" onClick={discard} className="rounded-md px-2 py-1 text-xs text-amber-900 hover:underline">
                Discard
              </button>
            </span>
          </div>
        </div>
      )}
      {state === 'idle' && elsewhere && !unfinished && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-1.5 text-center text-xs text-red-700">
          A call is being recorded in another tab ({elsewhere}).
        </div>
      )}
      {children}
    </Ctx.Provider>
  )
}
