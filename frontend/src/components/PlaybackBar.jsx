import React, { useEffect, useRef, useState } from 'react'
import Spectrogram from './Spectrogram.jsx'

function fmt(s) {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// Playback transport + spectrogram strip. Owns the <audio> element and reports
// the current playhead time up via onSeek(seconds), which App turns into the
// highlighted 3D point. Scrubbing works with or without live audio playback,
// so the sync is verifiable headlessly.
export default function PlaybackBar({ audioUrl, duration, spectrogram, playheadSec, onSeek }) {
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

  return (
    <div className="border-t border-white/10 bg-panel/60 px-4 py-2">
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          disabled={disabled}
          className={'h-9 w-9 shrink-0 grid place-items-center rounded-full ' +
            (disabled ? 'bg-white/5 text-slate-600' : 'bg-white/15 hover:bg-white/25 text-white')}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? '⏸' : '▶'}
        </button>

        <span className="text-[11px] tabular-nums text-slate-400 w-10 text-right">
          {fmt(playheadSec)}
        </span>

        <input
          type="range"
          min={0}
          max={dur || 1}
          step={0.01}
          value={Math.min(playheadSec, dur || 0)}
          onChange={onScrub}
          disabled={disabled}
          aria-label="Seek"
          className="flex-1 accent-indigo-400 disabled:opacity-40"
        />

        <span className="text-[11px] tabular-nums text-slate-400 w-10">
          {fmt(dur)}
        </span>
      </div>

      {/* Spectrogram strip below the transport */}
      <div className="mt-2 h-24 rounded overflow-hidden bg-black/40">
        <Spectrogram spectrogram={spectrogram} progress={progress} />
      </div>

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="auto"
          onTimeUpdate={(e) => onSeek(e.target.currentTime)}
          onEnded={() => setPlaying(false)}
          className="hidden"
        />
      )}
    </div>
  )
}
