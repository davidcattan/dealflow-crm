'use client'

// Keeps the call being recorded on this device (IndexedDB) second by
// second, so closing the tab, a refresh, a crash or a locked phone never
// loses it — the CRM offers to continue or save it next time.
// A recording can have several segments (each "Continue" starts a new one);
// they're uploaded as separate files and transcribed in order.

export type RecordingTarget = {
  uploadUrl: string
  pathPrefix: string
  label: string
  href: string
  callWith: 'borrower' | 'lender' | 'broker' | null
  lenderId: string | null
}

export type RecordingSession = {
  id: string
  target: RecordingTarget
  // Seconds recorded in earlier segments.
  priorSeconds: number
  segments: { mimeType: string; seconds: number }[]
  updatedAt: number
}

const DB = 'crm-call-recordings'
const META = 'sessions'
const CHUNKS = 'chunks'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(CHUNKS)) {
        const s = db.createObjectStore(CHUNKS, { autoIncrement: true })
        s.createIndex('session', 'sessionId')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function saveSession(session: RecordingSession) {
  const db = await open()
  const tx = db.transaction(META, 'readwrite')
  tx.objectStore(META).put({ ...session, updatedAt: Date.now() })
  await done(tx)
  db.close()
}

export async function appendChunk(sessionId: string, segment: number, data: Blob) {
  const db = await open()
  const tx = db.transaction(CHUNKS, 'readwrite')
  tx.objectStore(CHUNKS).add({ sessionId, segment, data })
  await done(tx)
  db.close()
}

// The unfinished recording, if there is one (newest first).
export async function loadSession(): Promise<RecordingSession | null> {
  const db = await open()
  const tx = db.transaction(META, 'readonly')
  const req = tx.objectStore(META).getAll()
  await done(tx)
  db.close()
  const all = (req.result as RecordingSession[]).sort((a, b) => b.updatedAt - a.updatedAt)
  return all[0] ?? null
}

// One Blob per segment, in order.
export async function loadSegments(session: RecordingSession): Promise<Blob[]> {
  const db = await open()
  const tx = db.transaction(CHUNKS, 'readonly')
  const req = tx.objectStore(CHUNKS).index('session').getAll(session.id)
  await done(tx)
  db.close()
  const rows = req.result as { segment: number; data: Blob }[]
  return session.segments
    .map((seg, i) => new Blob(rows.filter((r) => r.segment === i).map((r) => r.data), { type: seg.mimeType }))
    .filter((b) => b.size > 0)
}

export async function clearSession(sessionId: string) {
  const db = await open()
  const tx = db.transaction([META, CHUNKS], 'readwrite')
  tx.objectStore(META).delete(sessionId)
  const idx = tx.objectStore(CHUNKS).index('session')
  const keys = idx.getAllKeys(sessionId)
  keys.onsuccess = () => {
    for (const k of keys.result) tx.objectStore(CHUNKS).delete(k)
  }
  await done(tx)
  db.close()
}
