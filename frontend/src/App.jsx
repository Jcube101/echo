import React, { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import Scene from './components/Scene.jsx'
import AnalysisPanel from './components/AnalysisPanel.jsx'
import Controls from './components/Controls.jsx'
import PlaybackBar from './components/PlaybackBar.jsx'
import Gallery from './components/Gallery.jsx'
import Samples from './components/Samples.jsx'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toaster } from '@/components/ui/sonner'
import { uploadAudio, friendlyError } from './lib/api.js'
import { indexForTime } from './lib/nearestIndex.js'
import sample from './data/sample.json'

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
  const [samplesOpen, setSamplesOpen] = useState(false)
  const [sampleMeta, setSampleMeta] = useState(null) // attribution when a sample is loaded
  const [historyKey, setHistoryKey] = useState(0) // bump to refresh the gallery
  const [view, setView] = useState('trail') // 'trail' (3D) | 'panel' (spectral)

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
    setSampleMeta(res.source_type === 'sample' ? res : null)
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
      toast.success('Uploaded', { description: f.name })
    } catch (err) {
      const msg = friendlyError(err)
      onStatus('error', msg)
      toast.error('Upload failed', { description: msg })
    }
  }, [busy, onResult, onStatus])

  return (
    <div className="h-full w-full flex flex-col bg-ink text-slate-100">
      <Toaster position="top-center" />
      <header className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Echo</h1>
          <span className="hidden sm:inline text-xs text-slate-400">
            sound made visible — pitch × timbre × motion
          </span>
        </div>

        {/* View toggle: the 3D trail (primary) vs. the v1.5 spectral panel —
            a genuinely separate view, not merged into the 3D scene. Radix Tabs
            gives this a real tab-switch transition (see index.css) and correct
            keyboard/aria semantics for free. */}
        <Tabs value={view} onValueChange={setView}>
          <TabsList aria-label="View" className="bg-white/5 h-auto p-0.5 rounded-md">
            <TabsTrigger
              value="trail"
              className="px-3 py-1.5 rounded font-medium data-[state=active]:bg-white/15 data-[state=active]:text-white data-[state=active]:shadow-none data-[state=inactive]:text-slate-400"
            >
              3D Trail
            </TabsTrigger>
            <TabsTrigger
              value="panel"
              className="px-3 py-1.5 rounded font-medium data-[state=active]:bg-white/15 data-[state=active]:text-white data-[state=active]:shadow-none data-[state=inactive]:text-slate-400"
            >
              Spectral Panel
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="ml-auto flex items-center gap-2">
          <Controls busy={busy} onStatus={onStatus} onResult={onResult} />
          <Button
            onClick={() => setSamplesOpen(true)}
            className="bg-white/10 hover:bg-white/20 text-slate-100"
            title="Curated example birdcalls"
          >
            🐦 Samples
          </Button>
          <Button
            onClick={() => setGalleryOpen(true)}
            className="bg-white/10 hover:bg-white/20 text-slate-100"
            title="Browse past clips"
          >
            ☰ History
          </Button>
        </div>
      </header>

      <main
        className="flex-1 relative"
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {/* key={view} + a restrained fade-in gives the tab switch a real
            transition instead of an instant swap. Purely a wrapper: Scene's
            own markup/camera/rendering is untouched. */}
        {view === 'trail' ? (
          <div key="trail" className="absolute inset-0 animate-in fade-in-0 duration-200">
            <Scene features={features} highlightIndex={highlightIndex} />
          </div>
        ) : (
          <div key="panel" className="absolute inset-0 bg-ink animate-in fade-in-0 duration-200">
            <AnalysisPanel
              features={features}
              duration={duration}
              playheadSec={playheadSec}
              onSeek={setPlayheadSec}
            />
          </div>
        )}

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

        <div className="absolute bottom-3 left-3 text-[11px] text-slate-400 bg-panel/70 rounded px-2 py-1 backdrop-blur">
          {features.length} points{clipId ? ` · clip ${clipId}` : ' · sample'}
          {view === 'trail' ? ' · drag to orbit' : ' · hover for values'}
        </div>

        {/* Attribution credit while a curated sample is loaded (required for the
            publicly-served CC BY-NC-SA recordings) */}
        {sampleMeta && (
          <div className="absolute bottom-3 right-3 max-w-[70vw] text-[11px] bg-panel/80 rounded-md px-3 py-2 backdrop-blur border border-white/10">
            <span className="text-slate-200 font-medium">🐦 {sampleMeta.species}</span>
            <span className="text-slate-500"> — rec. {sampleMeta.recordist} · </span>
            <a href={sampleMeta.license_url} target="_blank" rel="noopener noreferrer"
               className="text-slate-400 underline decoration-dotted hover:text-slate-200">{sampleMeta.license}</a>
            <span className="text-slate-500"> · </span>
            <a href={sampleMeta.source_url} target="_blank" rel="noopener noreferrer"
               className="text-indigo-300 hover:text-indigo-200">Xeno-canto ↗</a>
          </div>
        )}
      </main>

      <PlaybackBar
        audioUrl={audioUrl}
        duration={duration}
        spectrogram={spectrogram}
        playheadSec={playheadSec}
        onSeek={setPlayheadSec}
      />

      <Samples
        open={samplesOpen}
        onClose={() => setSamplesOpen(false)}
        currentId={clipId}
        onLoaded={applyClip}
        onStatus={onStatus}
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
