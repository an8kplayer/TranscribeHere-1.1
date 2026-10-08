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
        const caseDiffers = expected !== actual;

        // Any capitalization difference between otherwise identical words is
        // a half mistake. This is deliberately symmetric: both
        // "Hello" -> "hello" and "hello" -> "Hello" are counted.
        // Sentence-start and proper-noun checks are kept for clarity and
        // future rule refinement, but the capitalization rule itself does
        // not depend on which side contains the capital letter.
        if (caseDiffers) {
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
        const timeTaken = Number(h.timeTaken);
        const timeText = Number.isFinite(timeTaken) && timeTaken >= 0
            ? `${timeTaken.toFixed(2)} min`
            : "-";
        details.textContent =
            ` | Accuracy: ${h.accuracy ?? "-"}% | Error: ${h.errorPercentage ?? "-"}% | WPM: ${h.netWPM ?? "-"} | Time: ${timeText} | Date: ${h.date || "-"}`;

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
        timeTaken,
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

// ---------- RESULT DOWNLOAD ----------
function escapeReportHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function buildComparisonReport(words, marks, markTypes, typedClass) {
    return words.map((word, i) => {
        let className = "";
        if (typedClass) {
            if (marks?.[i]) className = "typed-mistake";
        } else if (markTypes?.[i] === "omission") {
            className = "omitted-word";
        } else if (marks?.[i]) {
            className = "wrong-word";
        }

        const safeWord = escapeReportHtml(word) + " ";
        return className
            ? `<span class="${className}">${safeWord}</span>`
            : safeWord;
    }).join("");
}

function pdfEscape(value) {
    return String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)")
        .replace(/\r?\n/g, " ");
}

function pdfSafeText(value) {
    return String(value ?? "")
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\u2013/g, "-")
        .replace(/\u2014/g, "-")
        .replace(/\u2026/g, "...")
        .replace(/[^\x20-\x7E]/g, "?");
}

function pdfTextWidth(text, fontSize) {
    return pdfSafeText(text).length * fontSize * 0.52;
}

function pdfWrapText(text, maxWidth, fontSize) {
    const words = pdfSafeText(text).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const lines = [];
    let line = "";
    words.forEach(word => {
        const candidate = line ? `${line} ${word}` : word;
        if (pdfTextWidth(candidate, fontSize) <= maxWidth || !line) {
            line = candidate;
        } else {
            lines.push(line);
            line = word;
        }
    });
    if (line) lines.push(line);
    return lines;
}

function pdfAddText(commands, text, x, y, fontSize, options = {}) {
    const color = options.color || [0, 0, 0];
    commands.push(`${color[0]} ${color[1]} ${color[2]} rg`);
    commands.push(`BT /F1 ${fontSize} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfEscape(pdfSafeText(text))}) Tj ET`);
}

function pdfAddWord(commands, word, x, y, fontSize, type) {
    const safe = pdfSafeText(word);
    const width = pdfTextWidth(safe, fontSize);

    if (type === "omission") {
        commands.push(`0.827 0.118 0.118 rg`);
        commands.push(`${x.toFixed(2)} ${(y - 2).toFixed(2)} ${Math.max(width, 2).toFixed(2)} ${(fontSize + 3).toFixed(2)} re f`);
        pdfAddText(commands, safe, x, y, fontSize, { color: [1, 1, 1] });
    } else if (type === "wrong") {
        commands.push(`1 0.945 0.463 rg`);
        commands.push(`${x.toFixed(2)} ${(y - 2).toFixed(2)} ${Math.max(width, 2).toFixed(2)} ${(fontSize + 3).toFixed(2)} re f`);
        pdfAddText(commands, safe, x, y, fontSize);
    } else if (type === "typed") {
        pdfAddText(commands, safe, x, y, fontSize);
        commands.push(`0.082 0.396 0.753 RG`);
        commands.push(`1.5 w ${x.toFixed(2)} ${(y - 2).toFixed(2)} m ${(x + width).toFixed(2)} ${(y - 2).toFixed(2)} l S`);
    } else {
        pdfAddText(commands, safe, x, y, fontSize);
    }

    return width;
}

function pdfAddComparison(commands, words, originalMark, originalMarkType, typedMark, x, y, width, fontSize, pageState, type) {
    const spaceWidth = pdfTextWidth(" ", fontSize);
    let cx = x;
    let cy = y;
    const lineHeight = fontSize + 5;

    words.forEach((word, i) => {
        const safe = pdfSafeText(word);
        const wordWidth = pdfTextWidth(safe, fontSize);
        const needed = wordWidth + spaceWidth;

        if (cx !== x && cx + needed > x + width) {
            cx = x;
            cy -= lineHeight;
        }

        if (cy < pageState.bottom) {
            pageState.newPage();
            cy = pageState.y;
            cx = x;
        }

        let marker = null;
        if (type === "original") {
            if (originalMarkType?.[i] === "omission") marker = "omission";
            else if (originalMark?.[i]) marker = "wrong";
        } else if (typedMark?.[i]) {
            marker = "typed";
        }

        pdfAddWord(commands, safe, cx, cy, fontSize, marker);
        cx += needed;
    });

    return cy - lineHeight;
}

function createPdfDocument(record, result, allottedMinutes) {
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 42;
    const contentWidth = pageWidth - margin * 2;
    const fontSize = 10;
    const lineHeight = 15;
    const commandsByPage = [];
    let commands = [];
    let y = pageHeight - margin;

    const pageState = {
        bottom: margin + 30,
        y: pageHeight - margin,
        newPage() {
            commandsByPage.push(commands);
            commands = [];
            y = pageHeight - margin;
            this.y = y;
        }
    };

    const ensure = needed => {
        if (y - needed < pageState.bottom) {
            pageState.newPage();
            y = pageState.y;
        }
    };

    const heading = (text, size = 16) => {
        ensure(size + 12);
        pdfAddText(commands, text, margin, y, size, { color: [0.08, 0.08, 0.08] });
        y -= size + 10;
    };

    const line = (text, size = 10, gap = 15) => {
        ensure(gap);
        pdfAddText(commands, text, margin, y, size);
        y -= gap;
    };

    const paragraph = (text, size = 9.5, gap = 13) => {
        const lines = pdfWrapText(text, contentWidth, size);
        lines.forEach(t => line(t, size, gap));
    };

    const drawBox = (x, topY, w, h) => {
        commands.push(`0.78 0.78 0.78 RG 0.8 w ${x.toFixed(2)} ${(topY - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
    };

    heading("TranscribeHere - Result", 18);
    line(`Date: ${record.date}`);
    line(`Passage: ${record.passageName || "Custom Passage"}`);
    line(`Time Taken: ${Number(record.timeTaken || 0).toFixed(2)} min`);
    line(`Time Limit: ${allottedMinutes ? allottedMinutes.toFixed(2) + " min" : "Not available"}`);
    line(`Words in Real Passage: ${result.originalWords.length}`);
    line(`Words Typed: ${result.typedWords.length}`);

    y -= 6;
    heading("Statistics", 13);
    line(`Gross WPM: ${record.grossWPM}`);
    line(`Net WPM: ${record.netWPM}`);
    line(`Accuracy: ${record.accuracy}%`);
    line(`SSC Error %: ${record.errorPercentage}%`);
    line(`Full Mistakes: ${record.fullMistakes}`);
    line(`Half Mistakes: ${record.halfMistakes}`);
    line(`Total Mistakes: ${record.mistakes}`);

    y -= 6;
    heading("Passage", 13);
    paragraph(record.passage || "(No passage)", 9.5, 13);

    y -= 6;
    heading("Comparison", 13);
    ensure(30);
    pdfAddText(commands, "Red text / red box = Omitted word", margin, y, 9.5, { color: [0.827, 0.118, 0.118] });
    y -= 13;
    pdfAddText(commands, "Yellow highlight = Wrong word", margin, y, 9.5, { color: [0.25, 0.25, 0.25] });
    y -= 13;
    pdfAddText(commands, "Blue underline = Typed mistake", margin, y, 9.5, { color: [0.082, 0.396, 0.753] });
    y -= 18;

    const boxGap = 10;
    const boxWidth = (contentWidth - boxGap) / 2;
    const boxTop = y;
    const boxHeight = 230;
    ensure(boxHeight + 20);
    const top = y;
    drawBox(margin, top, boxWidth, boxHeight);
    drawBox(margin + boxWidth + boxGap, top, boxWidth, boxHeight);
    pdfAddText(commands, "Original Passage", margin + 10, top - 18, 11);
    pdfAddText(commands, "Your Transcription", margin + boxWidth + boxGap + 10, top - 18, 11);

    const comparisonTop = top - 36;
    const leftState = {
        bottom: top - boxHeight + 12,
        y: comparisonTop,
        newPage() {
            commandsByPage.push(commands);
            commands = [];
            y = pageHeight - margin;
            this.y = y;
        }
    };
    // Comparison boxes are kept together when possible. If a very long comparison
    // exceeds the box height, continue it on following pages in full-width boxes.
    const originalLines = [];
    let cx = 0;
    let current = [];
    const maxBoxWidth = boxWidth - 20;
    result.originalWords.forEach((word, i) => {
        const w = pdfTextWidth(pdfSafeText(word), fontSize) + pdfTextWidth(" ", fontSize);
        if (cx && cx + w > maxBoxWidth) {
            originalLines.push(current);
            current = [];
            cx = 0;
        }
        current.push(i);
        cx += w;
    });
    if (current.length) originalLines.push(current);

    const typedLines = [];
    cx = 0;
    current = [];
    result.typedWords.forEach((word, i) => {
        const w = pdfTextWidth(pdfSafeText(word), fontSize) + pdfTextWidth(" ", fontSize);
        if (cx && cx + w > maxBoxWidth) {
            typedLines.push(current);
            current = [];
            cx = 0;
        }
        current.push(i);
        cx += w;
    });
    if (current.length) typedLines.push(current);

    const maxLines = Math.max(originalLines.length, typedLines.length, 1);
    const lineHeightCmp = 15;
    const visibleLines = Math.max(1, Math.floor((boxHeight - 48) / lineHeightCmp));

    const drawComparisonPage = (startLine) => {
        if (startLine > 0) {
            commandsByPage.push(commands);
            commands = [];
            y = pageHeight - margin;
            heading("Comparison (continued)", 13);
        }
        const h = Math.min(boxHeight, 48 + visibleLines * lineHeightCmp);
        const topY = y;
        drawBox(margin, topY, boxWidth, h);
        drawBox(margin + boxWidth + boxGap, topY, boxWidth, h);
        pdfAddText(commands, "Original Passage", margin + 10, topY - 18, 11);
        pdfAddText(commands, "Your Transcription", margin + boxWidth + boxGap + 10, topY - 18, 11);
        const endLine = Math.min(maxLines, startLine + visibleLines);
        for (let li = startLine; li < endLine; li++) {
            let lx = margin + 10;
            let rx = margin + boxWidth + boxGap + 10;
            const ly = topY - 36 - (li - startLine) * lineHeightCmp;
            (originalLines[li] || []).forEach(i => {
                const word = result.originalWords[i];
                const marker = result.originalMarkType?.[i] === "omission" ? "omission" : (result.originalMark?.[i] ? "wrong" : null);
                const w = pdfAddWord(commands, word, lx, ly, fontSize, marker);
                lx += w + pdfTextWidth(" ", fontSize);
            });
            (typedLines[li] || []).forEach(i => {
                const word = result.typedWords[i];
                const w = pdfAddWord(commands, word, rx, ly, fontSize, result.typedMark?.[i] ? "typed" : null);
                rx += w + pdfTextWidth(" ", fontSize);
            });
        }
        y = topY - h - 18;
        return endLine;
    };

    // Replace the initially drawn boxes with a clean paginated comparison.
    commands = commands.slice(0, commands.length - 4);
    y = top;
    let startLine = 0;
    while (startLine < maxLines) {
        startLine = drawComparisonPage(startLine);
        if (startLine < maxLines) {
            commandsByPage.push(commands);
            commands = [];
            y = pageHeight - margin;
        }
    }

    if (commands.length) commandsByPage.push(commands);

    // Add page numbers to every page.
    const totalPages = commandsByPage.length;
    commandsByPage.forEach((pageCommands, index) => {
        pageCommands.push(`0.4 0.4 0.4 rg`);
        pageCommands.push(`BT /F1 8 Tf ${margin} 22 Td (Generated by TranscribeHere) Tj ET`);
        pageCommands.push(`BT /F1 8 Tf ${(pageWidth - 90).toFixed(2)} 22 Td (Page ${index + 1} of ${totalPages}) Tj ET`);
    });

    const objects = [];
    const addObj = body => { objects.push(body); return objects.length; };
    const catalog = addObj("<< /Type /Catalog /Pages 2 0 R >>");
    const pagesObj = 2;
    addObj("");
    const fontObj = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    const pageRefs = [];
    const contentRefs = [];
    commandsByPage.forEach(pageCommands => {
        const stream = pageCommands.join("\n");
        const streamObj = addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
        const pageObj = addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${streamObj} 0 R >>`);
        contentRefs.push(streamObj);
        pageRefs.push(pageObj);
    });
    objects[1] = `<< /Type /Pages /Kids [${pageRefs.map(n => `${n} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;

    let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets = [0];
    objects.forEach((obj, i) => {
        offsets[i + 1] = pdf.length;
        pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
        pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;

    return pdf;
}

function downloadResult() {
    const record = readJSON("lastResult", null);
    if (!record) {
        alert("No result is available to download.");
        return;
    }

    const passage = record.passage || "";
    const typed = record.typed || "";
    const result = evaluateSSC(passage, typed);
    const allottedMinutes = Number(
        getExamState()?.durationMinutes || localStorage.getItem("currentTime") || 0
    );

    const pdf = createPdfDocument(record, result, allottedMinutes);
    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xFF;
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const datePart = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `TranscribeHere-Result-${datePart}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
