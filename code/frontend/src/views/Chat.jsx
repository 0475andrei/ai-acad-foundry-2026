import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { ConversationList, Err, RunsOnBadge, SpeakButton, MicButton } from '../components'
import { titleFrom, exportConversation } from '../conversations'

// The "simple user" role always talks to the same persona over the same lane, so
// there is nothing for them to pick — these are the fixed defaults for that role.
const USER_DEFAULT_AGENT = 'andrei-dobrin-agent'
const USER_DEFAULT_MODE = 'foundry'

export default function Chat({ agents, hostedOnly = [], foundry, isAdmin = true, convo }) {
  const { conversations, activeId, setActiveId, active, updateActive, setMessages,
          startNew, deleteConversation, fileInputRef, importClick, importFile, importError } = convo
  const messages = active.messages

  const [question, setQuestion] = useState('')
  const [agent, setAgent] = useState(() => (isAdmin ? 'default' : USER_DEFAULT_AGENT))
  const [useRag, setUseRag] = useState(true)
  const [mode, setMode] = useState(() => (isAdmin ? 'local' : USER_DEFAULT_MODE))
  const [topK, setTopK] = useState(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  async function send() {
    const text = question.trim()
    if (!text || busy) return
    setQuestion(''); setError(null); setBusy(true)
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'bot')
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.role === 'user' ? m.text : m.data.answer }))
    if (messages.length === 0) updateActive((c) => ({ ...c, title: titleFrom(text) }))
    setMessages((m) => [...m, { role: 'user', text }])
    try {
      const data = await api.ask({ question: text, use_rag: useRag, top_k: Number(topK),
                                  agent, agent_mode: mode, history })
      setMessages((m) => [...m, { role: 'bot', data }])
    } catch (e) {
      setMessages((m) => [...m, { role: 'err', text: e.message }])
      setError(e.message)
    } finally { setBusy(false) }
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
                            onImportFile={importFile} onExport={exportConversation} onDelete={deleteConversation} />
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
          <span className="badge" title={current?.description || 'Andrei’s Product Specialist'}>
            {current?.display_name || 'Andrei’s Product Specialist'}
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
                onClick={() => updateActive((c) => ({ ...c, messages: [], title: 'New chat' }))}>
          clear
        </button>
        {current && <span className="badge muted" title={current.description}>temp {current.temperature ?? '—'}</span>}
      </div>

      <div className="msgs">
        {messages.length === 0 && (
          <div className="card" style={{ margin: 'auto', maxWidth: '46rem', textAlign: 'center' }}>
            <h3>Libra Assist</h3>
            <p className="muted" style={{ margin: 0 }}>
              Ask a question about the documents you have ingested. Switch the persona to change how
              it answers, or turn RAG off to see the model answer without grounding.
            </p>
          </div>
        )}

        {messages.map((m, i) => {
          if (m.role === 'user') return <div className="msg user" key={i}>{m.text}</div>
          if (m.role === 'err') return <div className="msg err" key={i}><strong>Request failed:</strong> {m.text}</div>
          const d = m.data
          return (
            <div className="msg bot" key={i}>
              {d.answer}
              <div className="msg-meta">
                <span className="badge">{d.agent?.display_name || 'agent'}</span>
                <span className={`badge ${d.augmented ? 'gold' : 'muted'}`}>{d.augmented ? 'grounded' : 'no retrieval'}</span>
                <span className="badge muted">{d.agent?.mode}</span>
                <span className="badge muted">{d.model}</span>
                {d.usage && <span className="badge muted">{d.usage.prompt_tokens} {d.usage.completion_tokens} tokens</span>}
                <SpeakButton text={d.answer} />
              </div>
              {d.retrieved?.length > 0 && (
                <details className="sources">
                  <summary>{d.retrieved.length} retrieved passage{d.retrieved.length > 1 ? 's' : ''}</summary>
                  {d.retrieved.map((h, j) => (
                    <div className="src" key={h.id}>
                      <span className="score">[{j + 1}] score {h.score.toFixed(4)}</span>
                      <div>{h.text}</div>
                    </div>
                  ))}
                </details>
              )}
              <details className="sources">
                <summary>the exact prompt that was sent</summary>
                <pre className="out" style={{ marginTop: '.4rem' }}>{`SYSTEM:\n${d.system_prompt}\n\nUSER:\n${d.prompt_sent}`}</pre>
              </details>
            </div>
          )
        })}
        {busy && <div className="msg bot"><span className="spin" /> thinking…</div>}
        <div ref={endRef} />
      </div>

      <Err error={error || importError} />
      <div className="composer">
        <textarea value={question} placeholder={"Ask Libra Assist\u2026  (Enter to send, Shift+Enter for a new line)"}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        <MicButton onText={(t) => setQuestion((q) => (q ? `${q} ${t}` : t))} disabled={busy} />
        <button className="btn btn-primary" onClick={send} disabled={busy || !question.trim()}>Send</button>
      </div>
      </div>
    </div>
  )
}
