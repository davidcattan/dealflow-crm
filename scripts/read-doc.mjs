// Reads a borrower document for the underwriting queue.
//   node scripts/read-doc.mjs file.pdf [fromPage] [toPage]   → text per page
//   node scripts/read-doc.mjs file.pdf --render 7 out.png     → page 7 as an image (for scans)
//   node scripts/read-doc.mjs file.xlsx                        → sheets as text
import fs from 'fs'

const [file, a, b, c] = process.argv.slice(2)
if (!file) {
  console.error('usage: node scripts/read-doc.mjs <file> [from] [to] | --render <page> <out.png>')
  process.exit(1)
}

if (/\.(xlsx|xls)$/i.test(file)) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  wb.eachSheet((ws) => {
    console.log(`# ${ws.name}`)
    ws.eachRow((row) => console.log((row.values ?? []).slice(1).map((v) => (v && typeof v === 'object' && 'result' in v ? v.result : v) ?? '').join(' | ')))
  })
} else {
  const mupdf = await import('mupdf')
  const doc = mupdf.Document.openDocument(fs.readFileSync(file), 'application/pdf')
  const n = doc.countPages()
  if (a === '--render') {
    const pix = doc.loadPage(Number(b) - 1).toPixmap(mupdf.Matrix.scale(1.6, 1.6), mupdf.ColorSpace.DeviceRGB, false, true)
    fs.writeFileSync(c ?? `page-${b}.png`, pix.asPNG())
    console.log(`wrote ${c ?? `page-${b}.png`}`)
  } else {
    const from = Math.max(1, Number(a ?? 1)), to = Math.min(n, Number(b ?? n))
    console.log(`PAGES ${n}`)
    for (let i = from; i <= to; i++) {
      const t = doc.loadPage(i - 1).toStructuredText('preserve-whitespace').asText()
      // Little or no text on a page = a scan; render it and read the image.
      console.log(`--- page ${i}${t.replace(/\s+/g, '').length < 80 ? ' (scanned — use --render)' : ''} ---\n${t}`)
    }
  }
}
