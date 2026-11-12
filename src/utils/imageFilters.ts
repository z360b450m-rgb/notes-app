/**
 * 旋转图片（仅支持 90°/180°/270°）
 * @param deg 旋转角度，90 顺时针，-90或270 逆时针，180 翻转
 */
export async function rotateImage(imageSource: string, deg: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('Canvas not supported'))

      const rad = (deg * Math.PI) / 180
      const sin = Math.abs(Math.sin(rad))
      const cos = Math.abs(Math.cos(rad))
      canvas.width = img.width * cos + img.height * sin
      canvas.height = img.width * sin + img.height * cos

      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate(rad)
      ctx.drawImage(img, -img.width / 2, -img.height / 2)

      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = imageSource
  })
}
