/**
 * 将普通照片处理为黑白文档模式（白底黑字）
 * 使用 Canvas API 逐像素二值化，适合拍试卷/书本等文字场景
 */
export interface DocumentFilterOptions {
  threshold?: number // 二值化阈值 0-255, 默认 150
  keepOnlyBlack?: boolean // 仅保留黑/灰色, 去除彩色(红笔/蓝章等)
  colorThreshold?: number // 色彩判定阈值 0-1, 默认 0.15。越低越严格
}

export async function applyDocumentFilter(
  imageSource: string,
  options: DocumentFilterOptions = {},
): Promise<string> {
  const { threshold = 150, keepOnlyBlack = false, colorThreshold = 0.15 } = options

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('Canvas not supported'))

      canvas.width = img.width
      canvas.height = img.height
      ctx.drawImage(img, 0, 0)

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageData.data

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]

        if (keepOnlyBlack) {
          // 饱和度检测: 彩色像素 → 变白
          const max = Math.max(r, g, b)
          const min = Math.min(r, g, b)
          const saturation = max > 0 ? (max - min) / max : 0
          if (saturation > colorThreshold) {
            data[i] = 255
            data[i + 1] = 255
            data[i + 2] = 255
            continue
          }
        }

        const grayscale = 0.299 * r + 0.587 * g + 0.114 * b
        const color = grayscale > threshold ? 255 : 0
        data[i] = color
        data[i + 1] = color
        data[i + 2] = color
      }

      ctx.putImageData(imageData, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = imageSource
  })
}

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
