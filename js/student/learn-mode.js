import { dom } from '../utils.js';
import state from '../state.js';

let learnElements = {};
let currentCards = [];
let allCards = [];
let starredList = [];
let currentQIndex = 0;
let learnQuestions = [];
let score = 0;
let timer = null;
let timeLeft = 0;
let currentQuestion = null;
let starredOnly = false;
let timerEnabled = false;

// Audio context/element for playing sounds inside learn mode if needed
// We can just reuse playVocabSound(text)

export function initLearnMode(originalCards, elementsMap, currentStarredList) {
    allCards = originalCards.map(c => {
        let text = c.front || '';
        const posMap = { 'n': 'noun', 'v': 'verb', 'adj': 'adjective', 'adv': 'adverb', 'prep': 'preposition', 'conj': 'conjunction', 'pron': 'pronoun', 'int': 'interjection', 'phr': 'phrase', 'idiom': 'idiom' };
        const regex = /\(([^)]+)\)/g;
        let badge = '';
        let match;
        while ((match = regex.exec(text)) !== null) {
            const inner = match[1].trim().toLowerCase().replace(/\.$/, '');
            if (posMap[inner]) {
                badge = posMap[inner];
                text = text.replace(match[0], '');
            }
        }
        text = text.trim();
        const isPhrase = text.split(/\s+/).filter(w => w.length > 0).length > 2;
        if (!badge && isPhrase) badge = 'phrase';
        
        return { ...c, badge, cleanFront: text, isPhrase };
    });
    
    learnElements = elementsMap;
    starredList = currentStarredList || [];
    
    // Cleanup old events — clone + replace to remove all stacked handlers
    const newStartBtn = learnElements.startBtn.cloneNode(true);
    learnElements.startBtn.parentNode.replaceChild(newStartBtn, learnElements.startBtn);
    learnElements.startBtn = newStartBtn;
    learnElements.startBtn.addEventListener('click', startSession);

    const newQuitBtn = learnElements.quitBtn.cloneNode(true);
    learnElements.quitBtn.parentNode.replaceChild(newQuitBtn, learnElements.quitBtn);
    learnElements.quitBtn = newQuitBtn;
    learnElements.quitBtn.addEventListener('click', quitSession);

    const newNextBtn = learnElements.nextBtn.cloneNode(true);
    learnElements.nextBtn.parentNode.replaceChild(newNextBtn, learnElements.nextBtn);
    learnElements.nextBtn = newNextBtn;
    learnElements.nextBtn.addEventListener('click', nextQuestion);

    const newOverrideBtn = learnElements.overrideBtn.cloneNode(true);
    learnElements.overrideBtn.parentNode.replaceChild(newOverrideBtn, learnElements.overrideBtn);
    learnElements.overrideBtn = newOverrideBtn;
    learnElements.overrideBtn.addEventListener('click', acceptOverride);

    const newRestartBtn = learnElements.restartBtn.cloneNode(true);
    learnElements.restartBtn.parentNode.replaceChild(newRestartBtn, learnElements.restartBtn);
    learnElements.restartBtn = newRestartBtn;
    learnElements.restartBtn.addEventListener('click', () => {
        showScreen('setup');
    });

    const newBackBtn = learnElements.backToFlashcardBtn.cloneNode(true);
    learnElements.backToFlashcardBtn.parentNode.replaceChild(newBackBtn, learnElements.backToFlashcardBtn);
    learnElements.backToFlashcardBtn = newBackBtn;
    learnElements.backToFlashcardBtn.addEventListener('click', quitSession);

    function updateSelectAllBtn() {
        const checkboxes = document.querySelectorAll('.fs-learn-type-card input[type="checkbox"]');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        const btn = document.getElementById('fs-learn-select-all');
        if (btn) {
            if (allChecked) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    }

    function updateCardActiveState(checkbox) {
        if (checkbox.checked) {
            checkbox.closest('.fs-learn-type-card').classList.add('active');
        } else {
            checkbox.closest('.fs-learn-type-card').classList.remove('active');
        }
    }

    // Select All button — clone + replace
    const oldSelectAllBtn = document.getElementById('fs-learn-select-all');
    if (oldSelectAllBtn) {
        const newSelectAllBtn = oldSelectAllBtn.cloneNode(true);
        oldSelectAllBtn.parentNode.replaceChild(newSelectAllBtn, oldSelectAllBtn);
        newSelectAllBtn.addEventListener('click', function() {
            const checkboxes = document.querySelectorAll('.fs-learn-type-card input[type="checkbox"]');
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            checkboxes.forEach(cb => {
                cb.checked = !allChecked;
                updateCardActiveState(cb);
            });
            updateSelectAllBtn();
        });
    }

    // Chip buttons — clone + replace each
    document.querySelectorAll('.fs-learn-qchip').forEach(oldChip => {
        const newChip = oldChip.cloneNode(true);
        oldChip.parentNode.replaceChild(newChip, oldChip);
        newChip.addEventListener('click', function() {
            document.querySelectorAll('.fs-learn-qchip').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
        });
    });

    // Question type checkboxes — clone + replace each
    document.querySelectorAll('.fs-learn-type-card').forEach(card => {
        const checkbox = card.querySelector('input[type="checkbox"]');
        if (!checkbox) return;
        const newCheckbox = checkbox.cloneNode(true);
        checkbox.parentNode.replaceChild(newCheckbox, checkbox);
        newCheckbox.addEventListener('change', function() {
            updateCardActiveState(this);
            updateSelectAllBtn();
        });
    });

    // Initial setup state
    updateSelectAllBtn();
    showScreen('setup');
    updateSetupUI(starredList);
}

export function updateSetupUI(currentStarredList = []) {
    starredList = currentStarredList;
    const starredTile = document.querySelector('.fs-learn-option-tile--starred');
    if (learnElements.starredToggle) {
        if (starredList.length === 0) {
            learnElements.starredToggle.disabled = true;
            learnElements.starredToggle.checked = false;
            if(learnElements.starredHint) learnElements.starredHint.textContent = "No starred cards in this set";
            if (starredTile) starredTile.classList.add('disabled');
        } else {
            learnElements.starredToggle.disabled = false;
            if(learnElements.starredHint) learnElements.starredHint.textContent = "Only study your marked cards";
            if (starredTile) starredTile.classList.remove('disabled');
        }
    }
}

function showScreen(screen) {
    dom.hide(learnElements.setupScreen);
    dom.hide(learnElements.playScreen);
    dom.hide(learnElements.resultsScreen);
    
    if (screen === 'setup') dom.show(learnElements.setupScreen);
    if (screen === 'play') dom.show(learnElements.playScreen);
    if (screen === 'results') dom.show(learnElements.resultsScreen);
}

function startSession() {
    starredOnly = learnElements.starredToggle?.checked || false;
    timerEnabled = learnElements.timerToggle?.checked || false;
    
    const types = [];
    if (document.getElementById('fs-learn-type-mc')?.checked) types.push('mc');
    if (document.getElementById('fs-learn-type-written')?.checked) types.push('written');
    if (document.getElementById('fs-learn-type-listen')?.checked) types.push('listen');
    if (document.getElementById('fs-learn-type-fill')?.checked) types.push('fill');
    
    if (types.length === 0) {
        alert("Please select at least one question type.");
        return;
    }
    
    currentCards = [...allCards];
    if (starredOnly) {
        currentCards = currentCards.filter(c => starredList.includes(c.front));
    }
    
    // Filter out cards that cannot be tested with ANY of the selected types.
    currentCards = currentCards.filter(c => {
        let validTypes = [...types];
        if (!c.isPhrase) {
            const fillIdx = validTypes.indexOf('fill');
            if (fillIdx > -1) validTypes.splice(fillIdx, 1);
        }
        return validTypes.length > 0;
    });

    if (currentCards.length === 0) {
        alert("Không có thẻ nào phù hợp với tùy chọn của bạn. (VD: Điền từ chỉ áp dụng cho các cụm từ - phrases).");
        return;
    }
    
    const activeChip = document.querySelector('.fs-learn-qchip.active');
    const countVal = activeChip?.dataset.value || 'all';
    let qCount = currentCards.length;
    if (countVal !== 'all') {
        qCount = Math.min(parseInt(countVal, 10), currentCards.length);
    }
    
    // Shuffle and slice
    currentCards = currentCards.sort(() => Math.random() - 0.5).slice(0, qCount);
    
    generateQuestions(types);
    
    currentQIndex = 0;
    score = 0;
    showScreen('play');
    renderQuestion();
}

function generateQuestions(types) {
    learnQuestions = currentCards.map(card => {
        const availableTypes = [...types];
        // If not a phrase, cannot do 'fill'
        if (!card.isPhrase) {
            const fillIndex = availableTypes.indexOf('fill');
            if (fillIndex > -1) availableTypes.splice(fillIndex, 1);
        }
        
        const type = availableTypes[Math.floor(Math.random() * availableTypes.length)];
        
        let q = { card, type };
        
        if (type === 'mc') {
            q.options = generateMCOptions(card);
            // 50% chance to swap meaning/word
            q.direction = Math.random() > 0.5 ? 'word_to_meaning' : 'meaning_to_word';
        } else if (type === 'fill') {
            q.fillData = generateFillData(card);
        }
        
        return q;
    });
}

function generateMCOptions(targetCard) {
    let distractors = allCards.filter(c => c.front !== targetCard.front && c.badge === targetCard.badge);
    
    if (distractors.length < 3) {
        const others = allCards.filter(c => c.front !== targetCard.front && c.badge !== targetCard.badge);
        distractors = distractors.concat(others);
    }
    
    // Deduplicate by meaning
    const uniqueDistractors = [];
    const seenMeanings = new Set([targetCard.back.toLowerCase().trim()]);
    
    for (const d of distractors.sort(() => Math.random() - 0.5)) {
        const mean = d.back.toLowerCase().trim();
        if (!seenMeanings.has(mean)) {
            uniqueDistractors.push(d);
            seenMeanings.add(mean);
        }
        if (uniqueDistractors.length === 3) break;
    }
    
    const options = [targetCard, ...uniqueDistractors].sort(() => Math.random() - 0.5);
    return options;
}

function generateFillData(card) {
    const words = card.front.split(' ');
    
    const candidates = words.map((w, i) => ({w, i})).filter(item => {
        // Exclude words containing parentheses
        if (item.w.includes('(') || item.w.includes(')')) return false;
        
        // Exclude placeholder words
        const excludeRegex = /\b(someone|something|somebody|sb|sth|one)\b/i;
        if (excludeRegex.test(item.w)) return false;
        
        // Require > 2 letters
        const letters = item.w.replace(/[^a-zA-Z]/g, '');
        if (letters.length <= 2) return false;
        
        return true;
    });
    
    let target;
    if (candidates.length > 0) {
        target = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
        let longest = {w: words[0], i: 0};
        words.forEach((w, i) => {
            if (w.length > longest.w.length) longest = {w, i};
        });
        target = longest;
    }
    
    const blanked = [...words];
    // Create blank string of appropriate length
    const cleanWord = target.w.replace(/[^a-zA-Z0-9]/g, '');
    blanked[target.i] = target.w.replace(cleanWord, '_'.repeat(Math.max(4, cleanWord.length)));
    
    return {
        display: blanked.join(' '),
        answer: cleanWord
    };
}

function stopTimer() {
    if (timer) clearInterval(timer);
    dom.hide(learnElements.timerDisplay);
}

function startTimer() {
    stopTimer();
    if (!timerEnabled) return;
    
    timeLeft = 15; // 15 seconds per question
    dom.show(learnElements.timerDisplay);
    learnElements.timerDisplay.innerHTML = `<i class="fas fa-clock"></i> ${timeLeft}s`;
    
    timer = setInterval(() => {
        timeLeft--;
        learnElements.timerDisplay.innerHTML = `<i class="fas fa-clock"></i> ${timeLeft}s`;
        if (timeLeft <= 0) {
            stopTimer();
            handleTimeout();
        }
    }, 1000);
}

function handleTimeout() {
    // Disable inputs
    const inputs = learnElements.qContainer.querySelectorAll('input, button:not(#fs-learn-quit-btn)');
    inputs.forEach(el => el.disabled = true);
    showFeedback(false, "Time's up!", currentQuestion.card.front + " - " + currentQuestion.card.back);
}

function renderQuestion() {
    stopTimer();
    // Hide feedback and reset animation
    learnElements.feedbackArea.classList.remove('hidden');
    void learnElements.feedbackArea.offsetWidth; // trigger reflow
    learnElements.feedbackArea.classList.add('hidden');
    
    dom.hide(learnElements.overrideBtn);
    learnElements.qContainer.innerHTML = '';
    
    if (currentQIndex >= learnQuestions.length) {
        showResults();
        return;
    }
    
    currentQuestion = learnQuestions[currentQIndex];
    
    if (learnElements.progressText) {
        learnElements.progressText.textContent = `${currentQIndex + 1} / ${learnQuestions.length}`;
    }
    const progressFill = document.getElementById('fs-learn-progress-fill');
    if (progressFill) {
        progressFill.style.width = `${(currentQIndex / learnQuestions.length) * 100}%`;
    }
    
    const qHTML = document.createElement('div');
    qHTML.className = 'fs-learn-question';
    
    if (currentQuestion.type === 'mc') {
        const isWordToMeaning = currentQuestion.direction === 'word_to_meaning';
        const prompt = isWordToMeaning ? currentQuestion.card.front : currentQuestion.card.back;
        
        qHTML.innerHTML = `
            <div class="fs-learn-question-label">Choose the correct answer:</div>
            <h3 class="fs-learn-question-prompt">${prompt}</h3>
            <div class="fs-learn-mc-grid">
                ${currentQuestion.options.map((opt, i) => `
                    <button type="button" class="fs-learn-mc-btn" data-index="${i}">
                        <span class="option-letter" aria-hidden="true">${String.fromCharCode(65 + i)}</span>
                        <span class="option-text">${isWordToMeaning ? opt.back : opt.front}</span>
                    </button>
                `).join('')}
            </div>
        `;
        learnElements.qContainer.appendChild(qHTML);
        
        qHTML.querySelectorAll('.fs-learn-mc-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                stopTimer();
                const selectedOpt = currentQuestion.options[btn.dataset.index];
                const isCorrect = selectedOpt.front === currentQuestion.card.front;
                
                // Highlight buttons
                qHTML.querySelectorAll('.fs-learn-mc-btn').forEach(b => b.disabled = true);
                if (isCorrect) {
                    btn.classList.add('option-correct');
                    score++;
                    showFeedback(true, "Correct!", isWordToMeaning ? currentQuestion.card.back : currentQuestion.card.front);
                } else {
                    btn.classList.add('option-wrong');
                    // Highlight correct one
                    const correctIndex = currentQuestion.options.findIndex(o => o.front === currentQuestion.card.front);
                    const correctBtn = qHTML.querySelector(`[data-index="${correctIndex}"]`);
                    if(correctBtn) {
                        correctBtn.classList.add('option-correct');
                    }
                    showFeedback(false, "Incorrect", isWordToMeaning ? currentQuestion.card.back : currentQuestion.card.front);
                }
            });
        });
        
    } else if (currentQuestion.type === 'written') {
        qHTML.innerHTML = `
            <div class="fs-learn-question-label">Type the English word for:</div>
            <h3 class="fs-learn-question-prompt">${currentQuestion.card.back}</h3>
            <div class="fs-learn-input-wrapper">
                <input type="text" id="fs-learn-text-input" class="fs-learn-input" autocomplete="off" placeholder="Type here...">
                <button type="button" id="fs-learn-submit-btn" class="fs-learn-submit-btn" title="Check"><i class="fas fa-right-to-bracket"></i></button>
            </div>
        `;
        learnElements.qContainer.appendChild(qHTML);
        
        const input = document.getElementById('fs-learn-text-input');
        const submit = document.getElementById('fs-learn-submit-btn');
        
        setTimeout(() => input.focus(), 50);
        
        const checkAnswer = () => {
            if(input.disabled) return;
            stopTimer();
            input.disabled = true;
            submit.disabled = true;
            
            const userAns = input.value;
            
            // Allow any card's front that has the exact same meaning
            let validAnswers = [currentQuestion.card.front];
            if (allCards && currentQuestion.card.back) {
                const currentBack = currentQuestion.card.back.trim().toLowerCase();
                allCards.forEach(c => {
                    if (c.back && c.back.trim().toLowerCase() === currentBack && c.front) {
                        validAnswers.push(c.front);
                    }
                });
            }
            const isCorrect = validAnswers.some(ans => fuzzyMatch(userAns, ans));
            
            const uniqueAnswers = [...new Set(validAnswers)];
            const answersStr = uniqueAnswers.join(' / ');
            
            if (isCorrect) {
                input.style.borderColor = '#10B981';
                input.style.background = '#ECFDF5';
                input.style.color = '#047857';
                score++;
                showFeedback(true, "Correct!", answersStr);
            } else {
                input.style.borderColor = '#EF4444';
                input.style.background = '#FEF2F2';
                input.style.color = '#B91C1C';
                showFeedback(false, "Incorrect", answersStr);
                dom.show(learnElements.overrideBtn); // Show "Accept this answer"
            }
        };
        
        submit.addEventListener('click', checkAnswer);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') checkAnswer();
        });
        
    } else if (currentQuestion.type === 'listen') {
        qHTML.innerHTML = `
            <div class="fs-learn-question-label">Listen and type what you hear:</div>
            <button type="button" id="fs-learn-play-sound-btn" class="fs-learn-play-btn">
                <i class="fas fa-volume-up"></i>
            </button>
            <div class="fs-learn-input-wrapper">
                <input type="text" id="fs-learn-text-input" class="fs-learn-input" autocomplete="off" placeholder="Type here...">
                <button type="button" id="fs-learn-submit-btn" class="fs-learn-submit-btn" title="Check"><i class="fas fa-right-to-bracket"></i></button>
            </div>
        `;
        learnElements.qContainer.appendChild(qHTML);
        
        const playBtn = document.getElementById('fs-learn-play-sound-btn');
        playBtn.addEventListener('click', () => {
            if (window.playVocabSound) window.playVocabSound(currentQuestion.card.front);
        });
        
        // Auto play on render
        setTimeout(() => { if (window.playVocabSound) window.playVocabSound(currentQuestion.card.front); }, 300);
        
        const input = document.getElementById('fs-learn-text-input');
        const submit = document.getElementById('fs-learn-submit-btn');
        
        setTimeout(() => input.focus(), 50);
        
        const checkAnswer = () => {
            if(input.disabled) return;
            stopTimer();
            input.disabled = true;
            submit.disabled = true;
            
            const userAns = input.value;
            const isCorrect = fuzzyMatch(userAns, currentQuestion.card.front);
            
            if (isCorrect) {
                input.style.borderColor = '#10B981';
                input.style.background = '#ECFDF5';
                input.style.color = '#047857';
                score++;
                showFeedback(true, "Correct!", currentQuestion.card.front);
            } else {
                input.style.borderColor = '#EF4444';
                input.style.background = '#FEF2F2';
                input.style.color = '#B91C1C';
                showFeedback(false, "Incorrect", currentQuestion.card.front);
                dom.show(learnElements.overrideBtn);
            }
        };
        
        submit.addEventListener('click', checkAnswer);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') checkAnswer();
        });
        
    } else if (currentQuestion.type === 'fill') {
        qHTML.innerHTML = `
            <div class="fs-learn-question-label">Fill in the blank:</div>
            <div class="fs-learn-fill-phrase">${currentQuestion.fillData.display}</div>
            <div class="fs-learn-fill-hint">${currentQuestion.card.back}</div>
            <div class="fs-learn-input-wrapper">
                <input type="text" id="fs-learn-text-input" class="fs-learn-input" autocomplete="off" placeholder="Type the missing word">
                <button type="button" id="fs-learn-submit-btn" class="fs-learn-submit-btn" title="Check"><i class="fas fa-right-to-bracket"></i></button>
            </div>
        `;
        learnElements.qContainer.appendChild(qHTML);
        
        const input = document.getElementById('fs-learn-text-input');
        const submit = document.getElementById('fs-learn-submit-btn');
        
        setTimeout(() => input.focus(), 50);
        
        const checkAnswer = () => {
            if(input.disabled) return;
            stopTimer();
            input.disabled = true;
            submit.disabled = true;
            
            const userAns = input.value;
            // For fill in the blank, exact word match (case insensitive)
            const expected = currentQuestion.fillData.answer.toLowerCase().trim();
            const actual = userAns.toLowerCase().trim();
            const isCorrect = (expected === actual);
            
            if (isCorrect) {
                input.style.borderColor = '#10B981';
                input.style.background = '#ECFDF5';
                input.style.color = '#047857';
                score++;
                showFeedback(true, "Correct!", currentQuestion.card.front);
            } else {
                input.style.borderColor = '#EF4444';
                input.style.background = '#FEF2F2';
                input.style.color = '#B91C1C';
                showFeedback(false, "Incorrect", currentQuestion.card.front);
                dom.show(learnElements.overrideBtn);
            }
        };
        
        submit.addEventListener('click', checkAnswer);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') checkAnswer();
        });
    }

    startTimer();
}

function fuzzyMatch(userAns, correctAns) {
    let u = userAns.toLowerCase().trim();
    u = u.replace(/\s+/g, ' ');
    
    let c = correctAns.toLowerCase().trim();
    // Remove stuff in parentheses like "(to) "
    c = c.replace(/\([^)]+\)/g, '').trim();
    c = c.replace(/\s+/g, ' ');
    
    if (u === c) return true;
    
    // Split correct answer by common separators to allow typing just one synonym
    // separators: comma, semicolon, slash, backslash, or pipe
    const separators = /[,;\\/|]+/;
    const parts = c.split(separators).map(p => p.trim()).filter(p => p.length > 0);
    
    return parts.includes(u);
}

function showFeedback(isCorrect, titleText, correctAnsText = '') {
    dom.show(learnElements.feedbackArea);
    
    // Retrigger CSS animation
    learnElements.feedbackArea.style.animation = 'none';
    void learnElements.feedbackArea.offsetWidth;
    learnElements.feedbackArea.style.animation = '';
    
    const banner = learnElements.feedbackBanner;
    const title = learnElements.feedbackTitle;
    const text = learnElements.feedbackText;
    
    const label = correctAnsText.includes('/') ? 'Valid answers' : 'Correct answer';

    if (isCorrect) {
        banner.className = 'fs-learn-feedback-inner fs-learn-feedback--correct';
        title.innerHTML = `<i class="fas fa-check-circle"></i> ${titleText}`;
        if (correctAnsText) {
            text.innerHTML = `<span class="feedback-section-label">${label}</span><span class="feedback-answer-text">${correctAnsText}</span>`;
            text.classList.remove('hidden');
        } else {
            text.innerHTML = '';
            text.classList.add('hidden');
        }
    } else {
        banner.className = 'fs-learn-feedback-inner fs-learn-feedback--incorrect';
        title.innerHTML = `<i class="fas fa-times-circle"></i> ${titleText}`;
        text.innerHTML = `<span class="feedback-section-label">${label}</span><span class="feedback-answer-text">${correctAnsText}</span>`;
        text.classList.remove('hidden');
    }
}

function acceptOverride() {
    score++;
    showFeedback(true, "Answer accepted manually.");
    dom.hide(learnElements.overrideBtn);
}

function quitSession() {
    stopTimer();
    document.getElementById('fs-mode-btn').click(); 
    // Wait for dropdown to open, then click Flashcard
    setTimeout(() => {
        const flashcardOpt = document.querySelector('#fs-mode-menu .fs-dropdown-option[data-mode="flashcard"]');
        if (flashcardOpt) flashcardOpt.click();
    }, 10);
}

function nextQuestion() {
    currentQIndex++;
    renderQuestion();
}

function showResults() {
    stopTimer();
    showScreen('results');
    if (learnElements.scoreDisplay) {
        const percent = Math.round((score / learnQuestions.length) * 100);
        learnElements.scoreDisplay.textContent = `${percent}%`;
    }
    if (learnElements.correctCountDisplay) {
        learnElements.correctCountDisplay.textContent = `${score}/${learnQuestions.length}`;
    }
}

// Allow pressing Enter to continue to next question when feedback is visible
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const feedbackArea = document.getElementById('fs-learn-feedback');
        if (feedbackArea && !feedbackArea.classList.contains('hidden')) {
            // Let the user trigger 'Accept this answer' if they have focused on it
            if (document.activeElement && document.activeElement.id === 'fs-learn-override-btn') {
                return;
            }
            if (learnElements.nextBtn) {
                e.preventDefault();
                learnElements.nextBtn.click();
            }
        }
    }
});
