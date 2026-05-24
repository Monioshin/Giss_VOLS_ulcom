/** Меняет размер canvas только при смене размера карты / DPR. */
export function syncCanvasSize(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  size: { x: number; y: number },
  dpr: number,
  sizeKeyRef: { current: string },
): void {
  const key = `${size.x}x${size.y}@${dpr}`
  if (sizeKeyRef.current !== key) {
    sizeKeyRef.current = key
    canvas.width = size.x * dpr
    canvas.height = size.y * dpr
    canvas.style.width = `${size.x}px`
    canvas.style.height = `${size.y}px`
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
