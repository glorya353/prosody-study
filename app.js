import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, doc, setDoc, collection, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const screens = {
  consent: $("screen-consent"),
  questionnaire: $("screen-questionnaire"),
  task: $("screen-task"),
  finish: $("screen-finish"),
};

function show(screenName) {
  Object.values(screens).forEach((el) => el.classList.add("hidden"));
  screens[screenName].classList.remove("hidden");
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const toNumOrBlank = (v) => (v === "" ? "" : Number(v));

/* ===== Firebase config: PASTE YOURS HERE ===== */
const firebaseConfig = {
  apiKey: "AIzaSyCkGjSBaimmDrm_0Filjp8XjD5HrbRQrg4",
  authDomain: "prosody-study.firebaseapp.com",
  projectId: "prosody-study",
  storageBucket: "prosody-study.firebasestorage.app",
  messagingSenderId: "587902540180",
  appId: "1:587902540180:web:a19bc722e2348f9dc1d781",
  measurementId: "G-QT7RF74ESR"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* ===== Theme toggle ===== */
const btnTheme = $("btnTheme");
function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}
btnTheme.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  setTheme(current === "dark" ? "light" : "dark");
});
const savedTheme = localStorage.getItem("theme");
if (savedTheme) setTheme(savedTheme);

/* ===== State ===== */
let stimuli = [];
let trialIndex = 0;
let startTimeMs = 0;
let useConfidence = true;

const participant = {
  participant_id: crypto?.randomUUID?.() || ("p_" + Math.random().toString(16).slice(2)),
  started_at_iso: new Date().toISOString(),
  questionnaire: {},
};

const results = []; // local backup (optional)

/* ===== Consent ===== */
$("consentCheck").addEventListener("change", (e) => {
  $("btnConsentNext").disabled = !e.target.checked;
});
$("btnConsentNext").addEventListener("click", () => show("questionnaire"));

/* ===== Progress ===== */
function setProgress() {
  const n = stimuli.length || 1;
  $("progressText").textContent = `Trial ${trialIndex + 1} / ${n}  •  Ensayo ${trialIndex + 1} / ${n}`;
  $("barFill").style.width = `${(trialIndex / n) * 100}%`;
}

/* ===== Confidence helpers ===== */
function clearConfidence() {
  document.querySelectorAll('input[name="conf"]').forEach((r) => (r.checked = false));
}
function getConfidence() {
  if (!useConfidence) return "";
  const checked = document.querySelector('input[name="conf"]:checked');
  return checked ? checked.value : "";
}

/* ===== Firestore helpers ===== */
const participantDocRef = () => doc(db, "participants", participant.participant_id);
const trialsColRef = () => collection(db, "participants", participant.participant_id, "trials");

/* ===== Start ===== */
$("btnStart").addEventListener("click", async () => {
  // Only require Age + Languages
  if (!$("age").value || !$("langs").value) {
    alert("Please complete the required fields (Age and Languages).\nPor favor completa los campos obligatorios (Edad e Idiomas).");
    return;
  }

  useConfidence = $("doConfidence").checked;

  participant.questionnaire = {
    age: Number($("age").value),
    languages_regular: $("langs").value.trim(),
    aoa_english: toNumOrBlank($("aoaEn").value),
    aoa_spanish: toNumOrBlank($("aoaEs").value),
    proficiency_english_1to5: toNumOrBlank($("profEn").value),
    proficiency_spanish_1to5: toNumOrBlank($("profEs").value),
    dominance: $("dominance").value || "",
    spanish_contexts: Array.from(document.querySelectorAll(".ctx:checked")).map((x) => x.value),
    confidence_enabled: useConfidence ? 1 : 0
  };

  // Create participant doc in Firestore
  try {
    await setDoc(participantDocRef(), {
      participant_id: participant.participant_id,
      started_at_iso: participant.started_at_iso,
      created_at: serverTimestamp(),
      questionnaire: participant.questionnaire
    });
  } catch (e) {
    alert("Could not save to the database.\nNo se pudo guardar en la base de datos.");
    console.error(e);
    return;
  }

  // Load stimuli manifest
  try {
    const res = await fetch("stimuli/stimuli_manifest.json", { cache: "no-store" });
    const manifest = await res.json();
    stimuli = shuffle(manifest.stimuli);

    if (!Array.isArray(stimuli) || stimuli.length === 0) {
      alert("Stimuli list is empty. Please check stimuli_manifest.json.\nLa lista de estímulos está vacía. Revisa stimuli_manifest.json.");
      return;
    }
  } catch (e) {
    alert("Could not load stimuli_manifest.json.\nNo se pudo cargar stimuli_manifest.json.");
    console.error(e);
    return;
  }

  trialIndex = 0;
  show("task");
  initTrial();
});

function initTrial() {
  setProgress();
  $("status").textContent = "";

  const stim = stimuli[trialIndex];
  const player = $("player");
  player.src = stim.file;
  player.load();

  const box = $("confidenceBox");
  if (useConfidence) {
    box.classList.remove("hidden");
    clearConfidence();
  } else {
    box.classList.add("hidden");
  }

  player.oncanplaythrough = () => {
    startTimeMs = performance.now();
  };

  player.play().catch(() => {
    $("status").textContent = "If the clip does not start automatically, press Play.\nSi el clip no empieza automáticamente, presiona Reproducir.";
  });
}

async function recordResponse(choice) {
  const stim = stimuli[trialIndex];
  const rt_ms = Math.max(0, Math.round(performance.now() - startTimeMs));

  // Confidence logic
  let conf = "";
  if (choice !== "Not sure") {
    conf = getConfidence();
    if (useConfidence && !conf) {
      $("status").textContent = "Please select confidence (1–5).\nSelecciona confianza (1–5).";
      return;
    }
  } else {
    clearConfidence();
  }

  const usable_for_accuracy = choice === "Not sure" ? 0 : 1;

  let correct = "";
  if (usable_for_accuracy === 1) {
    correct =
      (choice === "English" && stim.language === "EN") ||
      (choice === "Spanish" && stim.language === "ES")
        ? 1
        : 0;
  }

  const row = {
    participant_id: participant.participant_id,
    trial_number: trialIndex + 1,
    stimulus_id: stim.id,
    target_language: stim.language,   // EN / ES
    response: choice,                 // English / Spanish / Not sure
    usable_for_accuracy,              // 1 or 0
    correct,                          // 1/0 or ""
    confidence_1to5: conf,            // "" allowed
    rt_ms,
    timestamp_iso: new Date().toISOString(),
    created_at: serverTimestamp()
  };

  // Save trial to Firestore immediately
  try {
    await addDoc(trialsColRef(), row);
  } catch (e) {
    // If save fails, keep local backup and show warning
    console.error(e);
    $("status").textContent = "Connection issue: response saved locally as backup.\nProblema de conexión: respuesta guardada localmente como respaldo.";
  }

  // Always keep local backup too (optional but helpful)
  results.push(row);

  trialIndex++;
  if (trialIndex >= stimuli.length) {
    $("barFill").style.width = "100%";
    show("finish");
  } else {
    initTrial();
  }
}

$("btnEnglish").addEventListener("click", () => recordResponse("English"));
$("btnSpanish").addEventListener("click", () => recordResponse("Spanish"));
$("btnNotSure").addEventListener("click", () => recordResponse("Not sure"));

/* ===== Optional backup downloads ===== */
function toCSV(rows) {
  const headers = Object.keys(rows[0] || {});
  const esc = (v) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))];
  return lines.join("\n");
}
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

$("btnDownloadCSV").addEventListener("click", () => {
  if (!results.length) return;
  download(`prosody_backup_${participant.participant_id}.csv`, toCSV(results), "text/csv");
});
$("btnDownloadJSON").addEventListener("click", () => {
  if (!results.length) return;
  download(`prosody_backup_${participant.participant_id}.json`, JSON.stringify({ participant, results }, null, 2), "application/json");
});

/* ===== Initial ===== */
show("consent");
