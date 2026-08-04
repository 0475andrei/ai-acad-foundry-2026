import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { ConversationList, Err, LibraTeller, RunsOnBadge, SpeakButton, MicButton } from '../components'
import { titleFrom, exportConversation } from '../conversations'

// The "simple user" role always talks to the same persona over the same lane, so
// there is nothing for them to pick — these are the fixed defaults for that role.
const USER_DEFAULT_AGENT = 'andrei-dobrin-agent'
const USER_DEFAULT_MODE = 'foundry'

// Below this length there isn't enough draft for the model to guess intent from —
// skip the call rather than asking it to rewrite three words.
const SUGGEST_MIN_CHARS = 12
const SUGGEST_DEBOUNCE_MS = 900

// The "simple user" role's whole chat surface is in Romanian; admin stays English
// (it's the technical pipeline-explorer console, unlike the plain customer-facing
// chat). Everything not covered here — backend badges like "grounded"/model
// names/guardrail category labels — is either dynamic content from the API or
// jargon-shaped enough (top-k, temp) that it isn't natural-language prose to begin
// with, so it's left as-is rather than half-translated.
function uiStrings(isAdmin) {
  return isAdmin ? {
    clear: 'clear', newChatTitle: 'New chat',
    welcomeBody: 'Ask a question about the documents you have ingested. Switch the persona '
                + 'to change how it answers, or turn RAG off to see the model answer without grounding.',
    guardrailFlag: '⚠ guardrail flag',
    piiRedacted: '🔒 personal data redacted',
    piiTooltip: (kinds) => `Redacted before the model saw it: ${kinds}`,
    goodAnswer: 'Good answer', notHelpful: 'Not helpful',
    searchedUsing: 'searched using:',
    retrievalTooltip: 'The question was translated to English for document search only — the '
                      + 'answer above was generated from what you actually asked.',
    sources: (n) => `${n} retrieved passage${n > 1 ? 's' : ''}`,
    exactPrompt: 'the exact prompt that was sent',
    requestFailed: 'Request failed:',
    suggestHeading: 'did you mean to write this?', useThis: 'use this', keepMine: 'keep mine',
    placeholder: 'Ask Libra Assist…  (Enter to send, Shift+Enter for a new line)',
    send: 'Send',
    personaFallback: 'Andrei’s Product Specialist',
    addContract: '📄 Analyze a contract (PDF)', analyzingContract: 'Reading the contract…',
    contractType: 'document type', contractParties: 'parties', contractDuration: 'duration',
    contractAmounts: 'amounts & fees', contractObligations: 'key obligations',
    contractPenalties: 'penalties / termination', contractWarnings: 'worth a second look',
    contractTruncated: (n) => `Only the first ${n.toLocaleString()} characters were analyzed — the file was longer.`,
    contractNotSaved: 'Analyzed once, not saved — this contract was not added to the knowledge base.',
  } : {
    clear: 'golește', newChatTitle: 'Conversație nouă',
    welcomeBody: 'Pune o întrebare despre documentele încărcate. Răspunsul e tradus automat, '
                + 'indiferent în ce limbă întrebi.',
    greetingCaption: 'Salut, sunt LIviu BRAdu!',
    greetingBody: 'Sunt aici să te ajut cu întrebări despre conturi, carduri, credite și dobânzi '
                + 'la Libra Bank. Ce vrei să afli?',
    guardrailFlag: '⚠ posibilă tentativă suspectă',
    piiRedacted: '🔒 date personale ascunse',
    piiTooltip: (kinds) => `Ascunse înainte ca modelul să le vadă: ${kinds}`,
    goodAnswer: 'Răspuns bun', notHelpful: 'Nu a ajutat',
    searchedUsing: 'căutare folosind:',
    retrievalTooltip: 'Întrebarea a fost tradusă în engleză doar pentru căutarea în documente — '
                      + 'răspunsul de mai sus a fost generat chiar din ce ai întrebat.',
    sources: (n) => `${n} pasaj${n > 1 ? 'e' : ''} găsit${n > 1 ? 'e' : ''}`,
    exactPrompt: 'promptul exact trimis',
    requestFailed: 'Cerere eșuată:',
    suggestHeading: 'ai vrut să scrii asta?', useThis: 'folosește asta', keepMine: 'păstrează ce am scris',
    placeholder: 'Întreabă Libra Assist…  (Enter pentru a trimite, Shift+Enter pentru rând nou)',
    send: 'Trimite',
    personaFallback: 'Specialistul Andrei în produse',
    addContract: '📄 Analizează un contract (PDF)', analyzingContract: 'LIviu BRAdu citește contractul…',
    contractType: 'tip document', contractParties: 'părți implicate', contractDuration: 'durată',
    contractAmounts: 'sume și taxe', contractObligations: 'obligații principale',
    contractPenalties: 'penalități / reziliere', contractWarnings: 'de reținut / atenție',
    contractTruncated: (n) => `S-au analizat doar primele ${n.toLocaleString('ro-RO')} caractere — fișierul era mai lung.`,
    contractNotSaved: 'Analizat o singură dată, nu s-a salvat — acest contract nu a fost adăugat în baza de cunoștințe.',
  }
}

// Turns the backend's guardrail report into one tooltip string, or null when clean.
// Flags are informational, not a block — the answer still went through — this is
// what tells you *why* it's worth a second look.
function describeGuardrails(g) {
  if (!g) return null
  const parts = []
  if (g.question_flags?.length) parts.push(`question: ${g.question_flags.join(', ')}`)
  for (const [index, flags] of Object.entries(g.context_flags || {})) {
    parts.push(`passage [${Number(index) + 1}]: ${flags.join(', ')}`)
  }
  return parts.length ? parts.join(' · ') : null
}

export default function Chat({ agents, hostedOnly = [], foundry, isAdmin = true, convo }) {
  const { conversations, activeId, setActiveId, active, updateActive, setMessages,
          startNew, deleteConversation, renameConversation, fileInputRef, importClick,
          importFile, importError } = convo
  const messages = active.messages
  const t = uiStrings(isAdmin)

  const [question, setQuestion] = useState('')
  const [agent, setAgent] = useState(() => (isAdmin ? 'default' : USER_DEFAULT_AGENT))
  const [useRag, setUseRag] = useState(true)
  const [mode, setMode] = useState(() => (isAdmin ? 'local' : USER_DEFAULT_MODE))
  const [topK, setTopK] = useState(6)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  // "Did you mean…" — a debounced call to the same chat model, asking it to clean
  // up whatever is currently in the box. Any keystroke invalidates the last
  // suggestion (it was made for different text), so it's cleared up front; the
  // sequence ref drops a response that arrives after the draft has moved on.
  const [suggestion, setSuggestion] = useState(null)
  const suggestSeq = useRef(0)
  useEffect(() => {
    setSuggestion(null)
    const draft = question.trim()
    if (draft.length < SUGGEST_MIN_CHARS || busy) return
    const seq = ++suggestSeq.current
    const timer = setTimeout(() => {
      api.suggest({ draft })
        .then((d) => { if (seq === suggestSeq.current && d.suggestion) setSuggestion(d.suggestion) })
        // Not worth an error banner over a background suggestion, but silent enough
        // otherwise that a broken backend/proxy would look identical to "no typo found".
        .catch((e) => console.warn('suggest() failed:', e.message))
    }, SUGGEST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [question, busy])

  function acceptSuggestion() {
    setQuestion(suggestion)
    setSuggestion(null)
  }

  // Thumbs up/down on a bot reply. Click the same one again to undo it — that
  // undo only removes the highlight locally; it does not retract the logged
  // entry, since the point is a record of what was submitted, not a live tally.
  function voteOn(index, rating) {
    const msg = messages[index]
    if (!msg || msg.role !== 'bot') return
    const nextVote = msg.vote === rating ? null : rating
    setMessages((ms) => ms.map((m, i) => (i === index ? { ...m, vote: nextVote } : m)))
    if (!nextVote) return
    const priorUser = messages.slice(0, index).reverse().find((m) => m.role === 'user')
    api.feedback({
      rating: nextVote,
      question: priorUser?.text || '',
      answer: msg.data.answer,
      agent: msg.data.agent?.name,
      mode: msg.data.agent?.mode,
      augmented: msg.data.augmented,
      model: msg.data.model,
    }).catch((e) => console.warn('feedback failed:', e.message))
  }

  // LIviu BRAdu's pose while a "user"-role, RAG-grounded question is in flight:
  // 'searching' (paging the book) for the wait, then a one-shot 'eureka' (raised
  // finger) once the answer lands, then gone — independent of `busy`, which
  // drops the instant the fetch resolves, well before the eureka beat should end.
  // The sequence ref exists only so a fast second question doesn't get its
  // "searching" pose cut short by a still-pending timeout from the previous one.
  const [tellerPhase, setTellerPhase] = useState(null)
  const tellerSeq = useRef(0)

  async function send() {
    const text = question.trim()
    if (!text || busy) return
    setQuestion(''); setError(null); setBusy(true)
    const seq = ++tellerSeq.current
    const showTeller = !isAdmin && useRag
    if (showTeller) setTellerPhase('searching')
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'bot')
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.role === 'user' ? m.text : m.data.answer }))
    if (messages.length === 0) updateActive((c) => ({ ...c, title: titleFrom(text) }))
    setMessages((m) => [...m, { role: 'user', text }])
    try {
      const data = await api.ask({ question: text, use_rag: useRag, top_k: Number(topK),
                                  agent, agent_mode: mode, history })
      setMessages((m) => [...m, { role: 'bot', data }])
      if (showTeller) {
        setTellerPhase('eureka')
        // matches the eureka GIF's own hold time (see teller-eureka.gif generation):
        // long enough to actually read the pose, not just glimpse it mid-motion.
        setTimeout(() => { if (seq === tellerSeq.current) setTellerPhase(null) }, 2000)
      }
    } catch (e) {
      setMessages((m) => [...m, { role: 'err', text: e.message }])
      setError(e.message)
      if (showTeller) setTellerPhase(null)
    } finally { setBusy(false) }
  }

  // Contract PDF upload — a one-shot analysis, not RAG: the result is shown as its
  // own message so it stays in this conversation's history like anything else, but
  // it's a 'contract' role, not 'user'/'bot', so the history filter in send() (above)
  // never feeds it back to the model. Nothing is sent to /ingest — see app/contracts.py.
  const contractInputRef = useRef(null)
  const [contractBusy, setContractBusy] = useState(false)

  async function handleContractFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''   // same file picked twice in a row must still fire onChange
    if (!file) return
    setContractBusy(true); setError(null)
    try {
      const data = await api.contractExtract(file)
      setMessages((m) => [...m, { role: 'contract', fileName: file.name, data }])
    } catch (err) {
      setMessages((m) => [...m, { role: 'err', text: err.message }])
      setError(err.message)
    } finally { setContractBusy(false) }
  }

  const all = [...agents, ...hostedOnly]
  const current = all.find((a) => a.name === agent)

  // Three states, not two. `available === false` is not "we don't know" — it is a
  // definite no: the Agent Service cannot be reached from here at all, whichever agent
  // you pick, because a key was used where Entra is required. Offering the lane anyway
  // is how you get a 503 in the chat window instead of a greyed-out option.
  const foundryReachable = foundry?.available                 // true | false | undefined
  const isHosted = current?.runs_on === 'both' || current?.runs_on === 'foundry'
  const localImpossible = current?.runs_on === 'foundry'      // no JSON file to run here
  const foundryBlocked =
    foundryReachable === false ||                             // no identity — nothing can
    (foundryReachable === true && !isHosted)                  // reachable, but not deployed
  const foundryWhy =
    foundryReachable === false
      ? (foundry?.reason || 'The Agent Service cannot be reached from here.')
      : 'Not deployed to Foundry — deploy it from the Agents view'

  // Keep the mode legal whenever the selected agent changes.
  useEffect(() => {
    if (foundryBlocked && mode === 'foundry') setMode('local')
    else if (localImpossible && mode !== 'foundry') setMode('foundry')
  }, [agent, localImpossible, foundryBlocked])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="chat-shell">
      {/* Non-admin users get this same list, but rendered in the app's own left rail
          instead — see App.jsx — since it's now the only thing there is to navigate. */}
      {isAdmin && (
        <aside className="chat-side">
          <ConversationList conversations={conversations} activeId={activeId} onSelect={setActiveId}
                            onNew={startNew} onImportClick={importClick} fileInputRef={fileInputRef}
                            onImportFile={importFile} onExport={exportConversation} onDelete={deleteConversation}
                            onRename={renameConversation} locale="en" />
        </aside>
      )}

      <div className="chat-wrap">
      <div className="chat-bar">
        {isAdmin ? (
          <>
            <select value={agent} onChange={(e) => setAgent(e.target.value)} title="Which persona answers">
              {agents.map((a) => <option key={a.name} value={a.name}>{a.display_name}</option>)}
              {hostedOnly.length > 0 && (
                <optgroup label="hosted in Foundry only">
                  {hostedOnly.map((a) => <option key={a.name} value={a.name}>{a.display_name}</option>)}
                </optgroup>
              )}
            </select>
            {current && <RunsOnBadge runsOn={current.runs_on} reason={foundry?.reason} />}
            <label className="check" style={{ margin: 0 }} title="Retrieve from your documents and ground the answer">
              <input type="checkbox" checked={useRag} onChange={(e) => setUseRag(e.target.checked)} />
              use RAG
            </label>
            <select value={mode} onChange={(e) => setMode(e.target.value)} style={{ minWidth: '9rem' }}
                    title="Where the loop executes">
              <option value="local" disabled={localImpossible}
                      title={localImpossible ? 'This agent has no local JSON file' : ''}>
                local agent
              </option>
              <option value="foundry" disabled={foundryBlocked} title={foundryBlocked ? foundryWhy : ''}>
                Foundry agent{foundryReachable === false ? ' — no identity'
                              : foundryBlocked ? ' — not deployed' : ''}
              </option>
            </select>
          </>
        ) : (
          <span className="badge" title={current?.description || t.personaFallback}>
            {current?.display_name || t.personaFallback}
          </span>
        )}
        <span className="badge muted" style={{ gap: '.35rem' }} title="Passages to retrieve">
          top-k
          <input type="number" min="1" max="10" value={topK} onChange={(e) => setTopK(e.target.value)}
                 style={{ width: '2.2rem', flex: '0 0 auto', background: 'transparent', border: 0,
                          padding: 0, textAlign: 'center', color: 'inherit', fontWeight: 700 }} />
        </span>
        {foundryReachable === false && (
          <span className="badge muted" title={foundryWhy}>
            hosted agents off — key auth
          </span>
        )}
        <button className="btn btn-outline btn-sm"
                onClick={() => updateActive((c) => ({ ...c, messages: [], title: t.newChatTitle }))}>
          {t.clear}
        </button>
        {current && <span className="badge muted" title={current.description}>temp {current.temperature ?? '—'}</span>}
      </div>

      <div className="msgs">
        {messages.length === 0 && (
          isAdmin ? (
            <div className="card" style={{ margin: 'auto', maxWidth: '46rem', textAlign: 'center' }}>
              <h3>Libra Assist</h3>
              <p className="muted" style={{ margin: 0 }}>{t.welcomeBody}</p>
            </div>
          ) : (
            // Every new/empty conversation opens on LIviu BRAdu introducing himself —
            // reuses the same page-flipping GIF as the mid-request "searching" pose
            // (he already has the book open), just with his own line instead of
            // "caută prin dosare…".
            <div className="card" style={{ margin: 'auto', maxWidth: '32rem', textAlign: 'center' }}>
              <LibraTeller phase="greeting" caption={t.greetingCaption} />
              <p className="muted" style={{ margin: '.6rem 0 0' }}>{t.greetingBody}</p>
            </div>
          )
        )}

        {messages.map((m, i) => {
          if (m.role === 'user') return <div className="msg user" key={i}>{m.text}</div>
          if (m.role === 'err') return <div className="msg err" key={i}><strong>{t.requestFailed}</strong> {m.text}</div>
          if (m.role === 'contract') {
            const c = m.data
            const rows = [
              [t.contractType, c.document_type],
              [t.contractParties, c.parties],
              [t.contractDuration, c.duration],
              [t.contractAmounts, c.amounts],
              [t.contractObligations, c.key_obligations],
              [t.contractPenalties, c.penalties],
              [t.contractWarnings, c.warnings],
            ]
            return (
              <div className="msg bot" key={i}>
                <strong>📄 {m.fileName}</strong>
                {rows.map(([label, value]) => {
                  if (!value || (Array.isArray(value) && value.length === 0)) return null
                  return (
                    <div key={label} style={{ marginTop: '.6rem' }}>
                      <div className="muted" style={{ fontSize: '.78rem', textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
                      {Array.isArray(value)
                        ? <ul style={{ margin: '.25rem 0 0', paddingLeft: '1.2rem' }}>
                            {value.map((v, j) => <li key={j}>{v}</li>)}
                          </ul>
                        : <div>{value}</div>}
                    </div>
                  )
                })}
                <div className="msg-meta">
                  <span className="badge muted">{t.contractNotSaved}</span>
                  {c.truncated && <span className="badge gold">{t.contractTruncated(c.chars_analyzed)}</span>}
                </div>
              </div>
            )
          }
          const d = m.data
          const guardrailHit = describeGuardrails(d.guardrails)
          return (
            <div className="msg bot" key={i}>
              {d.answer}
              <div className="msg-meta">
                <span className="badge">{d.agent?.display_name || 'agent'}</span>
                <span className={`badge ${d.augmented ? 'gold' : 'muted'}`}>{d.augmented ? 'grounded' : 'no retrieval'}</span>
                <span className="badge muted">{d.agent?.mode}</span>
                <span className="badge muted">{d.model}</span>
                {d.usage && <span className="badge muted">{d.usage.prompt_tokens} {d.usage.completion_tokens} tokens</span>}
                {guardrailHit && <span className="badge crimson" title={guardrailHit}>{t.guardrailFlag}</span>}
                {d.pii?.redacted?.length > 0 && (
                  <span className="badge crimson" title={t.piiTooltip(d.pii.redacted.join(', '))}>
                    {t.piiRedacted}
                  </span>
                )}
                <SpeakButton text={d.answer} />
                <span className="vote-group">
                  <button className={`vote-btn ${m.vote === 'up' ? 'vote-up-active' : ''}`}
                          title={t.goodAnswer} onClick={() => voteOn(i, 'up')}>👍</button>
                  <button className={`vote-btn ${m.vote === 'down' ? 'vote-down-active' : ''}`}
                          title={t.notHelpful} onClick={() => voteOn(i, 'down')}>👎</button>
                </span>
              </div>
              {d.retrieval_query && (
                <div className="muted" style={{ fontSize: '.78rem', marginTop: '.4rem' }}
                     title={t.retrievalTooltip}>
                  {t.searchedUsing} <em>{d.retrieval_query}</em>
                </div>
              )}
              {d.retrieved?.length > 0 && (
                <details className="sources">
                  <summary>{t.sources(d.retrieved.length)}</summary>
                  {d.retrieved.map((h, j) => (
                    <div className="src" key={h.id}>
                      <span className="score">[{j + 1}] score {h.score.toFixed(4)}</span>
                      <div>{h.text}</div>
                    </div>
                  ))}
                </details>
              )}
              <details className="sources">
                <summary>{t.exactPrompt}</summary>
                <pre className="out" style={{ marginTop: '.4rem' }}>{`SYSTEM:\n${d.system_prompt}\n\nUSER:\n${d.prompt_sent}`}</pre>
              </details>
            </div>
          )
        })}
        {(isAdmin || !useRag) && busy && <div className="msg bot"><span className="spin" /> thinking…</div>}
        <div ref={endRef} />
      </div>

      <Err error={error || importError} />
      {/* Once the greeting card is gone (first message sent), the searching/eureka
          indicator moves here — a small status line above the composer instead of
          taking over the middle of the screen on every request. */}
      {!isAdmin && tellerPhase && <LibraTeller phase={tellerPhase} compact />}
      {!isAdmin && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '.5rem' }}>
          <input type="file" accept="application/pdf" ref={contractInputRef}
                 onChange={handleContractFile} style={{ display: 'none' }} />
          <button className="btn btn-outline btn-sm" disabled={contractBusy}
                  onClick={() => contractInputRef.current?.click()}>
            {t.addContract}
          </button>
          {contractBusy && <span className="muted" style={{ fontSize: '.85rem' }}><span className="spin" /> {t.analyzingContract}</span>}
        </div>
      )}
      <div className="composer">
        {suggestion && (
          <div className="suggest-popup">
            <div className="suggest-text">
              <strong>{t.suggestHeading}</strong>
              {suggestion}
            </div>
            <div className="suggest-actions">
              <button className="btn btn-primary btn-sm" onClick={acceptSuggestion}>{t.useThis}</button>
              <button className="btn btn-outline btn-sm" onClick={() => setSuggestion(null)}>{t.keepMine}</button>
            </div>
          </div>
        )}
        <textarea value={question} placeholder={t.placeholder}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        <MicButton onText={(spoken) => setQuestion((q) => (q ? `${q} ${spoken}` : spoken))} disabled={busy} />
        <button className="btn btn-primary" onClick={send} disabled={busy || !question.trim()}>{t.send}</button>
      </div>
      </div>
    </div>
  )
}
