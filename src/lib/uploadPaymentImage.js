const cloudName = () => import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const preset    = () => import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

async function compressImage(file, maxWidth = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const scale   = Math.min(1, maxWidth / img.width)
      const canvas  = document.createElement('canvas')
      canvas.width  = Math.round(img.width  * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Compression failed'))),
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Failed to load image')) }
    img.src = objectUrl
  })
}

export async function uploadPaymentImage(file) {
  if (!cloudName() || !preset()) throw new Error('Cloudinary not configured — add VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET to .env')
  const blob       = await compressImage(file)
  const compressed = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
  const fd = new FormData()
  fd.append('file', compressed)
  fd.append('upload_preset', preset())
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName()}/image/upload`, { method: 'POST', body: fd })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message ?? `HTTP ${res.status}`)
  }
  return (await res.json()).secure_url
}
