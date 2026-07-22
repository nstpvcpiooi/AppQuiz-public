const cheerio = require('cheerio');

function cleanText(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .replace(/\u00a0/g, ' ')
        .trim();
}

function extractText($el) {
    return cleanText($el.text());
}

function isCrossRefLine($el) {
    if (!$el.hasClass('margin25')) return false;
    const html = $el.html() || '';
    const text = extractText($el).toLowerCase();
    return text.includes('xem') && /<a\b/i.test(html);
}

function parseCrossRef($el) {
    const link = $el.find('a[href]').first();
    const word = cleanText(link.text());
    const url = link.attr('href') || '';
    if (!word) return null;
    return { word, url };
}

function createDefinitionItem(definition) {
    return {
        kind: 'definition',
        definition,
        examples: [],
        notes: []
    };
}

function createPhraseItem(phrase) {
    return {
        kind: 'phrase',
        phrase,
        meanings: [],
        notes: [],
        seeAlso: null
    };
}

function createMeaning(definition) {
    return {
        definition,
        examples: [],
        notes: []
    };
}

function addNote(target, text) {
    if (!text || !target) return;
    if (!target.notes) target.notes = [];
    target.notes.push(text);
}

function addExample(target, english, vietnamese = '') {
    if (!english || !target) return;
    if (!target.examples) target.examples = [];
    target.examples.push({ english, vietnamese: vietnamese || '' });
}

function getNoteTarget(ctx) {
    if (ctx.currentMeaning) return ctx.currentMeaning;
    if (ctx.currentItem?.kind === 'phrase') return ctx.currentItem;
    return ctx.currentItem;
}

function getExampleTarget(ctx) {
    if (ctx.currentMeaning) return ctx.currentMeaning;
    if (ctx.currentItem?.kind === 'definition') return ctx.currentItem;
    if (ctx.currentItem?.kind === 'phrase') {
        if (!ctx.currentMeaning) {
            ctx.currentMeaning = createMeaning('');
            ctx.currentItem.meanings.push(ctx.currentMeaning);
        }
        return ctx.currentMeaning;
    }
    return null;
}

function ensureSense(ctx) {
    if (!ctx.currentSense) {
        ctx.currentSense = { partOfSpeech: '', items: [] };
        ctx.senses.push(ctx.currentSense);
    }
}

function pushItem(ctx, item) {
    ensureSense(ctx);
    ctx.currentSense.items.push(item);
    ctx.currentItem = item;
    ctx.currentMeaning = null;
    ctx.pendingEnglish = null;
}

function parseViContent($, $content) {
    const ctx = {
        senses: [],
        currentSense: null,
        currentItem: null,
        currentMeaning: null,
        pendingEnglish: null
    };

    $content.children().each((_, el) => {
        const $el = $(el);
        const tag = el.tagName?.toLowerCase();
        if (tag === 'script') return;

        const classAttr = $el.attr('class') || '';

        if ($el.hasClass('bg-grey') && $el.hasClass('bold')) {
            const pos = extractText($el.find('span').first().length ? $el.find('span') : $el);
            ctx.currentSense = { partOfSpeech: pos, items: [] };
            ctx.senses.push(ctx.currentSense);
            ctx.currentItem = null;
            ctx.currentMeaning = null;
            ctx.pendingEnglish = null;
            return;
        }

        if ($el.hasClass('bold') && $el.hasClass('dot-blue')) {
            pushItem(ctx, createPhraseItem(extractText($el)));
            return;
        }

        if ($el.hasClass('green') && $el.hasClass('bold')) {
            pushItem(ctx, createDefinitionItem(extractText($el)));
            return;
        }

        if ($el.hasClass('grey') && $el.hasClass('bold')) {
            const text = extractText($el);
            if (!text) return;
            if (!ctx.currentItem || ctx.currentItem.kind !== 'phrase') {
                pushItem(ctx, createPhraseItem(''));
            }
            ctx.currentMeaning = createMeaning(text);
            ctx.currentItem.meanings.push(ctx.currentMeaning);
            ctx.pendingEnglish = null;
            return;
        }

        if ($el.hasClass('color-light-grey')) {
            addNote(getNoteTarget(ctx), extractText($el));
            return;
        }

        if ($el.hasClass('color-light-blue')) {
            ctx.pendingEnglish = extractText($el);
            return;
        }

        if (isCrossRefLine($el)) {
            if (!ctx.currentItem || ctx.currentItem.kind !== 'phrase') {
                pushItem(ctx, createPhraseItem(''));
            }
            ctx.currentItem.seeAlso = parseCrossRef($el);
            ctx.pendingEnglish = null;
            return;
        }

        if ($el.hasClass('margin25')) {
            const text = extractText($el);
            if (!text) return;
            if (ctx.pendingEnglish) {
                const target = getExampleTarget(ctx);
                if (target) addExample(target, ctx.pendingEnglish, text);
                ctx.pendingEnglish = null;
            }
            return;
        }

        if (!classAttr.trim()) {
            const text = extractText($el);
            if (text) addNote(getNoteTarget(ctx), text);
        }
    });

    return ctx.senses.filter((sense) =>
        sense.items.some((item) =>
            item.kind === 'definition'
                ? !!(item.definition || item.examples.length || item.notes.length)
                : !!(item.phrase || item.meanings.length || item.seeAlso || item.notes.length)
        )
    );
}

function parseEnContent($, $content) {
    const ctx = {
        senses: [],
        currentSense: null,
        currentItem: null,
        currentMeaning: null,
        pendingEnglish: null
    };

    $content.children().each((_, el) => {
        const $el = $(el);
        const tag = el.tagName?.toLowerCase();
        if (tag === 'script') return;

        const classAttr = $el.attr('class') || '';

        if ($el.hasClass('bg-grey') && $el.hasClass('bold')) {
            const pos = extractText($el.find('span').first().length ? $el.find('span') : $el);
            ctx.currentSense = { partOfSpeech: pos, items: [] };
            ctx.senses.push(ctx.currentSense);
            ctx.currentItem = null;
            ctx.currentMeaning = null;
            ctx.pendingEnglish = null;
            return;
        }

        if ($el.hasClass('bold') && $el.hasClass('dot-blue')) {
            pushItem(ctx, createPhraseItem(extractText($el)));
            return;
        }

        if ($el.hasClass('green') && $el.hasClass('bold')) {
            pushItem(ctx, createDefinitionItem(extractText($el)));
            return;
        }

        if ($el.hasClass('grey') && $el.hasClass('bold')) {
            const text = extractText($el);
            if (!text) return;
            if (!ctx.currentItem || ctx.currentItem.kind !== 'phrase') {
                pushItem(ctx, createPhraseItem(''));
            }
            ctx.currentMeaning = createMeaning(text);
            ctx.currentItem.meanings.push(ctx.currentMeaning);
            return;
        }

        if ($el.hasClass('color-light-grey')) {
            addNote(getNoteTarget(ctx), extractText($el));
            return;
        }

        if ($el.hasClass('color-light-blue')) {
            const text = extractText($el);
            const target = getExampleTarget(ctx);
            if (!target) {
                pushItem(ctx, createDefinitionItem(''));
                addExample(ctx.currentItem, text);
            } else {
                addExample(target, text);
            }
            return;
        }

        if (isCrossRefLine($el)) {
            if (!ctx.currentItem || ctx.currentItem.kind !== 'phrase') {
                pushItem(ctx, createPhraseItem(''));
            }
            ctx.currentItem.seeAlso = parseCrossRef($el);
            return;
        }

        if (!classAttr.trim()) {
            const text = extractText($el);
            if (text) addNote(getNoteTarget(ctx), text);
        }
    });

    return ctx.senses.filter((sense) =>
        sense.items.some((item) =>
            item.kind === 'definition'
                ? !!(item.definition || item.examples.length || item.notes.length)
                : !!(item.phrase || item.meanings.length || item.seeAlso || item.notes.length)
        )
    );
}

function createSynonymItem(context) {
    return {
        kind: 'synonym',
        context,
        synonyms: []
    };
}

function parseSynContent($, $content) {
    const ctx = {
        senses: [],
        currentSense: null,
        currentItem: null
    };

    function pushSynonymGroup(context) {
        if (!ctx.currentSense) {
            ctx.currentSense = { partOfSpeech: '', items: [] };
            ctx.senses.push(ctx.currentSense);
        }
        ctx.currentItem = createSynonymItem(context);
        ctx.currentSense.items.push(ctx.currentItem);
    }

    $content.children().each((_, el) => {
        const $el = $(el);
        const tag = el.tagName?.toLowerCase();
        if (tag === 'script') return;

        if ($el.hasClass('bg-grey') && $el.hasClass('bold')) {
            const pos = extractText($el.find('span').first().length ? $el.find('span') : $el);
            ctx.currentSense = { partOfSpeech: pos, items: [] };
            ctx.senses.push(ctx.currentSense);
            ctx.currentItem = null;
            return;
        }

        if ($el.hasClass('green') && $el.hasClass('bold')) {
            pushSynonymGroup(extractText($el));
            return;
        }

        if ($el.hasClass('color-light-blue')) {
            const phrase = extractText($el);
            if (!phrase) return;
            if (!ctx.currentItem || ctx.currentItem.kind !== 'synonym') {
                pushSynonymGroup('');
            }
            if (!ctx.currentItem.synonyms.includes(phrase)) {
                ctx.currentItem.synonyms.push(phrase);
            }
        }
    });

    return ctx.senses.filter((sense) =>
        sense.items.some((item) => item.kind === 'synonym' && item.synonyms.length > 0)
    );
}

function extractIpaFromText(text) {
    if (!text) return [];
    const results = [];
    const matches = String(text).match(/\/[^/\n]+\//g) || [];
    matches.forEach((item) => {
        const cleaned = cleanText(item);
        if (cleaned && !results.includes(cleaned)) results.push(cleaned);
    });
    return results;
}

function extractHeaderPhonetics($, relIndex) {
    const phonetics = [];
    $(`.word_tab_title_${relIndex} h2`).first()
        .find('span.color-black, span.color-orange')
        .each((_, el) => {
            extractIpaFromText(extractText($(el))).forEach((ipa) => {
                if (!phonetics.includes(ipa)) phonetics.push(ipa);
            });
        });
    return phonetics;
}

function isPosHeading($el) {
    return $el.hasClass('bg-grey') && $el.hasClass('bold');
}

function isDefinitionHeading($el) {
    return ($el.hasClass('green') || $el.hasClass('grey')) && $el.hasClass('bold');
}

function extractContentPhonetics($, rel) {
    const phonetics = [];
    const $content = $(`li.slide_content[rel="${rel}"] .content`).first();
    if (!$content.length) return phonetics;

    const children = $content.children().toArray();
    for (let i = 0; i < children.length; i++) {
        const $el = $(children[i]);
        if (!isPosHeading($el)) continue;

        for (let j = i + 1; j < children.length; j++) {
            const $next = $(children[j]);
            if (isPosHeading($next)) break;
            if (isDefinitionHeading($next)) break;

            const text = extractText($next);
            if (!text || !/\/[^/]+\//.test(text)) continue;

            extractIpaFromText(text).forEach((ipa) => {
                if (!phonetics.includes(ipa)) phonetics.push(ipa);
            });
            break;
        }
    }
    return phonetics;
}

function extractPhonetics($, relIndex) {
    const phonetics = [];
    [...extractHeaderPhonetics($, relIndex), ...extractContentPhonetics($, relIndex)].forEach((ipa) => {
        if (!phonetics.includes(ipa)) phonetics.push(ipa);
    });
    return phonetics;
}

function extractHeadword($, relIndex) {
    const h2 = $(`.word_tab_title_${relIndex} h2`).first();
    if (!h2.length) return null;
    const clone = h2.clone();
    clone.find('span').remove();
    return cleanText(clone.text()) || null;
}

function parseDictionarySection($, rel) {
    const $content = $(`li.slide_content[rel="${rel}"] .content`).first();
    if (!$content.length) return { phonetics: [], phonetic: null, senses: [] };

    let senses;
    if (rel === '0') senses = parseViContent($, $content);
    else if (rel === '1') senses = parseEnContent($, $content);
    else if (rel === '2') senses = parseSynContent($, $content);
    else senses = [];

    let phonetics = extractPhonetics($, rel);
    if (rel === '2' && !phonetics.length) {
        phonetics = extractPhonetics($, '0');
        if (!phonetics.length) phonetics = extractPhonetics($, '1');
    }
    return {
        phonetics,
        phonetic: phonetics.length ? phonetics.join(' · ') : null,
        senses
    };
}

function parseLabanHtml(html, query) {
    const $ = cheerio.load(html);
    const hasResult = $('.world').length > 0;

    if (!hasResult) {
        return {
            query,
            found: false,
            word: query,
            dictionaries: {
                enVi: { phonetics: [], phonetic: null, senses: [] },
                enEn: { phonetics: [], phonetic: null, senses: [] },
                enSyn: { phonetics: [], phonetic: null, senses: [] }
            }
        };
    }

    const word = extractHeadword($, 0) || extractHeadword($, 1) || extractHeadword($, 2) || query;
    const enVi = parseDictionarySection($, '0');
    const enEn = parseDictionarySection($, '1');
    const enSyn = parseDictionarySection($, '2');
    const found = enVi.senses.length > 0 || enEn.senses.length > 0 || enSyn.senses.length > 0;

    return {
        query,
        found,
        word,
        dictionaries: {
            enVi,
            enEn,
            enSyn
        }
    };
}

module.exports = { parseLabanHtml, cleanText };
