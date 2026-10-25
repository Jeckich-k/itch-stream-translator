const translations = {};
let currentLanguage = "en";

export async function loadTranslations(lang) {
    try {
        // console.log("loadTranslations start", lang);
        if (!lang) lang = "en";

        if (translations[lang]) {
            currentLanguage = lang;
            return true;
        }

        const url = chrome.runtime.getURL(`locales/${lang}.json`);
        const response = await fetch(url);
        if (!response.ok) console.log(`Cannot load translation file: ${lang}.json`);

        translations[lang] = await response.json();
        currentLanguage = lang;
        // console.log("loadTranslations done", lang);

        return true;
    } catch (error) {
        console.warn(`loadTranslations error for lang "${lang}":`, error);
        currentLanguage = "en";
        return false;
    }
}

export function t(key, variables = {}) {
    // console.log("t called with lang =", currentLanguage);
    let translation = key.split('.').reduce((obj, k) => obj?.[k], translations[currentLanguage]);
    // console.log(`t("${key}")`, translation);
    if (!translation) {
        translation = key.split('.').reduce((obj, k) => obj?.[k], translations['en']);
    }

    if (!translation) {
        console.warn(`Missing translation for key: "${key}"`);
        return key;
    }

    return translation.replace(/{(\w+)}/g, (_, varName) => variables[varName] ?? `{${varName}}`);
}

export function getCurrentLanguage() {
    return currentLanguage;
}