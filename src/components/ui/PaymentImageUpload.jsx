import { useRef } from 'react'
import { ImageIcon, X, ExternalLink } from 'lucide-react'

export function PaymentImageUpload({ file, previewUrl, existingUrl, onChange, onClear, onClearExisting }) {
  const inputRef = useRef(null)

  // New file selected → show new preview
  if (file) {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Receipt Image</label>
        <div className="relative border border-gray-200 rounded-md overflow-hidden">
          <img src={previewUrl} alt="Receipt preview" className="w-full h-32 object-cover" />
          <button
            type="button"
            onClick={onClear}
            className="absolute top-1 right-1 bg-white rounded-full p-0.5 shadow text-gray-600 hover:text-red-600"
          >
            <X className="w-4 h-4" />
          </button>
          <p className="text-xs text-gray-500 px-2 py-1 truncate bg-white border-t border-gray-100">{file.name}</p>
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
        <div className="relative border border-gray-200 rounded-md overflow-hidden">
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
            Click to replace with a different image
          </button>
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
        className="w-full border-2 border-dashed border-gray-300 rounded-md py-3 px-4 text-sm text-gray-500 hover:border-accent hover:text-accent transition-colors flex items-center gap-2"
      >
        <ImageIcon className="w-4 h-4" />
        Click to attach receipt / screenshot
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { onChange(e.target.files?.[0] ?? null); e.target.value = '' }} />
    </div>
  )
}
