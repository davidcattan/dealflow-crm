'use client'

import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'

export function FileDropzone({
  files,
  onFilesChange,
  disabled,
}: {
  files: File[]
  onFilesChange: (files: File[]) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    onFilesChange([...files, ...Array.from(list)])
  }

  function removeFile(index: number) {
    onFilesChange(files.filter((_, i) => i !== index))
  }

  return (
    <div>
      <div
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(e: DragEvent<HTMLDivElement>) => {
          e.preventDefault()
          if (!disabled) setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e: DragEvent<HTMLDivElement>) => {
          e.preventDefault()
          setDragActive(false)
          if (!disabled) addFiles(e.dataTransfer.files)
        }}
        className={`rounded-md border-2 border-dashed px-4 py-6 text-center text-sm transition-colors ${
          disabled
            ? 'cursor-not-allowed border-slate-200 text-slate-300'
            : 'cursor-pointer'
        } ${
          dragActive && !disabled
            ? 'border-slate-500 bg-slate-50 text-slate-700'
            : !disabled
              ? 'border-slate-300 text-slate-500 hover:border-slate-400 hover:bg-slate-50'
              : ''
        }`}
      >
        Drag files here, or click to browse — select or drop several at once
        <input
          ref={inputRef}
          type="file"
          multiple
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
          className="hidden"
        />
      </div>

      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-1.5 text-sm"
            >
              <span className="truncate text-slate-700">{f.name}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="ml-2 shrink-0 text-xs text-red-500 hover:underline"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
