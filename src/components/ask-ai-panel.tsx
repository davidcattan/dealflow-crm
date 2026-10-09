'use client'

import { usePathname } from 'next/navigation'
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { loadChat, type ChatMessage } from '@/lib/chat/actions'
import { OPEN_ASK_AI_EVENT } from '@/components/mobile-nav'

const DEAL_PATH = /^\/deals\/([0-9a-f-]{36})/

const DEAL_SUGGESTIONS = [
  'Where does this deal stand, and what should I do next?',
  "What's missing before I send this to more lenders?",
  'Draft a follow-up to the lenders who haven\'t replied',
  "I'll paste a lender's questions — fill in what we know",
]
const PIPELINE_SUGGESTIONS = [
  'What should I work on today?',
  'Which deals have lenders waiting on us?',
  'Which deals have gone quiet?',
]

// --- tiny formatter: paragraphs, bullets, numbered lists, **bold**, and
// ```email blocks shown as a card with a Copy button.

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>
  )
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          // ignore
        }
      }}
      className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
    >
      {copied ? 'Copied ✓' : label}
    </button>
  )
}

function EmailCard({ raw }: { raw: string }) {
  const lines = raw.trim().split('\n')
  const subjectLine = lines[0]?.match(/^subject:\s*(.*)$/i)
  const subject = subjectLine ? subjectLine[1] : null
  const body = (subjectLine ? lines.slice(1) : lines).join('\n').trim()
  return (
    <div className="my-2 rounded-lg border border-violet-200 bg-violet-50/50">
      <div className="flex items-center justify-between gap-2 border-b border-violet-100 px-3 py-1.5">
        <span className="text-xs font-medium text-violet-800">Email draft</span>
        <div className="flex gap-1.5">
          {subject && <CopyButton text={subject} label="Copy subject" />}
          <CopyButton text={body} label="Copy email" />
        </div>
      </div>
      {subject && (
        <p className="px-3 pt-2 text-xs text-slate-500">
          <span className="font-medium text-slate-700">Subject:</span> {subject}
        </p>
      )}
      <p className="whitespace-pre-wrap px-3 py-2 text-sm text-slate-800">{body}</p>
    </div>
  )
}

function renderText(text: string, key: number) {
  const blocks = text.split(/\n\s*\n/)
  return blocks.map((block, bi) => {
    const lines = block.split('\n').filter((l) => l.trim())
    if (lines.length && lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return (
        <ul key={`${key}-${bi}`} className="my-1.5 list-disc space-y-0.5 pl-5">
          {lines.map((l, i) => (
            <li key={i}>{inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>
          ))}
        </ul>
      )
    }
    if (lines.length && lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      return (
        <ol key={`${key}-${bi}`} className="my-1.5 list-decimal space-y-0.5 pl-5">
          {lines.map((l, i) => (
            <li key={i}>{inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>
          ))}
        </ol>
      )
    }
    return (
      <p key={`${key}-${bi}`} className="my-1.5">
        {lines.map((l, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {inline(l.replace(/^#{1,4}\s+/, ''))}
          </Fragment>
        ))}
      </p>
    )
  })
}

function Formatted({ text }: { text: string }) {
  // Split out fenced blocks (```email … ``` or any ``` … ```), even if the
  // closing fence hasn't streamed in yet.
  const parts: ReactNode[] = []
  const re = /```(\w*)\n?([\s\S]*?)(```|$)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(...renderText(text.slice(last, m.index), k++))
    if (m[1].toLowerCase() === 'email') parts.push(<EmailCard key={`e${k++}`} raw={m[2]} />)
    else parts.push(<pre key={`c${k++}`} className="my-2 overflow-x-auto rounded bg-slate-100 p-2 text-xs">{m[2]}</pre>)
    last = re.lastIndex
    if (m[0].length === 0) break
  }
  if (last < text.length) parts.push(...renderText(text.slice(last), k++))
  return <>{parts}</>
}

export function AskAiPanel() {
  const pathname = usePathname()
  const dealId = pathname.match(DEAL_PATH)?.[1] ?? null

  const [open, setOpen] = useState(false)
  // Minimized: the panel stays alive (an answer keeps streaming) but is
  // tucked into a small bubble so the page underneath can be used.
  const [minimized, setMinimized] = useState(false)
  // Computer only: drag the left edge to resize; remembered per browser.
  const [width, setWidth] = useState(480)
  const [isDesktop, setIsDesktop] = useState(false)
  const [chatId, setChatId] = useState<string | null>(null)
  const [dealName, setDealName] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [documents, setDocuments] = useState<{ id: string; name: string }[]>([])
  const [attached, setAttached] = useState<string[]>([])
  const [showAttach, setShowAttach] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const res = await loadChat(dealId)
    setChatId(res.chatId)
    setDealName(res.dealName)
    setMessages(res.messages)
    setDocuments(res.documents)
    setAttached([])
    setLoading(false)
  }, [dealId])

  const busyRef = useRef(false)
  useEffect(() => {
    busyRef.current = busy
  }, [busy])
  useEffect(() => {
    if (open && !busyRef.current) refresh()
  }, [open, refresh])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)')
    const update = () => setIsDesktop(mq.matches)
    update()
    mq.addEventListener('change', update)
    try {
      const saved = Number(localStorage.getItem('ask-ai-width'))
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a saved browser preference
      if (saved >= 320 && saved <= 1200) setWidth(saved)
    } catch {
      // ignore
    }
    return () => mq.removeEventListener('change', update)
  }, [])

  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(Math.max(window.innerWidth - ev.clientX, 320), Math.min(1100, window.innerWidth - 200))
      setWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      setWidth((w) => {
        try {
          localStorage.setItem('ask-ai-width', String(w))
        } catch {
          // ignore
        }
        return w
      })
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // The phone tab bar's "Ask AI" button opens the panel.
  useEffect(() => {
    const openPanel = () => {
      setOpen(true)
      setMinimized(false)
    }
    window.addEventListener(OPEN_ASK_AI_EVENT, openPanel)
    return () => window.removeEventListener(OPEN_ASK_AI_EVENT, openPanel)
  }, [])

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    const attachedNames = documents.filter((d) => attached.includes(d.id)).map((d) => d.name)
    const now = new Date().toISOString()
    setMessages((m) => [
      ...m,
      { id: `u-${now}`, role: 'user', content: text, attached: attachedNames.join(', ') || null, created_at: now },
      { id: `a-${now}`, role: 'assistant', content: '', attached: null, created_at: now },
    ])
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId, chatId, message: text, documentIds: attached }),
        signal: controller.signal,
      })
      const newChatId = res.headers.get('X-Chat-Id')
      if (newChatId) setChatId(newChatId)
      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => '')
        throw new Error(err || `Something went wrong (${res.status}).`)
      }
      setAttached([])
      setShowAttach(false)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        setMessages((m) => {
          const copy = [...m]
          const last = copy[copy.length - 1]
          copy[copy.length - 1] = { ...last, content: last.content + chunk }
          return copy
        })
      }
    } catch (err) {
      const msg = err instanceof Error && err.name !== 'AbortError' ? err.message : 'Stopped.'
      setMessages((m) => {
        const copy = [...m]
        const last = copy[copy.length - 1]
        copy[copy.length - 1] = { ...last, content: `${last.content}${last.content ? '\n\n' : ''}⚠️ ${msg}` }
        return copy
      })
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const suggestions = dealId ? DEAL_SUGGESTIONS : PIPELINE_SUGGESTIONS

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => {
            setOpen(true)
            setMinimized(false)
          }}
          className="fixed bottom-5 right-5 z-40 hidden items-center gap-2 rounded-full sm:flex bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-slate-800"
        >
          ✨ Ask AI
        </button>
      )}

      {open && minimized && (
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="fixed bottom-20 right-4 z-50 flex max-w-[260px] items-center gap-2 rounded-full bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-slate-800 sm:bottom-5 sm:right-5"
          title="Open the chat again"
        >
          ✨ <span className="truncate">{busy ? 'Ask AI — answering…' : `Ask AI${dealName ? ` · ${dealName}` : ''}`}</span>
        </button>
      )}

      {open && (
        <div
          className={`fixed inset-y-0 right-0 z-50 w-full flex-col border-l border-slate-200 bg-white shadow-2xl ${minimized ? 'hidden' : 'flex'}`}
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
            ...(isDesktop ? { width } : {}),
          }}
        >
          <div
            onMouseDown={startResize}
            className="absolute inset-y-0 left-0 hidden w-1.5 cursor-col-resize hover:bg-slate-300/60 sm:block"
            title="Drag to resize"
            aria-hidden="true"
          />
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">✨ Ask AI</p>
              <p className="truncate text-xs text-slate-500">
                {dealId ? `Knows everything on ${dealName ?? 'this deal'}` : 'Knows your whole pipeline — open a deal for deal details'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setChatId(null)
                  setMessages([])
                  setAttached([])
                }}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                title="Start a fresh conversation (the old one is kept)"
              >
                New chat
              </button>
              <button
                type="button"
                onClick={() => setMinimized(true)}
                className="rounded-md px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100"
                aria-label="Minimize"
                title="Minimize — keeps the chat going"
              >
                –
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                ×
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm">
            {loading ? (
              <p className="text-slate-400">Loading…</p>
            ) : messages.length === 0 ? (
              <div>
                <p className="text-slate-600">
                  Ask anything — where things stand, what to do next, or have it draft an email. You can paste a
                  lender&apos;s email or questions right in.
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => (s.startsWith("I'll paste") ? setInput("Here are the lender's questions:\n\n") : send(s))}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="ml-8 rounded-lg bg-slate-900 px-3 py-2 text-white">
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    {m.attached && <p className="mt-1 text-xs text-slate-300">📎 {m.attached}</p>}
                  </div>
                ) : (
                  <div key={m.id} className="mr-4 text-slate-800">
                    {m.content ? <Formatted text={m.content} /> : <p className="animate-pulse text-slate-400">Thinking…</p>}
                    {m.content && !busy && <div className="mt-1"><CopyButton text={m.content} label="Copy answer" /></div>}
                  </div>
                )
              )
            )}
          </div>

          <div className="border-t border-slate-200 p-3">
            {showAttach && documents.length > 0 && (
              <div className="mb-2 max-h-40 overflow-y-auto rounded-md border border-slate-200 p-2 text-xs">
                <p className="mb-1 text-slate-500">Attach documents to your next question (the AI reads the full file):</p>
                {documents.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 py-0.5 text-slate-700">
                    <input
                      type="checkbox"
                      checked={attached.includes(d.id)}
                      onChange={() => setAttached((a) => (a.includes(d.id) ? a.filter((x) => x !== d.id) : [...a, d.id]))}
                      className="rounded border-slate-300"
                    />
                    <span className="truncate">{d.name}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              {dealId && documents.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAttach((v) => !v)}
                  title="Attach documents from this deal"
                  className={`rounded-md border px-2 py-2 text-sm ${attached.length ? 'border-violet-300 bg-violet-50' : 'border-slate-300'} hover:bg-slate-50`}
                >
                  📎{attached.length ? ` ${attached.length}` : ''}
                </button>
              )}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                data-enter="off"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                rows={Math.min(8, Math.max(2, input.split('\n').length))}
                placeholder={dealId ? 'Ask about this deal, or paste an email…' : 'Ask about your pipeline…'}
                className="min-w-0 flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-base sm:text-sm"
              />
              {busy ? (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => send()}
                  disabled={!input.trim()}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
                >
                  Send
                </button>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              About 1–6¢ per question{dealId ? ' · attached documents cost more' : ''}. Enter to send, Shift+Enter for a new line.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
