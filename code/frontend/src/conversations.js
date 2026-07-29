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
