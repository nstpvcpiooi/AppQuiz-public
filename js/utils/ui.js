let customSelectListenersBound = false;

function closeAllCustomSelects(exceptWrap = null) {
    document.querySelectorAll('.custom-select.is-open').forEach((wrap) => {
        if (wrap === exceptWrap) return;
        wrap.classList.remove('is-open');
        const menu = wrap.querySelector('.custom-select-menu');
        const trigger = wrap.querySelector('.custom-select-trigger');
        if (menu) menu.hidden = true;
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
}

function bindCustomSelectGlobalListeners() {
    if (customSelectListenersBound) return;
    customSelectListenersBound = true;
    document.addEventListener('click', (e) => {
        if (e.target.closest('.custom-select')) return;
        closeAllCustomSelects();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllCustomSelects();
    });
}

export function initCustomSelect(selectEl) {
    if (!selectEl || selectEl.dataset.customSelectInit === '1') return null;
    bindCustomSelectGlobalListeners();
    selectEl.dataset.customSelectInit = '1';
    const wrap = selectEl.closest('.admin-quiz-select-wrap') || selectEl.parentElement;
    if (!wrap) return null;
    wrap.classList.add('custom-select');
    selectEl.classList.add('custom-select-native');
    wrap.querySelector('.admin-quiz-select-chevron')?.remove();
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger admin-quiz-select-trigger';
    const valueSpan = document.createElement('span');
    valueSpan.className = 'custom-select-value';
    const chevron = document.createElement('i');
    chevron.className = 'fas fa-chevron-down custom-select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    trigger.append(valueSpan, chevron);
    const menu = document.createElement('ul');
    menu.className = 'custom-select-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    const optionEls = Array.from(selectEl.options).map((opt) => {
        const li = document.createElement('li');
        li.className = 'custom-select-option';
        li.setAttribute('role', 'option');
        li.dataset.value = opt.value;
        const label = document.createElement('span');
        label.className = 'custom-select-option-label';
        label.textContent = opt.textContent;
        const check = document.createElement('i');
        check.className = 'fas fa-check custom-select-option-check';
        check.setAttribute('aria-hidden', 'true');
        li.append(label, check);
        menu.appendChild(li);
        return li;
    });
    wrap.append(trigger, menu);
    const filterItem = wrap.closest('.admin-quiz-filter-item');
    filterItem?.addEventListener('click', (e) => {
        if (e.target.closest('.custom-select-menu') || e.target.closest('.custom-select-option')) return;
        if (e.target.closest('.custom-select-trigger')) return;
        e.preventDefault();
        e.stopPropagation();
        if (wrap.classList.contains('is-open')) closeMenu();
        else openMenu();
    });
    const ariaLabel = selectEl.getAttribute('aria-label') || '';
    if (ariaLabel) trigger.setAttribute('aria-label', ariaLabel);
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    function syncFromSelect() {
        const opt = selectEl.options[selectEl.selectedIndex];
        valueSpan.textContent = opt?.textContent || '';
        optionEls.forEach((li) => {
            const selected = li.dataset.value === selectEl.value;
            li.classList.toggle('is-selected', selected);
            li.setAttribute('aria-selected', selected ? 'true' : 'false');
        });
    }

    function openMenu() {
        closeAllCustomSelects(wrap);
        menu.hidden = false;
        wrap.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        const selected = menu.querySelector('.custom-select-option.is-selected');
        selected?.scrollIntoView({ block: 'nearest' });
    }

    function closeMenu() {
        menu.hidden = true;
        wrap.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
    }

    function chooseValue(value) {
        if (selectEl.value === value) {
            closeMenu();
            return;
        }
        selectEl.value = value;
        syncFromSelect();
        closeMenu();
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    trigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (wrap.classList.contains('is-open')) closeMenu();
        else openMenu();
    });
    menu.addEventListener('click', (e) => {
        const li = e.target.closest('.custom-select-option');
        if (!li) return;
        e.stopPropagation();
        chooseValue(li.dataset.value);
    });
    trigger.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!wrap.classList.contains('is-open')) openMenu();
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (!wrap.classList.contains('is-open')) openMenu();
        }
    });
    menu.addEventListener('keydown', (e) => {
        const currentIndex = optionEls.findIndex((li) => li.classList.contains('is-selected'));
        if (e.key === 'Escape') {
            e.preventDefault();
            closeMenu();
            trigger.focus();
            return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const focused = document.activeElement?.closest?.('.custom-select-option');
            if (focused?.dataset.value) chooseValue(focused.dataset.value);
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = optionEls[Math.min(currentIndex + 1, optionEls.length - 1)];
            next?.focus();
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = optionEls[Math.max(currentIndex - 1, 0)];
            prev?.focus();
        }
    });
    optionEls.forEach((li) => { li.tabIndex = -1; });
    syncFromSelect();
    return { sync: syncFromSelect, close: closeMenu };
}
