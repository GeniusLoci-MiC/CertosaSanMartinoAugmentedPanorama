import * as ecs from '@8thwall/ecs'

// Heading from alpha/beta/gamma (MDN approach)
function computeHeadingFromEuler(alpha: number, beta: number, gamma: number): number {
  const d2r = Math.PI / 180
  const _x = (beta ?? 0) * d2r; const _y = (gamma ?? 0) * d2r; const
    _z = (alpha ?? 0) * d2r
  const cX = Math.cos(_x); const cY = Math.cos(_y); const
    cZ = Math.cos(_z)
  const sX = Math.sin(_x); const sY = Math.sin(_y); const
    sZ = Math.sin(_z)
  const Vx = -cZ * sY - sZ * sX * cY
  const Vy = -sZ * sY + cZ * sX * cY
  let heading = Math.atan2(Vx, Vy)
  if (heading < 0) heading += 2 * Math.PI
  return heading * 180 / Math.PI
}

type EID = any
type State = {
  started: boolean
  lastHeadingDeg: number | null
}
const st = new Map<EID, State>()
const hAbs = new Map<EID, (e:any)=>void>()
const hRel = new Map<EID, (e:any)=>void>()
const firstTap = new Map<EID, ()=>void>()
const timers = new Map<EID, number>()

export const CompassYawSimple = ecs.registerComponent({
  name: 'Compass Yaw Simple',
  schema: {
    // rotates this entity; set if you want to rotate a different one
    // target: ecs.eid,

    // add/subtract degrees to line up with real north
    offsetDeg: ecs.f32,

    // start on first tap (required on iOS for permission; harmless on Android)
    startOnFirstTap: ecs.boolean,

    // prefer Android's absolute event
    preferAbsoluteEvent: ecs.boolean,

    // logging period (ms)
    logIntervalMs: ecs.i32,

    // extra console logs
    debug: ecs.boolean,
  },
  schemaDefaults: {
    offsetDeg: 0,
    startOnFirstTap: true,
    preferAbsoluteEvent: true,
    logIntervalMs: 1000,
    debug: false,
  },

  add: (world, component) => {
    const eid: EID = component.eid as any
    const cfg = component.schemaAttribute.get(eid) as any
    // const target: EID = (cfg.target ?? eid) as any
    // const target: EID = eid as any
    const dbg = !!cfg.debug
    const logMs = Math.max(250, (cfg.logIntervalMs ?? 1000) | 0)

    st.set(eid, {started: false, lastHeadingDeg: null})

    const onAbs = (e:any) => {
      const s = st.get(eid); if (!s) return
      if (typeof e.alpha === 'number') {
        s.lastHeadingDeg = computeHeadingFromEuler(e.alpha, e.beta ?? 0, e.gamma ?? 0)
      }
    }
    hAbs.set(eid, onAbs)

    const onRel = (e:any) => {
      const s = st.get(eid); if (!s) return
      if (typeof e?.webkitCompassHeading === 'number') {
        s.lastHeadingDeg = (e.webkitCompassHeading + 360) % 360
      } else if (typeof e.alpha === 'number') {
        s.lastHeadingDeg = computeHeadingFromEuler(e.alpha, e.beta ?? 0, e.gamma ?? 0)
      }
    }
    hRel.set(eid, onRel)

    const start = async () => {
      const s = st.get(eid); if (!s || s.started) return
      s.started = true

      // iOS permission (no-op on Android)
      try {
        const DOE: any = (window as any).DeviceOrientationEvent
        if (DOE && typeof DOE.requestPermission === 'function') {
          const res = await DOE.requestPermission()
          if (res !== 'granted') {
            if (dbg) console.warn('[Compass] permission not granted'); return
          }
        }
      } catch {}

      if (cfg.preferAbsoluteEvent) {
        window.addEventListener('deviceorientationabsolute', onAbs as any, true)
        window.addEventListener('deviceorientation', onRel as any, true)
      } else {
        window.addEventListener('deviceorientation', onRel as any, true)
        window.addEventListener('deviceorientationabsolute', onAbs as any, true)
      }

      const id = window.setInterval(() => {
        const ss = st.get(eid)
        if (!ss) return
        if (ss.lastHeadingDeg == null) {
          console.log('[CompassYawSimple] waiting for data…')
        } else {
          const yaw = (ss.lastHeadingDeg + (cfg.offsetDeg || 0) + 360) % 360
          console.log(`[CompassYawSimple] heading=${ss.lastHeadingDeg.toFixed(1)}°, yaw+offset=${yaw.toFixed(1)}°`)
        }
      }, logMs)
      timers.set(eid, id)

      if (dbg) console.log('[Compass] started')
    }

    if (cfg.startOnFirstTap) {
      const ft = () => {
        start()
        const gid: any = (world.events as any).globalId
        world.events.removeListener(gid as any, ecs.input.SCREEN_TOUCH_START, ft)
        firstTap.delete(eid)
      }
      firstTap.set(eid, ft)
      const gid: any = (world.events as any).globalId
      world.events.addListener(gid as any, ecs.input.SCREEN_TOUCH_START, ft)
      if (dbg) console.log('[Compass] ready; tap once to start')
    } else {
      start()
    }
  },

  // minimal Studio signature
  tick: (world, cursor) => {
    const eid: EID = (cursor as any).eid as any
    const cfg = (cursor as any).schemaAttribute.get(eid) as any
    //     const target: EID = (cfg.target ?? eid) as any
    const target: EID = eid as any
    const s = st.get(eid); if (!s) return
    if (s.lastHeadingDeg == null) return

    // compute yaw + offset, set quaternion (pure yaw around Y)
    const yawDeg = (s.lastHeadingDeg + (cfg.offsetDeg || 0))
    const q = ecs.math.quat.yDegrees(yawDeg)
    ecs.Quaternion.set(world, target, {x: q.x, y: q.y, z: q.z, w: q.w})
  },

  remove: (world, component) => {
    const eid: EID = component.eid as any
    const a = hAbs.get(eid); if (a) window.removeEventListener('deviceorientationabsolute', a as any, true)
    const r = hRel.get(eid); if (r) window.removeEventListener('deviceorientation', r as any, true)
    hAbs.delete(eid); hRel.delete(eid)

    const ft = firstTap.get(eid)
    if (ft) {
      const gid: any = (world.events as any).globalId
      world.events.removeListener(gid as any, ecs.input.SCREEN_TOUCH_START, ft)
      firstTap.delete(eid)
    }

    const t = timers.get(eid); if (t) window.clearInterval(t)
    timers.delete(eid)
    st.delete(eid)
  },
})
