import { z } from 'zod'

export const DraftEmailSchema = z.object({
  subject: z
    .string()
    .describe(
      'A short, specific email subject line for a loan submission, e.g. "Deal Submission: Acme Fabrication LLC — $250k Bridge"'
    ),
  body: z
    .string()
    .describe(
      "The full email body as plain text, ready to paste into Outlook. Professional broker-to-lender tone, addressed to the lender contact by first name if known (otherwise a generic greeting), 3-5 short paragraphs: (1) brief intro of the deal and the ask, (2) the key facts that make it fit this specific lender's mandate, (3) financial highlights / notable strengths or caveats, (4) a clear ask for next steps (a call, term sheet, etc.). End with a sign-off using the broker's name if known, otherwise a generic placeholder like '[Your name]'. Do not invent facts not given to you — if financials are unknown, don't state numbers."
    ),
})

export type DraftEmail = z.infer<typeof DraftEmailSchema>
