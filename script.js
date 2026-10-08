// ---------- GUI & FONT SIZE CONTROLS ----------
function changeGuiSize(factor) {
    let currentSize = parseFloat(localStorage.getItem("guiSize") || "1");
    currentSize *= factor;
    currentSize = Math.max(0.5, Math.min(2, currentSize));
    localStorage.setItem("guiSize", String(currentSize));
    applyGuiSize();
}

function resetGuiSize() {
    localStorage.setItem("guiSize", "1");
    applyGuiSize();
}

function applyGuiSize() {
    const size = Math.max(0.5, Math.min(2, parseFloat(localStorage.getItem("guiSize") || "1")));
    document.documentElement.style.setProperty("--gui-scale", String(size));
    document.body.style.transform = `scale(${size})`;
    document.body.style.transformOrigin = "top center";
    document.body.style.width = `${100 / size}%`;
}

function changeFontSize(factor) {
    let currentSize = parseFloat(localStorage.getItem("fontSize") || "18");
    currentSize *= factor;
    currentSize = Math.max(10, Math.min(40, currentSize));
    localStorage.setItem("fontSize", String(currentSize));
    applyFontSize();
}

function applyFontSize() {
    const size = Math.max(10, Math.min(40, parseFloat(localStorage.getItem("fontSize") || "18")));
    document.documentElement.style.setProperty("--base-font-size", `${size}px`);
}

// ---------- SSC-STYLE TEXT EVALUATION ----------
// The evaluator deliberately ignores commas and semicolons for practice.
// SSC's published Stenography guidelines explicitly classify omissions,
// substitutions, additions, repetitions and incomplete words as full
// mistakes, and spelling, singular/plural, sentence-start case,
// proper-noun capitalization and full-stop errors as half mistakes.
// Comma/semicolon treatment is kept configurable here because SSC's
// published stenography guideline does not explicitly define those marks.

function normalizeSpace(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
}

function tokenize(text) {
    const normalized = normalizeSpace(text);
    return normalized ? normalized.split(" ") : [];
}

function stripIgnoredPunctuation(word) {
    // User-requested practice behavior: commas and semicolons do not count.
    return String(word || "").replace(/[,;]/g, "");
}

function wordCore(word) {
    return stripIgnoredPunctuation(word).replace(/^[^\p{L}\p{N}’'-]+|[^\p{L}\p{N}’'.-]+$/gu, "");
}

function wordLetters(word) {
    // Word comparison ignores punctuation/case so comma differences cannot
    // create a word error. Full stops are checked separately.
    return wordCore(word)
        .toLocaleLowerCase()
        .replace(/[’'.,!?;:"“”‘’()\[\]{}]/gu, "");
}

function wordLettersExactCase(word) {
    // Used by alignment so capitalization differences remain visible to the
    // evaluator instead of being treated as a perfect match.
    return wordCore(word)
        .replace(/[’'.,!?;:"“”‘’()\[\]{}]/gu, "");
}

function hasAnyLetters(word) {
    return /[A-Za-zÀ-ÖØ-öø-ÿ]/u.test(wordCore(word));
}

function isAllCapsWord(word) {
    const core = wordCore(word);
    const letters = core.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/gu);
    return !!letters && letters.length > 0 && letters.every(ch => ch === ch.toUpperCase());
}

function isSentenceStart(originalWords, index) {
    if (index === 0) return true;
    const previous = stripIgnoredPunctuation(originalWords[index - 1]);
    return /[.!?]["'’”»)]*$/u.test(previous);
}

function isLowercaseAtSentenceStart(original, typed, originalWords, index) {
    if (!isSentenceStart(originalWords, index)) return false;
    const expected = wordCore(original);
    const actual = wordCore(typed);
    if (!expected || !actual) return false;
    const expectedFirst = expected.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/u);
    const actualFirst = actual.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/u);
    return !!expectedFirst && !!actualFirst &&
        expectedFirst[0] === expectedFirst[0].toUpperCase() &&
        actualFirst[0] === actualFirst[0].toLowerCase() &&
        wordLetters(expected) === wordLetters(actual);
}

function likelyProperNoun(original, index, originalWords) {
    const core = wordCore(original);
    if (!core || !/^[A-ZÀ-ÖØ-Þ]/u.test(core)) return false;
    // Sentence-start capitalization is handled separately.
    if (isSentenceStart(originalWords, index)) return false;
    // Conservative heuristic: a non-sentence-start word that is capitalized
    // in the master passage is treated as a proper noun candidate.
    return true;
}

function singularPluralEquivalent(a, b) {
    const x = wordLetters(a);
    const y = wordLetters(b);
    if (!x || !y || x === y) return false;

    const variants = new Set();
    function addPlural(base) {
        variants.add(base + "s");
        variants.add(base + "es");
        if (base.endsWith("y") && base.length > 1 && !/[aeiou]y$/i.test(base)) {
            variants.add(base.slice(0, -1) + "ies");
        }
    }
    addPlural(x);
    addPlural(y);
    return variants.has(x) || variants.has(y);
}

function levenshteinString(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    if (n > m) return levenshteinString(b, a);

    let prev = new Array(n + 1);
    let curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;

    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            curr[j] = Math.min(
                curr[j - 1] + 1,
                prev[j] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

// Linear-space word alignment. Returns one-to-one substitutions plus
// omissions/additions, which are then classified according to SSC rules.
function alignWords(originalWords, typedWords) {
    const m = originalWords.length;
    const n = typedWords.length;
    let prev = new Array(n + 1);
    let curr = new Array(n + 1);

    for (let j = 0; j <= n; j++) prev[j] = j;

    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const a = wordLetters(originalWords[i - 1]);
            const b = wordLetters(typedWords[j - 1]);
            curr[j] = Math.min(
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + (a === b ? 0 : 1)
            );
        }
        [prev, curr] = [curr, prev];
    }

    // For the UI comparison marks we need backtracking. Keep the matrix only
    // for the current passage; practice passages are normally <= 1000 words.
    // The scoring itself no longer depends on this matrix.
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const a = wordLetters(originalWords[i - 1]);
            const b = wordLetters(typedWords[j - 1]);
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + (a === b ? 0 : 1)
            );
        }
    }

    const pairs = [];
    let i = m, j = n;
    const originalMark = new Array(m).fill(false);
    const originalMarkType = new Array(m).fill(null);
    const typedMark = new Array(n).fill(false);

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 &&
            wordLetters(originalWords[i - 1]) === wordLetters(typedWords[j - 1]) &&
            dp[i][j] === dp[i - 1][j - 1]) {
            pairs.push({ oi: i - 1, ti: j - 1, type: "match" });
            i--; j--;
        } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
            pairs.push({ oi: i - 1, ti: j - 1, type: "substitution" });
            originalMark[i - 1] = true;
            originalMarkType[i - 1] = "substitution";
            typedMark[j - 1] = true;
            i--; j--;
        } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
            pairs.push({ oi: i - 1, ti: null, type: "omission" });
            originalMark[i - 1] = true;
            originalMarkType[i - 1] = "omission";
            i--;
        } else {
            pairs.push({ oi: null, ti: j - 1, type: "addition" });
            typedMark[j - 1] = true;
            j--;
        }
    }

    pairs.reverse();
    return { pairs, originalMark, originalMarkType, typedMark, distance: dp[m][n] };
}

function punctuationHalfMistakes(originalWords, typedWords, pairs) {
    let missing = 0;
    let added = 0;

    for (const pair of pairs) {
        if (pair.type !== "match" && pair.type !== "substitution") continue;

        const expectedHasStop = stripIgnoredPunctuation(originalWords[pair.oi]).includes(".");
        const actualHasStop = stripIgnoredPunctuation(typedWords[pair.ti]).includes(".");

        if (expectedHasStop && !actualHasStop) missing++;
        if (!expectedHasStop && actualHasStop) added++;
    }

    // A moved full stop produces one missing + one added position, but SSC
    // treats the wrong placement as one half mistake, not two.
    return Math.max(missing, added);
}

function classifySubstitution(original, typed, originalWords, index) {
    const expected = wordCore(original);
    const actual = wordCore(typed);
    const expectedLetters = wordLetters(original);
    const actualLetters = wordLetters(typed);

    if (!expectedLetters || !actualLetters) return { full: 1, half: 0 };

    // All-capital passage words are explicitly full mistakes.
    if (isAllCapsWord(typed) && expected !== expected.toUpperCase()) {
        return { full: 1, half: 0 };
    }

    if (expectedLetters === actualLetters) {
        const expectedCore = expected;
        const actualCore = actual;
        const caseDiffers = expectedCore !== actualCore;

        // Capitalization at the beginning of a sentence is a half mistake.
        if (caseDiffers && isSentenceStart(originalWords, index)) {
            return { full: 0, half: 1 };
        }

        // Capitalization of a proper noun is a half mistake.
        if (caseDiffers && likelyProperNoun(original, index, originalWords)) {
            return { full: 0, half: 1 };
        }

        return { full: 0, half: 0 };
    }

    // Singular/plural is a half mistake.
    if (singularPluralEquivalent(original, typed)) {
        return { full: 0, half: 1 };
    }

    // A spelling variation is a half mistake. For a recognisable word,
    // treat modest edit-distance differences as spelling; larger changes
    // are wrong-word substitutions (full).
    const distance = levenshteinString(expectedLetters, actualLetters);
    const threshold = Math.max(expectedLetters.length, actualLetters.length) <= 5 ? 1 : 2;
    if (distance <= threshold) {
        return { full: 0, half: 1 };
    }

    return { full: 1, half: 0 };
}

function evaluateSSC(originalText, typedText) {
    const originalWords = tokenize(originalText);
    const typedWords = tokenize(typedText);

    if (!originalWords.length) {
        return {
            fullMistakes: 0, halfMistakes: 0, mistakes: 0,
            errorPercentage: 0, grossWPM: 0, netWPM: 0,
            originalWords, typedWords, ...alignWords([], typedWords)
        };
    }

    const alignment = alignWords(originalWords, typedWords);
    let fullMistakes = 0;
    let halfMistakes = 0;

    for (const pair of alignment.pairs) {
        if (pair.type === "omission" || pair.type === "addition") {
            fullMistakes += 1;
        } else if (pair.type === "match" || pair.type === "substitution") {
            const result = classifySubstitution(
                originalWords[pair.oi],
                typedWords[pair.ti],
                originalWords,
                pair.oi
            );
            fullMistakes += result.full;
            halfMistakes += result.half;
        }
    }

    halfMistakes += punctuationHalfMistakes(originalWords, typedWords, alignment.pairs);

    // SSC's published formula:
    // (Full mistakes + Half mistakes / 2) * 100 / master passage words.
    const mistakes = fullMistakes + (halfMistakes / 2);
    const errorPercentage = (mistakes * 100) / originalWords.length;

    return {
        ...alignment,
        originalWords,
        typedWords,
        fullMistakes,
        halfMistakes,
        mistakes,
        errorPercentage: Number(errorPercentage.toFixed(2))
    };
}

// ---------- STORAGE HELPERS ----------
function readJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const value = JSON.parse(raw);
        return value ?? fallback;
    } catch (e) {
        localStorage.removeItem(key);
        return fallback;
    }
}

function writeJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (e) {
        alert("Storage is full. Please delete some saved passages/history and try again.");
        return false;
    }
}

function makeId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getExamState() {
    return readJSON("examState", null);
}

function saveExamState(state) {
    writeJSON("examState", state);
}

function createExamState() {
    const passage = normalizeSpace(document.getElementById("passageInput")?.value || "");
    const time = Number(document.getElementById("timeInput")?.value);

    if (!passage || !Number.isInteger(time) || time < 1 || time > 60) {
        alert("Enter a passage and a time between 1 and 60 minutes.");
        return false;
    }

    const now = Date.now();
    const state = {
        id: makeId("attempt"),
        passage,
        passageName: normalizeSpace(localStorage.getItem("currentPassageName") || ""),
        durationMinutes: time,
        startedAt: now,
        deadline: now + time * 60 * 1000,
        typed: "",
        status: "active"
    };

    localStorage.setItem("currentPassage", passage);
    localStorage.setItem("currentTime", String(time));
    saveExamState(state);
    localStorage.removeItem("lastResult");
    return true;
}

// ---------- GLOBAL / PAGE INITIALIZATION ----------
window.addEventListener("load", function () {
    if (localStorage.getItem("darkMode") === "on") {
        document.body.classList.add("dark");
    }

    applyGuiSize();
    applyFontSize();

    const path = location.pathname;
    if (path.includes("index.html") || path.endsWith("/")) {
        loadSavedPassages();
        loadHistory();

        const selected = localStorage.getItem("selectedMatter");
        if (selected) {
            const box = document.getElementById("passageInput");
            if (box) box.value = selected;
            localStorage.removeItem("selectedMatter");
        }

        const passageBox = document.getElementById("passageInput");
        if (passageBox) {
            passageBox.addEventListener("input", () => {
                // Once a loaded passage is edited, its old name must not be
                // attached to the newly modified text.
                localStorage.removeItem("currentPassageName");
            });
        }
    }

    if (path.includes("exam.html")) startExam();
    if (path.includes("result.html")) showResult();
});

// ---------- HOME PAGE ----------
function savePassage() {
    const passage = normalizeSpace(document.getElementById("passageInput")?.value || "");
    if (!passage) {
        alert("Enter passage first");
        return;
    }

    const name = prompt("Enter a passage name:");
    if (name === null) return;

    const cleanName = normalizeSpace(name);
    if (!cleanName) {
        alert("Enter a passage name.");
        return;
    }

    const saved = readJSON("passages", []).map((item, index) =>
        typeof item === "string"
            ? { id: makeId(`legacy-${index}`), name: `Passage ${index + 1}`, text: item }
            : item
    );

    saved.push({
        id: makeId("passage"),
        name: cleanName,
        text: passage
    });

    if (writeJSON("passages", saved)) {
        localStorage.setItem("currentPassageName", cleanName);
        document.getElementById("passageInput").value = "";
        loadSavedPassages();
    }
}

function loadSavedPassages() {
    const raw = readJSON("passages", []);
    const saved = raw.map((item, index) =>
        typeof item === "string"
            ? { id: makeId(`legacy-${index}`), name: `Passage ${index + 1}`, text: item }
            : item
    );
    if (JSON.stringify(raw) !== JSON.stringify(saved)) writeJSON("passages", saved);

    const box = document.getElementById("savedPassages");
    if (!box) return;

    box.replaceChildren();

    saved.forEach((p, i) => {
        const row = document.createElement("div");
        row.style.cssText = "border:1px solid #ccc;padding:6px;margin:5px;border-radius:5px;";

        const select = document.createElement("button");
        select.type = "button";
        select.textContent = p.name || `Passage ${i + 1}`;
        select.style.cssText = "cursor:pointer;background:none;border:none;padding:0;font:inherit;text-align:left;";
        select.onclick = () => usePassage(i);

        const del = document.createElement("button");
        del.type = "button";
        del.textContent = "Delete";
        del.style.cssText = "float:right;background:red;color:white;border:none;padding:4px 8px;border-radius:4px;";
        del.onclick = () => deletePassage(i);

        row.appendChild(select);
        row.appendChild(del);
        box.appendChild(row);
    });
}

function usePassage(i) {
    const saved = readJSON("passages", []);
    const item = saved[i];
    if (!item) return;
    const text = typeof item === "string" ? item : item.text;
    const name = typeof item === "string" ? `Passage ${i + 1}` : (item.name || `Passage ${i + 1}`);
    const box = document.getElementById("passageInput");
    if (box) box.value = text || "";
    localStorage.setItem("currentPassageName", name);
}

function deletePassage(i) {
    if (!confirm("Delete this passage?")) return;
    const saved = readJSON("passages", []);
    saved.splice(i, 1);
    writeJSON("passages", saved);
    loadSavedPassages();
}

function startTest() {
    if (createExamState()) window.location.href = "exam.html";
}

function loadHistory() {
    const history = readJSON("history", []);
    const box = document.getElementById("history");
    if (!box) return;

    box.replaceChildren();

    history.slice().reverse().forEach(h => {
        const row = document.createElement("div");
        row.style.cssText = "border:1px solid #ccc;padding:6px;margin:5px;border-radius:5px;";

        const title = document.createElement("b");
        title.textContent = h.passageName || "Practice Attempt";

        const details = document.createElement("span");
        details.textContent =
            ` | Gross:${h.grossWPM} | Net:${h.netWPM} | Error:${h.errorPercentage}% | ${h.date}`;

        row.appendChild(title);
        row.appendChild(details);
        box.appendChild(row);
    });
}

// ---------- EXAM PAGE ----------
function startExam() {
    let state = getExamState();

    if (!state || state.status !== "active") {
        alert("No active test found.");
        window.location.href = "index.html";
        return;
    }

    const userInput = document.getElementById("userInput");
    if (!userInput) return;

    userInput.disabled = false;
    userInput.value = state.typed || "";

    const persistTyped = () => {
        const current = getExamState();
        if (!current || current.id !== state.id || current.status !== "active") return;
        current.typed = userInput.value;
        saveExamState(current);
    };

    userInput.addEventListener("input", persistTyped);
    window.addEventListener("beforeunload", persistTyped);

    document.getElementById("submitBtn").onclick = submitExam;
    updateTimer();
    timerInterval = setInterval(updateTimer, 250);
}

function updateTimer() {
    const state = getExamState();
    const timer = document.getElementById("timer");
    if (!state || state.status !== "active") return;

    const remaining = Math.max(0, state.deadline - Date.now());
    const totalSeconds = Math.ceil(remaining / 1000);
    const min = Math.floor(totalSeconds / 60);
    const sec = totalSeconds % 60;

    if (timer) {
        timer.innerText =
            `Time: ${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    }

    if (remaining <= 0) submitExam(true);
}

function submitExam(fromTimer = false) {
    const state = getExamState();
    if (!state || state.status !== "active") {
        if (!fromTimer) window.location.href = "index.html";
        return;
    }

    const btn = document.getElementById("submitBtn");
    if (btn) {
        btn.disabled = true;
        btn.innerText = "Processing...";
    }

    clearInterval(timerInterval);

    const userInput = document.getElementById("userInput");
    const typed = normalizeSpace(userInput?.value || "");
    state.typed = typed;
    state.status = "completed";
    state.completedAt = Date.now();
    state.timeTaken = Math.min(
        state.durationMinutes,
        Math.max(0.001, (state.completedAt - state.startedAt) / 60000)
    );

    saveExamState(state);
    localStorage.setItem("typedText", typed);
    localStorage.setItem("timeTaken", String(state.timeTaken));

    setTimeout(() => {
        window.location.href = "result.html";
    }, 50);
}

// ---------- RESULT PAGE ----------
function showResult() {
    const state = getExamState();
    if (!state || state.status !== "completed") {
        const lastResult = readJSON("lastResult", null);
        if (!lastResult) {
            window.location.href = "index.html";
            return;
        }
    }

    const current = state?.status === "completed"
        ? state
        : readJSON("lastResult", null);

    if (!current) {
        window.location.href = "index.html";
        return;
    }

    const passage = current.passage || localStorage.getItem("currentPassage") || "";
    const typed = current.typed ?? localStorage.getItem("typedText") ?? "";
    const timeTaken = Number(current.timeTaken || localStorage.getItem("timeTaken") || 0.001);

    const result = evaluateSSC(passage, typed);
    const wordsTypedCount = result.typedWords.length;
    const grossWPM = Number((wordsTypedCount / timeTaken).toFixed(2));
    const netWPM = Number(Math.max(0, grossWPM - (result.mistakes / timeTaken)).toFixed(2));

    const resultRecord = {
        id: current.resultId || makeId("result"),
        attemptId: current.id,
        passage,
        typed,
        grossWPM,
        netWPM,
        accuracy: Number(Math.max(0, 100 - result.errorPercentage).toFixed(2)),
        errorPercentage: result.errorPercentage,
        fullMistakes: result.fullMistakes,
        halfMistakes: result.halfMistakes,
        mistakes: result.mistakes,
        passageName: current.passageName || localStorage.getItem("currentPassageName") || "",
        date: current.completedAt
            ? new Date(current.completedAt).toLocaleString()
            : new Date().toLocaleString()
    };

    current.resultId = resultRecord.id;
    saveExamState(current);

    if (localStorage.getItem("lastSavedResultId") !== resultRecord.id) {
        saveHistoryRecord(resultRecord);
        localStorage.setItem("lastSavedResultId", resultRecord.id);
    }
    writeJSON("lastResult", resultRecord);

    const resultBox = document.getElementById("resultBox");
    if (resultBox) {
        resultBox.replaceChildren();
        const lines = [
            ["Gross WPM", resultRecord.grossWPM],
            ["Net WPM", resultRecord.netWPM],
            ["Accuracy", `${resultRecord.accuracy}%`],
            ["SSC Error %", `${resultRecord.errorPercentage}%`],
            ["Full Mistakes", resultRecord.fullMistakes],
            ["Half Mistakes", resultRecord.halfMistakes],
            ["Total Mistakes", resultRecord.mistakes],
            ["Time Used", `${timeTaken.toFixed(2)} min`]
        ];
        lines.forEach(([label, value]) => {
            const p = document.createElement("p");
            const b = document.createElement("b");
            b.textContent = `${label}:`;
            p.appendChild(b);
            p.append(` ${value}`);
            resultBox.appendChild(p);
        });
    }

    const originalBox = document.getElementById("originalBox");
    const typedBox = document.getElementById("typedBox");
    if (!originalBox || !typedBox) return;

    originalBox.replaceChildren();
    typedBox.replaceChildren();

    const origFrag = document.createDocumentFragment();
    result.originalWords.forEach((word, i) => {
        const span = document.createElement("span");
        if (result.originalMarkType?.[i] === "omission") {
            span.classList.add("omitted-word");
        } else if (result.originalMark[i]) {
            span.classList.add("wrong-word");
        }
        span.textContent = word + " ";
        origFrag.appendChild(span);
    });
    originalBox.appendChild(origFrag);

    const typedFrag = document.createDocumentFragment();
    result.typedWords.forEach((word, i) => {
        const span = document.createElement("span");
        if (result.typedMark[i]) span.classList.add("typed-mistake");
        span.textContent = word + " ";
        typedFrag.appendChild(span);
    });
    typedBox.appendChild(typedFrag);
}

// ---------- HISTORY ----------
function saveHistoryRecord(record) {
    const history = readJSON("history", []);
    if (history.some(h => h.id === record.id || h.attemptId === record.attemptId)) return;

    history.push(record);
    // Keep storage bounded.
    if (history.length > 100) history.splice(0, history.length - 100);
    writeJSON("history", history);
}

// ---------- NAVIGATION ----------
function retryTest() {
    const last = readJSON("lastResult", null);
    const source = last || getExamState();
    if (!source?.passage) {
        window.location.href = "index.html";
        return;
    }

    const now = Date.now();
    const state = {
        id: makeId("attempt"),
        passage: source.passage,
        durationMinutes: Number(source.durationMinutes || localStorage.getItem("currentTime") || 5),
        startedAt: now,
        deadline: now + Number(source.durationMinutes || localStorage.getItem("currentTime") || 5) * 60000,
        typed: "",
        status: "active",
        passageName: source.passageName || ""
    };
    saveExamState(state);
    localStorage.setItem("currentPassage", state.passage);
    localStorage.setItem("currentTime", String(state.durationMinutes));
    localStorage.removeItem("lastResult");
    window.location.href = "exam.html";
}

function goHome() {
    window.location.href = "index.html";
}

function toggleDarkMode() {
    document.body.classList.toggle("dark");
    localStorage.setItem(
        "darkMode",
        document.body.classList.contains("dark") ? "on" : "off"
    );
}

function openKCPage() {
    window.location.href = "kc-matters.html";
}

function selectMatter(text, name) {
    localStorage.setItem("selectedMatter", text);
    localStorage.setItem("currentPassageName", name);
    window.location.href = "index.html";
}

applyGuiSize();
applyFontSize();
