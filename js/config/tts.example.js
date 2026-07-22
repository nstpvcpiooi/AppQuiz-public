/**
 * Sao chép file này thành `tts.config.js` và điền key của bạn.
 *
 * Merriam-Webster Dictionary API:
 *   https://dictionaryapi.com/
 *
 * Azure Speech:
 *   Azure Portal → Speech → Keys and Endpoint
 *
 * Giọng Azure gợi ý: en-US-JennyNeural, en-US-GuyNeural, en-GB-SoniaNeural
 */
export const API_CONFIG = {
    merriamWebster: {
        learnersKey: 'YOUR_MW_LEARNERS_KEY',
        collegiateKey: 'YOUR_MW_COLLEGIATE_KEY'
    },

    azure: {
        subscriptionKey: 'YOUR_AZURE_SPEECH_KEY_1',
        subscriptionKeyAlt: 'YOUR_AZURE_SPEECH_KEY_2',
        region: 'southeastasia',
        voice: 'en-US-JennyNeural'
    },

    ttsOrder: ['azure', 'merriamWebster']
};
