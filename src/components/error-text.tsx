// Shows an error message, turning any web address in it into a clickable link.
export function ErrorText({ message, className = '' }: { message: string; className?: string }) {
  const parts = message.split(/(https?:\/\/\S+)/g)
  return (
    <span className={className}>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline"
          >
            Open billing page
          </a>
        ) : (
          <span key={i}>{part.replace(/:\s*$/, '')}</span>
        )
      )}
    </span>
  )
}
