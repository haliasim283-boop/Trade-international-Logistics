import { useRef, useState } from 'react'
import { ImageIcon, X, ExternalLink } from 'lucide-react'

function getDroppedImageFile(e) {
  const file = e.dataTransfer?.files?.[0]
  return file && file.type.startsWith('image/') ? file : null
}

export function PaymentImageUpload({ file, previewUrl, existingUrl, onChange, onClear, onClearExisting }) {
  const inputRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  // Counts nested dragenter/dragleave pairs so a child element's dragleave
  // (e.g. moving over the image inside the drop zone) doesn't flicker the
  // highlight off before the drag has actually left the container.
  const dragDepth = useRef(0)

  function handleDragEnter(e) {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current += 1
    setIsDragging(true)
  }

  function handleDragOver(e) {
    // Required for onDrop to fire at all — browsers reject drops by default.
    e.preventDefault()
    e.stopPropagation()
  }

  function handleDragLeave(e) {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragging(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setIsDragging(false)
    const dropped = getDroppedImageFile(e)
    if (dropped) onChange(dropped)
  }

  const dropZoneProps = {
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  }

  // New file selected → show new preview
  if (file) {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Receipt Image</label>
        <div
          {...dropZoneProps}
          className={`relative border rounded-md overflow-hidden transition-colors ${
            isDragging ? 'border-accent ring-2 ring-accent/30' : 'border-gray-200'
          }`}
        >
          <img src={previewUrl} alt="Receipt preview" className="w-full h-32 object-cover" />
          <button
            type="button"
            onClick={onClear}
            className="absolute top-1 right-1 bg-white rounded-full p-0.5 shadow text-gray-600 hover:text-red-600"
          >
            <X className="w-4 h-4" />
          </button>
          <p className="text-xs text-gray-500 px-2 py-1 truncate bg-white border-t border-gray-100">{file.name}</p>
          {isDragging && (
            <div className="absolute inset-0 flex items-center justify-center bg-accent/10 text-xs font-medium text-accent pointer-events-none">
              Drop to replace
            </div>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { onChange(e.target.files?.[0] ?? null); e.target.value = '' }} />
      </div>
    )
  }

  // Existing URL (from DB) but no new file yet
  if (existingUrl) {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Receipt Image</label>
        <div
          {...dropZoneProps}
          className={`relative border rounded-md overflow-hidden transition-colors ${
            isDragging ? 'border-accent ring-2 ring-accent/30' : 'border-gray-200'
          }`}
        >
          <img src={existingUrl} alt="Existing receipt" className="w-full h-32 object-cover" />
          <div className="absolute top-1 right-1 flex gap-1">
            <button
              type="button"
              onClick={() => window.open(existingUrl, '_blank')}
              className="bg-white rounded-full p-0.5 shadow text-gray-600 hover:text-blue-600"
              title="View full size"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onClearExisting}
              className="bg-white rounded-full p-0.5 shadow text-gray-600 hover:text-red-600"
              title="Remove receipt"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full text-xs text-gray-500 hover:text-accent px-2 py-1 bg-white border-t border-gray-100 text-left transition-colors"
          >
            Click to replace, or drag and drop a new image
          </button>
          {isDragging && (
            <div className="absolute inset-0 flex items-center justify-center bg-accent/10 text-xs font-medium text-accent pointer-events-none">
              Drop to replace
            </div>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { onChange(e.target.files?.[0] ?? null); e.target.value = '' }} />
      </div>
    )
  }

  // Nothing yet
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">Receipt Image</label>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        {...dropZoneProps}
        className={`w-full border-2 border-dashed rounded-md py-3 px-4 text-sm transition-colors flex items-center gap-2 ${
          isDragging
            ? 'border-accent bg-accent/5 text-accent'
            : 'border-gray-300 text-gray-500 hover:border-accent hover:text-accent'
        }`}
      >
        <ImageIcon className="w-4 h-4" />
        {isDragging ? 'Drop image to attach' : 'Click, or drag and drop, to attach a receipt / screenshot'}
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { onChange(e.target.files?.[0] ?? null); e.target.value = '' }} />
    </div>
  )
}
