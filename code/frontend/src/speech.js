// Browser-side helper for the microphone -> transcribe round trip.
//
// MediaRecorder normally produces webm/opus, but Azure's short-audio speech
// recognition endpoint expects 16 kHz mono PCM WAV. So we record with
// MediaRecorder, decode the result with the Web Audio API, resample/downmix
// it to 16 kHz mono via an OfflineAudioContext, and hand-encode a WAV header
// â€” no extra dependency needed for a browser feature this small.

export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const recorder = new MediaRecorder(stream)
  const chunks = []
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }

  const stopped = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
  })
  recorder.start()

  return {
    // Call to end the clip. Resolves with a ready-to-send audio/wav Blob.
    stop: async () => {
      recorder.stop()
      stream.getTracks().forEach((t) => t.stop())
      const recordedBlob = await stopped
      return toWav16kMono(recordedBlob)
    },
  }
}

async function toWav16kMono(blob) {
  const arrayBuffer = await blob.arrayBuffer()
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  const decodeCtx = new AudioCtx()
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer)
  decodeCtx.close?.()

  const targetRate = 16000
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate) || 1, targetRate)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)   // stereo -> mono downmix happens automatically here
  source.start(0)
  const rendered = await offline.startRendering()

  return encodeWav(rendered.getChannelData(0), targetRate)
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)          // fmt chunk size
  view.setUint16(20, 1, true)           // PCM
  view.setUint16(22, 1, true)           // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)   // byte rate (16-bit mono)
  view.setUint16(32, 2, true)           // block align
  view.setUint16(34, 16, true)          // bits per sample
  writeString(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}
