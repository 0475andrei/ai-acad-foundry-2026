import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { ConversationList, Logo } from './components'
import { exportConversation, useConversationManager } from './conversations'
import { loadSession, logout } from './auth'
import Login from './views/Login'
import Agents from './views/Agents'
import Chat from './views/Chat'
import Knowledge from './views/Knowledge'
import Search from './views/Search'
import Status from './views/Status'
import Tools from './views/Tools'

// admin sees everything; the "simple user" role only ever gets Chat.
const VIEWS = [
  { id: 'chat', label: 'Chat', group: 'Assistant' },
  { id: 'knowledge', label: 'Knowledge', group: 'Pipeline', adminOnly: true },
  { id: 'search', label: 'Retrieval', group: 'Pipeline', adminOnly: true },
  { id: 'agents', label: 'Agents', group: 'Platform', adminOnly: true },
  { id: 'tools', label: 'Tools', group: 'Platform', adminOnly: true },
  { id: 'status', label: 'Status', group: 'Platform', adminOnly: true },
]

export default function App() {
  const [session, setSession] = useState(() => loadSession())
  const [view, setView] = useState('chat')
  const [agents, setAgents] = useState([])
  const [hostedOnly, setHostedOnly] = useState([])
  const [foundry, setFoundry] = useState(null)
  const [health, setHealth] = useState(null)
  const [azure, setAzure] = useState(null)
  const [theme, setTheme] = useState('dark')
  const convo = useConversationManager()

  const loadAgents = useCallback(() => {
    api.agents()
      .then((d) => { setAgents(d.personas || []); setHostedOnly(d.hosted_only || []); setFoundry(d.foundry) })
      .catch(() => { setAgents([]); setHostedOnly([]); setFoundry(null) })
  }, [])
  const loadHealth = useCallback(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
  }, [])
  const loadAzure = useCallback(() => {
    api.azure().then(setAzure).catch(() => setAzure(null))
  }, [])

  useEffect(() => { loadAgents(); loadHealth(); loadAzure() }, [loadAgents, loadHealth, loadAzure])
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])

  const isAdmin = session?.role === 'admin'
  const visibleViews = VIEWS.filter((v) => isAdmin || !v.adminOnly)
  const groups = [...new Set(visibleViews.map((v) => v.group))]
  const online = health?.status === 'ok'

  if (!session) return <Login onSignIn={setSession} />

  function signOut() {
    logout()
    setSession(null)
    setView('chat')
  }

  return (
    <div className="app">
      <aside className="side">
        <p className="brand"><Logo /><span>Libra Assist<small>console</small></span></p>
        {/* A "simple user" only ever has Chat, so the nav list would show one dead
            button. Drop it and show the chat history right here instead — one
            left-hand list, not a "Chat" button stacked on top of a second sidebar. */}
        {isAdmin && groups.map((g) => (
          <div key={g}>
            <div className="nav-group">{g}</div>
            {visibleViews.filter((v) => v.group === g).map((v) => (
              <button key={v.id} className={`nav-item ${view === v.id ? 'active' : ''}`} onClick={() => setView(v.id)}>
                <span className="dot" />{v.label}
              </button>
            ))}
          </div>
        ))}
        {!isAdmin && (
          <div className="side-history">
            <ConversationList conversations={convo.conversations} activeId={convo.activeId}
                              onSelect={convo.setActiveId} onNew={convo.startNew}
                              onImportClick={convo.importClick} fileInputRef={convo.fileInputRef}
                              onImportFile={convo.importFile} onExport={exportConversation}
                              onDelete={convo.deleteConversation} onRename={convo.renameConversation}
                              locale="ro" />
          </div>
        )}
        <div className="side-foot">
          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.4rem' }}>
            <span className="dot" style={{ width: 7, height: 7, borderRadius: '50%',
              background: online ? 'var(--c-cyan)' : 'var(--c-crimson)', display: 'inline-block' }} />
            {online ? `${health.llm.provider} · ${health.llm.model}` : 'backend offline'}
          </div>
          {azure?.configured && (
            <div style={{ marginBottom: '.5rem' }} title={azure.auth === 'identity'
              ? 'Signed in with Microsoft Entra — the Agent Service and control plane are available'
              : 'Key authentication — the Agent Service and control plane cannot be queried'}>
              <span className={`badge ${azure.auth === 'identity' ? '' : 'gold'}`}>
                {azure.auth === 'identity' ? 'Entra identity' : 'key auth'}
              </span>
            </div>
          )}
          <div style={{ marginBottom: '.5rem' }}>
            <span className="badge muted">{session.username} · {session.role}</span>
          </div>
          <div style={{ display: 'flex', gap: '.4rem' }}>
            <button className="btn btn-outline btn-sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              ◐ {isAdmin
                ? (theme === 'dark' ? 'light' : 'dark')
                : (theme === 'dark' ? 'luminos' : 'întunecat')}
            </button>
            <button className="btn btn-outline btn-sm" onClick={signOut}>{isAdmin ? 'sign out' : 'ieși din cont'}</button>
          </div>
        </div>
      </aside>

      <main className="main">
        {/* Chat stays mounted even off-screen, not conditionally rendered like the other
            views: unmounting it mid-request would drop the answer when it comes back,
            since the setState that attaches it would land on an instance that's gone. */}
        <div style={{ display: view === 'chat' ? 'contents' : 'none' }}>
          <Chat agents={agents} hostedOnly={hostedOnly} foundry={foundry} isAdmin={isAdmin} convo={convo} />
        </div>
        {isAdmin && view === 'knowledge' && <Knowledge />}
        {isAdmin && view === 'search' && <Search />}
        {isAdmin && view === 'agents' && <Agents agents={agents} hostedOnly={hostedOnly} foundry={foundry}
                                                  reload={loadAgents} azure={azure} />}
        {isAdmin && view === 'tools' && <Tools />}
        {isAdmin && view === 'status' && <Status health={health} reload={loadHealth}
                                                  azure={azure} reloadAzure={loadAzure} />}
      </main>
    </div>
  )
}
