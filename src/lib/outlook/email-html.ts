// Turns a drafted plain-text email into clean Outlook HTML: real bullet
// lists, bold section labels ("The deal:", "Heads up:"), normal paragraph
// spacing, the signature kept line by line, in Outlook's default font.

const FONT = "font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt; color: #000000; line-height: 1.4;"
const P = 'margin: 0 0 12px 0;'

function escape(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const BULLET = /^\s*(?:[-•*]|\d+[.)])\s+/
// "The deal:", "Why you:", "Things to know:" on their own line.
const LABEL_LINE = /^[A-Z][A-Za-z' ]{1,28}:$/
// The house format's block titles on their own line: "Revenue", "EBITDA".
const BLOCK_TITLE = /^(?:Revenue|Net Revenue|Sales|Gross Profit|EBITDA|Adj\.? EBITDA|Adjusted EBITDA|Net Income)$/i
// "Heads up: …" / "Why you: …" and the house format's number lines
// ("AR: $5.8M", "Total Debt: …", "ASK: …") at the start of a line.
const LABEL_PREFIX =
  /^((?:Heads up|Why you|Why it fits|Structure|Note|Things to know|The deal|Ask|Timing|Use of funds|AR|A\/R|Inventory(?: on Hand| in Transit)?|Equipment|Real Estate|Total Debt|Debt|Property|Estimated Value|Appraised Value|1st Mortgage|Loan Request|Loan to Value|Combined LTV|Credit)):\s*/i

function inline(line: string) {
  const text = escape(line.trim())
  const m = text.match(LABEL_PREFIX)
  return m ? `<strong>${m[1]}:</strong> ${text.slice(m[0].length)}` : text
}

export function textToEmailHtml(body: string): string {
  const blocks = body.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/)
  const out: string[] = []

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0)
    let paragraph: string[] = []
    let list: string[] = []
    const flushParagraph = () => {
      if (paragraph.length) out.push(`<p style="${P}">${paragraph.join('<br>')}</p>`)
      paragraph = []
    }
    const flushList = () => {
      if (list.length) {
        out.push(
          `<ul style="margin: 0 0 12px 0; padding-left: 22px;">${list
            .map((li) => `<li style="margin: 0 0 4px 0;">${li}</li>`)
            .join('')}</ul>`
        )
      }
      list = []
    }

    for (const line of lines) {
      if (BULLET.test(line)) {
        flushParagraph()
        list.push(inline(line.replace(BULLET, '')))
      } else if (LABEL_LINE.test(line.trim()) || BLOCK_TITLE.test(line.trim())) {
        flushParagraph()
        flushList()
        out.push(`<p style="margin: 0 0 4px 0;"><strong>${escape(line.trim())}</strong></p>`)
      } else {
        flushList()
        paragraph.push(inline(line))
      }
    }
    flushList()
    flushParagraph()
  }

  return `<div style="${FONT}">${out.join('\n')}</div>`
}
