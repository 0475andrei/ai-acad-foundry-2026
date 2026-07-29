import { useState, useRef } from 'react'
import { api } from './api'
import { startRecording } from './speech'


export function Head({ title, children }) {
  return (
    <div className="head">
      <div>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </div>
  )
}

export function Err({ error }) {
  if (!error) return null
  return <div className="err" style={{ marginTop: '.8rem' }}><strong>Error:</strong> {error}</div>
}

export function Spinner({ label = 'working' }) {
  return <span className="muted" style={{ fontSize: '.85rem' }}><span className="spin" /> {label}…</span>
}

/** Collapsible raw JSON — the bridge between the GUI and what Swagger would show. */
export function RawJson({ data, label = 'raw response' }) {
  const [open, setOpen] = useState(false)
  if (!data) return null
  return (
    <div style={{ marginTop: '.8rem' }}>
      <button className="btn btn-outline btn-sm" onClick={() => setOpen(!open)}>
        {open ? 'hide' : 'show'} {label}
      </button>
      {open && <pre className="out" style={{ marginTop: '.5rem' }}>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  )
}

/** Where an agent can run — the four states, with the reason on hover. */
export const RUNS_ON = {
  local:   { label: 'local only',     tone: 'muted',   hint: 'A JSON file on disk. Runs in the backend process, with any provider.' },
  both:    { label: 'local + Foundry', tone: '',       hint: 'A JSON file here AND a hosted agent of the same name in Azure. Either lane works.' },
  foundry: { label: 'Foundry only',   tone: 'gold',    hint: 'Hosted in Azure with no local file — created in the portal, or its file was removed.' },
  unknown: { label: 'Foundry: unknown', tone: 'muted', hint: 'Could not ask the Agent Service, so hosted state is genuinely unknown.' },
}

export function RunsOnBadge({ runsOn, reason }) {
  const s = RUNS_ON[runsOn] || RUNS_ON.unknown
  return <span className={`badge ${s.tone}`} title={runsOn === 'unknown' && reason ? reason : s.hint}>{s.label}</span>
}

export function ChunkList({ chunks }) {
  if (!chunks?.length) return null
  return (
    <div>
      {chunks.map((c) => (
        <div className="chunk" key={c.index}>
          <div className="chunk-head">
            <span>chunk [{c.index}]</span>
            <span>{c.chars} chars · ~{c.approx_tokens} tokens</span>
          </div>
          {c.text}
        </div>
      ))}
    </div>
  )
}

export function Hits({ hits }) {
  if (!hits?.length) return <p className="faint">No hits.</p>
  return (
    <table>
      <thead>
        <tr><th style={{ width: '5.5rem' }}>score</th><th>chunk</th><th style={{ width: '7rem' }}>source</th></tr>
      </thead>
      <tbody>
        {hits.map((h) => (
          <tr key={h.id}>
            <td className="mono" style={{ color: 'var(--c-gold)' }}>{h.score.toFixed(4)}</td>
            <td>{h.text}</td>
            <td className="faint">{h.source}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function SpeakButton({ text }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function play() {
    setError(null); setBusy(true)
    try {
      const blob = await api.speak({ text })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
    } catch (e) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
      <button className="btn btn-outline btn-sm" onClick={play} disabled={busy}
              title="Listen to this answer (Azure AI Speech)">
        {busy ? <span className="spin" /> : '\u{1F50A}'} listen
      </button>
      {error && <span className="faint" style={{ color: 'var(--c-crimson)' }}>{error}</span>}
    </span>
  )
}

export function MicButton({ onText, disabled }) {
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const controllerRef = useRef(null)

  async function toggle() {
    setError(null)
    if (!recording) {
      try {
        controllerRef.current = await startRecording()
        setRecording(true)
      } catch (e) {
        setError(e.message || 'Microphone access denied')
      }
      return
    }
    setRecording(false); setBusy(true)
    try {
      const wavBlob = await controllerRef.current.stop()
      const file = new File([wavBlob], 'clip.wav', { type: 'audio/wav' })
      const result = await api.transcribe(file)
      onText(result.text)
    } catch (e) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
      <button type="button" className={`btn btn-sm ${recording ? 'btn-primary' : 'btn-outline'}`}
              onClick={toggle} disabled={disabled || busy}
              title={recording ? 'Stop recording' : 'Ask by voice (Azure AI Speech)'}>
        {busy ? <span className="spin" /> : recording ? '\u25CF' : '\u{1F3A4}'} {recording ? 'stop' : 'speak'}
      </button>
      {error && <span className="faint" style={{ color: 'var(--c-crimson)' }}>{error}</span>}
    </span>
  )
}
