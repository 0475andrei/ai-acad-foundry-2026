import { useState, useRef } from 'react'
import { api } from './api'
import { startRecording } from './speech'


/** The Libra monogram — circle, black serif stem, red "B", a small swoosh.
 * Inline SVG rather than a raster asset: crisp at any size, no file to ship. */
export function Logo({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ flex: '0 0 auto' }}>
      <circle cx="48" cy="50" r="38" fill="none" stroke="currentColor" strokeWidth="6" />
      <text x="38" y="70" fontFamily="Georgia, 'Times New Roman', serif" fontSize="56"
            fontWeight="700" fill="currentColor" textAnchor="middle">I</text>
      <text x="63" y="70" fontFamily="Georgia, 'Times New Roman', serif" fontSize="56"
            fontWeight="700" fill="var(--c-crimson)" textAnchor="middle">B</text>
      <path d="M 82 68 Q 94 76 80 86" stroke="currentColor" strokeWidth="6" fill="none" strokeLinecap="round" />
    </svg>
  )
}

// LIviu BRAdu — capitalized that way on purpose (LI + BRA = LIBRA) — the "simple
// user" role's face while a grounded answer is being retrieved. An 8-bit sprite,
// not an image file: each row below is one line of a pixel grid ('.' =
// transparent), matching how Logo above is inline SVG rather than a shipped
// asset. Row width is fixed at 18 — every row must stay that long or the grid
// skews. Two full grids, not one grid plus a diff: SEARCH and EUREKA are
// identical below the shoulders (row 14 down — desk, book, torso) and differ
// only in a single arm column (index 16) and one spark pixel (index 17, row 0),
// which is simpler to keep correct by eye than reconstructing an overlay.
const TELLER_PALETTE = {
  H: '#1b1f2e',   // hair
  S: '#a9704f',   // skin
  D: '#3a2415',   // eyes / mustache
  W: '#f2ede4',   // shirt
  V: '#232a45',   // vest / sleeve
  C: '#8a5a34',   // desk
  K: '#5c3b20',   // desk shadow
  P: '#d9b878',   // book page
  E: '#5c3b20',   // book spine
  T: '#3aa0a0',   // page mid-turn highlight
  Y: '#eea23e',   // "idea" spark
}

// Paging through the book, arm resting.
const TELLER_SEARCH_ROWS = [
  '......HHHHHH......',
  '.....HHHHHHHH.....',
  '.....HHHHHHHH.....',
  '.....HSSSSSSH.....',
  '.....SSSSSSSS.....',
  '.....SDDSSDDS.....',
  '.....SDDSSDDS.....',
  '.....SSSSSSSS.....',
  '.....SSDDDDSS.....',
  '......SDDDDS......',
  '.......SSSS.......',
  '..VVWWWWWWWWWWVV..',
  '..VVVVWWWWWWVVVV..',
  '..VVVVVWWWWVVVVV..',
  'VVVVVVVVVVVVVVVVVV',
  'SSVVVVVVVVVVVVVVSS',
  'KKKKKKKKKKKKKKKKKK',
  'CCCCPPPPEEPPPPCCCC',
  'CCCCPPPTEEPPPPCCCC',
  'CCCCPPPPEEPPPPCCCC',
  'CCCCCCCCCCCCCCCCCC',
  'KKKKKKKKKKKKKKKKKK',
]

// Same figure — arm raised straight up along column 16, ending in a fingertip
// with an "idea" spark above his head. Attaches cleanly at the shoulder (row
// 14, already solid) with no gap, and never crosses the face (columns 5-12).
const TELLER_EUREKA_ROWS = [
  '......HHHHHH.....Y',
  '.....HHHHHHHH...S.',
  '.....HHHHHHHH...S.',
  '.....HSSSSSSH...S.',
  '.....SSSSSSSS...S.',
  '.....SDDSSDDS...S.',
  '.....SDDSSDDS...S.',
  '.....SSSSSSSS...S.',
  '.....SSDDDDSS...S.',
  '......SDDDDS....V.',
  '.......SSSS.....V.',
  '..VVWWWWWWWWWWVVV.',
  '..VVVVWWWWWWVVVVV.',
  '..VVVVVWWWWVVVVVV.',
  'VVVVVVVVVVVVVVVVVV',
  'SSVVVVVVVVVVVVVVSS',
  'KKKKKKKKKKKKKKKKKK',
  'CCCCPPPPEEPPPPCCCC',
  'CCCCPPPTEEPPPPCCCC',
  'CCCCPPPPEEPPPPCCCC',
  'CCCCCCCCCCCCCCCCCC',
  'KKKKKKKKKKKKKKKKKK',
]
const TELLER_PIXEL = 6

// The hand-drawn fallback — used only when the real photo for this phase (see
// LibraTeller below) isn't in public/ yet, or fails to load. Kept, not deleted:
// this way there's never a broken/blank state, just a lower-fidelity one.
function PixelTeller({ phase = 'searching', caption: captionOverride, pixel = TELLER_PIXEL }) {
  const rows = phase === 'eureka' ? TELLER_EUREKA_ROWS : TELLER_SEARCH_ROWS
  const caption = captionOverride ?? (phase === 'eureka'
    ? 'LIviu BRAdu a găsit!'
    : 'LIviu BRAdu caută prin dosare…')
  const width = rows[0].length * pixel
  const height = rows.length * pixel

  // The book (rows 17-19) is grouped in its own <g> so it can tilt as one
  // rigid piece — a rotation only reads as "the book moved" if every one of
  // its pixels shares a single transform-origin, which individual per-rect
  // classes can't give it. translateY (the head bob) doesn't have that
  // problem: every rect moving the same amount looks identical to a real
  // group, so those stay plain rects with a shared class.
  const bodyRects = []
  const bookRects = []
  rows.forEach((row, y) => {
    ;[...row].forEach((ch, x) => {
      if (ch === '.') return
      const isEye = phase === 'searching' && (y === 5 || y === 6) &&
                    (x === 6 || x === 7 || x === 10 || x === 11)
      const isHead = y <= 10 && x <= 13 && !isEye
      const isPageTurn = phase === 'searching' && ch === 'T'
      const isSpark = phase === 'eureka' && ch === 'Y'
      const cls = [isEye && 'teller-eye', isHead && 'teller-head',
                   isPageTurn && 'teller-page', isSpark && 'teller-spark']
        .filter(Boolean).join(' ') || undefined
      const rect = (
        <rect key={`${y}-${x}`} x={x * pixel} y={y * pixel}
              width={pixel} height={pixel} fill={TELLER_PALETTE[ch]}
              className={cls} />
      )
      ;(y >= 17 && y <= 19 ? bookRects : bodyRects).push(rect)
    })
  })

  return (
    <div className={`teller${phase === 'eureka' ? ' teller-eureka' : ''}`}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
           shapeRendering="crispEdges" role="img" aria-label="Asistentul caută în documentație">
        {bodyRects}
        <g className={phase === 'searching' ? 'teller-book-group' : undefined}>{bookRects}</g>
      </svg>
      <p className="teller-caption">{caption}</p>
    </div>
  )
}

// The real art, when it exists. public/ is served at the site root as-is (not
// bundled), so a missing file here is just a 404 on this one <img> — caught by
// onError, never a build failure — rather than something that could break the
// dev server before the photos are ever added.
const TELLER_PHOTOS = {
  searching: '/teller-reading.gif',
  eureka: '/teller-eureka.gif',
  // A still photo, not a loop — this is the calm "before you've asked anything"
  // pose, shown once per empty conversation, not tied to a request in flight.
  greeting: '/teller-greeting.png',
}

export function LibraTeller({ phase = 'searching', caption: captionOverride, compact = false }) {
  // Tracked per phase, not as one flag: the photos are separate files, and one
  // going missing shouldn't sink the others back to the pixel sprite too.
  const [failed, setFailed] = useState({})
  // caption is overridable — the new-chat greeting reuses the "searching" GIF's
  // page-flipping loop (he's got the whole book ready) but with its own line
  // instead of the mid-request "searching…" caption.
  const caption = captionOverride ?? (phase === 'eureka'
    ? 'LIviu BRAdu a găsit!'
    : 'LIviu BRAdu caută prin dosare…')

  if (failed[phase]) return <PixelTeller phase={phase} caption={caption} pixel={compact ? 3 : TELLER_PIXEL} />

  return (
    <div className={`teller teller-photo${phase === 'eureka' ? ' teller-eureka' : ''}${compact ? ' teller-compact' : ''}`}>
      {/* The motion (bob, pop, brightness flash) is baked into the GIF's own frames —
          generated from these same reference photos — so no CSS transform is layered
          on top here; that avoided fighting/doubling up with the animation already
          inside the file. The greeting photo is static, so it gets its own gentle
          CSS idle bob instead (see .teller-greeting-idle). */}
      <img key={phase} src={TELLER_PHOTOS[phase]} alt="LIviu BRAdu"
           className={phase === 'greeting' ? 'teller-greeting-idle' : undefined}
           onError={() => setFailed((f) => ({ ...f, [phase]: true }))} />
      <p className="teller-caption">{caption}</p>
    </div>
  )
}

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

const CONVO_LIST_STRINGS = {
  en: { newChat: '+ new chat', import: 'import', importTitle: 'Import a conversation exported as JSON',
        rename: 'Rename this chat', export: 'Export this chat as JSON', del: 'Delete this chat' },
  ro: { newChat: '+ conversație nouă', import: 'import', importTitle: 'Importă o conversație exportată ca JSON',
        rename: 'Redenumește', export: 'Exportă ca JSON', del: 'Șterge conversația' },
}

/** The chat-history list: new/import controls plus the conversation rows. Rendered
 * inside the Chat view for admins, or inside the app's own left rail for the
 * single-agent "user" role — same list, two different homes depending on isAdmin. */
export function ConversationList({ conversations, activeId, onSelect, onNew, onImportClick,
                                    fileInputRef, onImportFile, onExport, onDelete, onRename,
                                    locale = 'en' }) {
  const s = CONVO_LIST_STRINGS[locale] || CONVO_LIST_STRINGS.en
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState('')
  // Escape must not save. Removing the input on keydown lets the browser fire blur
  // on an element that's already gone, which is unreliable — so both keys resolve
  // through the same onBlur, and this flag is the one thing that tells it which way.
  const cancelRef = useRef(false)

  function startRename(c) {
    setEditingId(c.id)
    setDraft(c.title)
  }
  function commitRename() {
    if (cancelRef.current) { cancelRef.current = false } else if (editingId) { onRename(editingId, draft) }
    setEditingId(null)
  }

  return (
    <>
      <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.6rem' }}>
        <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={onNew}>
          {s.newChat}
        </button>
        <button className="btn btn-outline btn-sm" title={s.importTitle}
                onClick={onImportClick}>
          {s.import}
        </button>
      </div>
      <input ref={fileInputRef} type="file" accept="application/json,.json"
             style={{ display: 'none' }} onChange={onImportFile} />
      {conversations
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((c) => {
          const editing = c.id === editingId
          return (
            <div key={c.id} className={`convo-item ${c.id === activeId ? 'active' : ''}`}
                 onClick={() => !editing && onSelect(c.id)}>
              {editing ? (
                <input className="convo-rename-input" autoFocus value={draft}
                       onClick={(e) => e.stopPropagation()}
                       onChange={(e) => setDraft(e.target.value)}
                       onBlur={commitRename}
                       onKeyDown={(e) => {
                         if (e.key === 'Enter') { e.preventDefault(); e.target.blur() }
                         if (e.key === 'Escape') { e.preventDefault(); cancelRef.current = true; e.target.blur() }
                       }} />
              ) : (
                <span className="convo-title" title={c.title}>{c.title}</span>
              )}
              {!editing && (
                <button className="convo-rename" title={s.rename}
                        onClick={(e) => { e.stopPropagation(); startRename(c) }}>
                  ✎
                </button>
              )}
              <button className="convo-export" title={s.export}
                      onClick={(e) => { e.stopPropagation(); onExport(c) }}>
                ↓
              </button>
              <button className="convo-del" title={s.del}
                      onClick={(e) => { e.stopPropagation(); onDelete(c.id) }}>
                ×
              </button>
            </div>
          )
        })}
    </>
  )
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
