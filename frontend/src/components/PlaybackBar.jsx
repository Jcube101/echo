import React, { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import Spectrogram from './Spectrogram.jsx'
import { fmtClock } from '../lib/format.js'

// The dock: playback transport + spectrogram strip. Owns the <audio> element
// and reports the current playhead time up via onSeek(seconds), which App turns
// into the highlighted 3D point. Scrubbing works with or without live audio
// playback, so the sync is verifiable headlessly.
//
// `phone` (DESIGN_V2.md §4.7): the spectrogram sits above a bottom dock holding
// a larger play button, the seek bar with times under it, and `children` (the
// sample attribution line).
export default function PlaybackBar({ audioUrl, duration, spectrogram, playheadSec, onSeek, phone = false, children }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)

  // Reset transport when the clip changes.
  useEffect(() => {
    setPlaying(false)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
  }, [audioUrl])

  const dur = duration || 0
  const progress = dur > 0 ? playheadSec / dur : 0

  function togglePlay() {
    const a = audioRef.current
    if (!a) return
    if (playing) {
      a.pause()
      setPlaying(false)
    } else {
      a.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    }
  }

  function onScrub(e) {
    const t = Number(e.target.value)
    if (audioRef.current) audioRef.current.currentTime = t
    onSeek(t)
  }

  const disabled = !audioUrl

  const audioEl = audioUrl && (
    <audio
      ref={audioRef}
      src={audioUrl}
      preload="auto"
      onTimeUpdate={(e) => onSeek(e.target.currentTime)}
      onEnded={() => setPlaying(false)}
      className="hidden"
    />
  )

  const playButton = (sizeCls) => (
    <button
      type="button"
      onClick={togglePlay}
      disabled={disabled}
      title={playing ? 'Pause' : 'Play'}
      aria-label={playing ? 'Pause' : 'Play'}
      className={'grid shrink-0 place-items-center rounded-full transition-colors ' + sizeCls + ' ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-night-2 ' +
        (disabled ? 'bg-night-3 text-muted-foreground' : 'bg-cream text-ink hover:bg-white')}
    >
      {playing
        ? <Pause className="h-4 w-4 fill-current" />
        : <Play className="h-4 w-4 fill-current ml-0.5" />}
    </button>
  )

  const seekBar = (
    <input
      type="range"
      min={0}
      max={dur || 1}
      step={0.01}
      value={Math.min(playheadSec, dur || 0)}
      onChange={onScrub}
      disabled={disabled}
      aria-label="Seek"
      className="echo-range w-full min-w-0"
      style={{ '--pct': `${Math.min(100, Math.max(0, progress * 100))}%` }}
    />
  )

  if (phone) {
    return (
      <div>
        <div className="px-4 pb-4">
          <Spectrogram spectrogram={spectrogram} progress={progress} duration={dur} compact />
        </div>
        <div className="border-t border-night-line bg-night-2 px-4 pt-3 pb-4">
          <div className="flex items-center gap-4">
            {playButton('h-[52px] w-[52px]')}
            <div className="min-w-0 flex-1">
              {seekBar}
              <div className="flex justify-between font-mono text-xs tabular-nums text-muted-foreground">
                <span>{fmtClock(playheadSec)}</span>
                <span>{fmtClock(dur)}</span>
              </div>
            </div>
          </div>
          {children}
        </div>
        {audioEl}
      </div>
    )
  }

  return (
    <div className="border-t border-night-line bg-night-2 px-4 sm:px-6 pt-3.5 pb-3">
      <div className="flex items-center gap-4">
        {playButton('h-11 w-11')}

        <div className="shrink-0 font-mono text-sm tabular-nums">
          <span className="text-cream">{fmtClock(playheadSec)}</span>
          <span className="text-muted-foreground"> / </span>
          <span className="text-muted-foreground">{fmtClock(dur)}</span>
        </div>

        <div className="flex min-w-0 flex-1 items-center">{seekBar}</div>

        <span className="hidden sm:inline shrink-0 text-[13px] text-muted-foreground">Spectrogram</span>
      </div>

      {/* Spectrogram strip below the transport (owns its own axes) */}
      <div className="mt-3">
        <Spectrogram spectrogram={spectrogram} progress={progress} duration={dur} />
      </div>

      {audioEl}
    </div>
  )
}
