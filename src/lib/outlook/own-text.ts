// The new part of an email — what the sender wrote, without the quoted thread.
export function ownText(body: string) {
  return body.split(/\n\s*(From:|-----Original Message|On .{5,80} wrote:|________________)/)[0].trim()
}
