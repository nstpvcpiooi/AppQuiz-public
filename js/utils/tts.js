export const tts = {
    speak: (text, onEnd = () => {}) => {
        if (!('speechSynthesis' in window)) {
            onEnd();
            return;
        }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        const voices = window.speechSynthesis.getVoices();
        let engVoice = voices.find(v => v.lang === 'en-US' && v.name.includes('Google'))
                    || voices.find(v => v.lang === 'en-US' && v.name.includes('Samantha'))
                    || voices.find(v => v.lang.startsWith('en-'));
        if (engVoice) utterance.voice = engVoice;
        utterance.onend = onEnd;
        utterance.onerror = onEnd;
        window.speechSynthesis.speak(utterance);
    }
};
