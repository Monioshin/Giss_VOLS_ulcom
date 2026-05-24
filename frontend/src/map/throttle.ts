/** Возвращает функцию, вызываемую не чаще чем раз в `ms` мс. */
export function throttle<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null

  const run = () => {
    timer = null
    if (!lastArgs) return
    const args = lastArgs
    lastArgs = null
    last = Date.now()
    fn(...args)
  }

  return ((...args: Parameters<T>) => {
    lastArgs = args
    const now = Date.now()
    const remaining = ms - (now - last)
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      last = now
      lastArgs = null
      fn(...args)
      return
    }
    if (!timer) {
      timer = setTimeout(run, remaining)
    }
  }) as T
}
