document.addEventListener("DOMContentLoaded", async () => {
    const toggleEnabled = document.getElementById("toggle-enabled");
    const toggleSubtitles = document.getElementById("toggle-subtitles");
    const selectTargetLang = document.getElementById("select-target-lang");
    const targetPills = document.querySelectorAll(".target-pill");
    const tagPreviewSample = document.getElementById("tag-preview-sample");
    const sourceLangCheckboxes = document.querySelectorAll('input[name="source-lang"]');
    const btnSelectAll = document.getElementById("btn-select-all");
    const btnSelectRuOnly = document.getElementById("btn-select-ru-only");
    const btnSelectKoOnly = document.getElementById("btn-select-ko-only");
    const btnDeselectAll = document.getElementById("btn-deselect-all");
    const displayModeRadios = document.querySelectorAll('input[name="display-mode"]');
    const statusIndicator = document.getElementById("status-indicator");
    const statsCount = document.getElementById("stats-count");
    const btnClearCache = document.getElementById("btn-clear-cache");
    const sliderSubtitleSpeed = document.getElementById("slider-subtitle-speed");
    const speedValueBadge = document.getElementById("speed-value");
    const speedButtons = document.querySelectorAll(".speed-btn");

    // 1. Загрузка настроек
    const settings = await chrome.storage.local.get([
        "enabled",
        "subtitlesEnabled",
        "subtitleDuration",
        "targetLang",
        "sourceLangs",
        "koreanOnly",
        "displayMode",
        "translatedCount"
    ]);

    const enabled = settings.enabled ?? true;
    const subtitlesEnabled = settings.subtitlesEnabled ?? true;
    const subtitleDuration = settings.subtitleDuration ?? 8;
    const targetLang = settings.targetLang || "ru";
    const displayMode = settings.displayMode || "append";
    const count = settings.translatedCount || 0;

    toggleEnabled.checked = enabled;
    toggleSubtitles.checked = subtitlesEnabled;
    statsCount.textContent = count;

    if (sliderSubtitleSpeed) {
        sliderSubtitleSpeed.value = subtitleDuration;
    }
    updateSpeedUI(subtitleDuration);

    if (selectTargetLang) {
        selectTargetLang.value = targetLang;
    }
    updateTargetPills(targetLang);
    updatePreview(targetLang);

    // Исходные языки (множественный выбор)
    const allAvailableLangs = Array.from(sourceLangCheckboxes).map(cb => cb.value);
    let sourceLangs = settings.sourceLangs;

    if (!sourceLangs || !Array.isArray(sourceLangs) || !sourceLangs.length) {
        if (settings.koreanOnly === true) {
            sourceLangs = ["ko"];
        } else {
            sourceLangs = allAvailableLangs;
        }
    }

    if (sourceLangs && (sourceLangs.includes("auto") || sourceLangs.includes("all")) && !sourceLangs.includes("ru")) {
        sourceLangs.push("ru");
        chrome.storage.local.set({ sourceLangs });
    }

    sourceLangCheckboxes.forEach(cb => {
        cb.checked = sourceLangs.includes(cb.value);
    });

    displayModeRadios.forEach(radio => {
        radio.checked = (radio.value === displayMode);
    });

    updateStatusUI(enabled);

    // 2. Обработчики изменений
    toggleEnabled.addEventListener("change", () => {
        const isEnabled = toggleEnabled.checked;
        chrome.storage.local.set({ enabled: isEnabled });
        updateStatusUI(isEnabled);
    });

    toggleSubtitles.addEventListener("change", () => {
        chrome.storage.local.set({ subtitlesEnabled: toggleSubtitles.checked });
    });

    function setTargetLang(lang) {
        if (!lang) return;
        if (selectTargetLang) {
            selectTargetLang.value = lang;
        }
        updateTargetPills(lang);
        updatePreview(lang);
        chrome.storage.local.set({ targetLang: lang });
    }

    if (selectTargetLang) {
        selectTargetLang.addEventListener("change", () => {
            setTargetLang(selectTargetLang.value);
        });
    }

    targetPills.forEach(pill => {
        pill.addEventListener("click", () => {
            setTargetLang(pill.dataset.lang);
        });
    });

    function updateTargetPills(selectedLang) {
        targetPills.forEach(pill => {
            if (pill.dataset.lang === selectedLang) {
                pill.classList.add("active");
            } else {
                pill.classList.remove("active");
            }
        });
    }

    function updatePreview(tl) {
        if (tagPreviewSample) {
            tagPreviewSample.textContent = `[${(tl || "ru").toUpperCase()}: перевод]`;
        }
    }

    function saveSourceLangs() {
        let selected = Array.from(sourceLangCheckboxes)
            .filter(c => c.checked)
            .map(c => c.value);

        if (!selected.length) {
            // Защита: если все чекбоксы сняты, возвращаем "Все языки (авто)", чтобы расширение не отключалось полностью
            selected = ["auto"];
            const autoCb = document.querySelector('input[name="source-lang"][value="auto"]');
            if (autoCb) autoCb.checked = true;
        }

        chrome.storage.local.set({ 
            sourceLangs: selected,
            koreanOnly: selected.length === 1 && selected[0] === "ko"
        });
    }

    sourceLangCheckboxes.forEach(cb => {
        cb.addEventListener("change", () => {
            if (cb.value === "auto") {
                if (cb.checked) {
                    sourceLangCheckboxes.forEach(c => c.checked = true);
                }
            } else {
                if (!cb.checked) {
                    const autoCb = document.querySelector('input[name="source-lang"][value="auto"]');
                    if (autoCb) autoCb.checked = false;
                }
            }
            saveSourceLangs();
        });
    });

    if (btnSelectAll) {
        btnSelectAll.addEventListener("click", () => {
            sourceLangCheckboxes.forEach(cb => cb.checked = true);
            saveSourceLangs();
        });
    }

    if (btnSelectRuOnly) {
        btnSelectRuOnly.addEventListener("click", () => {
            sourceLangCheckboxes.forEach(cb => {
                cb.checked = (cb.value === "ru");
            });
            saveSourceLangs();
        });
    }

    if (btnSelectKoOnly) {
        btnSelectKoOnly.addEventListener("click", () => {
            sourceLangCheckboxes.forEach(cb => {
                cb.checked = (cb.value === "ko");
            });
            saveSourceLangs();
        });
    }

    if (btnDeselectAll) {
        btnDeselectAll.addEventListener("click", () => {
            sourceLangCheckboxes.forEach(cb => cb.checked = false);
            saveSourceLangs();
        });
    }

    displayModeRadios.forEach(radio => {
        radio.addEventListener("change", () => {
            if (radio.checked) {
                chrome.storage.local.set({ displayMode: radio.value });
            }
        });
    });

    // Управление скоростью / временем показа субтитров
    function updateSpeedUI(duration) {
        if (speedValueBadge) {
            speedValueBadge.textContent = `${duration} сек`;
        }
        speedButtons.forEach(btn => {
            if (parseInt(btn.dataset.speed, 10) === parseInt(duration, 10)) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });
    }

    if (sliderSubtitleSpeed) {
        sliderSubtitleSpeed.addEventListener("input", (e) => {
            const val = parseInt(e.target.value, 10);
            updateSpeedUI(val);
        });

        sliderSubtitleSpeed.addEventListener("change", (e) => {
            const val = parseInt(e.target.value, 10);
            chrome.storage.local.set({ subtitleDuration: val });
        });
    }

    speedButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const val = parseInt(btn.dataset.speed, 10);
            if (sliderSubtitleSpeed) {
                sliderSubtitleSpeed.value = val;
            }
            updateSpeedUI(val);
            chrome.storage.local.set({ subtitleDuration: val });
        });
    });

    btnClearCache.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "clearCache" }, (res) => {
            if (res?.success) {
                statsCount.textContent = "0";
                btnClearCache.textContent = "Очищено!";
                setTimeout(() => {
                    btnClearCache.textContent = "Сбросить кэш";
                }, 1500);
            }
        });
    });

    function updateStatusUI(isOn) {
        if (isOn) {
            statusIndicator.textContent = "Активен";
            statusIndicator.className = "status-badge status-on";
        } else {
            statusIndicator.textContent = "Выключен";
            statusIndicator.className = "status-badge status-off";
        }
    }
});