import React, { useRef, useState } from 'react'
import { useRecorder } from '../lib/useRecorder.js'
import { uploadAudio, captureMic } from '../lib/api.js'

function Btn({ children, onClick, disabled, active, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        'px-3 py-2 rounded-md text-sm font-medium transition ' +
        (active
          ? 'bg-rose-500 text-white '
          : 'bg-white/10 hover:bg-white/20 text-slate-100 ') +
        (disabled ? 'opacity-40 cursor-not-allowed' : '')
      }
    >
      {children}
    </button>
  )
}

// Toolbar: file upload (picker) + browser recording + Pi mic capture.
// Reports work through onStatus('processing'|'idle'|'error', msg) and
// onResult(apiResponse).
export default function Controls({ busy, onStatus, onResult }) {
  const fileRef = useRef(null)
  const [captureSecs, setCaptureSecs] = useState(5)

  async function runUpload(fileOrBlob, name) {
    onStatus('processing', 'Analyzing audio…')
    try {
      const res = await uploadAudio(fileOrBlob, name)
      onResult(res)
      onStatus('idle')
    } catch (e) {
      onStatus('error', e.message || 'Upload failed')
    }
  }

  const recorder = useRecorder((blob, name) => runUpload(blob, name))

  function onPick(e) {
    const f = e.target.files?.[0]
    if (f) runUpload(f, f.name)
    e.target.value = '' // allow re-picking the same file
  }

  async function runCapture() {
    onStatus('processing', `Recording ${captureSecs}s on the Pi mic…`)
    try {
      const res = await captureMic(captureSecs)
      onResult(res)
      onStatus('idle')
    } catch (e) {
      onStatus('error', e.message || 'Capture failed')
    }
  }

  const recPct = Math.min(100, (recorder.elapsed / recorder.maxSeconds) * 100)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,video/*,.opus,.m4a,.webm,.ogg"
        className="hidden"
        onChange={onPick}
      />

      <Btn onClick={() => fileRef.current?.click()} disabled={busy} title="Upload an audio or video file">
        ⤴ Upload file
      </Btn>

      {recorder.supported ? (
        recorder.recording ? (
          <div className="flex items-center gap-2">
            <Btn onClick={recorder.stop} active title="Stop recording">
              ⏹ Stop {Math.ceil(recorder.maxSeconds - recorder.elapsed)}s
            </Btn>
            <div className="w-24 h-1.5 bg-white/10 rounded overflow-hidden">
              <div className="h-full bg-rose-400" style={{ width: `${recPct}%` }} />
            </div>
          </div>
        ) : (
          <Btn onClick={recorder.start} disabled={busy} title="Record from your device mic (max 60s)">
            ● Record
          </Btn>
        )
      ) : (
        <span className="text-xs text-slate-500">recording unsupported here</span>
      )}

      <div className="flex items-center gap-1 ml-1">
        <Btn onClick={runCapture} disabled={busy} title="Record from the Pi's USB mic">
          🎙 Pi mic
        </Btn>
        <select
          value={captureSecs}
          onChange={(e) => setCaptureSecs(Number(e.target.value))}
          disabled={busy}
          className="bg-white/10 text-sm rounded-md px-2 py-2 outline-none"
          title="Capture duration"
        >
          {[3, 5, 10, 15, 30, 60].map((s) => (
            <option key={s} value={s} className="bg-panel">{s}s</option>
          ))}
        </select>
      </div>
    </div>
  )
}
