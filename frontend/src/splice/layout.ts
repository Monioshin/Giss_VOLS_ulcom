import type { WorkspaceEdge } from './types'
import { clamp } from './utils'

export type Side = 'bottom' | 'top' | 'left' | 'right'

export type FiberLabelMode = 'horizontal-left' | 'horizontal-right' | 'vertical-above' | 'vertical-below'
export type CableLabelMode = 'horizontal-below' | 'horizontal-above' | 'vertical-left' | 'vertical-right'

const MIN_FIBER_PITCH = 12
const GAP_CABLE = 20
const BODY_PAD = 28
const STUB_OUT = 12
const LABEL_GAP = 10
const OWNER_GAP_VERT = 18
const SIDE_OWNER_GAP = 26
const VERTICAL_LABEL_CLEAR = 28
const BOTTOM_LABEL_CLEAR = 28
const CABLE_LABEL_OFFSET_BOTTOM = 32
const CABLE_LABEL_OFFSET_TOP = 40
const CABLE_LABEL_OFFSET_SIDE = 48
/** Ниже этого шага подпись владельца на схеме скрывается (остаётся в tooltip). */
export const FIBER_OWNER_DIAGRAM_PITCH_MIN = 10
const MARGIN_BASE = 72
const SEG_END = 22

/**
 * Кабели по сторонам: 2 — низ и право; 3 — низ/лево/право; 4 — по одному на сторону;
 * дальше по кругу bottom → right → top → left.
 */
function distributeCablesToSidesV2(n: number): Side[] {
  const out: Side[] = []
  if (n <= 0) return out
  if (n === 1) return ['bottom']
  if (n === 2) return ['bottom', 'right']
  if (n === 3) return ['bottom', 'left', 'right']
  if (n === 4) return ['bottom', 'right', 'top', 'left']
  const order: Side[] = ['bottom', 'right', 'top', 'left']
  for (let i = 0; i < n; i += 1) out.push(order[i % 4])
  return out
}

/** Кабели только снизу/слева/справа — верх зарезервирован под порты кросса. */
function distributeCablesAvoidTopOnly(n: number): Side[] {
  if (n <= 0) return []
  const order: Side[] = ['bottom', 'left', 'right']
  return Array.from({ length: n }, (_, i) => order[i % 3])
}

function minSegmentForCable(T: number, side?: Side): number {
  const t = Math.max(1, T)
  const sideExtra = side === 'left' || side === 'right' ? 20 : 0
  if (t <= 1) return 52 + sideExtra
  return (
    SEG_END * 2 +
    (t - 1) * MIN_FIBER_PITCH +
    STUB_OUT +
    LABEL_GAP +
    (side === 'bottom' || side === 'top' ? VERTICAL_LABEL_CLEAR + OWNER_GAP_VERT : SIDE_OWNER_GAP) +
    (side === 'bottom' ? BOTTOM_LABEL_CLEAR : 0) +
    sideExtra +
    14
  )
}

function sumInnerNeed(idxs: number[], Tof: (ci: number) => number, side: Side): number {
  if (idxs.length === 0) return 0
  let s = idxs.reduce((acc, ci) => acc + minSegmentForCable(Tof(ci), side), 0)
  s += GAP_CABLE * (idxs.length + 1)
  return s
}

function maxFibersOnSide(idxs: number[], Tof: (ci: number) => number): number {
  if (!idxs.length) return 0
  return Math.max(...idxs.map(Tof))
}

function outerMargins(
  perSide: Record<Side, number[]>,
  Tof: (ci: number) => number,
  internalTopPorts: number,
): { top: number; bottom: number; left: number; right: number } {
  let top = MARGIN_BASE
  let bottom = MARGIN_BASE
  let left = MARGIN_BASE
  let right = MARGIN_BASE

  if (perSide.bottom.length) {
    bottom += CABLE_LABEL_OFFSET_BOTTOM + 28 + Math.min(40, maxFibersOnSide(perSide.bottom, Tof) * 0.35)
  }
  if (perSide.top.length) {
    top += CABLE_LABEL_OFFSET_TOP + 32 + perSide.top.length * 10 + Math.min(36, maxFibersOnSide(perSide.top, Tof) * 0.3)
  }
  if (perSide.left.length) {
    left += CABLE_LABEL_OFFSET_SIDE + 24 + perSide.left.length * 26 + Math.min(32, maxFibersOnSide(perSide.left, Tof) * 0.25)
  }
  if (perSide.right.length) {
    right += CABLE_LABEL_OFFSET_SIDE + 24 + perSide.right.length * 26 + Math.min(32, maxFibersOnSide(perSide.right, Tof) * 0.25)
  }
  if (internalTopPorts > 0) top += 20

  return { top, bottom, left, right }
}

export type CableBand = {
  edgeId: number
  side: Side
  x: number
  y: number
  w: number
  h: number
  labelMode: CableLabelMode
  labelAnchorX: number
  labelAnchorY: number
}

export type LayoutResult = {
  worldW: number
  worldH: number
  body: { x: number; y: number; w: number; h: number }
  ports: Map<string, PortGeom>
  cableBands: CableBand[]
}

export type PortGeom = {
  edgeId: number
  fiberIndex: number
  xIn: number
  yIn: number
  xLabel: number
  yLabel: number
  ownerX: number
  ownerY: number
  hitCx: number
  hitCy: number
  fiberPitch: number
  textAnchor: 'start' | 'middle' | 'end'
  fiberLabelMode: FiberLabelMode
}

function fitPitchInSegment(seg: number, T: number): { pitch: number; span: number } {
  if (T <= 1) return { pitch: 0, span: 0 }
  const usable = Math.max(10, seg - 2 * SEG_END)
  const raw = usable / (T - 1)
  const pitch = clamp(raw, 8, 20)
  const span = (T - 1) * pitch
  return { pitch, span }
}

function placeInternalCrossPorts(bx: number, by: number, bw: number, bh: number, N: number, ports: Map<string, PortGeom>) {
  if (N <= 0) return
  const innerL = bx + BODY_PAD + 8
  const innerR = bx + bw - BODY_PAD - 8
  const innerW = Math.max(20, innerR - innerL)
  const { pitch, span } = fitPitchInSegment(innerW, N)
  const startX = innerL + (innerW - span) / 2
  const yRim = by + 10
  const hitCy = by + Math.min(42, Math.max(24, bh * 0.2))
  for (let fi = 1; fi <= N; fi += 1) {
    const px = N <= 1 ? bx + bw / 2 : startX + (fi - 1) * pitch
    const yNum = hitCy + 14
    ports.set(`0:${fi}`, {
      edgeId: 0,
      fiberIndex: fi,
      xIn: px,
      yIn: yRim + 4,
      xLabel: px,
      yLabel: yNum,
      ownerX: px,
      ownerY: yNum + OWNER_GAP_VERT,
      hitCx: px,
      hitCy,
      fiberPitch: N <= 1 ? 0 : pitch,
      textAnchor: 'middle',
      fiberLabelMode: 'vertical-below',
    })
  }
}

export function buildPortLayout(cables: WorkspaceEdge[], internalTopPorts: number): LayoutResult {
  const n = cables.length
  const reserveTop = internalTopPorts > 0
  if (n === 0 && internalTopPorts <= 0) {
    return { worldW: 960, worldH: 720, body: { x: 200, y: 200, w: 400, h: 240 }, ports: new Map(), cableBands: [] }
  }
  const sides = n === 0 ? ([] as Side[]) : reserveTop ? distributeCablesAvoidTopOnly(n) : distributeCablesToSidesV2(n)
  const perSide: Record<Side, number[]> = { bottom: [], top: [], left: [], right: [] }
  sides.forEach((s, idx) => {
    perSide[s].push(idx)
  })
  const Tof = (ci: number) => Math.max(1, cables[ci].total_fibers ?? 1)

  const sumB = sumInnerNeed(perSide.bottom, Tof, 'bottom')
  const sumT = sumInnerNeed(perSide.top, Tof, 'top')
  const sumL = sumInnerNeed(perSide.left, Tof, 'left')
  const sumR = sumInnerNeed(perSide.right, Tof, 'right')
  const internalExtra = internalTopPorts > 0 ? minSegmentForCable(internalTopPorts, 'top') + GAP_CABLE * 2 : 0

  const bw =
    Math.max(n === 0 && internalTopPorts > 0 ? 300 : 300, sumB, sumT, internalExtra, perSide.left.length || perSide.right.length ? 260 : 0) +
    2 * BODY_PAD
  const bh =
    Math.max(
      220,
      sumL,
      sumR,
      perSide.bottom.length || perSide.top.length ? 200 : 0,
      internalTopPorts > 0 ? Math.max(190, 86 + internalTopPorts * 5) : 0,
    ) + 2 * BODY_PAD

  const marg = outerMargins(perSide, Tof, internalTopPorts)
  const bx = marg.left
  const by = marg.top
  const worldW = bw + marg.left + marg.right
  const worldH = bh + marg.top + marg.bottom

  const ports = new Map<string, PortGeom>()
  const cableBands: CableBand[] = []

  const placeBottom = () => {
    const idxs = perSide.bottom
    const k = idxs.length
    if (!k) return
    const inner = bw - 2 * BODY_PAD - GAP_CABLE * (k + 1)
    const weights = idxs.map((ci) => Math.max(Tof(ci), 3) ** 1.25)
    const wSum = weights.reduce((a, b) => a + b, 0)
    let x = bx + BODY_PAD + GAP_CABLE
    for (let j = 0; j < k; j += 1) {
      const ci = idxs[j]
      const edge = cables[ci]
      const segW = (inner * weights[j]) / wSum
      const T = Tof(ci)
      const { pitch, span } = fitPitchInSegment(segW, T)
      const startX = x + (segW - span) / 2
      const yBody = by + bh
      const yTip = yBody + STUB_OUT
      const yNum = yTip + LABEL_GAP + BOTTOM_LABEL_CLEAR
      const yOwner = yNum + OWNER_GAP_VERT
      for (let fi = 1; fi <= T; fi += 1) {
        const px = T <= 1 ? x + segW / 2 : startX + (fi - 1) * pitch
        ports.set(`${edge.id}:${fi}`, {
          edgeId: edge.id,
          fiberIndex: fi,
          xIn: px,
          yIn: yBody,
          xLabel: px,
          yLabel: yNum,
          ownerX: px,
          ownerY: yOwner,
          hitCx: px,
          hitCy: yTip,
          fiberPitch: T <= 1 ? 0 : pitch,
          textAnchor: 'middle',
          fiberLabelMode: 'vertical-below',
        })
      }
      cableBands.push({
        edgeId: edge.id,
        side: 'bottom',
        x,
        y: yBody - 4,
        w: segW,
        h: STUB_OUT + 34,
        labelMode: 'horizontal-below',
        labelAnchorX: x + segW / 2,
        labelAnchorY: yBody + STUB_OUT + CABLE_LABEL_OFFSET_BOTTOM,
      })
      x += segW + GAP_CABLE
    }
  }

  const placeTop = () => {
    const idxs = perSide.top
    const k = idxs.length
    if (!k) return
    const inner = bw - 2 * BODY_PAD - GAP_CABLE * (k + 1)
    const weights = idxs.map((ci) => Math.max(Tof(ci), 3) ** 1.25)
    const wSum = weights.reduce((a, b) => a + b, 0)
    let x = bx + BODY_PAD + GAP_CABLE
    for (let j = 0; j < k; j += 1) {
      const ci = idxs[j]
      const edge = cables[ci]
      const segW = (inner * weights[j]) / wSum
      const T = Tof(ci)
      const { pitch, span } = fitPitchInSegment(segW, T)
      const startX = x + (segW - span) / 2
      const yBody = by
      const yTip = yBody - STUB_OUT
      const yNum = yTip - LABEL_GAP - VERTICAL_LABEL_CLEAR
      const yOwner = yNum - OWNER_GAP_VERT
      for (let fi = 1; fi <= T; fi += 1) {
        const px = T <= 1 ? x + segW / 2 : startX + (fi - 1) * pitch
        ports.set(`${edge.id}:${fi}`, {
          edgeId: edge.id,
          fiberIndex: fi,
          xIn: px,
          yIn: yBody,
          xLabel: px,
          yLabel: yNum,
          ownerX: px,
          ownerY: yOwner,
          hitCx: px,
          hitCy: yTip,
          fiberPitch: T <= 1 ? 0 : pitch,
          textAnchor: 'middle',
          fiberLabelMode: 'vertical-above',
        })
      }
      cableBands.push({
        edgeId: edge.id,
        side: 'top',
        x,
        y: yBody - STUB_OUT - 30,
        w: segW,
        h: STUB_OUT + 30,
        labelMode: 'vertical-left',
        labelAnchorX: x + segW / 2,
        labelAnchorY: yBody - STUB_OUT - CABLE_LABEL_OFFSET_TOP,
      })
      x += segW + GAP_CABLE
    }
  }

  const placeLeft = () => {
    const idxs = perSide.left
    const k = idxs.length
    if (!k) return
    const inner = bh - 2 * BODY_PAD - GAP_CABLE * (k + 1)
    const weights = idxs.map((ci) => Math.max(Tof(ci), 3) ** 1.25)
    const wSum = weights.reduce((a, b) => a + b, 0)
    let y = by + BODY_PAD + GAP_CABLE
    for (let j = 0; j < k; j += 1) {
      const ci = idxs[j]
      const edge = cables[ci]
      const segH = (inner * weights[j]) / wSum
      const T = Tof(ci)
      const { pitch, span } = fitPitchInSegment(segH, T)
      const startY = y + (segH - span) / 2
      const xBody = bx
      const xTip = xBody - STUB_OUT
      for (let fi = 1; fi <= T; fi += 1) {
        const py = T <= 1 ? y + segH / 2 : startY + (fi - 1) * pitch
        const xNum = xTip - LABEL_GAP
        ports.set(`${edge.id}:${fi}`, {
          edgeId: edge.id,
          fiberIndex: fi,
          xIn: xBody,
          yIn: py,
          xLabel: xNum,
          yLabel: py,
          ownerX: xNum - SIDE_OWNER_GAP,
          ownerY: py,
          hitCx: xTip,
          hitCy: py,
          fiberPitch: T <= 1 ? 0 : pitch,
          textAnchor: 'end',
          fiberLabelMode: 'horizontal-left',
        })
      }
      cableBands.push({
        edgeId: edge.id,
        side: 'left',
        x: xBody - STUB_OUT - 32,
        y,
        w: STUB_OUT + 32,
        h: segH,
        labelMode: 'vertical-left',
        labelAnchorX: xBody - STUB_OUT - CABLE_LABEL_OFFSET_SIDE,
        labelAnchorY: y + segH / 2,
      })
      y += segH + GAP_CABLE
    }
  }

  const placeRight = () => {
    const idxs = perSide.right
    const k = idxs.length
    if (!k) return
    const inner = bh - 2 * BODY_PAD - GAP_CABLE * (k + 1)
    const weights = idxs.map((ci) => Math.max(Tof(ci), 3) ** 1.25)
    const wSum = weights.reduce((a, b) => a + b, 0)
    let y = by + BODY_PAD + GAP_CABLE
    for (let j = 0; j < k; j += 1) {
      const ci = idxs[j]
      const edge = cables[ci]
      const segH = (inner * weights[j]) / wSum
      const T = Tof(ci)
      const { pitch, span } = fitPitchInSegment(segH, T)
      const startY = y + (segH - span) / 2
      const xBody = bx + bw
      const xTip = xBody + STUB_OUT
      for (let fi = 1; fi <= T; fi += 1) {
        const py = T <= 1 ? y + segH / 2 : startY + (fi - 1) * pitch
        const xNum = xTip + LABEL_GAP
        ports.set(`${edge.id}:${fi}`, {
          edgeId: edge.id,
          fiberIndex: fi,
          xIn: xBody,
          yIn: py,
          xLabel: xNum,
          yLabel: py,
          ownerX: xNum + SIDE_OWNER_GAP,
          ownerY: py,
          hitCx: xTip,
          hitCy: py,
          fiberPitch: T <= 1 ? 0 : pitch,
          textAnchor: 'start',
          fiberLabelMode: 'horizontal-right',
        })
      }
      cableBands.push({
        edgeId: edge.id,
        side: 'right',
        x: xBody + 4,
        y,
        w: STUB_OUT + 32,
        h: segH,
        labelMode: 'vertical-right',
        labelAnchorX: xBody + STUB_OUT + CABLE_LABEL_OFFSET_SIDE,
        labelAnchorY: y + segH / 2,
      })
      y += segH + GAP_CABLE
    }
  }

  placeBottom()
  placeTop()
  placeLeft()
  placeRight()
  placeInternalCrossPorts(bx, by, bw, bh, internalTopPorts, ports)

  return { worldW, worldH, body: { x: bx, y: by, w: bw, h: bh }, ports, cableBands }
}
