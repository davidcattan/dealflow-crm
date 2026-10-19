#!/usr/bin/env node
// JED CRM — Desktop folder sync.
//
// Every file saved in ~/Desktop/JED/Deals/<Deal folder>/ (any depth) is
// uploaded to the CRM deal with the same name ("TEAM Inc" → Team Inc).
// Runs once and exits; launchd runs it every minute (see install.sh).
//
//   node jed-desktop-sync.mjs            sync now
//   node jed-desktop-sync.mjs --dry-run  show what would upload, upload nothing
//
// The first run only records what's already there, so only files saved
// after installing go to the CRM. Files the deal already has (same name and
// size) are skipped by the CRM. Overwriting a file with a new version
// uploads the new version.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.env.JED_DEALS_DIR || path.join(os.homedir(), 'Desktop', 'JED', 'Deals')
const CRM = (process.env.JED_CRM_URL || 'https://dealflow-crm-gamma.vercel.app').replace(/\/$/, '')
const HOME = process.env.JED_SYNC_HOME || path.join(os.homedir(), 'Library', 'Application Support', 'JED CRM Sync')
const STATE = path.join(HOME, 'state.json')
const LOCK = path.join(HOME, 'running.lock')
const LOG = path.join(HOME, 'sync.log')
const KEYCHAIN_SERVICE = 'JED CRM Desktop Sync'
const DRY = process.argv.includes('--dry-run')

const KEEP = /\.(pdf|xlsx|xlsm|xls|csv|docx|doc|pptx|ppt|png|jpe?g|txt|eml|msg)$/i
const MAX_BYTES = 50 * 1024 * 1024
const SETTLE_MS = 15_000 // still being written if touched this recently
const RETRY_NO_DEAL_MS = 30 * 60_000 // re-check folders with no deal every 30 min

function log(line) {
  const text = `${new Date().toISOString()}  ${line}\n`
  if (DRY || process.stdout.isTTY) process.stdout.write(text)
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 1_000_000) fs.renameSync(LOG, `${LOG}.old`)
    fs.appendFileSync(LOG, text)
  } catch {}
}

function notify(message) {
  if (DRY) return
  try {
    execFileSync('osascript', ['-e', `display notification ${JSON.stringify(message)} with title "JED CRM"`])
  } catch {}
}

function readKey() {
  try {
    return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'))
  } catch {
    return null
  }
}

function saveState(state) {
  if (DRY) return
  fs.writeFileSync(`${STATE}.tmp`, JSON.stringify(state, null, 1))
  fs.renameSync(`${STATE}.tmp`, STATE)
}

const skipName = (name) => name.startsWith('.') || name.startsWith('~$') || name === 'Icon\r'

// Every keepable file under one deal folder, as paths relative to ROOT.
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipName(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile() && KEEP.test(entry.name)) out.push(full)
  }
  return out
}

function scan() {
  const files = new Map()
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || skipName(entry.name)) continue
    for (const full of walk(path.join(ROOT, entry.name))) {
      const st = fs.statSync(full)
      files.set(path.relative(ROOT, full), { full, folder: entry.name, size: st.size, mtime: st.mtimeMs, sig: `${st.size}:${Math.round(st.mtimeMs)}` })
    }
  }
  return files
}

async function api(key, route, body) {
  const res = await fetch(`${CRM}/api/desktop/${route}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 401) throw Object.assign(new Error('CRM key rejected'), { auth: true })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json) throw new Error(`${route} failed (${res.status})`)
  return json
}

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
  eml: 'message/rfc822',
  msg: 'application/vnd.ms-outlook',
}

async function main() {
  fs.mkdirSync(HOME, { recursive: true })
  if (!fs.existsSync(ROOT)) return log(`No folder at ${ROOT} — nothing to do`)

  let files
  try {
    files = scan()
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      log(`macOS blocked reading ${ROOT}: ${err.message}`)
      notify('Can’t read your Desktop. Allow “node” in System Settings → Privacy & Security → Files and Folders.')
      return
    }
    throw err
  }

  let state = loadState()
  if (!state) {
    // First run: what's already there stays put.
    state = { files: {} }
    for (const [rel, f] of files) state.files[rel] = { sig: f.sig, status: 'baseline' }
    saveState(state)
    return log(`First run: noted ${files.size} existing files; only new saves will go to the CRM`)
  }

  const now = Date.now()
  const todo = [...files].filter(([rel, f]) => {
    const seen = state.files[rel]
    if (now - f.mtime < SETTLE_MS) return false
    if (!seen || seen.sig !== f.sig) return true
    return seen.status === 'no_deal' && now - (seen.at ?? 0) > RETRY_NO_DEAL_MS
  })
  // Forget files that were deleted or moved away.
  for (const rel of Object.keys(state.files)) if (!files.has(rel)) delete state.files[rel]
  if (todo.length === 0) return saveState(state)
  if (DRY) return todo.forEach(([rel]) => log(`Would upload: ${rel}`))

  const key = readKey()
  if (!key) {
    log('No CRM key in the Keychain — run install.sh again')
    return notify('Desktop sync has no CRM key. Run the installer again.')
  }

  const byDeal = new Map() // dealId → { name, uploaded: [] }
  const noDeal = new Set()
  for (const [rel, f] of todo) {
    const fileName = path.basename(rel)
    if (f.size > MAX_BYTES) {
      log(`Too big to upload (${Math.round(f.size / 1e6)} MB): ${rel}`)
      state.files[rel] = { sig: f.sig, status: 'too_big' }
      continue
    }
    try {
      const prep = await api(key, 'prepare', { folder: f.folder, fileName, size: f.size })
      if (prep.skip === 'no_deal') {
        noDeal.add(f.folder)
        state.files[rel] = { sig: f.sig, status: 'no_deal', at: now }
        continue
      }
      if (prep.skip === 'already_there') {
        state.files[rel] = { sig: f.sig, status: 'already_there' }
        continue
      }
      const ext = fileName.split('.').pop().toLowerCase()
      const put = await fetch(prep.upload_url, {
        method: 'PUT',
        headers: { 'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream', 'x-upsert': 'false' },
        body: fs.readFileSync(f.full),
      })
      if (!put.ok) throw new Error(`upload failed (${put.status})`)
      const group = byDeal.get(prep.dealId) ?? { name: prep.dealName, uploaded: [] }
      group.uploaded.push({ rel, sig: f.sig, path: prep.path, fileName, size: f.size, contentType: CONTENT_TYPES[ext] ?? null })
      byDeal.set(prep.dealId, group)
    } catch (err) {
      if (err.auth) {
        log('CRM key rejected — make a new key in CRM Settings and run install.sh again')
        notify('Desktop sync: the CRM key stopped working. Make a new one in CRM Settings and run the installer again.')
        saveState(state)
        return
      }
      log(`Error on ${rel}: ${err.message} (will retry)`)
    }
  }

  for (const [dealId, group] of byDeal) {
    try {
      const { filed } = await api(key, 'finish', { dealId, files: group.uploaded })
      for (const u of group.uploaded) state.files[u.rel] = { sig: u.sig, status: 'uploaded' }
      log(`Added ${filed.length} file${filed.length === 1 ? '' : 's'} to ${group.name}: ${filed.join(', ')}`)
      notify(
        filed.length === 1 ? `Added “${filed[0]}” to ${group.name}` : `Added ${filed.length} files to ${group.name}`
      )
    } catch (err) {
      log(`Couldn’t file uploads on ${group.name}: ${err.message} (will retry)`)
    }
  }

  for (const folder of noDeal) {
    const told = state.toldNoDeal ?? (state.toldNoDeal = {})
    if (!told[folder]) {
      notify(`No CRM deal matches the “${folder}” folder. Rename the folder to the deal’s name.`)
      told[folder] = now
    }
    log(`No CRM deal matches folder "${folder}"`)
  }
  saveState(state)
}

// One run at a time (a big upload can outlast the 1-minute timer).
let locked = false
try {
  fs.mkdirSync(HOME, { recursive: true })
  if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < 30 * 60_000) process.exit(0)
  fs.writeFileSync(LOCK, String(process.pid))
  locked = true
  await main()
} catch (err) {
  log(`Run failed: ${err.stack || err.message}`)
} finally {
  if (locked) fs.rmSync(LOCK, { force: true })
}
