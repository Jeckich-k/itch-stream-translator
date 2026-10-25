const translationCache = new Map();

function incrementTranslatedCount() {
    chrome.storage.local.get(["translatedCount"], (res) => {
        const count = (res.translatedCount || 0) + 1;
        chrome.storage.local.set({ translatedCount: count });
    });
}

/**
 * Перевод текста через Google Translate API с автоматическим резервным endpoint при ошибках/лимитах (429)
 */
async function translateText(text, sl = "auto", tl = "ru") {
    const trimmed = (text || "").trim();
    if (!trimmed) {
        return { success: false, error: "Empty text" };
    }

    const cacheKey = `${sl}_${tl}_${trimmed}`;
    if (translationCache.has(cacheKey)) {
        return { 
            success: true, 
            translatedText: translationCache.get(cacheKey), 
            fromCache: true 
        };
    }

    // 1. Попытка через основной endpoint (gtx)
    try {
        const url1 = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(trimmed)}`;
        const response1 = await fetch(url1);
        
        if (response1.ok) {
            const data1 = await response1.json();
            const translatedText = data1[0]?.map(item => item[0]).join("").trim();
            const detectedLang = data1[2];

            if (translatedText) {
                translationCache.set(cacheKey, translatedText);
                if (translationCache.size > 2000) {
                    const firstKey = translationCache.keys().next().value;
                    translationCache.delete(firstKey);
                }
                incrementTranslatedCount();
                console.log(`[Translate OK] (${sl} -> ${tl}) "${trimmed}" => "${translatedText}"`);
                return { success: true, translatedText, detectedLang };
            }
        } else {
            console.warn(`[Translate gtx warning] HTTP ${response1.status}, переключаемся на резервный endpoint...`);
        }
    } catch (err) {
        console.warn("[Translate gtx error]", err.message);
    }

    // 2. Резервный endpoint (dict-chrome-ex) при сбоях или rate limit (429) первого
    try {
        const url2 = `https://translate.googleapis.com/translate_a/t?client=dict-chrome-ex&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(trimmed)}`;
        const response2 = await fetch(url2);

        if (response2.ok) {
            const data2 = await response2.json();
            let translatedText = "";
            if (Array.isArray(data2)) {
                if (Array.isArray(data2[0])) {
                    translatedText = data2[0].map(item => (Array.isArray(item) ? item[0] : item)).join("").trim();
                } else if (typeof data2[0] === "string") {
                    translatedText = data2.join("").trim();
                }
            } else if (typeof data2 === "string") {
                translatedText = data2.trim();
            }

            if (translatedText) {
                translationCache.set(cacheKey, translatedText);
                incrementTranslatedCount();
                console.log(`[Translate Fallback OK] (${sl} -> ${tl}) "${trimmed}" => "${translatedText}"`);
                return { success: true, translatedText, detectedLang: sl };
            }
        } else {
            console.warn(`[Translate fallback warning] HTTP ${response2.status}`);
        }
    } catch (err) {
        console.warn("[Translate fallback error]", err.message);
    }

    return { success: false, error: "Both primary and fallback translation endpoints failed" };
}

// Слушатель сообщений
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "translate") {
        translateText(message.text, message.sl || "auto", message.tl || "ru")
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (message.action === "clearCache") {
        translationCache.clear();
        chrome.storage.local.set({ translatedCount: 0 }, () => {
            sendResponse({ success: true });
        });
        return true;
    }

    if (message.action === "getStats") {
        chrome.storage.local.get(["translatedCount"], (res) => {
            sendResponse({ 
                translatedCount: res.translatedCount || 0,
                cacheSize: translationCache.size 
            });
        });
        return true;
    }
});

const DEFAULT_SOURCE_LANGS = ["auto", "ru", "ko", "en", "ja", "zh", "de", "fr", "es", "it", "pt", "tr", "pl", "uk", "ar"];

// Стандартные настройки
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(["enabled", "subtitlesEnabled", "subtitleDuration", "sourceLangs", "targetLang", "koreanOnly", "displayMode", "uiLanguage"], (res) => {
        const defaults = {};
        if (res.enabled === undefined) defaults.enabled = true;
        if (res.subtitlesEnabled === undefined) defaults.subtitlesEnabled = true;
        if (res.subtitleDuration === undefined) defaults.subtitleDuration = 8;
        if (res.targetLang === undefined) defaults.targetLang = "ru";
        if (res.displayMode === undefined) defaults.displayMode = "append";
        if (res.uiLanguage === undefined) defaults.uiLanguage = "ru";

        if (res.sourceLangs === undefined) {
            if (res.koreanOnly === true) {
                defaults.sourceLangs = ["ko"];
            } else {
                defaults.sourceLangs = DEFAULT_SOURCE_LANGS;
            }
        }

        chrome.storage.local.set(defaults);
    });
    console.log("[Live Chat & Speech Translator] Ready.");
});
