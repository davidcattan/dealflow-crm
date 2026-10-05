'use client'

import { useState, useTransition } from 'react'
import { saveEmailProfile } from './actions'

function firstName(email: string) {
  const f = email.split('@')[0].split(/[._-]/)[0]
  return f ? f[0].toUpperCase() + f.slice(1).toLowerCase() : ''
}

// Intro + signature used in this person's lender emails.
export function EmailProfile({
  connectionId,
  email,
  intro,
  signature,
}: {
  connectionId: string
  email: string
  intro: string | null
  signature: string | null
}) {
  const name = firstName(email)
  const [open, setOpen] = useState(false)
  const [introText, setIntroText] = useState(intro ?? '')
  const [signatureText, setSignatureText] = useState(signature ?? '')
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const suggestedIntro = `This is ${name} with JED Capital Group. We arrange asset-based, real estate and growth financing for business owners, and we bring lenders deals that fit their programs.`
  const suggestedSignature = `${name}\nJED Capital Group`

  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-slate-600 hover:underline">
        {open ? 'Hide' : 'Edit'} email intro &amp; signature
        {!intro && !signature && <span className="ml-1 text-amber-700">(not set)</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-600">
                Intro — added right after &ldquo;Hi [name],&rdquo; in {name}&apos;s lender emails
              </label>
              {!introText && (
                <button type="button" onClick={() => setIntroText(suggestedIntro)} className="text-xs text-slate-500 hover:underline">
                  Use a suggestion
                </button>
              )}
            </div>
            <textarea
              value={introText}
              onChange={(e) => setIntroText(e.target.value)}
              rows={3}
              placeholder={suggestedIntro}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-600">Signature — added after &ldquo;Best,&rdquo;</label>
              {!signatureText && (
                <button type="button" onClick={() => setSignatureText(suggestedSignature)} className="text-xs text-slate-500 hover:underline">
                  Use a suggestion
                </button>
              )}
            </div>
            <textarea
              value={signatureText}
              onChange={(e) => setSignatureText(e.target.value)}
              rows={4}
              placeholder={'Name\nTitle\nJED Capital Group\nPhone'}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await saveEmailProfile(connectionId, introText, signatureText)
                  setSaved(true)
                  setTimeout(() => setSaved(false), 2000)
                })
              }
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-xs text-emerald-700">Saved ✓ — new drafts will use it (click Redraft on existing ones)</span>}
          </div>
        </div>
      )}
    </div>
  )
}
