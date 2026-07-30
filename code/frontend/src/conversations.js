import { useCallback, useEffect, useRef, useState } from 'react'

// Saved chats live in localStorage — this is a single-user console with no
// backend session store, so the browser is the only place to keep them.
const CONVERSATIONS_KEY = 'libra-assist-conversations'
const ACTIVE_KEY = 'libra-assist-active-conversation'

export function loadConversations() {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveConversations(conversations) {
  try { localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations)) } catch { /* storage full/unavailable */ }
}

export function loadActiveId() {
  try { return localStorage.getItem(ACTIVE_KEY) } catch { return null }
}

export function saveActiveId(id) {
  try { localStorage.setItem(ACTIVE_KEY, id) } catch { /* storage full/unavailable */ }
}

function makeId() {
  return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `c${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function newConversation() {
  return { id: makeId(), title: 'New chat', createdAt: Date.now(), messages: [] }
}

export function titleFrom(text) {
  const clean = text.trim().replace(/\s+/g, ' ')
  if (!clean) return 'New chat'
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean
}

function slugify(text) {
  const clean = (text || 'conversation').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return clean || 'conversation'
}

/** Downloads one conversation as a standalone JSON file — title, timestamp and
 * the exact message list, round-trippable back through readConversationFile. */
export function exportConversation(conv) {
  const payload = { title: conv.title, createdAt: conv.createdAt, messages: conv.messages }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const date = new Date(conv.createdAt).toISOString().slice(0, 10)
  const a = document.createElement('a')
  a.href = url
  a.download = `${slugify(conv.title)}-${date}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Reads a File (from an <input type=file>) back into a conversation object.
 * Rejects with a human-readable message on anything that isn't one of ours. */
export function readConversationFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        if (!Array.isArray(parsed.messages)) throw new Error('missing a "messages" array')
        resolve({
          id: makeId(),
          title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : 'Imported chat',
          createdAt: Date.now(),
          messages: parsed.messages,
        })
      } catch (e) {
        reject(new Error(`"${file.name}" is not a valid conversation export (${e.message})`))
      }
    }
    reader.readAsText(file)
  })
}

/** All chat-history state and its CRUD, in one hook. The list needs to render in two
 * different places depending on role — inside the Chat view for admins, in the app's
 * own left rail for the single-agent "user" role — so the state has to live above
 * both, in whichever component calls this hook once, and get passed down from there. */
export function useConversationManager() {
  const [conversations, setConversations] = useState(() => {
    const loaded = loadConversations()
    return loaded.length ? loaded : [newConversation()]
  })
  const [activeId, setActiveId] = useState(() => {
    const saved = loadActiveId()
    return saved && conversations.some((c) => c.id === saved) ? saved : conversations[0].id
  })

  useEffect(() => { saveConversations(conversations) }, [conversations])
  useEffect(() => { saveActiveId(activeId) }, [activeId])

  const active = conversations.find((c) => c.id === activeId) || conversations[0]

  const updateActive = useCallback((updater) => {
    setConversations((cs) => cs.map((c) => (c.id === activeId ? updater(c) : c)))
  }, [activeId])

  const setMessages = useCallback((next) => {
    updateActive((c) => ({ ...c, messages: typeof next === 'function' ? next(c.messages) : next }))
  }, [updateActive])

  const startNew = useCallback(() => {
    const conv = newConversation()
    setConversations((cs) => [conv, ...cs])
    setActiveId(conv.id)
  }, [])

  const deleteConversation = useCallback((id) => {
    setConversations((cs) => {
      const rest = cs.filter((c) => c.id !== id)
      const next = rest.length ? rest : [newConversation()]
      setActiveId((cur) => (id === cur ? next[0].id : cur))
      return next
    })
  }, [])

  const fileInputRef = useRef(null)
  const importClick = useCallback(() => fileInputRef.current?.click(), [])
  const [importError, setImportError] = useState(null)
  const importFile = useCallback(async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''   // lets the same filename be re-imported later
    if (!file) return
    try {
      const conv = await readConversationFile(file)
      setConversations((cs) => [conv, ...cs])
      setActiveId(conv.id)
      setImportError(null)
    } catch (err) {
      setImportError(err.message)
    }
  }, [])

  return {
    conversations, activeId, setActiveId, active,
    updateActive, setMessages, startNew, deleteConversation,
    fileInputRef, importClick, importFile, importError,
  }
}
