const KOREAN_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
const JAPANESE_REGEX = /[\u3040-\u309F\u30A0-\u30FF]/;
const CHINESE_REGEX = /[\u4E00-\u9FFF]/;
const CYRILLIC_REGEX = /[\u0400-\u04FF]/;
const ARABIC_REGEX = /[\u0600-\u06FF]/;
const LATIN_REGEX = /[a-zA-Z]/;

const DEFAULT_SOURCE_LANGS = ["auto", "ru", "ko", "en", "ja", "zh", "de", "fr", "es", "it", "pt", "tr", "pl", "uk", "ar"];

let config = {
    enabled: true,
    subtitlesEnabled: true,
    subtitleDuration: 8,
    sourceLangs: DEFAULT_SOURCE_LANGS,
    targetLang: "ru",
    displayMode: "append" // "append" или "replace"
};

// Загружаем настройки из хранилища и только потом инициализируем перевод
chrome.storage.local.get(["enabled", "subtitlesEnabled", "subtitleDuration", "sourceLangs", "targetLang", "koreanOnly", "displayMode"], (res) => {
    if (res.enabled !== undefined) config.enabled = res.enabled;
    if (res.subtitlesEnabled !== undefined) config.subtitlesEnabled = res.subtitlesEnabled;
    if (res.subtitleDuration !== undefined) config.subtitleDuration = parseInt(res.subtitleDuration, 10) || 8;
    if (res.targetLang !== undefined) config.targetLang = res.targetLang;
    if (res.displayMode !== undefined) config.displayMode = res.displayMode;
    if (res.sourceLangs !== undefined && Array.isArray(res.sourceLangs) && res.sourceLangs.length > 0) {
        config.sourceLangs = res.sourceLangs;
        if (config.sourceLangs.includes("auto") && !config.sourceLangs.includes("ru")) {
            config.sourceLangs.push("ru");
        }
    } else if (res.koreanOnly === true) {
        config.sourceLangs = ["ko"];
    } else {
        config.sourceLangs = DEFAULT_SOURCE_LANGS;
    }
    console.log("[Translator Content] Настройки загружены:", config);

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startObserver);
    } else {
        startObserver();
    }
});

// Обновление настроек на лету при изменении в popup + моментальный пересчет существующих сообщений
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
        let needsReTranslate = false;

        if (changes.enabled !== undefined) {
            config.enabled = changes.enabled.newValue;
            needsReTranslate = true;
        }
        if (changes.subtitlesEnabled !== undefined) {
            config.subtitlesEnabled = changes.subtitlesEnabled.newValue;
        }
        if (changes.subtitleDuration !== undefined) {
            config.subtitleDuration = parseInt(changes.subtitleDuration.newValue, 10) || 8;
        }
        if (changes.sourceLangs !== undefined) {
            const newLangs = changes.sourceLangs.newValue;
            if (Array.isArray(newLangs) && newLangs.length > 0) {
                config.sourceLangs = newLangs;
                if (config.sourceLangs.includes("auto") && !config.sourceLangs.includes("ru")) {
                    config.sourceLangs.push("ru");
                }
            } else {
                config.sourceLangs = DEFAULT_SOURCE_LANGS;
            }
            needsReTranslate = true;
        }
        if (changes.targetLang !== undefined && changes.targetLang.newValue !== config.targetLang) {
            config.targetLang = changes.targetLang.newValue;
            needsReTranslate = true;
        }
        if (changes.displayMode !== undefined) {
            config.displayMode = changes.displayMode.newValue;
            needsReTranslate = true;
        }

        console.log("[Translator Content] Настройки обновлены:", config);

        if (needsReTranslate) {
            resetAndReTranslateChat();
        }
    }
});

/**
 * Сброс старых бейджей и мгновенный повторный перевод видимых сообщений на новый целевой язык
 */
function resetAndReTranslateChat() {
    console.log("[Translator Content] Повторный перевод видимых сообщений чата на новый язык:", config.targetLang);

    // 1. Twitch Chat
    const twitchMsgs = Array.from(document.querySelectorAll('div[data-a-target="chat-line-message"], .chat-line__message, .chat-line__status, .seventv-message, .seventv-chat-message'));
    twitchMsgs.forEach(msg => {
        msg.querySelectorAll(".twitch-trans-badge").forEach(b => b.remove());

        const textSpans = msg.querySelectorAll('span[data-a-target="chat-message-text"], .text-fragment');
        textSpans.forEach(s => {
            if (s.dataset.originalText) {
                s.innerText = s.dataset.originalText;
                delete s.dataset.originalText;
            }
        });

        delete msg.dataset.translated;
        delete msg.dataset.translating;
    });

    // Переводим только последние 25 сообщений, чтобы не блокировать API Google
    twitchMsgs.slice(-25).forEach(msg => {
        handleTwitch(msg);
    });

    // 2. YouTube Live Chat
    const ytMsgs = Array.from(document.querySelectorAll("yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer"));
    ytMsgs.forEach(renderer => {
        const messageEl = renderer.querySelector("#message");
        if (messageEl) {
            messageEl.querySelectorAll(".chat-trans-badge").forEach(b => b.remove());
            if (messageEl.dataset.originalText) {
                messageEl.innerText = messageEl.dataset.originalText;
                delete messageEl.dataset.originalText;
            }
        }
        delete renderer.dataset.translated;
        delete renderer.dataset.translating;
    });

    ytMsgs.slice(-25).forEach(renderer => {
        handleYouTubeLive(renderer);
    });
}

/* ==========================================================================
   ОЧЕРЕДЬ ЗАПРОСОВ (Защита от лимитов Google Translate HTTP 429)
   ========================================================================== */

const translationQueue = [];
let isQueueProcessing = false;

function enqueueTranslation(text, sl, tl) {
    return new Promise((resolve) => {
        translationQueue.push({ text, sl, tl, resolve });
        processQueue();
    });
}

async function processQueue() {
    if (isQueueProcessing) return;
    isQueueProcessing = true;

    while (translationQueue.length > 0) {
        // Ограничиваем очередь последними 25 сообщениями
        if (translationQueue.length > 25) {
            const dropped = translationQueue.splice(0, translationQueue.length - 25);
            dropped.forEach(item => item.resolve(null));
        }

        const current = translationQueue.shift();
        if (current) {
            try {
                const result = await sendTranslateMessage(current.text, current.sl, current.tl);
                current.resolve(result);
            } catch (err) {
                console.warn("[Translator Queue Error]", err);
                current.resolve(null);
            }
            // 40мс пауза между сетевыми запросами для предотвращения HTTP 429
            await new Promise(r => setTimeout(r, 40));
        }
    }

    isQueueProcessing = false;
}

function sendTranslateMessage(text, sl, tl) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({
                action: "translate",
                text,
                sl,
                tl
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn("[Translator Content] Ошибка связи с расширением (обновите страницу F5):", chrome.runtime.lastError.message);
                    resolve(null);
                    return;
                }
                if (!response?.success) {
                    console.warn("[Translator Content] Ошибка перевода от background:", response?.error);
                    resolve(null);
                    return;
                }
                resolve(response);
            });
        } catch (e) {
            console.warn("[Translator Content] Ошибка вызова sendMessage (обновите страницу F5):", e);
            resolve(null);
        }
    });
}

/**
 * Быстрая предварительная проверка текста по выбранным языковым направлениям
 */
function shouldTranslatePreCheck(trimmed) {
    if (!trimmed || trimmed.length < 2) return false;

    let selected = config.sourceLangs;
    if (!selected || !selected.length) {
        selected = DEFAULT_SOURCE_LANGS;
    }

    const isAuto = selected.includes("auto") || selected.includes("all");
    const target = (config.targetLang || "ru").toLowerCase();

    const hasKorean = KOREAN_REGEX.test(trimmed);
    const hasJapanese = JAPANESE_REGEX.test(trimmed);
    const hasChinese = CHINESE_REGEX.test(trimmed);
    const hasCyrillic = CYRILLIC_REGEX.test(trimmed);
    const hasArabic = ARABIC_REGEX.test(trimmed);
    const hasLatin = LATIN_REGEX.test(trimmed);

    // Если текст уже на целевом языке, перевод не требуется
    if (target === "ru" && hasCyrillic && !hasKorean && !hasJapanese && !hasChinese && !hasLatin && !hasArabic) {
        return false;
    }
    if (target === "ko" && hasKorean && !hasJapanese && !hasChinese && !hasCyrillic && !hasLatin && !hasArabic) {
        return false;
    }
    if (target === "ja" && hasJapanese && !hasKorean && !hasChinese && !hasCyrillic && !hasLatin && !hasArabic) {
        return false;
    }
    if (target === "ar" && hasArabic && !hasKorean && !hasJapanese && !hasChinese && !hasCyrillic && !hasLatin) {
        return false;
    }
    if (target === "en" && hasLatin && !hasCyrillic && !hasKorean && !hasJapanese && !hasChinese && !hasArabic) {
        const otherLatinSelected = selected.some(l => ["de", "fr", "es", "it", "pt", "pl", "tr"].includes(l));
        if (!isAuto && !otherLatinSelected) {
            return false;
        }
    }

    // Если включен режим авто (по умолчанию), переводим любой язык кроме целевого!
    if (isAuto) return true;

    // Проверка по конкретным выбранным языкам
    if (hasKorean && selected.includes("ko")) return true;
    if (hasJapanese && selected.includes("ja")) return true;
    if (hasChinese && !hasJapanese && (selected.includes("zh") || selected.includes("zh-CN"))) return true;
    if (hasArabic && selected.includes("ar")) return true;
    if (hasCyrillic && (selected.includes("ru") || selected.includes("uk"))) return true;

    const latinLangs = ["en", "de", "fr", "es", "it", "pt", "tr", "pl"];
    if (hasLatin && selected.some(l => latinLangs.includes(l))) {
        return true;
    }

    return false;
}

/**
 * Запрос перевода в Service Worker через очередь
 */
function requestTranslation(text) {
    return new Promise((resolve) => {
        if (!config.enabled) return resolve(null);
        
        const trimmed = (text || "").trim();
        if (!trimmed || trimmed.length < 2) return resolve(null);

        // Пре-проверка по выбранным языковым направлениям
        if (!shouldTranslatePreCheck(trimmed)) {
            return resolve(null);
        }

        let selected = config.sourceLangs;
        if (!selected || !selected.length) selected = DEFAULT_SOURCE_LANGS;

        const isAuto = selected.includes("auto") || selected.includes("all");
        const target = (config.targetLang || "ru").toLowerCase();

        const hasKorean = KOREAN_REGEX.test(trimmed);
        const hasJapanese = JAPANESE_REGEX.test(trimmed);
        const hasChinese = CHINESE_REGEX.test(trimmed);
        const hasArabic = ARABIC_REGEX.test(trimmed);
        const hasCyrillic = CYRILLIC_REGEX.test(trimmed);

        let sl = "auto";
        if (hasKorean) sl = "ko";
        else if (hasJapanese) sl = "ja";
        else if (hasChinese) sl = "zh-CN";
        else if (hasArabic) sl = "ar";
        else if (hasCyrillic) sl = selected.includes("uk") && !selected.includes("ru") ? "uk" : "ru";
        else if (selected.length === 1 && !isAuto) sl = selected[0];

        enqueueTranslation(trimmed, sl, target).then((response) => {
            if (!response || !response.translatedText) {
                resolve(null);
                return;
            }

            const det = (response.detectedLang || sl || "").toLowerCase().split("-")[0];
            const targetNorm = target.split("-")[0];

            // Если распознанный язык совпадает с целевым, перевод не нужен
            if (det && det === targetNorm) {
                resolve(null);
                return;
            }

            // Пост-проверка: если не режим "Все языки (авто)", убеждаемся что язык входит в выбранные
            if (!isAuto && det) {
                const matches = selected.some(l => l.toLowerCase().split("-")[0] === det);
                if (!matches) {
                    console.log(`[Translator Skip] Язык "${det}" не входит в выбранные:`, selected);
                    resolve(null);
                    return;
                }
            }

            // Если результат перевода идентичен исходному тексту, не показываем
            if (response.translatedText.toLowerCase().replace(/[\s\p{P}]/gu, "") === trimmed.toLowerCase().replace(/[\s\p{P}]/gu, "")) {
                resolve(null);
                return;
            }

            resolve(response.translatedText);
        });
    });
}

/* ==========================================================================
   1. ПЕРЕВОД ЧАТА (YOUTUBE & TWITCH)
   ========================================================================== */

function handleYouTubeLive(renderer) {
    if (!config.enabled || !renderer) return;
    if (renderer.dataset.translating === "true" || renderer.dataset.translated === "true") return;

    const messageEl = renderer.querySelector("#message");
    if (!messageEl || messageEl.querySelector(".chat-trans-badge")) return;

    const originalText = messageEl.innerText.trim();
    if (!originalText || !shouldTranslatePreCheck(originalText)) return;

    renderer.dataset.translating = "true";

    requestTranslation(originalText).then((translated) => {
        delete renderer.dataset.translating;
        if (!translated || messageEl.querySelector(".chat-trans-badge")) return;
        renderer.dataset.translated = "true";

        const targetBadge = (config.targetLang || "ru").toUpperCase();

        if (config.displayMode === "replace") {
            messageEl.dataset.originalText = originalText;
            messageEl.setAttribute("title", `Оригинал: ${originalText}`);
            messageEl.innerText = `${translated} `;
            const tag = document.createElement("span");
            tag.className = "chat-trans-badge";
            tag.style.cssText = "color: #ff9e22; font-size: 0.8em; opacity: 0.85; margin-left: 4px; font-weight: bold;";
            tag.textContent = `[${targetBadge}]`;
            messageEl.appendChild(tag);
        } else {
            const badge = document.createElement("span");
            badge.className = "chat-trans-badge";
            badge.style.cssText = "color: #ff9e22; margin-left: 6px; font-weight: 600; font-size: 0.95em;";
            badge.textContent = `[${targetBadge}: ${translated}]`;
            badge.title = `Оригинал: ${originalText}`;
            messageEl.appendChild(badge);
        }
    });
}

function handleYouTubeComment(commentEl) {
    if (!config.enabled || !commentEl) return;
    if (commentEl.dataset.translating === "true" || commentEl.dataset.translated === "true") return;

    const originalText = commentEl.innerText.trim();
    if (!originalText || !shouldTranslatePreCheck(originalText)) return;

    commentEl.dataset.translating = "true";

    requestTranslation(originalText).then((translated) => {
        delete commentEl.dataset.translating;
        if (!translated || commentEl.querySelector(".yt-comment-trans-badge")) return;
        commentEl.dataset.translated = "true";

        const targetBadge = (config.targetLang || "ru").toUpperCase();
        const badge = document.createElement("div");
        badge.className = "yt-comment-trans-badge";
        badge.style.cssText = "color: #3ea6ff; margin-top: 5px; font-size: 0.95em; font-weight: 500; line-height: 1.4;";
        badge.textContent = `[${targetBadge}: ${translated}]`;
        badge.title = `Оригинал: ${originalText}`;
        commentEl.appendChild(badge);
    });
}

function handleTwitch(messageDiv) {
    if (!config.enabled || !messageDiv) return;
    if (messageDiv.dataset.translating === "true" || messageDiv.dataset.translated === "true") return;

    // 1. Сначала ищем непосредственные текстовые элементы
    let textSpans = Array.from(messageDiv.querySelectorAll('span[data-a-target="chat-message-text"], .text-fragment, .seventv-chat-message-body .text-token'));
    
    // 2. Если конкретных спанов нет, ищем общее тело сообщения
    if (!textSpans.length) {
        const bodyEl = messageDiv.querySelector('.chat-line__message-body, .chat-line__message--body, [data-test-selector="chat-line-message-body"], .seventv-chat-message-body');
        if (bodyEl) {
            textSpans = [bodyEl];
        }
    }
    if (!textSpans.length) return;

    const originalText = textSpans.map(s => s.innerText).join(" ").trim();
    if (!originalText || !shouldTranslatePreCheck(originalText)) return;

    messageDiv.dataset.translating = "true";

    requestTranslation(originalText).then((translated) => {
        delete messageDiv.dataset.translating;
        if (!translated || messageDiv.querySelector(".twitch-trans-badge")) return;
        messageDiv.dataset.translated = "true";

        const lastSpan = textSpans[textSpans.length - 1];
        if (!lastSpan) return;

        const targetBadge = (config.targetLang || "ru").toUpperCase();

        if (config.displayMode === "replace") {
            textSpans.forEach(s => {
                s.dataset.originalText = s.innerText;
                s.setAttribute("title", `Оригинал: ${s.innerText}`);
                s.innerText = "";
            });
            lastSpan.innerText = translated;
            const tag = document.createElement("span");
            tag.className = "twitch-trans-badge";
            tag.style.cssText = "color: #a970ff; font-size: 0.8em; opacity: 0.85; margin-left: 4px; font-weight: bold;";
            tag.textContent = `[${targetBadge}]`;
            if (typeof lastSpan.after === "function") {
                lastSpan.after(tag);
            } else if (lastSpan.parentNode) {
                lastSpan.parentNode.appendChild(tag);
            }
        } else {
            const badge = document.createElement("span");
            badge.className = "twitch-trans-badge";
            badge.style.cssText = "color: #a970ff; margin-left: 6px; font-weight: 600;";
            badge.textContent = `[${targetBadge}: ${translated}]`;
            badge.title = `Оригинал: ${originalText}`;
            if (typeof lastSpan.after === "function") {
                lastSpan.after(badge);
            } else if (lastSpan.parentNode) {
                lastSpan.parentNode.appendChild(badge);
            }
        }
    });
}

function processChatNodes(node) {
    if (!node || node.nodeType !== 1) return;

    // YouTube Live Chat
    const ytLive = node.matches?.("yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer")
        ? node
        : node.closest?.("yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer");

    if (ytLive) {
        handleYouTubeLive(ytLive);
    } else {
        node.querySelectorAll?.("yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer")
            ?.forEach(handleYouTubeLive);
    }

    // YouTube Comments
    const ytComment = node.matches?.("#content-text") ? node : node.closest?.("#content-text");
    if (ytComment) {
        handleYouTubeComment(ytComment);
    } else {
        node.querySelectorAll?.("#content-text")?.forEach(handleYouTubeComment);
    }

    // Twitch Chat (Поддержка стандартного Twitch, 7TV, BTTV, FFZ)
    const twitchMsg = node.matches?.('div[data-a-target="chat-line-message"], .chat-line__message, .chat-line__status, .seventv-message, .seventv-chat-message')
        ? node
        : node.closest?.('div[data-a-target="chat-line-message"], .chat-line__message, .chat-line__status, .seventv-message, .seventv-chat-message');

    if (twitchMsg) {
        handleTwitch(twitchMsg);
    } else {
        node.querySelectorAll?.('div[data-a-target="chat-line-message"], .chat-line__message, .chat-line__status, .seventv-message, .seventv-chat-message')
            ?.forEach(handleTwitch);
    }
}

/* ==========================================================================
   2. ПЕРЕВОД РЕЧИ И СУБТИТРОВ НА ЭКРАНЕ (YOUTUBE & TWITCH VIDEO OVERLAY)
   ========================================================================== */

let lastSubtitleText = "";
let subtitleDebounceTimer = null;
let subtitleClearTimer = null;
let autoEnableAttempted = false;
let previousSubtitleLine = "";
let currentSubtitleLine = "";

/**
 * Автоматическое включение субтитров YouTube, если они доступны
 */
function tryAutoEnableSubtitles() {
    if (!config.enabled || !config.subtitlesEnabled || autoEnableAttempted) return;
    
    const subButton = document.querySelector(".ytp-subtitles-button");
    if (subButton && subButton.getAttribute("aria-pressed") === "false" && subButton.getAttribute("aria-disabled") !== "true") {
        console.log("[Translator] Автоматическое включение субтитров YouTube...");
        subButton.click();
        autoEnableAttempted = true;
    }
}

/**
 * Отображение переведенных субтитров в плавающей плашке на видео
 */
function showSubtitleOverlay(translatedText, originalText) {
    if (!config.enabled || !config.subtitlesEnabled) return;

    let overlay = document.getElementById("stream-trans-subtitle-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "stream-trans-subtitle-overlay";
        overlay.style.cssText = `
            position: absolute !important;
            bottom: 80px !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            background: rgba(10, 10, 15, 0.92) !important;
            color: #ffffff !important;
            padding: 10px 22px !important;
            border-radius: 8px !important;
            font-size: 20px !important;
            font-weight: 600 !important;
            text-align: center !important;
            max-width: 88% !important;
            z-index: 2147483647 !important;
            pointer-events: none !important;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.8) !important;
            border: 1px solid rgba(255, 184, 77, 0.6) !important;
            transition: opacity 0.25s ease !important;
            line-height: 1.4 !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
            text-shadow: 1px 1px 3px rgba(0,0,0,0.9) !important;
        `;

        const playerContainer = document.querySelector("#movie_player, .html5-video-player, .video-player") || document.body;
        playerContainer.appendChild(overlay);
    }

    const targetBadge = (config.targetLang || "ru").toUpperCase();
    const cleanCurrent = (translatedText || "").trim();

    // Запоминаем предыдущую строку для буфера (чтобы зритель успевал дочитать)
    if (currentSubtitleLine && currentSubtitleLine !== cleanCurrent) {
        previousSubtitleLine = currentSubtitleLine;
    }
    currentSubtitleLine = cleanCurrent;

    let html = "";
    if (previousSubtitleLine && previousSubtitleLine !== currentSubtitleLine) {
        html += `<div style="opacity: 0.65; font-size: 0.82em; margin-bottom: 4px; font-weight: normal; color: #d0d0d8;">${previousSubtitleLine}</div>`;
    }
    html += `<div><span style="color: #ffb84d; font-size: 0.85em; margin-right: 8px; font-weight: bold;">[${targetBadge}]</span>${currentSubtitleLine}</div>`;

    overlay.innerHTML = html;
    overlay.style.display = "block";
    overlay.style.opacity = "1";

    const durationSeconds = Math.max(3, parseInt(config.subtitleDuration, 10) || 8);
    const durationMs = durationSeconds * 1000;

    if (subtitleClearTimer) clearTimeout(subtitleClearTimer);
    subtitleClearTimer = setTimeout(() => {
        if (overlay) {
            overlay.style.opacity = "0";
            setTimeout(() => {
                if (overlay) overlay.style.display = "none";
                previousSubtitleLine = "";
                currentSubtitleLine = "";
            }, 300);
        }
    }, durationMs);
}

/**
 * Проверка появления субтитров на экране видео
 */
function checkLiveSubtitles() {
    if (!config.enabled || !config.subtitlesEnabled) return;

    tryAutoEnableSubtitles();

    // 1. YouTube Субтитры (.ytp-caption-segment)
    const ytSegments = document.querySelectorAll(".ytp-caption-segment");
    if (ytSegments.length > 0) {
        const rawText = Array.from(ytSegments).map(s => s.innerText).join(" ").trim();
        if (rawText && rawText !== lastSubtitleText && rawText.length >= 2 && shouldTranslatePreCheck(rawText)) {
            lastSubtitleText = rawText;

            clearTimeout(subtitleDebounceTimer);
            subtitleDebounceTimer = setTimeout(() => {
                requestTranslation(rawText).then(translated => {
                    if (translated) {
                        showSubtitleOverlay(translated, rawText);
                        ytSegments.forEach(seg => {
                            seg.style.color = "#ffb84d";
                        });
                    }
                });
            }, 450);
        }
        return;
    }

    // 2. Twitch Субтитры (.player-captions__line)
    const twitchCaps = document.querySelectorAll(".player-captions__line, .player-captions-container p, .closed-captions-osd");
    if (twitchCaps.length > 0) {
        const rawText = Array.from(twitchCaps).map(s => s.innerText).join(" ").trim();
        if (rawText && rawText !== lastSubtitleText && rawText.length >= 2 && shouldTranslatePreCheck(rawText)) {
            lastSubtitleText = rawText;

            clearTimeout(subtitleDebounceTimer);
            subtitleDebounceTimer = setTimeout(() => {
                requestTranslation(rawText).then(translated => {
                    if (translated) {
                        showSubtitleOverlay(translated, rawText);
                    }
                });
            }, 450);
        }
    }
}

/* ==========================================================================
   3. ИНИЦИАЛИЗАЦИЯ
   ========================================================================== */

let isStarted = false;
function startObserver() {
    if (isStarted) return;
    isStarted = true;
    console.log("[Translator Content] Запущен на странице:", window.location.href);

    // Первоначальный проход по элементам
    document.querySelectorAll("yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer")
        .forEach(handleYouTubeLive);
    document.querySelectorAll("#content-text").forEach(handleYouTubeComment);
    document.querySelectorAll('div[data-a-target="chat-line-message"], .chat-line__message, .chat-line__status, .seventv-message, .seventv-chat-message')
        .forEach(handleTwitch);

    // Наблюдатель за новыми элементами в DOM
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                processChatNodes(node);
            }
        }
        checkLiveSubtitles();
    });

    observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
    });

    // Регулярный опрос субтитров видео (каждые 350мс)
    setInterval(checkLiveSubtitles, 350);
}