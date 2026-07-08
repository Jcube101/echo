import React, { useCallback, useMemo, useState } from 'react'
import Scene from './components/Scene.jsx'
import Controls from './components/Controls.jsx'
import PlaybackBar from './components/PlaybackBar.jsx'
import Gallery from './components/Gallery.jsx'
import { uploadAudio } from './lib/api.js'
import sample from './data/sample.json'

// Nearest feature index for a given playback time (features are t-ordered).
function indexForTime(features, t) {
  if (!features.length) return null
  let lo = 0
  let hi = features.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (features[mid].t < t) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(features[lo - 1].t - t) < Math.abs(features[lo].t - t)) return lo - 1
  return lo
}

export default function App() {
  const [features, setFeatures] = useState(sample)
  const [spectrogram, setSpectrogram] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)
  const [duration, setDuration] = useState(sample.length ? sample[sample.length - 1].t : 0)
  const [clipId, setClipId] = useState(null)
  const [playheadSec, setPlayheadSec] = useState(0)
  const [status, setStatus] = useState('idle') // idle | processing | error
  const [message, setMessage] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [historyKey, setHistoryKey] = useState(0) // bump to refresh the gallery

  const busy = status === 'processing'

  const highlightIndex = useMemo(
    () => (audioUrl ? indexForTime(features, playheadSec) : null),
    [features, playheadSec, audioUrl],
  )

  const onStatus = useCallback((s, msg = '') => {
    setStatus(s)
    setMessage(msg)
  }, [])

  const applyClip = useCallback((res) => {
    setFeatures(res.features)
    setSpectrogram(res.spectrogram || null)
    setAudioUrl(res.audio_url || null)
    setClipId(res.id || null)
    setPlayheadSec(0)
    setDuration(res.duration_s || (res.features.length ? res.features[res.features.length - 1].t : 0))
  }, [])

  // A freshly created clip: apply it AND refresh the gallery list.
  const onResult = useCallback((res) => {
    applyClip(res)
    setHistoryKey((k) => k + 1)
  }, [applyClip])

  // Drag & drop anywhere over the scene.
  const onDrop = useCallback(async (e) => {
    e.preventDefault()
    setDragOver(false)
    if (busy) return
    const f = e.dataTransfer.files?.[0]
    if (!f) return
    onStatus('processing', 'Analyzing audio…')
    try {
      const res = await uploadAudio(f, f.name)
      onResult(res)
      onStatus('idle')
    } catch (err) {
      onStatus('error', err.message || 'Upload failed')
    }
  }, [busy, onResult, onStatus])

  return (
    <div className="h-full w-full flex flex-col bg-ink text-slate-100">
      <header className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Echo</h1>
          <span className="hidden sm:inline text-xs text-slate-400">
            sound made visible — pitch × timbre × motion
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Controls busy={busy} onStatus={onStatus} onResult={onResult} />
          <button
            onClick={() => setGalleryOpen(true)}
            className="px-3 py-2 rounded-md text-sm font-medium bg-white/10 hover:bg-white/20 text-slate-100"
            title="Browse past clips"
          >
            ☰ History
          </button>
        </div>
      </header>

      <main
        className="flex-1 relative"
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <Scene features={features} highlightIndex={highlightIndex} />

        {/* Drag overlay */}
        {dragOver && (
          <div className="absolute inset-0 grid place-items-center bg-indigo-500/10 border-2 border-dashed border-indigo-300/60 pointer-events-none">
            <div className="text-indigo-100 text-lg font-medium">Drop audio to visualize</div>
          </div>
        )}

        {/* Processing overlay */}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-ink/60 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 rounded-full border-2 border-white/20 border-t-white animate-spin" />
              <div className="text-sm text-slate-200">{message || 'Working…'}</div>
              <div className="text-[11px] text-slate-500">pitch analysis can take a moment</div>
            </div>
          </div>
        )}

        {/* Error toast */}
        {status === 'error' && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-rose-600/90 text-white text-sm px-4 py-2 rounded-md shadow-lg">
            {message}
          </div>
        )}

        <div className="absolute bottom-3 left-3 text-[11px] text-slate-400 bg-panel/70 rounded px-2 py-1 backdrop-blur">
          {features.length} points{clipId ? ` · clip ${clipId}` : ' · sample'} · drag to orbit
        </div>
      </main>

      <PlaybackBar
        audioUrl={audioUrl}
        duration={duration}
        spectrogram={spectrogram}
        playheadSec={playheadSec}
        onSeek={setPlayheadSec}
      />

      <Gallery
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        currentId={clipId}
        refreshKey={historyKey}
        onLoaded={applyClip}
        onStatus={onStatus}
      />
    </div>
  )
}
