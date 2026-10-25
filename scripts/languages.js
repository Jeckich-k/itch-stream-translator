const translations = {};
let currentLanguage = "ru";

export async function loadTranslations(lang) {
    try {
        if (!lang) lang = "ru";

        if (translations[lang]) {
            currentLanguage = lang;
            return true;
        }

        const url = chrome.runtime.getURL(`locales/${lang}.json`);
        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`Cannot load translation file: ${lang}.json`);
            return false;
        }

        translations[lang] = await response.json();
        currentLanguage = lang;
        return true;
    } catch (error) {
        console.warn(`loadTranslations error for lang "${lang}":`, error);
        currentLanguage = lang || "ru";
        return false;
    }
}

export function t(key, variables = {}) {
    let translation = key.split('.').reduce((obj, k) => obj?.[k], translations[currentLanguage]);
    if (!translation) {
        const fallback = currentLanguage === 'ru' ? 'en' : 'ru';
        translation = key.split('.').reduce((obj, k) => obj?.[k], translations[fallback]);
    }

    if (!translation) {
        return key;
    }

    return translation.replace(/{(\w+)}/g, (_, varName) => variables[varName] ?? `{${varName}}`);
}

export function getCurrentLanguage() {
    return currentLanguage;
}

export function applyHtmlTranslations() {
    // 1. Text elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        const val = t(key);
        if (val && val !== key) {
            el.innerHTML = val;
        }
    });

    // 2. Title tooltips
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.dataset.i18nTitle;
        const val = t(key);
        if (val && val !== key) {
            el.title = val;
        }
    });

    // 3. Placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.dataset.i18nPlaceholder;
        const val = t(key);
        if (val && val !== key) {
            el.placeholder = val;
        }
    });

    document.documentElement.lang = currentLanguage;
}
