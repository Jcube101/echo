import React, { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Line, Instances, Instance, Text } from '@react-three/drei'
import * as THREE from 'three'
import { buildGeometry, EXTENT } from '../lib/features.js'

// One axis: a colored line from origin outward + a text label at its tip.
function Axis({ dir, color, label }) {
  const end = dir.map((d) => d * (EXTENT + 1.5))
  return (
    <group>
      <Line points={[[0, 0, 0], end]} color={color} lineWidth={1.5} transparent opacity={0.5} />
      <Text position={end} fontSize={0.6} color={color} anchorX="center" anchorY="middle">
        {label}
      </Text>
    </group>
  )
}

function Trail({ geo, highlightIndex }) {
  // Line points + per-vertex colors for the connecting trail.
  const { points, vertexColors } = useMemo(() => {
    const pts = []
    const cols = []
    for (let i = 0; i < geo.n; i++) {
      pts.push([geo.positions[i * 3], geo.positions[i * 3 + 1], geo.positions[i * 3 + 2]])
      cols.push([geo.colors[i * 3], geo.colors[i * 3 + 1], geo.colors[i * 3 + 2]])
    }
    return { points: pts, vertexColors: cols }
  }, [geo])

  if (geo.n < 2) return null

  return (
    <>
      <Line points={points} vertexColors={vertexColors} lineWidth={2} transparent opacity={0.55} />

      {/* Points — amplitude drives per-instance scale + color. */}
      <Instances limit={geo.n} range={geo.n}>
        <sphereGeometry args={[1, 10, 10]} />
        {/* No vertexColors here — drei's <Instance color> drives per-instance
            color via the instanceColor buffer; vertexColors would override it
            and render everything black. */}
        <meshBasicMaterial toneMapped={false} />
        {points.map((p, i) => (
          <Instance
            key={i}
            position={p}
            scale={geo.sizes[i]}
            color={[geo.colors[i * 3], geo.colors[i * 3 + 1], geo.colors[i * 3 + 2]]}
          />
        ))}
      </Instances>

      {/* Playback highlight (Phase 6): a bright ring-marker at the current point. */}
      {highlightIndex != null && highlightIndex >= 0 && highlightIndex < geo.n && (
        <mesh position={points[highlightIndex]}>
          <sphereGeometry args={[Math.max(geo.sizes[highlightIndex] * 1.6, 0.22), 16, 16]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
      )}
    </>
  )
}

export default function Scene({ features, highlightIndex = null }) {
  const geo = useMemo(() => buildGeometry(features || []), [features])

  return (
    <Canvas
      camera={{ position: [EXTENT * 2.1, EXTENT * 1.4, EXTENT * 2.1], fov: 50 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      dpr={[1, 2]}
    >
      <color attach="background" args={['#0a0a12']} />
      <ambientLight intensity={0.6} />

      <Axis dir={[1, 0, 0]} color="#ff6b9d" label="pitch" />
      <Axis dir={[0, 1, 0]} color="#8be9c0" label="timbre" />
      <Axis dir={[0, 0, 1]} color="#7aa2ff" label="motion" />

      {geo.n > 0 && <Trail geo={geo} highlightIndex={highlightIndex} />}

      <OrbitControls enableDamping makeDefault />
    </Canvas>
  )
}
