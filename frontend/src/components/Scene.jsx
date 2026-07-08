import React, { useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Line, Text, Billboard } from '@react-three/drei'
import * as THREE from 'three'
import { buildGeometry, WORLD } from '../lib/features.js'

// --- Fixed camera framing (Part D #4) ----------------------------------------
// Direction is fixed (locked polar angle from the previous session — Y-rotation
// only). Distance is a one-time choice since the world box never resizes.
const CAM_DIR = new THREE.Vector3(2.1, 1.35, 2.1).normalize()
const CAM_DIST = 11.2
const CAM_POS = CAM_DIR.clone().multiplyScalar(CAM_DIST)
const POLAR_ANGLE = Math.acos(CAM_DIR.y) // ≈ 1.13 rad — locked min == max

const GRID = '#243044'
const BOXCOL = '#33405a'
const TICKCOL = '#5b6b86'
const TEAL = '#3df0c0'

// --- Soft radial glow sprite (built once) ------------------------------------
function makeGlow() {
  const s = 64
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0.0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.30)')
  g.addColorStop(1.0, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  const tex = new THREE.CanvasTexture(c)
  tex.needsUpdate = true
  return tex
}
const GLOW = makeGlow()

const VERT = `
  attribute float size;
  attribute vec3 aColor;
  uniform float scale;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (scale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`
const FRAG = `
  uniform sampler2D uTex;
  varying vec3 vColor;
  void main() {
    float a = texture2D(uTex, gl_PointCoord).a;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * a, a);
  }`

// --- Keeps the drawing buffer synced to the container (Bug 2, prev session) ---
function Resizer() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    const parent = gl.domElement.parentElement
    if (!parent) return
    const apply = () => {
      const w = parent.clientWidth
      const h = parent.clientHeight
      if (!w || !h) return
      gl.setSize(w, h, false)
      if (camera.isPerspectiveCamera) {
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      }
    }
    const ro = new ResizeObserver(apply)
    ro.observe(parent)
    const onOrient = () => window.setTimeout(apply, 250)
    window.addEventListener('orientationchange', onOrient)
    apply()
    return () => {
      ro.disconnect()
      window.removeEventListener('orientationchange', onOrient)
    }
  }, [gl, camera])
  return null
}

// Frames the fixed box to ~78% of the SHORTER viewport dimension, recomputing
// on resize/orientation. Only the camera DISTANCE changes (direction + polar
// angle stay locked, so the no-pole-flip guarantee holds). Radius is pinned via
// the controls' min/maxDistance since zoom is disabled.
const BOX_SPHERE = WORLD * Math.sqrt(3) // bounding sphere of the [-W,W]^3 box
const FILL = 0.78
function Framing() {
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  useEffect(() => {
    const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2
    const aspect = size.width / Math.max(size.height, 1)
    const hHalf = Math.atan(Math.tan(vHalf) * aspect)
    const half = Math.min(vHalf, hHalf) // bind on the shorter dimension
    const dist = BOX_SPHERE / (Math.tan(half) * FILL)
    const dir = camera.position.lengthSq() > 0 ? camera.position.clone().normalize() : CAM_DIR.clone()
    camera.position.copy(dir.multiplyScalar(dist))
    camera.updateProjectionMatrix()
    if (controls) {
      controls.minDistance = dist
      controls.maxDistance = dist
      controls.update()
    }
  }, [size.width, size.height, camera, controls])
  return null
}

// --- Fixed world box: wireframe + gridded back walls + ticks + axis names -----
function gridSegments() {
  const W = WORLD
  const seg = []
  const push = (a, b) => seg.push(a[0], a[1], a[2], b[0], b[1], b[2])
  for (let i = -W; i <= W; i++) {
    // floor  y = -W
    push([-W, -W, i], [W, -W, i]); push([i, -W, -W], [i, -W, W])
    // back   z = -W
    push([-W, i, -W], [W, i, -W]); push([i, -W, -W], [i, W, -W])
    // left   x = -W
    push([-W, i, -W], [-W, i, W]); push([-W, -W, i], [-W, W, i])
  }
  return new Float32Array(seg)
}

function Ticks({ axis }) {
  const W = WORLD
  const vals = []
  for (let i = -W; i <= W; i++) vals.push(i)
  return vals.map((v) => {
    let pos
    if (axis === 'pitch') pos = [v, -W - 0.32, W + 0.12]       // X, front-bottom
    else if (axis === 'timbre') pos = [W + 0.3, -W - 0.2, v]   // Z, right-bottom
    else pos = [-W - 0.35, v, W + 0.08]                        // Y (motion), front-left
    return (
      <Billboard key={axis + v} position={pos}>
        <Text fontSize={0.26} color={TICKCOL} anchorX="center" anchorY="middle">
          {v}
        </Text>
      </Billboard>
    )
  })
}

function WorldBox() {
  const grid = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(gridSegments(), 3))
    return g
  }, [])
  const box = useMemo(() => new THREE.BoxGeometry(2 * WORLD, 2 * WORLD, 2 * WORLD), [])
  useEffect(() => () => { grid.dispose(); box.dispose() }, [grid, box])

  return (
    <group>
      <lineSegments geometry={grid}>
        <lineBasicMaterial color={GRID} transparent opacity={0.5} />
      </lineSegments>
      <lineSegments>
        <edgesGeometry args={[box]} />
        <lineBasicMaterial color={BOXCOL} transparent opacity={0.7} />
      </lineSegments>

      <Ticks axis="pitch" />
      <Ticks axis="timbre" />
      <Ticks axis="motion" />

      <Billboard position={[0, -WORLD - 0.95, WORLD + 0.5]}>
        <Text fontSize={0.5} color="#aab8d4">Pitch</Text>
      </Billboard>
      <Billboard position={[WORLD + 1.15, -WORLD - 0.5, 0]}>
        <Text fontSize={0.5} color="#aab8d4">Timbre</Text>
      </Billboard>
      <Billboard position={[-WORLD - 1.15, 0.2, WORLD]}>
        <Text fontSize={0.5} color="#aab8d4">Motion</Text>
      </Billboard>
    </group>
  )
}

// --- Monochrome glowing point cloud (single draw call) -----------------------
function GlowPoints({ geo }) {
  const gl = useThree((s) => s.gl)
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3))
    g.setAttribute('aColor', new THREE.BufferAttribute(geo.colors, 3))
    g.setAttribute('size', new THREE.BufferAttribute(geo.sizes, 1))
    return g
  }, [geo])
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTex: { value: GLOW }, scale: { value: 105 * gl.getPixelRatio() } },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), [gl])
  useEffect(() => () => geom.dispose(), [geom])
  return <points geometry={geom} material={mat} />
}

function Trail({ geo, highlightIndex }) {
  const linePoints = useMemo(() => {
    const pts = []
    for (let i = 0; i < geo.n; i++) {
      pts.push([geo.positions[i * 3], geo.positions[i * 3 + 1], geo.positions[i * 3 + 2]])
    }
    return pts
  }, [geo])

  const hi = highlightIndex != null && highlightIndex >= 0 && highlightIndex < geo.n
    ? [geo.positions[highlightIndex * 3], geo.positions[highlightIndex * 3 + 1], geo.positions[highlightIndex * 3 + 2]]
    : null

  return (
    <>
      {geo.n >= 2 && (
        <Line points={linePoints} color={TEAL} lineWidth={1} transparent opacity={0.16} />
      )}
      <GlowPoints geo={geo} />
      {hi && (
        <sprite position={hi} scale={[0.9, 0.9, 0.9]}>
          <spriteMaterial map={GLOW} color={'#c9fff0'} transparent depthWrite={false}
                          blending={THREE.AdditiveBlending} />
        </sprite>
      )}
    </>
  )
}

export default function Scene({ features, highlightIndex = null }) {
  const geo = useMemo(() => buildGeometry(features || []), [features])

  return (
    <div className="absolute inset-0">
      <Canvas
        camera={{ position: CAM_POS.toArray(), fov: 45, near: 0.1, far: 100 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#080810']} />

        <WorldBox />
        {geo.n > 0 && <Trail geo={geo} highlightIndex={highlightIndex} />}

        <Resizer />
        <Framing />
        <OrbitControls
          makeDefault
          enableDamping
          enablePan={false}
          enableZoom={false}
          target={[0, 0, 0]}
          minPolarAngle={POLAR_ANGLE}
          maxPolarAngle={POLAR_ANGLE}
        />
      </Canvas>
    </div>
  )
}
