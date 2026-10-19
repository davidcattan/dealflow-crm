'use client'

import { unzip } from 'fflate'

// A .zip dropped on an upload box (e.g. "Download all" from a OneDrive,
// Dropbox or Google Drive link) becomes the files inside it. Unpacked in the
// browser, so nothing extra goes through the server.

const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  csv: 'text/csv',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}

const isZip = (f: File) => /\.zip$/i.test(f.name)

export async function expandZips(files: File[]): Promise<File[]> {
  const out: File[] = []
  for (const f of files) {
    if (!isZip(f)) {
      out.push(f)
      continue
    }
    const bytes = new Uint8Array(await f.arrayBuffer())
    const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
      unzip(bytes, (err, data) => (err ? reject(new Error(`Couldn't open ${f.name}`)) : resolve(data)))
    )
    for (const [path, data] of Object.entries(entries)) {
      const name = path.split('/').pop() ?? ''
      // Folders, Mac junk (__MACOSX, .DS_Store), empty files, zips inside zips.
      if (!name || path.endsWith('/') || path.startsWith('__MACOSX/') || name.startsWith('.') || !data.length || /\.zip$/i.test(name)) continue
      const ext = name.split('.').pop()?.toLowerCase() ?? ''
      out.push(new File([data as unknown as BlobPart], name, { type: TYPES[ext] ?? '' }))
    }
  }
  return out
}
