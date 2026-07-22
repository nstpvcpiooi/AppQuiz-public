import { lookupWord, probePronunciations, suggestWords } from './dictionary-api.js';
import state from './state.js';
import { dom, escapeHtml, initCustomSelect } from './utils.js';

const DICT_LAST_QUERY_KEY = 'elearn_dict_last_query';
const DICT_SUBTAB_KEY = 'elearn_dict_subtab';
const DICT_HISTORY_MAX = 20;

const SUGGEST_DEBOUNCE_MS = 220;
const SUGGEST_MIN_CHARS = 2;
const DICT_EXAMPLES_VISIBLE = 2;

export function initDictionary(elements) {
    let currentResult = null;
    let activeDictKey = 'enVi';
    let audioPlayer = null;
    let soundUrls = { uk: null, us: null };
    let probedSoundWord = null;
    let pronunciationRequestId = 0;
    let suggestTimer = null;
    let suggestRequestId = 0;
    let activeSuggestIndex = -1;
    let currentSuggestions = [];
    let currentViewState = 'empty';
    const dictTypeCustom = initCustomSelect(elements.dictTypeSelect);

    function getStoredSubtab() {
        const stored = sessionStorage.getItem(DICT_SUBTAB_KEY);
        if (stored === 'enEn' || stored === 'enSyn') return stored;
        return 'enVi';
    }

    function setActiveSubtab(dictKey) {
        activeDictKey = dictKey === 'enEn' || dictKey === 'enSyn' ? dictKey : 'enVi';
        sessionStorage.setItem(DICT_SUBTAB_KEY, activeDictKey);
        if (elements.dictTypeSelect) {
            elements.dictTypeSelect.value = activeDictKey;
            dictTypeCustom?.sync();
        }
        renderSenses();
    }

    function getHistoryStorageKey() {
        const user = String(state.user.current || 'guest').trim().toLowerCase() || 'guest';
        return `elearn_dict_history_${user}`;
    }

    function loadHistory() {
        try {
            const raw = localStorage.getItem(getHistoryStorageKey());
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    function saveHistory(items) {
        try {
            localStorage.setItem(getHistoryStorageKey(), JSON.stringify(items));
        } catch (err) {
            console.error('Dictionary history save error:', err);
        }
    }

    function formatHistoryTime(timestamp) {
        const diffMs = Date.now() - timestamp;
        const minutes = Math.floor(diffMs / 60000);
        if (minutes < 1) return 'Vừa xong';
        if (minutes < 60) return `${minutes} phút trước`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours} giờ trước`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `${days} ngày trước`;
        return new Date(timestamp).toLocaleDateString('vi-VN', {
            day: 'numeric',
            month: 'short'
        });
    }

    function addToHistory(result) {
        if (!result?.found) return;
        const word = String(result.word || result.query || '').trim();
        if (!word) return;

        const phonetic = result.dictionaries?.enVi?.phonetic
            || result.dictionaries?.enEn?.phonetic
            || null;
        const items = loadHistory().filter((item) => (
            String(item.word || '').trim().toLowerCase() !== word.toLowerCase()
        ));
        items.unshift({
            word,
            query: String(result.query || word).trim(),
            phonetic,
            lookedUpAt: Date.now()
        });
        saveHistory(items.slice(0, DICT_HISTORY_MAX));
    }

    function hideGuide() {
        dom.hide(elements.dictGuide);
        if (elements.dictGuide) elements.dictGuide.hidden = true;
    }

    function showGuide() {
        dom.show(elements.dictGuide);
        if (elements.dictGuide) elements.dictGuide.hidden = false;
    }

    function hideHistory() {
        dom.hide(elements.dictHistory);
        if (elements.dictHistory) elements.dictHistory.hidden = true;
    }

    function renderHistory() {
        if (!elements.dictHistoryList) return false;
        const items = loadHistory();
        if (!items.length) {
            dom.setHTML(elements.dictHistoryList, '');
            hideHistory();
            return false;
        }

        const html = items.map((item) => {
            const phonetic = item.phonetic
                ? `<span class="student-dict-history-phonetic">${escapeHtml(item.phonetic)}</span>`
                : '';
            return `
                <li role="listitem">
                    <button type="button" class="student-dict-history-item" data-dict-word="${escapeHtml(item.word)}">
                        <span class="student-dict-history-main">
                            <span class="student-dict-history-word">${escapeHtml(item.word)}</span>
                            ${phonetic}
                        </span>
                        <span class="student-dict-history-time">${escapeHtml(formatHistoryTime(item.lookedUpAt))}</span>
                    </button>
                </li>
            `;
        }).join('');

        dom.setHTML(elements.dictHistoryList, html);
        hideGuide();
        dom.show(elements.dictHistory);
        if (elements.dictHistory) elements.dictHistory.hidden = false;
        return true;
    }

    function syncBelowSearchPanel(viewState) {
        const showPanel = viewState === 'empty' || viewState === 'error';
        if (!showPanel) {
            hideGuide();
            hideHistory();
            return;
        }

        if (renderHistory()) return;

        hideHistory();
        showGuide();
    }

    function clearHistory() {
        saveHistory([]);
        dom.setHTML(elements.dictHistoryList, '');
        syncBelowSearchPanel(currentViewState);
    }

    function setViewState(viewState) {
        currentViewState = viewState;
        dom.hide(elements.dictLoader);
        dom.hide(elements.dictError);
        dom.hide(elements.dictResult);

        if (viewState === 'loading') dom.show(elements.dictLoader);
        else if (viewState === 'error') dom.show(elements.dictError);
        else if (viewState === 'result') dom.show(elements.dictResult);

        syncBelowSearchPanel(viewState);
    }

    function hideSuggestions() {
        activeSuggestIndex = -1;
        currentSuggestions = [];
        if (elements.dictSuggestions) {
            dom.hide(elements.dictSuggestions);
            elements.dictSuggestions.hidden = true;
        }
        if (elements.dictSuggestionsList) {
            dom.setHTML(elements.dictSuggestionsList, '');
        }
    }

    function highlightSuggestWord(word, query) {
        const lowerWord = word.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const index = lowerWord.indexOf(lowerQuery);
        if (index < 0) return escapeHtml(word);
        const before = word.slice(0, index);
        const match = word.slice(index, index + query.length);
        const after = word.slice(index + query.length);
        return `${escapeHtml(before)}<mark class="student-dict-suggest-mark">${escapeHtml(match)}</mark>${escapeHtml(after)}`;
    }

    function renderSuggestions(suggestions, query) {
        if (!elements.dictSuggestions || !elements.dictSuggestionsList) return;
        if (!suggestions?.length) {
            hideSuggestions();
            return;
        }

        currentSuggestions = suggestions;
        const html = suggestions.map((item, index) => {
            const phonetic = item.phonetic
                ? `<span class="student-dict-suggest-phonetic">${escapeHtml(item.phonetic)}</span>`
                : '';
            const hint = item.hint
                ? `<span class="student-dict-suggest-hint">${escapeHtml(item.hint)}</span>`
                : '';
            return `
                <li role="presentation">
                    <button type="button" class="student-dict-suggest-item${index === activeSuggestIndex ? ' is-active' : ''}" role="option" aria-selected="${index === activeSuggestIndex ? 'true' : 'false'}" data-suggest-index="${index}" data-suggest-word="${escapeHtml(item.word)}">
                        <span class="student-dict-suggest-main">
                            <span class="student-dict-suggest-word">${highlightSuggestWord(item.word, query)}</span>
                            ${hint}
                        </span>
                        ${phonetic}
                    </button>
                </li>
            `;
        }).join('');

        dom.setHTML(elements.dictSuggestionsList, html);
        dom.show(elements.dictSuggestions);
        elements.dictSuggestions.hidden = false;
    }

    async function fetchSuggestions(rawQuery) {
        const query = String(rawQuery || '').trim();
        if (query.length < SUGGEST_MIN_CHARS) {
            hideSuggestions();
            return;
        }

        const requestId = ++suggestRequestId;
        try {
            const result = await suggestWords(query, activeDictKey);
            if (requestId !== suggestRequestId) return;
            activeSuggestIndex = -1;
            renderSuggestions(result?.suggestions || [], query);
        } catch (err) {
            if (requestId !== suggestRequestId) return;
            console.error('Dictionary suggest error:', err);
            hideSuggestions();
        }
    }

    function scheduleSuggestions(rawQuery) {
        clearTimeout(suggestTimer);
        const query = String(rawQuery || '').trim();
        if (query.length < SUGGEST_MIN_CHARS) {
            hideSuggestions();
            return;
        }
        suggestTimer = setTimeout(() => fetchSuggestions(query), SUGGEST_DEBOUNCE_MS);
    }

    function updateSearchClearVisibility() {
        const hasValue = Boolean(elements.dictSearch?.value?.trim());
        if (!elements.dictSearchClear) return;
        if (hasValue) {
            dom.show(elements.dictSearchClear);
            elements.dictSearchClear.hidden = false;
        } else {
            dom.hide(elements.dictSearchClear);
            elements.dictSearchClear.hidden = true;
        }
    }

    function renderDictExampleItem(ex, index) {
        const english = typeof ex === 'string' ? ex : (ex.english || '');
        const vietnamese = typeof ex === 'string' ? '' : (ex.vietnamese || '');
        if (!english && !vietnamese) return '';

        const isExtra = index >= DICT_EXAMPLES_VISIBLE;
        let html = `<div class="student-dict-example-item${isExtra ? ' student-dict-example-item--extra' : ''}">`;
        if (english) {
            html += `<p class="student-dict-example">${escapeHtml(english)}</p>`;
        }
        if (vietnamese) {
            html += `<p class="student-dict-translation">${escapeHtml(vietnamese)}</p>`;
        }
        html += '</div>';
        return html;
    }

    function renderDictExamples(examples = [], { plain = false } = {}) {
        const validExamples = (examples || []).filter((ex) => {
            const english = typeof ex === 'string' ? ex : (ex.english || '');
            const vietnamese = typeof ex === 'string' ? '' : (ex.vietnamese || '');
            return Boolean(english || vietnamese);
        });
        if (!validExamples.length) return '';

        const items = validExamples
            .map((ex, index) => renderDictExampleItem(ex, index))
            .join('');
        const hasHidden = validExamples.length > DICT_EXAMPLES_VISIBLE;
        const toggle = hasHidden
            ? `
                <button type="button" class="student-dict-examples-toggle" aria-expanded="false">
                    <span class="student-dict-examples-toggle-text">Xem thêm</span>
                    <i class="fas fa-chevron-down student-dict-examples-toggle-icon" aria-hidden="true"></i>
                </button>
            `
            : '';
        const content = plain ? items : `<div class="student-dict-examples-card">${items}</div>`;

        return `
            <div class="student-dict-examples${plain ? ' student-dict-examples--plain' : ''}">
                ${content}
                ${toggle}
            </div>
        `;
    }

    function renderDictNoteIcons(notes = []) {
        if (!notes?.length) return '';
        const content = notes.map((note) => escapeHtml(note)).join('<br>');
        return `
            <span class="student-dict-note-tip" tabindex="0" aria-label="Ghi chú">
                <i class="fas fa-circle-info student-dict-note-icon" aria-hidden="true"></i>
                <span class="student-dict-note-tooltip" role="tooltip">${content}</span>
            </span>
        `;
    }

    function renderDefinitionItem(item, number) {
        const defContent = item.definition
            ? `
                <div class="student-dict-def-line">
                    <span class="student-dict-def-num" aria-hidden="true">${number}</span>
                    <p class="student-dict-sense-def">${escapeHtml(item.definition)}${renderDictNoteIcons(item.notes)}</p>
                </div>
            `
            : renderDictNoteIcons(item.notes);

        return `
            <div class="student-dict-sense-item student-dict-sense-item--definition">
                ${defContent}
                ${renderDictExamples(item.examples)}
            </div>
        `;
    }

    function renderSynonymItem(item) {
        const context = item.context
            ? `<p class="student-dict-synonym-context">${escapeHtml(item.context)}</p>`
            : '';
        const links = (item.synonyms || []).map((word) => `
            <button type="button" class="student-dict-synonym-link" data-dict-word="${escapeHtml(word)}">${escapeHtml(word)}</button>
        `).join('');

        return `
            <div class="student-dict-sense-item student-dict-sense-item--synonym">
                ${context}
                <div class="student-dict-synonym-list">${links}</div>
            </div>
        `;
    }

    function renderPhraseItem(item) {
        const seeAlso = item.seeAlso?.word
            ? `
                <p class="student-dict-see-also">
                    <button type="button" class="student-dict-see-also-link" data-dict-word="${escapeHtml(item.seeAlso.word)}">
                        <span class="student-dict-see-also-label">Xem thêm</span>
                        <span class="student-dict-see-also-word">${escapeHtml(item.seeAlso.word)}</span>
                        <i class="fas fa-arrow-right student-dict-see-also-arrow" aria-hidden="true"></i>
                    </button>
                </p>
            `
            : '';
        const meanings = (item.meanings || []).map((meaning) => `
            <div class="student-dict-phrase-meaning">
                ${meaning.definition || meaning.notes?.length
                    ? `
                        <div class="student-dict-phrase-def-line">
                            <span class="student-dict-phrase-bullet" aria-hidden="true"></span>
                            <p class="student-dict-phrase-def">${meaning.definition ? escapeHtml(meaning.definition) : ''}${renderDictNoteIcons(meaning.notes)}</p>
                        </div>
                    `
                    : ''}
                ${renderDictExamples(meaning.examples, { plain: true })}
            </div>
        `).join('');
        const hasBody = Boolean(seeAlso || meanings);
        const chevron = hasBody
            ? '<i class="fas fa-chevron-down student-dict-phrase-chevron" aria-hidden="true"></i>'
            : '';
        const header = item.phrase
            ? `
                <button type="button" class="student-dict-phrase-header" aria-expanded="false">
                    <span class="student-dict-phrase-label">
                        <span class="student-dict-phrase-text">${escapeHtml(item.phrase)}</span>
                        ${renderDictNoteIcons(item.notes)}
                    </span>
                    ${chevron ? `<span class="student-dict-phrase-header-end">${chevron}</span>` : ''}
                </button>
            `
            : renderDictNoteIcons(item.notes);
        const body = hasBody
            ? `<div class="student-dict-phrase-body">${seeAlso}${meanings}</div>`
            : '';

        return `
            <div class="student-dict-sense-item student-dict-sense-item--phrase">
                <div class="student-dict-phrase-card">
                    ${header}
                    ${body}
                </div>
            </div>
        `;
    }

    function getSensePosModifier(partOfSpeech = '') {
        const normalized = String(partOfSpeech).toLowerCase().trim();
        if (normalized.includes('danh từ') || normalized === 'noun' || normalized === 'n') {
            return 'noun';
        }
        if (normalized.includes('động từ') || normalized === 'verb' || normalized === 'v') {
            return 'verb';
        }
        if (normalized.includes('tính từ') || normalized === 'adjective' || normalized === 'adj') {
            return 'adj';
        }
        return 'other';
    }

    function renderSenseItems(senses, dictKey = activeDictKey) {
        if (!senses?.length) {
            const message = dictKey === 'enSyn'
                ? 'Chưa có đồng nghĩa cho từ này.'
                : 'Chưa có nghĩa trong từ điển này.';
            return `<p class="student-dict-no-senses">${message}</p>`;
        }

        return senses.map((sense) => {
            const posModifier = getSensePosModifier(sense.partOfSpeech);
            const heading = sense.partOfSpeech
                ? `
                    <div class="student-dict-sense-heading student-dict-sense-heading--${posModifier}">
                        <span class="student-dict-sense-pos">${escapeHtml(sense.partOfSpeech)}</span>
                        <span class="student-dict-sense-divider" aria-hidden="true"></span>
                    </div>
                `
                : '';
            let definitionIndex = 0;
            const items = (sense.items || []).map((item) => {
                if (item.kind === 'phrase') return renderPhraseItem(item);
                if (item.kind === 'synonym') return renderSynonymItem(item);
                definitionIndex += 1;
                return renderDefinitionItem(item, definitionIndex);
            }).join('');

            return `
                <section class="student-dict-sense-section student-dict-sense-section--${posModifier}">
                    ${heading}
                    <div class="student-dict-sense-body">${items}</div>
                </section>
            `;
        }).join('');
    }

    function renderPhonetics(dict = {}) {
        const phonetics = Array.isArray(dict.phonetics) && dict.phonetics.length
            ? dict.phonetics
            : (dict.phonetic ? [dict.phonetic] : []);
        if (!elements.dictPhonetic) return;

        if (!phonetics.length) {
            dom.setText(elements.dictPhonetic, '');
            dom.hide(elements.dictPhonetic);
            return;
        }

        dom.setText(elements.dictPhonetic, phonetics.join(' · '));
        dom.show(elements.dictPhonetic);
    }

    function setSoundButtonState(btn, url, accentLabel) {
        if (!btn) return;
        if (url) {
            btn.hidden = false;
            btn.disabled = false;
            btn.classList.remove('is-unavailable');
            btn.title = `Phát âm ${accentLabel}`;
            btn.setAttribute('aria-label', `Play ${accentLabel} pronunciation`);
        } else {
            btn.hidden = true;
            btn.disabled = true;
            btn.classList.add('is-unavailable');
        }
    }

    function updateSoundButtons(urls = { uk: null, us: null }) {
        soundUrls = urls;
        setSoundButtonState(elements.dictSoundUk, urls.uk, 'UK');
        setSoundButtonState(elements.dictSoundUs, urls.us, 'US');

        const group = elements.dictSoundUk?.closest('.student-dict-pronounce-group');
        if (group) {
            if (urls.uk || urls.us) dom.show(group);
            else dom.hide(group);
        }
    }

    async function refreshPronunciationMeta() {
        if (!currentResult?.found) return;

        const word = currentResult.word || currentResult.query;
        const dict = currentResult.dictionaries?.[activeDictKey] || { phonetics: [], phonetic: null, senses: [] };
        renderPhonetics(dict);

        if (!word) {
            updateSoundButtons({ uk: null, us: null });
            return;
        }

        if (probedSoundWord === word) {
            updateSoundButtons(soundUrls);
            return;
        }

        const requestId = ++pronunciationRequestId;
        setSoundButtonState(elements.dictSoundUk, null, 'UK');
        setSoundButtonState(elements.dictSoundUs, null, 'US');
        if (elements.dictSoundUk) elements.dictSoundUk.hidden = false;
        if (elements.dictSoundUs) elements.dictSoundUs.hidden = false;
        if (elements.dictSoundUk) elements.dictSoundUk.disabled = true;
        if (elements.dictSoundUs) elements.dictSoundUs.disabled = true;

        const urls = await probePronunciations(word);
        if (requestId !== pronunciationRequestId) return;

        probedSoundWord = word;
        updateSoundButtons(urls);
    }

    function renderSenses() {
        if (!currentResult?.found) return;

        const dict = currentResult.dictionaries?.[activeDictKey] || { phonetics: [], phonetic: null, senses: [] };
        const phoneticsDict = (activeDictKey === 'enSyn' && !dict.phonetics?.length)
            ? (currentResult.dictionaries?.enVi || currentResult.dictionaries?.enEn || dict)
            : dict;
        dom.setText(elements.dictWord, currentResult.word || currentResult.query);
        renderPhonetics(phoneticsDict);
        dom.setHTML(elements.dictSenses, renderSenseItems(dict.senses, activeDictKey));
        refreshPronunciationMeta();
    }

    function renderResult(result) {
        currentResult = result;
        if (!result?.found) {
            dom.setText(
                elements.dictError,
                `Không có kết quả cho "${result?.query || ''}". Thử từ khác hoặc kiểm tra chính tả.`
            );
            setViewState('error');
            return;
        }

        addToHistory(result);
        setViewState('result');
        setActiveSubtab(getStoredSubtab());
    }

    async function playPronunciation(accent) {
        const word = currentResult?.word || currentResult?.query;
        if (!word) return;

        const btn = accent === 'us' ? elements.dictSoundUs : elements.dictSoundUk;
        const url = soundUrls[accent];
        if (!url) return;
        if (btn) btn.disabled = true;

        try {
            if (!audioPlayer) {
                audioPlayer = new Audio();
                audioPlayer.preload = 'auto';
            }
            audioPlayer.pause();
            audioPlayer.removeAttribute('src');
            audioPlayer.load();
            audioPlayer.src = url;
            await audioPlayer.play();
            dom.hide(elements.dictError);
        } catch (err) {
            console.error('Pronunciation error:', err);
            if (elements.dictError) {
                dom.setText(elements.dictError, 'Không phát được âm thanh. Vui lòng thử lại.');
                dom.show(elements.dictError);
            }
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function runLookup(rawWord) {
        const word = String(rawWord || '').trim();
        if (!word) return;

        probedSoundWord = null;
        soundUrls = { uk: null, us: null };
        hideSuggestions();
        if (elements.dictSearch) elements.dictSearch.value = word;
        updateSearchClearVisibility();
        setViewState('loading');
        dom.setText(elements.dictError, '');

        try {
            const result = await lookupWord(word);
            renderResult(result);
        } catch (err) {
            console.error('Dictionary lookup error:', err);
            currentResult = null;
            setViewState('error');
            const hint = err?.message === 'Failed to fetch'
                ? 'Không kết nối được API từ điển. Tải lại trang (Ctrl+F5) hoặc xóa dữ liệu site nếu bạn từng test local.'
                : (err.message || 'Không tra được từ này. Kiểm tra kết nối mạng.');
            dom.setText(elements.dictError, hint);
        }
    }

    elements.dictSearchForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        runLookup(elements.dictSearch?.value);
    });

    elements.dictSearchBtn?.addEventListener('click', () => {
        runLookup(elements.dictSearch?.value);
    });

    elements.dictSearchClear?.addEventListener('click', () => {
        if (elements.dictSearch) elements.dictSearch.value = '';
        hideSuggestions();
        currentResult = null;
        sessionStorage.removeItem(DICT_LAST_QUERY_KEY);
        updateSearchClearVisibility();
        dom.setText(elements.dictError, '');
        setViewState('empty');
        elements.dictSearch?.focus();
    });

    elements.dictSearch?.addEventListener('input', () => {
        updateSearchClearVisibility();
        scheduleSuggestions(elements.dictSearch?.value);
    });

    elements.dictSearch?.addEventListener('keydown', (e) => {
        const hasSuggestions = currentSuggestions.length > 0 && !elements.dictSuggestions?.classList.contains('hidden');

        if (e.key === 'ArrowDown' && hasSuggestions) {
            e.preventDefault();
            activeSuggestIndex = Math.min(activeSuggestIndex + 1, currentSuggestions.length - 1);
            renderSuggestions(currentSuggestions, elements.dictSearch?.value?.trim() || '');
            return;
        }
        if (e.key === 'ArrowUp' && hasSuggestions) {
            e.preventDefault();
            activeSuggestIndex = Math.max(activeSuggestIndex - 1, 0);
            renderSuggestions(currentSuggestions, elements.dictSearch?.value?.trim() || '');
            return;
        }
        if (e.key === 'Escape') {
            hideSuggestions();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (hasSuggestions && activeSuggestIndex >= 0) {
                runLookup(currentSuggestions[activeSuggestIndex]?.word);
            } else {
                runLookup(elements.dictSearch?.value);
            }
        }
    });

    elements.dictSearch?.addEventListener('blur', () => {
        setTimeout(hideSuggestions, 150);
    });

    elements.dictSuggestions?.addEventListener('mousedown', (e) => {
        e.preventDefault();
    });

    elements.dictSuggestions?.addEventListener('click', (e) => {
        const btn = e.target.closest('.student-dict-suggest-item');
        if (!btn) return;
        const word = btn.dataset.suggestWord;
        if (word) runLookup(word);
    });

    elements.dictHistoryList?.addEventListener('click', (e) => {
        const btn = e.target.closest('.student-dict-history-item');
        if (!btn) return;
        const word = btn.dataset.dictWord;
        if (word) runLookup(word);
    });

    elements.dictHistoryClear?.addEventListener('click', () => {
        clearHistory();
    });

    elements.dictTypeSelect?.addEventListener('change', () => {
        setActiveSubtab(elements.dictTypeSelect.value);
        scheduleSuggestions(elements.dictSearch?.value);
    });

    activeDictKey = getStoredSubtab();
    if (elements.dictTypeSelect) {
        elements.dictTypeSelect.value = activeDictKey;
        dictTypeCustom?.sync();
    }

    elements.dictSoundUk?.addEventListener('click', () => playPronunciation('uk'));
    elements.dictSoundUs?.addEventListener('click', () => playPronunciation('us'));

    elements.dictSenses?.addEventListener('click', (e) => {
        const lookupBtn = e.target.closest('.student-dict-see-also-link, .student-dict-synonym-link');
        if (lookupBtn) {
            const word = lookupBtn.dataset.dictWord;
            if (word) runLookup(word);
            return;
        }

        const phraseHeader = e.target.closest('.student-dict-phrase-header');
        if (phraseHeader) {
            if (e.target.closest('.student-dict-note-tip')) return;
            const card = phraseHeader.closest('.student-dict-phrase-card');
            if (!card) return;
            const expanded = card.classList.toggle('is-expanded');
            phraseHeader.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            return;
        }

        const toggleBtn = e.target.closest('.student-dict-examples-toggle');
        if (!toggleBtn) return;

        const wrap = toggleBtn.closest('.student-dict-examples');
        if (!wrap) return;

        const expanded = wrap.classList.toggle('is-expanded');
        toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        const label = toggleBtn.querySelector('.student-dict-examples-toggle-text');
        const icon = toggleBtn.querySelector('.student-dict-examples-toggle-icon');
        if (label) label.textContent = expanded ? 'Thu gọn' : 'Xem thêm';
        if (icon) {
            icon.classList.remove('fa-chevron-down', 'fa-chevron-up');
            icon.classList.add(expanded ? 'fa-chevron-up' : 'fa-chevron-down');
        }
    });

    function resetDictionary() {
        currentResult = null;
        probedSoundWord = null;
        soundUrls = { uk: null, us: null };
        pronunciationRequestId += 1;
        clearTimeout(suggestTimer);
        suggestTimer = null;
        suggestRequestId += 1;
        hideSuggestions();

        if (audioPlayer) {
            audioPlayer.pause();
            audioPlayer.removeAttribute('src');
            audioPlayer.load();
        }

        sessionStorage.removeItem(DICT_LAST_QUERY_KEY);
        if (elements.dictSearch) elements.dictSearch.value = '';
        updateSearchClearVisibility();
        dom.setText(elements.dictError, '');
        dom.setHTML(elements.dictSenses, '');
        setViewState('empty');
    }

    return {
        onTabOpen() {
            resetDictionary();
            elements.dictSearch?.focus();
        },
        onTabClose() {
            resetDictionary();
        }
    };
}
