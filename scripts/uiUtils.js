export function safeAdd(element, event, handler) {
    // console.log("Пробуем повесить обработчик на", element);
    // if (!element) {
    //     console.warn("❌ Элемент не найден!");
    //     return;
    // }

    // if (element.dataset.listenerAttached === 'true') {
    //     console.log("⚠️ Обработчик уже был добавлен");
    //     return;
    // }
    if (!element || element.dataset.listenerAttached === 'true') return;
    element.dataset.listenerAttached = 'true';
    element.addEventListener(event, handler);
}

function isCoolingDown(button) {
    return buttonCooldowns.has(button);
}

function applyCooldown(button, duration = 3000) {
    buttonCooldowns.set(button, true);
    button.disabled = true;
    button.style.pointerEvents = 'none';
    button.style.opacity = '0.6';

    setTimeout(() => {
        buttonCooldowns.delete(button);
        button.disabled = false;
        button.style.pointerEvents = '';
        button.style.opacity = '1';
    }, duration);
}

export function withButtonCooldown(button, handler, duration = 3000) {
    return (...args) => {
        if (isCoolingDown(button)) return;
        applyCooldown(button, duration);
        handler(...args);
    };
}

export function withAsyncCooldown(button, handler, duration = 3000) {
    return async (...args) => {
        if (isCoolingDown(button)) return;
        applyCooldown(button, duration);
        await handler(...args);
    };
}

export function debounce(func, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), delay);
    };
}

export function setCountdownText(button, originalText, seconds) {
    let remaining = seconds;
    button.textContent = `Wait ${remaining} seconds...`;

    const interval = setInterval(() => {
        remaining--;
        if (remaining > 0) {
            button.textContent = `Wait ${remaining} seconds...`;
        } else {
            clearInterval(interval);
            button.textContent = originalText;
        }
    }, 1000);
}

const buttonCooldowns = new Map();
