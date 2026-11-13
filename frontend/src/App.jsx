import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import Scene from './components/Scene.jsx'
import AnalysisPanel from './components/AnalysisPanel.jsx'
import Controls, { HEADER_BTN } from './components/Controls.jsx'
import Sidebar, { clipLabel } from './components/Sidebar.jsx'
import {
  PhoneHome, PhoneRecording, PhoneResultHeader, PlayheadChips,
} from './components/PhoneScreens.jsx'
import Wordmark from './components/Wordmark.jsx'
import PlaybackBar from './components/PlaybackBar.jsx'
import Gallery from './components/Gallery.jsx'
import Samples from './components/Samples.jsx'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toaster } from '@/components/ui/sonner'
import { History, Library } from 'lucide-react'
import { uploadAudio, getClip, getSample, friendlyError } from './lib/api.js'
import { useClipActions } from './lib/useClipActions.js'
import { useMediaQuery } from './lib/useMediaQuery.js'
import { indexForTime } from './lib/nearestIndex.js'
import { appIntent } from './lib/route.js'
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
  const [clipInfo, setClipInfo] = useState(null) // where a non-sample clip came from (sidebar clip card)
  const [historyKey, setHistoryKey] = useState(0) // bump to refresh the gallery
  const [view, setView] = useState('trail') // 'trail' (3D) | 'panel' (spectral)

  // /app?record=1 (the landing page's "Record a sound" link): start the
  // browser recorder straight away. Read once, then drop the param from the
  // URL so a refresh or a shared link doesn't start recording again.
  // Links from the landing page can also ask for a sample (?sample=<id>) or
  // the Samples sheet (?samples=1) — see lib/route.js.
  const [intent] = useState(() => appIntent(window.location.search))
  const autoRecord = intent.record
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname)
  }, [])

  const busy = status === 'processing'

  // The clip sidebar is a desktop feature (DESIGN_V2.md §4.3). Below this
  // width the stage keeps the floating attribution chip instead; the phone
  // layouts proper arrive in session 3.
  const isDesktop = useMediaQuery('(min-width: 1200px)')
  // Phone layouts (DESIGN_V2.md §4.5–4.7): home, recording, result.
  const isPhone = useMediaQuery('(max-width: 639px)')
  // On the phone, a loaded clip opens the result screen; Back returns home.
  const [showResult, setShowResult] = useState(false)
  const [loadingSampleId, setLoadingSampleId] = useState(null)

  const playheadIndex = useMemo(
    () => (features.length ? indexForTime(features, playheadSec) : null),
    [features, playheadSec],
  )
  // The 3D marker only shows for a real clip (there is no audio to follow on
  // the bundled example); the sidebar readout works for both.
  const highlightIndex = audioUrl ? playheadIndex : null
  const playheadFrame = playheadIndex == null ? null : features[playheadIndex]

  const onStatus = useCallback((s, msg = '') => {
    setStatus(s)
    setMessage(msg)
  }, [])

  // `info` says where a freshly made clip came from ({ kind, name }); clips
  // reloaded from history fall back to what the API stored.
  const applyClip = useCallback((res, info = null) => {
    setFeatures(res.features)
    setSpectrogram(res.spectrogram || null)
    setAudioUrl(res.audio_url || null)
    setClipId(res.id || null)
    setPlayheadSec(0)
    setDuration(res.duration_s || (res.features.length ? res.features[res.features.length - 1].t : 0))
    setShowResult(true)
    const isSample = res.source_type === 'sample'
    setSampleMeta(isSample ? res : null)
    setClipInfo(isSample ? null : {
      kind: info?.kind || 'history',
      name: info?.name || res.name || null,
      sourceType: res.source_type || null,
      createdAt: res.created_at || (info ? new Date().toISOString() : null),
    })
  }, [])

  // A freshly created clip: apply it AND refresh the gallery list.
  const onResult = useCallback((res, info) => {
    applyClip(res, info || { kind: 'upload' })
    setHistoryKey((k) => k + 1)
  }, [applyClip])

  // A clip deleted from the History sheet: refresh the sidebar's list, and if
  // it was the one on screen, go back to the starting view (its audio is gone).
  const onClipDeleted = useCallback((id) => {
    setHistoryKey((k) => k + 1)
    if (id !== clipId) return
    setFeatures(sample)
    setSpectrogram(null)
    setAudioUrl(null)
    setClipId(null)
    setClipInfo(null)
    setPlayheadSec(0)
    setDuration(sample.length ? sample[sample.length - 1].t : 0)
    setShowResult(false)
  }, [clipId])

  // Sidebar "Recent clips": reload a stored clip (same path as the History sheet).
  const loadHistoryClip = useCallback(async (id) => {
    onStatus('processing', 'Loading clip…')
    try {
      applyClip(await getClip(id))
      onStatus('idle')
    } catch (err) {
      const msg = friendlyError(err)
      onStatus('error', msg)
      toast.error("Couldn't load clip", { description: msg })
    }
  }, [applyClip, onStatus])

  // Phone home "Or try a sample": load one without opening the Samples sheet.
  const loadSample = useCallback(async (id) => {
    setLoadingSampleId(id)
    onStatus('processing', 'Loading sample…')
    try {
      const clip = await getSample(id)
      applyClip({ ...clip, source_type: 'sample', sample: clip })
      onStatus('idle')
    } catch (err) {
      const msg = friendlyError(err)
      onStatus('error', msg)
      toast.error("Couldn't load sample", { description: msg })
    } finally {
      setLoadingSampleId(null)
    }
  }, [applyClip, onStatus])

  // Act on the landing page's deep link once (the ref guards StrictMode's
  // dev double-run).
  const intentDone = useRef(false)
  useEffect(() => {
    if (intentDone.current) return
    intentDone.current = true
    if (intent.sample) loadSample(intent.sample)
    else if (intent.samples) setSamplesOpen(true)
  }, [intent, loadSample])

  // Upload, browser recording and Pi capture — one owner for every layout.
  const actions = useClipActions({ onStatus, onResult, autoRecord, justSignedIn: intent.owner })

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
      onResult(res, { kind: 'upload', name: f.name })
      onStatus('idle')
      toast.success('Uploaded', { description: f.name })
    } catch (err) {
      const msg = friendlyError(err)
      onStatus('error', msg)
      toast.error('Upload failed', { description: msg })
    }
  }, [busy, onResult, onStatus])

  const TAB =
    'h-10 rounded-full px-4 text-[15px] font-semibold transition-colors data-[state=active]:bg-cream ' +
    'data-[state=active]:text-ink data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground ' +
    'data-[state=inactive]:hover:text-cream'

  // --- Shared pieces (every layout) -------------------------------------------
  const stageView = view === 'trail' ? (
    // key={view} + a restrained fade-in gives the tab switch a real transition
    // instead of an instant swap. Purely a wrapper: Scene's own
    // markup/camera/rendering is untouched.
    <div key="trail" className="absolute inset-0 animate-in fade-in-0 duration-200">
      <Scene features={features} highlightIndex={highlightIndex} />
    </div>
  ) : (
    <div key="panel" className="absolute inset-0 bg-night animate-in fade-in-0 duration-200">
      <AnalysisPanel
        features={features}
        duration={duration}
        playheadSec={playheadSec}
        onSeek={setPlayheadSec}
      />
    </div>
  )

  const processingOverlay = busy && (
    <div className="absolute inset-0 z-20 grid place-items-center bg-night/70 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 rounded-full border-2 border-night-line border-t-amber animate-spin" />
        <div className="text-[15px] text-cream">{message || 'Working…'}</div>
        <div className="text-[13px] text-muted-foreground">pitch analysis can take a moment</div>
      </div>
    </div>
  )

  const sheets = (
    <>
      <input
        ref={actions.fileRef}
        type="file"
        accept="audio/*,video/*,.opus,.m4a,.webm,.ogg"
        className="hidden"
        onChange={actions.onPick}
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
        onDeleted={onClipDeleted}
      />
    </>
  )

  // --- Phone (DESIGN_V2.md §4.5–4.7) ------------------------------------------
  if (isPhone) {
    const recording = actions.recorder.recording
    const hasClip = clipId != null && showResult
    return (
      <div className="relative h-full w-full bg-night text-cream">
        <Toaster position="top-center" />
        {recording ? (
          <PhoneRecording recorder={actions.recorder} onOpenHistory={() => setGalleryOpen(true)} />
        ) : hasClip ? (
          <div className="flex h-full flex-col overflow-y-auto">
            <PhoneResultHeader
              title={sampleMeta ? sampleMeta.species : clipInfo ? clipLabel(clipInfo) : 'Clip'}
              subtitle={`${sampleMeta ? 'Sample' : 'Clip'} · ${duration.toFixed(1)} s`}
              onBack={() => setShowResult(false)}
              onOpenHistory={() => setGalleryOpen(true)}
            />
            <div className="px-4">
              <Tabs value={view} onValueChange={setView}>
                <TabsList aria-label="View" className="grid h-auto w-full grid-cols-2 gap-0.5 rounded-full border border-night-line bg-night-2 p-1">
                  <TabsTrigger value="trail" className={TAB}>3D Trail</TabsTrigger>
                  <TabsTrigger value="panel" className={TAB}>Spectral</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <main className="relative min-h-[300px] flex-1">{stageView}</main>
            <div className="px-4 py-3">
              <PlayheadChips frame={playheadFrame} />
            </div>
            <PlaybackBar
              phone
              audioUrl={audioUrl}
              duration={duration}
              spectrogram={spectrogram}
              playheadSec={playheadSec}
              onSeek={setPlayheadSec}
            >
              {sampleMeta && (
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  rec. {sampleMeta.recordist} ·{' '}
                  <a href={sampleMeta.license_url} target="_blank" rel="noopener noreferrer"
                     className="underline decoration-dotted underline-offset-2">{sampleMeta.license}</a>
                  {' · '}
                  <a href={sampleMeta.source_url} target="_blank" rel="noopener noreferrer"
                     className="text-amber">
                    {sampleMeta.provider === 'freesound' ? 'Freesound' : 'Xeno-canto'}
                  </a>
                </p>
              )}
            </PlaybackBar>
          </div>
        ) : (
          <PhoneHome
            actions={actions}
            busy={busy}
            onOpenHistory={() => setGalleryOpen(true)}
            onOpenSamples={() => setSamplesOpen(true)}
            onPickSample={loadSample}
            loadingSampleId={loadingSampleId}
          />
        )}
        {processingOverlay}
        {sheets}
      </div>
    )
  }

  // --- Tablet + desktop (DESIGN_V2.md §4.3–4.4) -------------------------------
  return (
    <div className="h-full w-full flex flex-col bg-night text-cream">
      <Toaster position="top-center" />
      <header className="min-h-[72px] px-4 sm:px-6 py-3 border-b border-night-line flex flex-wrap items-center gap-x-6 gap-y-3">
        <Wordmark />

        {/* View toggle: the 3D trail (primary) vs. the spectral panel — a
            genuinely separate view, not merged into the 3D scene. Radix Tabs
            gives correct keyboard/aria semantics for free. */}
        <Tabs value={view} onValueChange={setView}>
          <TabsList aria-label="View" className="h-auto gap-0.5 rounded-full border border-night-line bg-night-2 p-1">
            <TabsTrigger value="trail" className={TAB}>3D Trail</TabsTrigger>
            <TabsTrigger value="panel" className={TAB}>Spectral panel</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
          <Controls actions={actions} busy={busy} />
          <span className="hidden xl:block mx-2 h-7 w-px bg-night-line" aria-hidden />
          <Button
            onClick={() => setSamplesOpen(true)}
            className={HEADER_BTN}
            title="Curated example sounds"
          >
            <Library />
            Samples
          </Button>
          <Button
            onClick={() => setGalleryOpen(true)}
            className={HEADER_BTN}
            title="Browse past clips"
          >
            <History />
            History
          </Button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <div className="flex flex-1 min-w-0 flex-col">
          <main
            className="flex-1 relative min-h-0"
            onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            {stageView}

            {/* Drag overlay */}
            {dragOver && (
              <div className="absolute inset-0 grid place-items-center bg-amber/10 border-2 border-dashed border-amber/70 pointer-events-none">
                <div className="font-display text-2xl font-semibold text-cream">Drop audio to visualize</div>
              </div>
            )}

            {processingOverlay}

            {view === 'trail' && (
              <>
                <div className="absolute bottom-4 left-4 sm:left-5 font-mono text-[13px] text-muted-foreground pointer-events-none">
                  {features.length.toLocaleString('en-US')} points{clipId ? ` · clip ${clipId}` : ' · sample'} · drag to orbit
                </div>

                {/* Loudness legend: point size and colour both follow loudness. */}
                <div
                  className="absolute bottom-4 right-4 sm:right-5 flex items-center gap-2.5 text-[13px] text-muted-foreground pointer-events-none"
                  role="img"
                  aria-label="Legend: points grow and shift from green through amber to cream as the sound gets louder"
                >
                  <span>Quiet</span>
                  <span className="flex items-center gap-1.5" aria-hidden>
                    <span className="h-1 w-1 rounded-full bg-[#4F8F63]" />
                    <span className="h-2 w-2 rounded-full bg-[#9C9F57]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber" />
                    <span className="h-3.5 w-3.5 rounded-full bg-cream" />
                  </span>
                  <span>Loud</span>
                </div>
              </>
            )}

            {/* Between phone and desktop width there is no sidebar clip card,
                so the attribution credit stays on the stage (required for the
                publicly-served Creative Commons recordings). */}
            {sampleMeta && !isDesktop && (
              <div className="absolute bottom-11 right-3 max-w-[70vw] text-xs bg-night-2/90 rounded-[10px] px-3 py-2 backdrop-blur border border-night-line">
                <span className="text-cream font-medium">{sampleMeta.species}</span>
                <span className="text-muted-foreground"> — rec. {sampleMeta.recordist} · </span>
                <a href={sampleMeta.license_url} target="_blank" rel="noopener noreferrer"
                   className="text-muted-foreground underline decoration-dotted hover:text-cream">{sampleMeta.license}</a>
                <span className="text-muted-foreground"> · </span>
                <a href={sampleMeta.source_url} target="_blank" rel="noopener noreferrer"
                   className="text-amber hover:underline">
                  {sampleMeta.provider === 'freesound' ? 'Freesound' : 'Xeno-canto'}
                </a>
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
        </div>

        {isDesktop && (
          <Sidebar
            sampleMeta={sampleMeta}
            clipInfo={clipInfo}
            duration={duration}
            frame={playheadFrame}
            playheadSec={playheadSec}
            historyKey={historyKey}
            currentId={clipId}
            onPickClip={loadHistoryClip}
            onOpenHistory={() => setGalleryOpen(true)}
          />
        )}
      </div>

      {sheets}
    </div>
  )
}
