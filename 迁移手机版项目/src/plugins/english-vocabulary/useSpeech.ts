export function useVocabularySpeech() {
  let activeAudio: HTMLAudioElement | null = null

  function stop() {
    activeAudio?.pause()
    activeAudio = null
    window.speechSynthesis?.cancel()
  }

  async function speak(word: string, audioUrl?: string | null) {
    stop()
    if (audioUrl) {
      activeAudio = new Audio(audioUrl)
      try {
        await activeAudio.play()
        return
      } catch {
        activeAudio = null
      }
    }

    if (!('speechSynthesis' in window)) throw new Error('当前系统没有可用的英语语音')
    const utterance = new SpeechSynthesisUtterance(word)
    const voices = window.speechSynthesis.getVoices()
    utterance.voice =
      voices.find((voice) => /^en-(US|GB)/i.test(voice.lang)) ||
      voices.find((voice) => /^en/i.test(voice.lang)) ||
      null
    utterance.lang = utterance.voice?.lang || 'en-US'
    utterance.rate = 0.86
    window.speechSynthesis.speak(utterance)
  }

  return { speak, stop }
}
