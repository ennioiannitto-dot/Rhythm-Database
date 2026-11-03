'use strict';

/* =========================================================
   1. COSTANTI & DEFAULT
   ========================================================= */
const SCHEMA_VERSION = 5;
const STORAGE_KEY = 'tongueApp:data'; // nome interno storico: non cambiare, altrimenti i dati già salvati sul dispositivo non verrebbero più trovati

const DEFAULT_CATEGORIES = ['4/4','3/4','2/4','6/8','5/4','sincopato','meditativo','energico'];

// Mappa note di default per D Kurd 9 (0 = Dum centrale, 1-8 = lingue in senso orario).
// Modificabile liberamente nelle Impostazioni: gli strumenti reali variano per costruttore.
const DEFAULT_NOTE_MAP = [
  { numero: 0, anglo: 'D3', solf: 'Re3' },
  { numero: 1, anglo: 'A3', solf: 'La3' },
  { numero: 2, anglo: 'Bb3', solf: 'Sib3' },
  { numero: 3, anglo: 'C4', solf: 'Do4' },
  { numero: 4, anglo: 'D4', solf: 'Re4' },
  { numero: 5, anglo: 'E4', solf: 'Mi4' },
  { numero: 6, anglo: 'F4', solf: 'Fa4' },
  { numero: 7, anglo: 'G4', solf: 'Sol4' },
  { numero: 8, anglo: 'A4', solf: 'La4' },
];

function defaultData(){
  return {
    versione_schema: SCHEMA_VERSION,
    categorie: DEFAULT_CATEGORIES.slice(),
    mappaNote: DEFAULT_NOTE_MAP.map(n=>({...n})),
    noteCount: DEFAULT_NOTE_MAP.length,
    startIndex: 0,
    notationMode: 'numero',
    migrazioni: ['cat-2-4'],
    ritmi: [],
    canzoni: [],
    patterns: []
  };
}

/* =========================================================
   2. STORAGE
   ========================================================= */
let DATA = loadData();

function loadData(){
  let raw;
  try{ raw = localStorage.getItem(STORAGE_KEY); }catch(e){ raw = null; }
  if(!raw) return defaultData();
  try{
    const parsed = JSON.parse(raw);
    return migrate(parsed);
  }catch(e){
    console.error('Dati corrotti, riparto da zero', e);
    return defaultData();
  }
}

function migrate(d){
  if(!d.versione_schema) d.versione_schema = 1;
  if(!d.categorie) d.categorie = DEFAULT_CATEGORIES.slice();
  if(!d.mappaNote) d.mappaNote = DEFAULT_NOTE_MAP.map(n=>({...n}));
  if(!d.notationMode) d.notationMode = 'numero';
  if(!d.ritmi) d.ritmi = [];
  if(!d.canzoni) d.canzoni = [];
  if(!d.patterns) d.patterns = []; // nuova sezione Pattern: nessuna migrazione di dati esistenti necessaria, solo il campo vuoto
  if(!d.migrazioni) d.migrazioni = [];
  ensureManualOrder(d.ritmi);
  ensureManualOrder(d.canzoni);
  ensureManualOrder(d.patterns);

  // v1 -> v2: la numerazione delle note passa da 1-9 a 0-8 (0 = Dum centrale),
  // per farla coincidere con la posizione fisica reale sullo strumento.
  if(d.versione_schema < 2){
    d.mappaNote.forEach(n=>{ n.numero = n.numero - 1; });
    d.canzoni.forEach(song=>{
      (song.battute||[]).forEach(bar=>{
        bar.forEach(slot=>{
          (slot.n||[]).forEach(note=>{
            note.num = note.num - 1;
            if(note.mano===undefined) note.mano = null;
          });
        });
      });
    });
    d.versione_schema = 2;
  }

  // v2 -> v3: aggiunge brutta copia testuale, riferimento spartito immagine
  // e il "click" del metronomo interno per ogni movimento della canzone.
  if(d.versione_schema < 3){
    d.canzoni.forEach(song=>{
      if(song.melodiaTesto===undefined) song.melodiaTesto = '';
      if(!song.spartito) song.spartito = { nomeFile:'' };
      (song.battute||[]).forEach(bar=>{
        bar.forEach(slot=>{
          if(slot.click===undefined) slot.click = false;
        });
      });
    });
    d.versione_schema = 3;
  }

  // v3 -> v4: ogni misura del ritmo passa da "una riga di colpi" a "una o più righe
  // parallele" (fino a 3), per poter suonare più colpi insieme sullo stesso movimento.
  if(d.versione_schema < 4){
    d.ritmi.forEach(r=>{
      r.battute = (r.battute||[]).map(bar=>{
        if(bar && Array.isArray(bar.righe)) return bar; // già nel nuovo formato
        return { righe: [ Array.isArray(bar) ? bar : [] ] };
      });
    });
    d.versione_schema = 4;
  }

  // v4 -> v5: la mappa note diventa configurabile (numero di note e indice di partenza
  // liberi, non più fissi a 9 posizioni da 0). La migrazione NON cambia la mappa esistente:
  // si limita a registrare esplicitamente quante note e da dove parte quella già in uso,
  // così l'utente può poi decidere se e come cambiarla dalle Impostazioni.
  if(d.versione_schema < 5){
    d.noteCount = d.mappaNote.length;
    const nums = d.mappaNote.map(n=>n.numero);
    d.startIndex = nums.length ? Math.min(...nums) : 0;
    d.versione_schema = 5;
  }

  // Aggiunge il tag 2/4 una sola volta, rispettando un'eventuale rimozione manuale successiva.
  if(!d.migrazioni.includes('cat-2-4')){
    if(!d.categorie.includes('2/4')) d.categorie.push('2/4');
    d.migrazioni.push('cat-2-4');
  }
  return d;
}

function saveData(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DATA));
}

function genId(){
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
}
function nowIso(){ return new Date().toISOString(); }

/* =========================================================
   3. UTILITY
   ========================================================= */
function el(sel){ return document.querySelector(sel); }
function els(sel){ return Array.from(document.querySelectorAll(sel)); }
function debounce(fn, ms){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}
function slotsPerBar(item){ return item.tempo.battiti * item.tempo.suddivisione; }
function subdivLabel(s){ return s===1?'quarti':(s===2?'ottavi':(s===3?'terzine':'sedicesimi')); }
function tempoSignatureText(item){
  return `${item.tempo.battiti}/${item.tempo.suddivisione===1?4:(item.tempo.suddivisione===2?8:(item.tempo.suddivisione===3?'4 (terzine)':16))}`;
}

// Estremi correnti della mappa note (posizione minima/massima valida); usati per capire
// se un numero di nota già scritto in una canzone/pattern è "orfano" rispetto alla mappa attuale.
function mappaNoteRange(){
  if(!DATA.mappaNote.length) return null;
  const nums = DATA.mappaNote.map(m=>m.numero);
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

// Risolve un numero di nota sulla voce corrispondente della mappa; se la nota è orfana
// (numero fuori dal range attuale), la aggancia alla nota valida più estrema dalla stessa parte
// (così in riproduzione suona comunque, come la nota più acuta o più grave disponibile).
function resolveNoteMapEntry(numero){
  const found = DATA.mappaNote.find(m=>m.numero===numero);
  if(found) return found;
  const range = mappaNoteRange();
  if(!range) return null;
  if(numero > range.max) return DATA.mappaNote.find(m=>m.numero===range.max);
  if(numero < range.min) return DATA.mappaNote.find(m=>m.numero===range.min);
  return null;
}

// Etichetta testuale di una nota: numero/lettera/solfeggio per le note intonate valide,
// "+"/"-" per numeri fuori dal range attuale della mappa (orfani), "Tak"/"Gh" per le pseudo-note.
function noteLabel(numero){
  if(numero==='tak') return 'Tak';
  if(numero==='ghost') return 'Gh';
  const n = DATA.mappaNote.find(m=>m.numero===numero);
  if(n){
    if(DATA.notationMode==='lettera') return n.anglo;
    if(DATA.notationMode==='solfeggio') return n.solf;
    return String(numero);
  }
  const range = mappaNoteRange();
  if(range){
    if(numero > range.max) return '+';
    if(numero < range.min) return '-';
  }
  return '?';
}
function noteChipHtml(note){
  const isGhost = note.num==='ghost';
  const isTak = note.num==='tak';
  const cls = ['note-chip'];
  if(isTak) cls.push('note-tak');
  if(isGhost) cls.push('note-ghost');
  if(!isGhost){ // le ghost note non hanno controllo di intensità: volume fisso, sempre basso
    if(note.i===1) cls.push('i-forte');
    if(note.i===2) cls.push('i-debole');
  }
  if(note.mano==='dx') cls.push('hand-dx');
  if(note.mano==='sx') cls.push('hand-sx');
  return `<span class="${cls.join(' ')}">${escapeHtml(noteLabel(note.num))}</span>`;
}

// Calcola la frequenza (Hz) di una nota a partire dal suo nome testuale (es. "Bb3", "F#4"),
// invece di cercarla in una tabella fissa: necessario perché la mappa note è ora configurabile
// e può contenere qualsiasi nome, non solo le 9 voci originarie del D Kurd.
function noteFreqFromAnglo(anglo){
  const p = parseNoteToken(anglo);
  if(!p) return null;
  const octave = p.octave===null ? 4 : p.octave;
  const height = p.pc + octave*12;
  const semitonesFromA4 = height - 57; // A4: classe "la" (pc 9), ottava 4 -> altezza 57
  return 440 * Math.pow(2, semitonesFromA4/12);
}
function escapeHtml(s){
  return (s===undefined||s===null?'':String(s)).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

/* =========================================================
   4. STATO APPLICAZIONE / ROUTER
   ========================================================= */
const state = {
  currentTab: 'rhythms',
  rhythmsSearch: '', rhythmsFav: false, rhythmsCats: new Set(), rhythmsSort: 'modifica-desc',
  songsSearch: '', songsFav: false, songsCats: new Set(), songsSort: 'modifica-desc',
  patternsSearch: '', patternsFav: false, patternsCats: new Set(), patternsSort: 'modifica-desc',
  editingRhythmId: null, editingSongId: null, editingPatternId: null,
  rhythmDraft: null, songDraft: null, patternDraft: null,
  detailRhythmId: null, detailSongId: null, detailPatternId: null,
  barClipboardRhythm: null, barClipboardSong: null, barClipboardGuide: null,
  songSelected: null, // {barIdx, slotIdx} — selezione corrente nell'editor canzone o nel giro attivo di un pattern
  patternActiveGiroIdx: 0, // quale giro del pattern in editing riceve le scorciatoie da tastiera
  rdTabSpans: [], sdTabSpans: [],
  pdGuideSpans: [], pdGiroSpansById: {}, // span di evidenziazione per la riproduzione in dettaglio pattern
};

function showView(id){
  els('.view').forEach(v=>v.classList.add('hidden'));
  el('#'+id).classList.remove('hidden');
}

function showTab(tab){
  state.currentTab = tab;
  els('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  if(tab==='rhythms'){ showView('view-rhythms-list'); renderRhythmsList(); }
  if(tab==='songs'){ showView('view-songs-list'); renderSongsList(); }
  if(tab==='patterns'){ showView('view-patterns-list'); renderPatternsList(); }
  if(tab==='metronome'){ showView('view-metronome'); }
}

/* =========================================================
   5. AUDIO ENGINE (condiviso: ritmo, canzone, metronomo)
   ========================================================= */
const AudioEngine = (function(){
  let ctx = null;
  function ensureCtx(){
    if(!ctx) ctx = new (window.AudioContext||window.webkitAudioContext)();
    if(ctx.state==='suspended') ctx.resume();
    return ctx;
  }

  // Transiente breve e acuto sovrapposto ai colpi non intonati quando l'intensità è "forte":
  // dà all'accento un attacco riconoscibile (non solo più volume), udibile anche su altoparlanti
  // piccoli dove una semplice differenza di guadagno passa quasi inosservata.
  function addAccentTransient(c, time, gain){
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(2400, time);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time+0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time+0.03);
    osc.connect(g).connect(c.destination);
    osc.start(time); osc.stop(time+0.04);
  }

  // Suoni percussivi sintetizzati per Dum/Ta/Ka (oscillatore + inviluppo breve).
  function playPerc(type, time, intensity){
    const c = ensureCtx();
    const gainMul = intensity==='forte'?1.0:(intensity==='debole'?0.45:0.75);

    if(type==='dum'){
      // Dum più grave e più corposo del Ta/Ka: corpo abbassato ulteriormente (partenza 115Hz,
      // discesa fino a 58Hz) e guadagno di base maggiorato (x1.35) rispetto agli altri colpi,
      // per restare distinguibile anche su altoparlanti piccoli. Il breve transiente acuto
      // resta, altrimenti un tono puramente grave risulterebbe troppo debole in quel contesto.
      const dumGainMul = gainMul * 1.35;
      const dur = 0.46;
      const body = c.createOscillator();
      const bodyGain = c.createGain();
      body.type = 'sine';
      body.frequency.setValueAtTime(115, time);
      body.frequency.exponentialRampToValueAtTime(58, time+dur);
      bodyGain.gain.setValueAtTime(0.0001, time);
      bodyGain.gain.exponentialRampToValueAtTime(1.0*dumGainMul, time+0.008);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, time+dur);
      body.connect(bodyGain).connect(c.destination);
      body.start(time); body.stop(time+dur+0.02);

      const click = c.createOscillator();
      const clickGain = c.createGain();
      click.type = 'triangle';
      click.frequency.setValueAtTime(340, time);
      clickGain.gain.setValueAtTime(0.0001, time);
      clickGain.gain.exponentialRampToValueAtTime(0.55*dumGainMul, time+0.004);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, time+0.05);
      click.connect(clickGain).connect(c.destination);
      click.start(time); click.stop(time+0.07);

      if(intensity==='forte') addAccentTransient(c, time, 0.5);
      return;
    }

    let freq, dur, oscType;
    if(type==='ta'){ freq=520; dur=0.09; oscType='triangle'; }
    else { freq=760; dur=0.06; oscType='square'; }
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = oscType; osc.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.9*gainMul, time+0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, time+dur);
    osc.connect(gain).connect(c.destination);
    osc.start(time); osc.stop(time+dur+0.02);

    if(intensity==='forte') addAccentTransient(c, time, 0.35);
  }

  // Tak: colpo sulla scocca metallica, senza intonazione (solo canzoni/pattern). Timbro
  // metallico e secco, distinto sia dal Ta (percussione del ritmo) sia dalle note melodiche:
  // due componenti inarmoniche molto brevi invece di un singolo tono pulito.
  function playTak(time, intensity){
    const c = ensureCtx();
    const gainMul = intensity==='forte'?1.0:(intensity==='debole'?0.4:0.7);
    const dur = 0.05;
    [ {freq:1800, type:'square', amp:0.55}, {freq:3100, type:'triangle', amp:0.3} ].forEach(({freq,type,amp})=>{
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(amp*gainMul, time+0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, time+dur);
      osc.connect(gain).connect(c.destination);
      osc.start(time); osc.stop(time+dur+0.01);
    });
    if(intensity==='forte') addAccentTransient(c, time, 0.4);
  }

  // Ghost note: senza intonazione, volume fisso e molto basso (nessun controllo di intensità
  // per definizione). Timbro a "soffio" secco (rumore breve filtrato dall'inviluppo), distinto
  // sia dal Ta/Ka che dal Tak.
  function playGhost(time){
    const c = ensureCtx();
    const dur = 0.035;
    const bufferSize = Math.max(1, Math.floor(c.sampleRate*dur));
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++) data[i] = (Math.random()*2-1) * (1 - i/bufferSize);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.12, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time+dur);
    src.connect(gain).connect(c.destination);
    src.start(time); src.stop(time+dur+0.005);
  }

  // Suono per singola nota melodica (canzone), timbro metallico semplice.
  function playNote(freq, time, intensity){
    const c = ensureCtx();
    const gainMul = intensity==='forte'?1.0:(intensity==='debole'?0.4:0.7);
    const dur = 0.55;
    [1, 2.76, 5.4].forEach((mult,i)=>{
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq*mult, time);
      const amp = 0.5*gainMul/(i+1.6);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(amp, time+0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, time+dur);
      osc.connect(gain).connect(c.destination);
      osc.start(time); osc.stop(time+dur+0.02);
    });
  }

  function click(time, accented){
    const c = ensureCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type='sine';
    osc.frequency.setValueAtTime(accented?1500:900, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accented?0.55:0.32, time+0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time+0.05);
    osc.connect(gain).connect(c.destination);
    osc.start(time); osc.stop(time+0.06);
  }

  return { ensureCtx, playPerc, playNote, playTak, playGhost, click, now:()=>ensureCtx().currentTime };
})();

/* Scheduler generico a step, usato da riproduzione ritmo/canzone e metronomo.
   options: { bpm, subdivision (n. di step per beat), totalSteps, stepCallback(stepIndex, time), loop(bool) } */
function createStepScheduler(opts){
  const ctx = AudioEngine.ensureCtx();
  const lookahead = 0.12; // secondi
  const interval = 25; // ms
  let stepDuration = 60 / opts.bpm / opts.subdivision;
  let nextStepTime = 0;
  let stepIndex = 0;
  let timer = null;
  let running = false;
  let onVisualStep = opts.onVisualStep || function(){};

  function scheduleStep(idx, time){
    opts.stepCallback(idx, time);
    const delayMs = Math.max(0,(time - ctx.currentTime)*1000);
    setTimeout(()=>{ if(running) onVisualStep(idx); }, delayMs);
  }

  function tick(){
    while(nextStepTime < ctx.currentTime + lookahead){
      scheduleStep(stepIndex, nextStepTime);
      nextStepTime += stepDuration;
      stepIndex++;
      if(stepIndex >= opts.totalSteps){
        if(opts.loop) stepIndex = 0;
        else { stop(); return; }
      }
    }
  }

  function start(){
    if(running) return;
    running = true;
    nextStepTime = ctx.currentTime + 0.06;
    stepIndex = 0;
    timer = setInterval(tick, interval);
  }
  function stop(){
    running = false;
    if(timer) clearInterval(timer);
    timer = null;
    if(opts.onStop) opts.onStop();
  }
  function isRunning(){ return running; }
  function setBpm(bpm){ stepDuration = 60/bpm/opts.subdivision; }

  return { start, stop, isRunning, setBpm };
}

/* =========================================================
   6. WAKE LOCK
   ========================================================= */
const WakeLockMgr = (function(){
  let lock = null;
  async function acquire(){
    try{
      if('wakeLock' in navigator){
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', ()=>{ lock=null; });
      }
    }catch(e){ /* non disponibile o negato: si ignora silenziosamente */ }
  }
  async function release(){
    try{ if(lock){ await lock.release(); lock=null; } }catch(e){}
  }
  document.addEventListener('visibilitychange', async ()=>{
    if(document.visibilityState==='visible' && ActivePlayback.anyActive()){
      await acquire();
    }
  });
  return { acquire, release };
})();

// Tiene traccia di eventuali riproduzioni attive per il riaggancio del wake lock.
const ActivePlayback = {
  metronome:false, rhythm:false, song:false, pattern:false,
  anyActive(){ return this.metronome||this.rhythm||this.song||this.pattern; }
};

/* =========================================================
   7. GRIGLIA RITMO — struttura dati e rendering
   ========================================================= */
function newEmptyRhythmBar(n){
  // Una battuta ha una o più "righe" parallele (fino a 3), ognuna con la propria sequenza
  // di colpi: permette di suonare Dum+Ta+Ka insieme sullo stesso movimento.
  return { righe: [ Array.from({length:n}, ()=>({ c:null, i:0 })) ] }; // c: null|'dum'|'ta'|'ka'  i: 0 normale,1 forte,2 debole
}
function newRhythmRiga(n){
  return Array.from({length:n}, ()=>({ c:null, i:0 }));
}
function newEmptySongBar(n){
  return Array.from({length:n}, ()=>({ n:[], click:false })); // n: [{num, i, mano}], click: metronomo interno
}

const INTENSITIES = ['normale','forte','debole'];
const MAX_RHYTHM_RIGHE = 3;

function beatRulerRow(spb, suddivisione){
  const ruler = document.createElement('div');
  ruler.className = 'beat-ruler';
  for(let i=0;i<spb;i++){
    const cell = document.createElement('div');
    cell.className = 'ruler-cell';
    if(i % suddivisione === 0) cell.textContent = String(Math.floor(i/suddivisione)+1);
    ruler.appendChild(cell);
  }
  return ruler;
}

function renderRhythmBars(container, draft, opts){
  const editable = opts.editable;
  const singleRiga = !!opts.singleRiga; // usato dal ritmo guida dei Pattern: nessuna riga aggiuntiva
  const clipboardKey = opts.clipboardKey || 'barClipboardRhythm';
  container.innerHTML = '';
  draft.battute.forEach((bar, barIdx)=>{
    const row = document.createElement('div');
    row.className = 'bar-row';
    const top = document.createElement('div');
    top.className = 'bar-row-top';
    top.innerHTML = `<span class="bar-label">Misura ${barIdx+1}</span>`;
    if(editable){
      const tools = document.createElement('div');
      tools.className = 'bar-tools';
      tools.innerHTML = `
        <button data-act="up" title="Sposta su" ${barIdx===0?'disabled':''}>↑</button>
        <button data-act="down" title="Sposta giù" ${barIdx===draft.battute.length-1?'disabled':''}>↓</button>
        <button data-act="copy" title="Copia">⧉</button>
        <button data-act="paste" title="Incolla">📋</button>
        <button data-act="dup" title="Duplica dopo">+1</button>
        <button data-act="del" title="Elimina">✕</button>`;
      tools.querySelector('[data-act=up]').onclick = ()=>{
        if(barIdx===0) return;
        const tmp = draft.battute[barIdx-1]; draft.battute[barIdx-1] = draft.battute[barIdx]; draft.battute[barIdx] = tmp;
        renderRhythmBars(container, draft, opts);
      };
      tools.querySelector('[data-act=down]').onclick = ()=>{
        if(barIdx===draft.battute.length-1) return;
        const tmp = draft.battute[barIdx+1]; draft.battute[barIdx+1] = draft.battute[barIdx]; draft.battute[barIdx] = tmp;
        renderRhythmBars(container, draft, opts);
      };
      tools.querySelector('[data-act=copy]').onclick = ()=>{ state[clipboardKey] = JSON.parse(JSON.stringify(bar)); };
      tools.querySelector('[data-act=paste]').onclick = ()=>{
        if(state[clipboardKey]){ draft.battute[barIdx] = JSON.parse(JSON.stringify(state[clipboardKey])); renderRhythmBars(container, draft, opts); }
      };
      tools.querySelector('[data-act=dup]').onclick = ()=>{
        draft.battute.splice(barIdx+1, 0, JSON.parse(JSON.stringify(bar)));
        renderRhythmBars(container, draft, opts);
      };
      tools.querySelector('[data-act=del]').onclick = ()=>{
        if(draft.battute.length<=1) return;
        draft.battute.splice(barIdx,1);
        renderRhythmBars(container, draft, opts);
      };
      top.appendChild(tools);
    }
    row.appendChild(top);
    row.appendChild(beatRulerRow(draft.tempo.battiti*draft.tempo.suddivisione, draft.tempo.suddivisione));

    bar.righe.forEach((riga, rigaIdx)=>{
      const rigaWrap = document.createElement('div');
      rigaWrap.className = 'riga-wrap';
      if(editable && !singleRiga && bar.righe.length>1){
        const rigaTop = document.createElement('div');
        rigaTop.className = 'riga-top';
        const rigaLabel = document.createElement('span');
        rigaLabel.className = 'riga-label'; rigaLabel.textContent = `Riga ${rigaIdx+1}`;
        const delBtn = document.createElement('button');
        delBtn.type='button'; delBtn.className='riga-del-btn'; delBtn.textContent='✕ Elimina riga';
        delBtn.onclick = ()=>{
          const hasContent = riga.some(s=>s.c);
          const doDelete = ()=>{ bar.righe.splice(rigaIdx,1); renderRhythmBars(container, draft, opts); };
          if(hasContent){ if(confirm('Questa riga contiene già dei colpi: eliminarla comunque?')) doDelete(); }
          else doDelete();
        };
        rigaTop.appendChild(rigaLabel); rigaTop.appendChild(delBtn);
        rigaWrap.appendChild(rigaTop);
      }

      const grid = document.createElement('div');
      grid.className = 'slot-grid';
      riga.forEach((slot, slotIdx)=>{
        const b = document.createElement('button');
        b.type='button';
        b.className = 'slot-btn' + (slotIdx % draft.tempo.suddivisione===0 ? ' beat-start':'') +
          (slot.c ? ' '+slot.c : '') + (slot.c && slot.i===1 ? ' intensity-forte':'') + (slot.c && slot.i===2 ? ' intensity-debole':'');
        b.dataset.bar = barIdx; b.dataset.slot = slotIdx; b.dataset.riga = rigaIdx;
        b.textContent = slot.c ? ({dum:'D',ta:'T',ka:'K'})[slot.c] : '·';
        if(editable){
          let pressTimer=null, longPressed=false;
          b.addEventListener('pointerdown', ()=>{
            longPressed=false;
            pressTimer = setTimeout(()=>{
              longPressed=true;
              if(slot.c){ slot.i = (slot.i+1)%3; applySlotClass(b, slot); }
            }, 480);
          });
          const clear = ()=>{ if(pressTimer) clearTimeout(pressTimer); };
          b.addEventListener('pointerup', ()=>{
            clear();
            if(!longPressed){
              const order=[null,'dum','ta','ka'];
              const idx = order.indexOf(slot.c);
              slot.c = order[(idx+1)%order.length];
              if(!slot.c) slot.i = 0;
              applySlotClass(b, slot);
            }
          });
          b.addEventListener('pointerleave', clear);
          b.addEventListener('contextmenu', (e)=>e.preventDefault());
        }
        grid.appendChild(b);
      });
      rigaWrap.appendChild(grid);
      row.appendChild(rigaWrap);
    });

    if(editable && !singleRiga){
      const addRigaBtn = document.createElement('button');
      addRigaBtn.type='button';
      addRigaBtn.className = 'btn btn-secondary btn-block add-riga-btn';
      if(bar.righe.length >= MAX_RHYTHM_RIGHE){
        addRigaBtn.textContent = 'Massimo 3 righe per battuta';
        addRigaBtn.disabled = true;
      } else {
        addRigaBtn.textContent = '+ Aggiungi riga (per suonare più colpi insieme)';
        addRigaBtn.onclick = ()=>{
          bar.righe.push(newRhythmRiga(draft.tempo.battiti*draft.tempo.suddivisione));
          renderRhythmBars(container, draft, opts);
        };
      }
      row.appendChild(addRigaBtn);
    }

    container.appendChild(row);
  });
}
function applySlotClass(btn, slot){
  btn.className = 'slot-btn' + (btn.classList.contains('beat-start')?' beat-start':'') +
    (slot.c ? ' '+slot.c : '') + (slot.c && slot.i===1 ? ' intensity-forte':'') + (slot.c && slot.i===2 ? ' intensity-debole':'');
  btn.textContent = slot.c ? ({dum:'D',ta:'T',ka:'K'})[slot.c] : '·';
}

/* =========================================================
   8. GRIGLIA CANZONE — struttura dati, rendering, tastiera
   ========================================================= */
function songFlatIndex(d, barIdx, slotIdx){ return barIdx*slotsPerBar(d) + slotIdx; }
function songIndexToPos(d, flatIdx){
  const spb = slotsPerBar(d);
  return { barIdx: Math.floor(flatIdx/spb), slotIdx: flatIdx % spb };
}
function songTotalSlots(d){ return d.battute.length * slotsPerBar(d); }

function renderSongBars(container, draft, opts){
  const editable = opts.editable;
  container.innerHTML = '';
  draft.battute.forEach((bar, barIdx)=>{
    const row = document.createElement('div');
    row.className = 'bar-row';
    const top = document.createElement('div');
    top.className = 'bar-row-top';
    top.innerHTML = `<span class="bar-label">Misura ${barIdx+1}</span>`;
    if(editable){
      const tools = document.createElement('div');
      tools.className = 'bar-tools';
      tools.innerHTML = `
        <button data-act="up" title="Sposta su" ${barIdx===0?'disabled':''}>↑</button>
        <button data-act="down" title="Sposta giù" ${barIdx===draft.battute.length-1?'disabled':''}>↓</button>
        <button data-act="copy" title="Copia">⧉</button>
        <button data-act="paste" title="Incolla">📋</button>
        <button data-act="dup" title="Duplica dopo">+1</button>
        <button data-act="del" title="Elimina">✕</button>`;
      tools.querySelector('[data-act=up]').onclick = ()=>{
        if(barIdx===0) return;
        const tmp = draft.battute[barIdx-1]; draft.battute[barIdx-1] = draft.battute[barIdx]; draft.battute[barIdx] = tmp;
        renderSongBars(container, draft, {editable});
      };
      tools.querySelector('[data-act=down]').onclick = ()=>{
        if(barIdx===draft.battute.length-1) return;
        const tmp = draft.battute[barIdx+1]; draft.battute[barIdx+1] = draft.battute[barIdx]; draft.battute[barIdx] = tmp;
        renderSongBars(container, draft, {editable});
      };
      tools.querySelector('[data-act=copy]').onclick = ()=>{ state.barClipboardSong = JSON.parse(JSON.stringify(bar)); };
      tools.querySelector('[data-act=paste]').onclick = ()=>{
        if(state.barClipboardSong){ draft.battute[barIdx] = JSON.parse(JSON.stringify(state.barClipboardSong)); renderSongBars(container, draft, {editable}); }
      };
      tools.querySelector('[data-act=dup]').onclick = ()=>{
        draft.battute.splice(barIdx+1, 0, JSON.parse(JSON.stringify(bar)));
        renderSongBars(container, draft, {editable});
      };
      tools.querySelector('[data-act=del]').onclick = ()=>{
        if(draft.battute.length<=1) return;
        draft.battute.splice(barIdx,1);
        renderSongBars(container, draft, {editable});
      };
      top.appendChild(tools);
    }
    row.appendChild(top);
    row.appendChild(beatRulerRow(draft.tempo.battiti*draft.tempo.suddivisione, draft.tempo.suddivisione));

    const grid = document.createElement('div');
    grid.className = 'slot-grid';
    bar.forEach((slot, slotIdx)=>{
      const b = document.createElement('button');
      b.type='button';
      const isSelected = editable && state.songSelected && state.songSelected.barIdx===barIdx && state.songSelected.slotIdx===slotIdx;
      b.className = 'slot-btn' + (slotIdx % draft.tempo.suddivisione===0 ? ' beat-start':'') + (slot.n.length ? ' has-notes':'') + (slot.click ? ' has-click':'') + (isSelected?' selected':'');
      b.innerHTML = slot.n.length ? slot.n.map(noteChipHtml).join('') : '·';
      if(editable){
        b.addEventListener('click', ()=>{
          state.songSelected = {barIdx, slotIdx};
          renderSongBars(container, draft, {editable:true});
          openNotePicker(draft, barIdx, slotIdx, container);
        });
      }
      grid.appendChild(b);
    });
    row.appendChild(grid);
    container.appendChild(row);
  });
}

// Cella singola del selettore note: riusata sia per le note intonate (dalla mappa configurabile)
// sia per le pseudo-note Tak/Ghost, così la logica di selezione/intensità/mano resta unica.
function buildNotePickCell(slot, num, onChange){
  const isGhost = num==='ghost';
  const isTak = num==='tak';
  const existing = slot.n.find(x=>x.num===num);
  const cell = document.createElement('div');
  cell.className = 'note-pick-cell';

  const main = document.createElement('button');
  main.type='button';
  main.className = 'note-pick-btn' + (existing?' selected':'') +
    (existing && !isGhost && existing.i===1?' intensity-forte':'') +
    (existing && !isGhost && existing.i===2?' intensity-debole':'') +
    (existing&&existing.mano==='dx'?' hand-dx':'') + (existing&&existing.mano==='sx'?' hand-sx':'') +
    (isTak?' pick-tak':'') + (isGhost?' pick-ghost':'');
  const smallLabel = isTak ? 'Tak' : (isGhost ? 'Ghost' : (num===0?'Dum':'#'+num));
  main.innerHTML = `<span>${escapeHtml(noteLabel(num))}</span><span class="small">${smallLabel}</span>`;
  main.onclick = ()=>{
    const i = slot.n.findIndex(x=>x.num===num);
    if(i>=0) slot.n.splice(i,1);
    else slot.n.push({num, i:0, mano:null});
    onChange();
  };
  cell.appendChild(main);

  if(existing){
    const controls = document.createElement('div');
    controls.className = 'note-pick-controls';
    if(!isGhost){ // le ghost note non hanno controllo di intensità: è già "il minimo" per definizione
      const intBtn = document.createElement('button');
      intBtn.type='button'; intBtn.className='sub-chip';
      intBtn.textContent = existing.i===1?'Forte':(existing.i===2?'Debole':'Normale');
      intBtn.onclick = (e)=>{ e.stopPropagation(); existing.i=(existing.i+1)%3; onChange(); };
      controls.appendChild(intBtn);
    }
    const manoBtn = document.createElement('button');
    manoBtn.type='button'; manoBtn.className='sub-chip';
    manoBtn.textContent = existing.mano==='dx'?'Mano dx':(existing.mano==='sx'?'Mano sx':'Mano —');
    manoBtn.onclick = (e)=>{
      e.stopPropagation();
      existing.mano = existing.mano===null ? 'dx' : (existing.mano==='dx' ? 'sx' : null);
      onChange();
    };
    controls.appendChild(manoBtn);
    cell.appendChild(controls);
  }
  return cell;
}

function openNotePicker(draft, barIdx, slotIdx, containerToRefresh){
  const slot = draft.battute[barIdx][slotIdx];
  const sheet = el('#note-picker');
  const grid = el('#note-picker-grid');
  grid.innerHTML = '';
  const refresh = ()=> openNotePicker(draft, barIdx, slotIdx, containerToRefresh);

  const sortedNotes = DATA.mappaNote.slice().sort((a,b)=>a.numero-b.numero);
  sortedNotes.forEach(mapEntry=> grid.appendChild(buildNotePickCell(slot, mapEntry.numero, refresh)));

  const sep = document.createElement('div');
  sep.className = 'note-picker-sep';
  sep.textContent = 'Colpi speciali';
  grid.appendChild(sep);

  grid.appendChild(buildNotePickCell(slot, 'tak', refresh));
  grid.appendChild(buildNotePickCell(slot, 'ghost', refresh));

  const clickBox = el('#note-picker-click');
  clickBox.checked = !!slot.click;
  clickBox.onchange = ()=>{ slot.click = clickBox.checked; };
  sheet.classList.remove('hidden');
  el('#note-picker-done').onclick = ()=>{
    sheet.classList.add('hidden');
    renderSongBars(containerToRefresh, draft, {editable:true});
  };
}

// Costruisce l'assegnazione dei tasti scorciatoia in base alla mappa note corrente:
// - cifre 0-9 mappano direttamente il numero di nota corrispondente (se presente in mappa;
//   se la mappa parte da 1, la cifra "0" semplicemente non corrisponde a nessuna nota);
// - le note con numero a due cifre (10, 11, 12...) occupano in ordine crescente i tasti
//   Q W E R T Y U I O P;
// - esaurite le note, i due tasti successivi della stessa sequenza sono assegnati a Tak e Ghost.
const QWERTY_SEQ = ['Q','W','E','R','T','Y','U','I','O','P'];
function buildKeyAssignments(){
  const digitToNumero = {};
  const letterToTarget = {};
  const nums = DATA.mappaNote.map(m=>m.numero).sort((a,b)=>a-b);
  nums.forEach(n=>{ if(n>=0 && n<=9) digitToNumero[String(n)] = n; });
  const extra = nums.filter(n=> n<0 || n>9).sort((a,b)=>a-b);
  let li = 0;
  extra.forEach(n=>{
    if(li < QWERTY_SEQ.length){ letterToTarget[QWERTY_SEQ[li]] = {type:'note', numero:n}; li++; }
  });
  if(li < QWERTY_SEQ.length){ letterToTarget[QWERTY_SEQ[li]] = {type:'tak'}; li++; }
  if(li < QWERTY_SEQ.length){ letterToTarget[QWERTY_SEQ[li]] = {type:'ghost'}; li++; }
  return { digitToNumero, letterToTarget };
}

// Determina quale griglia (canzone in editing, oppure giro attivo di un pattern in editing)
// deve ricevere le scorciatoie da tastiera in questo momento: le due viste sono mutuamente
// esclusive (una sola può essere visibile), quindi non c'è ambiguità su quale intercettare.
function getActiveGridContext(){
  const songView = el('#view-song-editor');
  if(songView && !songView.classList.contains('hidden') && !el('#song-form').classList.contains('hidden')){
    return { draft: state.songDraft, container: el('#song-bars') };
  }
  const patternView = el('#view-pattern-editor');
  if(patternView && !patternView.classList.contains('hidden') && !el('#pattern-form').classList.contains('hidden')){
    const pd = state.patternDraft;
    if(pd && pd.giri[state.patternActiveGiroIdx]){
      const giro = pd.giri[state.patternActiveGiroIdx];
      return { draft: giroAsDraft(pd, giro), container: el(`#pgb-${giro.id}`) };
    }
  }
  return null;
}

/* Navigazione e digitazione da tastiera nell'editor canzone (o nel giro attivo di un pattern) */
function handleSongEditorKeydown(e){
  if(!el('#note-picker').classList.contains('hidden')) return; // popup aperto: non intercettare
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return;

  const ctx = getActiveGridContext();
  if(!ctx || !ctx.draft || !ctx.container) return;
  const d = ctx.draft;
  const container = ctx.container;
  if(!state.songSelected) state.songSelected = {barIdx:0, slotIdx:0};
  const total = songTotalSlots(d);
  let flat = songFlatIndex(d, state.songSelected.barIdx, state.songSelected.slotIdx);

  if(e.key==='ArrowRight'){
    e.preventDefault();
    flat = Math.min(flat+1, total-1);
    state.songSelected = songIndexToPos(d, flat);
    renderSongBars(container, d, {editable:true});
    return;
  }
  if(e.key==='ArrowLeft'){
    e.preventDefault();
    flat = Math.max(flat-1, 0);
    state.songSelected = songIndexToPos(d, flat);
    renderSongBars(container, d, {editable:true});
    return;
  }
  if(e.key===' '){
    e.preventDefault();
    const pos = state.songSelected;
    d.battute[pos.barIdx][pos.slotIdx].n = [];
    flat = Math.min(flat+1, total-1);
    state.songSelected = songIndexToPos(d, flat);
    renderSongBars(container, d, {editable:true});
    return;
  }
  if(e.key==='Delete' || e.key==='Backspace'){
    e.preventDefault();
    const pos = state.songSelected;
    d.battute[pos.barIdx][pos.slotIdx].n = [];
    renderSongBars(container, d, {editable:true});
    return;
  }
  if(e.key==='Enter'){
    e.preventDefault();
    const pos = state.songSelected;
    openNotePicker(d, pos.barIdx, pos.slotIdx, container);
    return;
  }
  const ka = buildKeyAssignments();
  if(/^[0-9]$/.test(e.key) && ka.digitToNumero[e.key]!==undefined){
    e.preventDefault();
    const num = ka.digitToNumero[e.key];
    const pos = state.songSelected;
    const slot = d.battute[pos.barIdx][pos.slotIdx];
    const i = slot.n.findIndex(x=>x.num===num);
    if(i>=0) slot.n.splice(i,1);
    else slot.n.push({num, i:0, mano:null});
    renderSongBars(container, d, {editable:true});
    return;
  }
  const upperKey = e.key.length===1 ? e.key.toUpperCase() : '';
  if(ka.letterToTarget[upperKey]){
    e.preventDefault();
    const t = ka.letterToTarget[upperKey];
    const target = t.type==='note' ? t.numero : t.type; // numero, oppure 'tak'/'ghost'
    const pos = state.songSelected;
    const slot = d.battute[pos.barIdx][pos.slotIdx];
    const i = slot.n.findIndex(x=>x.num===target);
    if(i>=0) slot.n.splice(i,1);
    else slot.n.push({num:target, i:0, mano:null});
    renderSongBars(container, d, {editable:true});
    return;
  }
}
document.addEventListener('keydown', handleSongEditorKeydown);

/* =========================================================
   9. CAMBIO TEMPO A SCRITTURA INIZIATA (ritmo e canzone)
   ========================================================= */
function resizeDraftTempo(draft, battiti, suddivisione, isRhythm){
  const spb = battiti*suddivisione;
  if(isRhythm){
    draft.battute = draft.battute.map(bar=>({
      righe: bar.righe.map(riga=>{
        let nr = riga.slice(0, spb);
        while(nr.length < spb) nr.push({c:null,i:0});
        return nr;
      })
    }));
  } else {
    draft.battute = draft.battute.map(bar=>{
      let nb = bar.slice(0, spb);
      while(nb.length < spb) nb.push({n:[],click:false});
      return nb;
    });
  }
  draft.tempo = { battiti, suddivisione };
}
function draftHasContentRhythm(draft){
  return draft.battute.some(bar=> bar.righe.some(riga=> riga.some(s=>s.c)));
}
function draftHasContentSong(draft){
  return draft.battute.some(bar=>bar.some(s=>s.n.length));
}
function updateTempoLabel(prefix, d){
  el(`#${prefix}-tempo-label`).textContent = `Tempo attuale: ${d.tempo.battiti} battiti · ${subdivLabel(d.tempo.suddivisione)}`;
}

/* =========================================================
   10. CATEGORIE — selezione multipla riusabile
   ========================================================= */
function renderCatSelector(container, selectedSet, onChange){
  container.innerHTML = '';
  DATA.categorie.forEach(cat=>{
    const chip = document.createElement('span');
    chip.className = 'chip' + (selectedSet.has(cat)?' active':'');
    chip.textContent = cat;
    chip.onclick = ()=>{
      if(selectedSet.has(cat)) selectedSet.delete(cat); else selectedSet.add(cat);
      renderCatSelector(container, selectedSet, onChange);
      if(onChange) onChange();
    };
    container.appendChild(chip);
  });
  if(DATA.categorie.length===0){
    const p = document.createElement('span');
    p.className='hint-text'; p.textContent='Nessuna categoria: aggiungine una dalle Impostazioni.';
    container.appendChild(p);
  }
}

function renderCatFilterChips(container, selectedSet, onChange){
  container.innerHTML = '';
  DATA.categorie.forEach(cat=>{
    const chip = document.createElement('span');
    chip.className = 'chip' + (selectedSet.has(cat)?' active':'');
    chip.textContent = cat;
    chip.onclick = ()=>{
      if(selectedSet.has(cat)) selectedSet.delete(cat); else selectedSet.add(cat);
      renderCatFilterChips(container, selectedSet, onChange);
      onChange();
    };
    container.appendChild(chip);
  });
}

/* Selettore rapido numero/lettera/solfeggio, riusabile in più viste */
function renderNotationToggle(containerSel, onChanged){
  const c = el(containerSel);
  if(!c) return;
  c.querySelectorAll('button[data-mode]').forEach(b=>{
    b.classList.toggle('active', b.dataset.mode===DATA.notationMode);
    b.onclick = ()=>{
      DATA.notationMode = b.dataset.mode;
      saveData();
      renderNotationToggle(containerSel, onChanged);
      if(onChanged) onChanged();
    };
  });
}

/* =========================================================
   11. LISTE — RITMI
   ========================================================= */
function tabPreviewString(item){
  const bar = item.battute[0];
  if(!bar || !bar.righe || !bar.righe[0]) return '';
  const spb = bar.righe[0].length;
  const syms = [];
  for(let s=0; s<spb; s++){
    const letters = [];
    bar.righe.forEach(riga=>{ if(riga[s] && riga[s].c) letters.push(({dum:'D',ta:'T',ka:'K'})[riga[s].c]); });
    syms.push(letters.length ? letters.join('') : '·');
  }
  const more = item.battute.length>1 ? '  |  …' : '';
  return syms.join(' ') + more;
}

function renderRhythmsList(){
  renderCatFilterChips(el('#rhythms-cat-chips'), state.rhythmsCats, renderRhythmsList);
  let items = DATA.ritmi.slice();
  const q = state.rhythmsSearch.trim().toLowerCase();
  if(q) items = items.filter(r => (r.titolo+' '+r.note).toLowerCase().includes(q));
  if(state.rhythmsFav) items = items.filter(r=>r.preferito);
  if(state.rhythmsCats.size) items = items.filter(r=> r.categorie.some(c=>state.rhythmsCats.has(c)));
  items = sortItems(items, state.rhythmsSort);

  const list = el('#rhythms-list');
  list.innerHTML = '';
  el('#rhythms-empty').classList.toggle('hidden', items.length>0);
  items.forEach((item, idx)=>{
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-top">
        <span class="item-title">${escapeHtml(item.titolo||'(senza titolo)')}</span>
        <span class="item-fav">${item.preferito?'★':''}</span>
      </div>
      <div class="item-preview">${escapeHtml(tabPreviewString(item))}</div>
      <div class="item-meta-row">
        ${item.bpm?`<span class="mini-chip">${item.bpm} bpm</span>`:''}
        ${item.categorie.map(c=>`<span class="mini-chip">${escapeHtml(c)}</span>`).join('')}
      </div>`;
    card.onclick = ()=> openRhythmDetail(item.id);
    attachManualOrderButtons(card, items, idx, state.rhythmsSort, renderRhythmsList);
    list.appendChild(card);
  });
}

function sortItems(items, mode){
  if(mode==='titolo-asc') return items.sort((a,b)=> (a.titolo||'').localeCompare(b.titolo||''));
  if(mode==='creazione-desc') return items.sort((a,b)=> new Date(b.dataCreazione)-new Date(a.dataCreazione));
  if(mode==='manuale') return items.sort((a,b)=> (a.ordine??0)-(b.ordine??0));
  return items.sort((a,b)=> new Date(b.dataModifica)-new Date(a.dataModifica));
}

// Valore di ordinamento manuale per un elemento appena creato: più piccolo di tutti quelli
// esistenti, così l'ultimo creato appare sempre in cima quando l'ordinamento è "Manuale".
function nextManualOrder(arr){
  let min = 0;
  arr.forEach(it=>{ if(typeof it.ordine==='number' && it.ordine<min) min = it.ordine; });
  return min - 1;
}
// Garantisce che ogni elemento abbia un campo ordine valido (migrazione dati vecchi o import
// da backup precedenti a questa funzionalità): chi non ce l'ha va in fondo, senza alterare
// l'ordine relativo di chi ce l'ha già.
function ensureManualOrder(arr){
  let maxOrdine = -1;
  arr.forEach(it=>{ if(typeof it.ordine==='number' && it.ordine>maxOrdine) maxOrdine = it.ordine; });
  arr.forEach(it=>{
    if(typeof it.ordine!=='number'){ maxOrdine++; it.ordine = maxOrdine; }
  });
}
// Aggiunge le frecce su/giù a una card quando l'ordinamento corrente è "Manuale". Lo scambio
// avviene sempre sull'elenco completo (il campo ordine è persistito e globale): riordinando
// con un filtro/ricerca attivi si vede semplicemente l'ordine relativo che ne risulta.
function attachManualOrderButtons(card, sortedItems, idx, mode, rerender){
  if(mode!=='manuale') return;
  const ctr = document.createElement('div');
  ctr.className = 'card-order-btns';
  const up = document.createElement('button');
  up.type='button'; up.textContent='↑'; up.title='Sposta su'; up.disabled = idx===0;
  const down = document.createElement('button');
  down.type='button'; down.textContent='↓'; down.title='Sposta giù'; down.disabled = idx===sortedItems.length-1;
  up.onclick = (e)=>{
    e.stopPropagation();
    const tmp = sortedItems[idx-1].ordine; sortedItems[idx-1].ordine = sortedItems[idx].ordine; sortedItems[idx].ordine = tmp;
    saveData(); rerender();
  };
  down.onclick = (e)=>{
    e.stopPropagation();
    const tmp = sortedItems[idx+1].ordine; sortedItems[idx+1].ordine = sortedItems[idx].ordine; sortedItems[idx].ordine = tmp;
    saveData(); rerender();
  };
  ctr.appendChild(up); ctr.appendChild(down);
  card.appendChild(ctr);
}

/* =========================================================
   12. LISTE — CANZONI
   ========================================================= */
function songPreviewString(item){
  const bar = item.battute[0] || [];
  const syms = bar.map(s => s.n.length ? s.n.map(x=>noteLabel(x.num)).join('+') : '·').join(' ');
  const more = item.battute.length>1 ? '  |  …' : '';
  return syms + more;
}

function renderSongsList(){
  renderCatFilterChips(el('#songs-cat-chips'), state.songsCats, renderSongsList);
  let items = DATA.canzoni.slice();
  const q = state.songsSearch.trim().toLowerCase();
  if(q) items = items.filter(r => (r.titolo+' '+r.note).toLowerCase().includes(q));
  if(state.songsFav) items = items.filter(r=>r.preferito);
  if(state.songsCats.size) items = items.filter(r=> r.categorie.some(c=>state.songsCats.has(c)));
  items = sortItems(items, state.songsSort);

  const list = el('#songs-list');
  list.innerHTML = '';
  el('#songs-empty').classList.toggle('hidden', items.length>0);
  items.forEach((item, idx)=>{
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-top">
        <span class="item-title">${escapeHtml(item.titolo||'(senza titolo)')}</span>
        <span class="item-fav">${item.preferito?'★':''}</span>
      </div>
      <div class="item-preview">${escapeHtml(songPreviewString(item))}</div>
      <div class="item-meta-row">
        ${item.bpm?`<span class="mini-chip">${item.bpm} bpm</span>`:''}
        ${item.audio && item.audio.nomeFile ? `<span class="mini-chip">♪ ${escapeHtml(item.audio.nomeFile)}</span>`:''}
        ${item.categorie.map(c=>`<span class="mini-chip">${escapeHtml(c)}</span>`).join('')}
      </div>`;
    card.onclick = ()=> openSongDetail(item.id);
    attachManualOrderButtons(card, items, idx, state.songsSort, renderSongsList);
    list.appendChild(card);
  });
}

/* =========================================================
   13. SELECT BATTITI (riuso in setup/cambio tempo ritmo/canzone/metronomo)
   ========================================================= */
function fillBeatsSelect(selectEl, def){
  selectEl.innerHTML='';
  for(let n=2;n<=12;n++){
    const o=document.createElement('option'); o.value=n; o.textContent=n;
    if(n===def) o.selected=true;
    selectEl.appendChild(o);
  }
}

/* =========================================================
   14. EDITOR RITMO
   ========================================================= */
function openRhythmEditor(existingId){
  state.editingRhythmId = existingId || null;
  const setupBox = el('#rhythm-setup');
  const form = el('#rhythm-form');
  el('#rhythm-delete').classList.toggle('hidden', !existingId);
  el('#rhythm-tempo-change-panel').classList.add('hidden');
  stopAllPlayback();

  if(existingId){
    const item = DATA.ritmi.find(r=>r.id===existingId);
    state.rhythmDraft = JSON.parse(JSON.stringify(item));
    setupBox.classList.add('hidden');
    form.classList.remove('hidden');
    fillRhythmForm();
  } else {
    state.rhythmDraft = null;
    setupBox.classList.remove('hidden');
    form.classList.add('hidden');
    fillBeatsSelect(el('#rhythm-setup-beats'), 4);
  }
  showView('view-rhythm-editor');
}

el('#rhythm-setup-confirm').onclick = ()=>{
  const battiti = parseInt(el('#rhythm-setup-beats').value,10);
  const suddivisione = parseInt(el('#rhythm-setup-subdiv').value,10);
  const spb = battiti*suddivisione;
  state.rhythmDraft = {
    id: genId(), titolo:'', note:'', bpm:null, categorie:[], preferito:false,
    tempo:{battiti, suddivisione},
    battute:[ newEmptyRhythmBar(spb) ],
    dataCreazione: nowIso(), dataModifica: nowIso()
  };
  el('#rhythm-setup').classList.add('hidden');
  el('#rhythm-form').classList.remove('hidden');
  fillRhythmForm();
};

function fillRhythmForm(){
  const d = state.rhythmDraft;
  el('#rhythm-title').value = d.titolo||'';
  el('#rhythm-bpm').value = d.bpm||'';
  el('#rhythm-favorite').checked = !!d.preferito;
  el('#rhythm-notes').value = d.note||'';
  renderCatSelector(el('#rhythm-cat-select'), new Set(d.categorie));
  updateTempoLabel('rhythm', d);
  renderRhythmBars(el('#rhythm-bars'), d, {editable:true});
  wireBpmStepper('rhythm', ()=>state.rhythmDraft, ()=>rhythmScheduler, (it)=>{ el('#rhythm-bpm').value = it.bpm; });
}
el('#rhythm-bpm').addEventListener('input', ()=>{
  const d = state.rhythmDraft;
  const v = parseInt(el('#rhythm-bpm').value,10);
  if(!d || !v) return;
  d.bpm = Math.max(20, Math.min(300, v));
  el('#rhythm-bpm-live-val').textContent = d.bpm;
  if(rhythmScheduler && rhythmScheduler.isRunning()) rhythmScheduler.setBpm(d.bpm);
});

el('#rhythm-add-bar').onclick = ()=>{
  const d = state.rhythmDraft;
  d.battute.push(newEmptyRhythmBar(slotsPerBar(d)));
  renderRhythmBars(el('#rhythm-bars'), d, {editable:true});
};

/* Cambio tempo a scrittura iniziata */
el('#rhythm-tempo-change-btn').onclick = ()=>{
  const d = state.rhythmDraft;
  fillBeatsSelect(el('#rhythm-change-beats'), d.tempo.battiti);
  el('#rhythm-change-subdiv').value = d.tempo.suddivisione;
  el('#rhythm-tempo-change-panel').classList.remove('hidden');
};
el('#rhythm-tempo-cancel').onclick = ()=> el('#rhythm-tempo-change-panel').classList.add('hidden');
el('#rhythm-tempo-apply').onclick = ()=>{
  const d = state.rhythmDraft;
  const nb = parseInt(el('#rhythm-change-beats').value,10);
  const ns = parseInt(el('#rhythm-change-subdiv').value,10);
  if(nb===d.tempo.battiti && ns===d.tempo.suddivisione){ el('#rhythm-tempo-change-panel').classList.add('hidden'); return; }
  const apply = ()=>{
    resizeDraftTempo(d, nb, ns, true);
    el('#rhythm-tempo-change-panel').classList.add('hidden');
    updateTempoLabel('rhythm', d);
    renderRhythmBars(el('#rhythm-bars'), d, {editable:true});
  };
  if(draftHasContentRhythm(d)){
    if(confirm('Cambiare tempo o suddivisione adatterà la griglia esistente: le misure verranno troncate o allungate e i colpi oltre la nuova lunghezza andranno persi. Continuare?')) apply();
  } else apply();
};

function collectRhythmFormIntoDraft(){
  const d = state.rhythmDraft;
  d.titolo = el('#rhythm-title').value.trim();
  d.bpm = el('#rhythm-bpm').value ? parseInt(el('#rhythm-bpm').value,10) : null;
  d.preferito = el('#rhythm-favorite').checked;
  d.note = el('#rhythm-notes').value;
  d.categorie = Array.from(el('#rhythm-cat-select').querySelectorAll('.chip.active')).map(c=>c.textContent);
}

el('#rhythm-save').onclick = ()=>{
  collectRhythmFormIntoDraft();
  const d = state.rhythmDraft;
  if(!d.titolo){ alert('Dai un titolo al ritmo prima di salvare.'); return; }
  d.dataModifica = nowIso();
  const idx = DATA.ritmi.findIndex(r=>r.id===d.id);
  if(idx>=0) DATA.ritmi[idx]=d; else { d.ordine = nextManualOrder(DATA.ritmi); DATA.ritmi.push(d); }
  saveData();
  stopAllPlayback();
  openRhythmDetail(d.id);
};

el('#rhythm-delete').onclick = ()=>{
  const d = state.rhythmDraft;
  if(confirm(`Eliminare definitivamente "${d.titolo||'questo ritmo'}"? L'operazione non può essere annullata (usa un backup per recuperarlo).`)){
    DATA.ritmi = DATA.ritmi.filter(r=>r.id!==d.id);
    saveData();
    showTab('rhythms');
  }
};

el('#rhythm-back').onclick = ()=>{ stopAllPlayback(); showTab('rhythms'); };

/* Riproduzione loop ritmo (editor) */
let rhythmScheduler = null;
el('#rhythm-play-toggle').onclick = ()=> toggleRhythmPlayback(state.rhythmDraft, el('#rhythm-play-toggle'), el('#rhythm-bars'));

// Combina tutte le righe di ogni battuta in un'unica sequenza di passi: ad ogni passo,
// i colpi di tutte le righe attive in quella posizione suonano contemporaneamente.
function flattenRhythmSteps(item){
  const spb = slotsPerBar(item);
  const steps = [];
  item.battute.forEach(bar=>{
    for(let s=0; s<spb; s++){
      const colpi = [];
      bar.righe.forEach(riga=>{ if(riga[s] && riga[s].c) colpi.push(riga[s]); });
      steps.push(colpi);
    }
  });
  return steps;
}

function toggleRhythmPlayback(draft, btn, barsContainer){
  if(rhythmScheduler && rhythmScheduler.isRunning()){
    rhythmScheduler.stop();
    rhythmScheduler = null;
    ActivePlayback.rhythm = false;
    WakeLockMgr.release();
    btn.textContent = '▶ Riproduci in loop';
    clearPlayingHighlight(barsContainer);
    return;
  }
  const steps = flattenRhythmSteps(draft);
  const spb = slotsPerBar(draft);
  const bpm = draft.bpm || 96;
  rhythmScheduler = createStepScheduler({
    bpm, subdivision: draft.tempo.suddivisione, totalSteps: steps.length, loop:true,
    stepCallback:(idx,time)=>{
      steps[idx].forEach(slot=> AudioEngine.playPerc(slot.c, time, INTENSITIES[slot.i]));
    },
    onVisualStep:(idx)=>{
      clearPlayingHighlight(barsContainer);
      const barIdx = Math.floor(idx/spb), slotIdx = idx%spb;
      barsContainer.querySelectorAll(`[data-bar="${barIdx}"][data-slot="${slotIdx}"]`).forEach(b=>b.classList.add('playing'));
    }
  });
  rhythmScheduler.start();
  ActivePlayback.rhythm = true;
  WakeLockMgr.acquire();
  btn.textContent = '■ Ferma riproduzione';
}
function clearPlayingHighlight(container){
  container.querySelectorAll('.slot-btn.playing').forEach(b=>b.classList.remove('playing'));
}

/* =========================================================
   14b. TRASPOSIZIONE MELODIA (testo libero -> griglia)
   ========================================================= */
const PITCH_CLASS_BY_LETTER = { c:0, d:2, e:4, f:5, g:7, a:9, b:11 };
const PITCH_CLASS_BY_SOLFEGGIO = { do:0, re:2, mi:4, fa:5, sol:7, la:9, si:11, ti:11, ut:0 };

// Interpreta un singolo token (es. "Fa#4", "Bb", "re") in classe di altezza (0-11) + ottava (o null se non indicata).
function parseNoteToken(tok){
  if(!tok) return null;
  let t = tok.trim().toLowerCase().replace(/[,;]/g,'');
  if(!t) return null;
  const m = t.match(/^(do|re|mi|fa|sol|la|si|ti|ut|[a-g])(#|♯|diesis|b|♭|bemolle)?(\d)?$/i);
  if(!m) return null;
  const name = m[1].toLowerCase();
  const acc = (m[2]||'').toLowerCase();
  const octave = m[3]!==undefined ? parseInt(m[3],10) : null;
  let pc = PITCH_CLASS_BY_SOLFEGGIO[name];
  if(pc===undefined) pc = PITCH_CLASS_BY_LETTER[name];
  if(pc===undefined) return null;
  if(acc==='#'||acc==='♯'||acc==='diesis') pc = (pc+1)%12;
  if(acc==='b'||acc==='♭'||acc==='bemolle') pc = (pc+11)%12;
  return { pc, octave };
}

// Analizza una voce della mappa note (es. "Bb3") in classe di altezza + altezza assoluta continua.
function noteMapEntryPitch(entry){
  const parsed = parseNoteToken(entry.anglo) || { pc:0, octave:4 };
  const octave = parsed.octave===null ? 4 : parsed.octave;
  return { pc: parsed.pc, octave, height: parsed.pc + octave*12 };
}

/* Traspone una sequenza testuale di note sulle 9 posizioni disponibili (DATA.mappaNote).
   Prova le 12 trasposizioni possibili e sceglie quella che fa cadere più note esattamente
   sulla scala di riferimento; le note non compatibili vengono avvicinate alla più vicina. */
function transposeMelodyText(text){
  const tokens = text.split(/[\s,]+/).map(t=>t.trim()).filter(Boolean);
  const parsedNotes = [];
  const unrecognized = [];
  tokens.forEach(tok=>{
    const p = parseNoteToken(tok);
    if(p) parsedNotes.push({ token:tok, pc:p.pc, octave: p.octave===null ? 4 : p.octave, octaveGiven: p.octave!==null });
    else unrecognized.push(tok);
  });
  if(!parsedNotes.length) return { sequence:[], shiftSemitones:0, unrecognized, adjustments:[] };

  const targetEntries = DATA.mappaNote.map(n=>({ ...n, ...noteMapEntryPitch(n) }));
  const targetPitchClasses = new Set(targetEntries.map(e=>e.pc));

  let bestT = 0, bestScore = -1;
  for(let t=0; t<12; t++){
    let score = 0;
    parsedNotes.forEach(n=>{ if(targetPitchClasses.has((n.pc+t)%12)) score++; });
    if(score > bestScore){ bestScore = score; bestT = t; }
  }
  const shift = bestT > 6 ? bestT - 12 : bestT; // spostamento minimo in valore assoluto (max ±6 semitoni)

  const sequence = [];
  const adjustments = [];
  let prevHeight = null;
  parsedNotes.forEach(n=>{
    const shiftedPc = ((n.pc + shift) % 12 + 12) % 12;
    const shiftedHeight = n.pc + n.octave*12 + shift;
    const sameClassEntries = targetEntries.filter(e=>e.pc===shiftedPc);
    let best, dist;
    if(sameClassEntries.length){
      // classe di nota esatta: nessuna approssimazione, si sceglie solo l'ottava più naturale
      // rispetto alla nota precedente (o, per la prima nota, rispetto all'altezza attesa)
      const refHeight = prevHeight!==null ? prevHeight : shiftedHeight;
      best = sameClassEntries.reduce((a,b)=> Math.abs(a.height-refHeight) <= Math.abs(b.height-refHeight) ? a : b);
      dist = 0;
    } else {
      // nessuna nota di questa classe disponibile sullo strumento: cerca la più vicina
      // per distanza circolare in semitoni (es. Fa# non disponibile -> Fa o Sol, il più vicino)
      let bestCirc = Infinity;
      targetEntries.forEach(e=>{
        const raw = Math.abs(e.pc - shiftedPc);
        const circ = Math.min(raw, 12-raw);
        if(circ < bestCirc || (circ===bestCirc && best && Math.abs(e.height-shiftedHeight) < Math.abs(best.height-shiftedHeight))){
          bestCirc = circ; best = e;
        }
      });
      dist = bestCirc;
    }
    sequence.push({ numero: best.numero, distanza: dist });
    if(dist > 0) adjustments.push({ token:n.token, numero: best.numero, distanza: dist });
    prevHeight = best.height;
  });

  return { sequence, shiftSemitones: shift, unrecognized, adjustments };
}

/* =========================================================
   15. EDITOR CANZONE
   ========================================================= */
function openSongEditor(existingId){
  state.editingSongId = existingId || null;
  const setupBox = el('#song-setup');
  const form = el('#song-form');
  el('#song-delete').classList.toggle('hidden', !existingId);
  el('#song-tempo-change-panel').classList.add('hidden');
  state.songSelected = null;
  stopAllPlayback();
  el('#song-audio-player').classList.add('hidden');

  if(existingId){
    const item = DATA.canzoni.find(r=>r.id===existingId);
    state.songDraft = JSON.parse(JSON.stringify(item));
    setupBox.classList.add('hidden');
    form.classList.remove('hidden');
    fillSongForm();
  } else {
    state.songDraft = null;
    setupBox.classList.remove('hidden');
    form.classList.add('hidden');
    fillBeatsSelect(el('#song-setup-beats'), 4);
  }
  showView('view-song-editor');
}

el('#song-setup-confirm').onclick = ()=>{
  const battiti = parseInt(el('#song-setup-beats').value,10);
  const suddivisione = parseInt(el('#song-setup-subdiv').value,10);
  const spb = battiti*suddivisione;
  state.songDraft = {
    id: genId(), titolo:'', note:'', bpm:null, categorie:[], preferito:false,
    tempo:{battiti, suddivisione},
    battute:[ newEmptySongBar(spb) ],
    audio:{ nomeFile:'', url:'' },
    spartito:{ nomeFile:'' },
    melodiaTesto:'',
    dataCreazione: nowIso(), dataModifica: nowIso()
  };
  el('#song-setup').classList.add('hidden');
  el('#song-form').classList.remove('hidden');
  fillSongForm();
};

function fillSongForm(){
  const d = state.songDraft;
  el('#song-title').value = d.titolo||'';
  el('#song-bpm').value = d.bpm||'';
  el('#song-favorite').checked = !!d.preferito;
  el('#song-notes').value = d.note||'';
  el('#song-audio-label').value = (d.audio&&d.audio.nomeFile)||'';
  el('#song-audio-url').value = (d.audio&&d.audio.url)||'';
  el('#song-image-label').value = (d.spartito&&d.spartito.nomeFile)||'';
  el('#song-image-preview').classList.add('hidden');
  el('#song-image-preview').removeAttribute('src');
  el('#song-melody-draft').value = d.melodiaTesto||'';
  el('#song-convert-report').classList.add('hidden');
  renderCatSelector(el('#song-cat-select'), new Set(d.categorie));
  updateTempoLabel('song', d);
  renderNotationToggle('#song-notation-toggle', ()=> renderSongBars(el('#song-bars'), d, {editable:true}));
  renderSongBars(el('#song-bars'), d, {editable:true});
  wireBpmStepper('song', ()=>state.songDraft, ()=>songScheduler, (it)=>{ el('#song-bpm').value = it.bpm; });
}
el('#song-bpm').addEventListener('input', ()=>{
  const d = state.songDraft;
  const v = parseInt(el('#song-bpm').value,10);
  if(!d || !v) return;
  d.bpm = Math.max(20, Math.min(300, v));
  el('#song-bpm-live-val').textContent = d.bpm;
  if(songScheduler && songScheduler.isRunning()) songScheduler.setBpm(d.bpm);
});

el('#song-add-bar').onclick = ()=>{
  const d = state.songDraft;
  d.battute.push(newEmptySongBar(slotsPerBar(d)));
  renderSongBars(el('#song-bars'), d, {editable:true});
};

el('#song-convert-melody').onclick = ()=>{
  const d = state.songDraft;
  const text = el('#song-melody-draft').value;
  const result = transposeMelodyText(text);
  const report = el('#song-convert-report');
  if(!result.sequence.length){
    report.textContent = 'Nessuna nota riconosciuta nel testo. Usa nomi come "Do Re Mi" o "C D E", con eventuale # o b e ottava.';
    report.classList.remove('hidden');
    return;
  }
  const doFill = ()=>{
    // distribuisce le note riconosciute negli slot in sequenza, aggiungendo misure se servono
    const spb = slotsPerBar(d);
    const barsNeeded = Math.ceil(result.sequence.length/spb);
    while(d.battute.length < barsNeeded) d.battute.push(newEmptySongBar(spb));
    let flat = 0;
    d.battute.forEach(bar=> bar.forEach(slot=>{
      if(flat < result.sequence.length){
        const n = result.sequence[flat];
        slot.n = [{ num:n.numero, i:0, mano:null }];
      } else {
        slot.n = [];
      }
      flat++;
    }));
    state.songSelected = null;
    renderSongBars(el('#song-bars'), d, {editable:true});

    const lines = [];
    lines.push(`Trasposizione applicata: ${result.shiftSemitones>=0?'+':''}${result.shiftSemitones} semitoni.`);
    if(result.adjustments.length){
      lines.push('Note avvicinate alla più vicina disponibile:');
      result.adjustments.forEach(a=> lines.push(`  ${a.token} → posizione ${a.numero} (avvicinata di ${a.distanza} semitono/i)`));
    } else {
      lines.push('Tutte le note corrispondono esattamente alla scala.');
    }
    if(result.unrecognized.length){
      lines.push(`Token non riconosciuti (ignorati): ${result.unrecognized.join(', ')}`);
    }
    report.textContent = lines.join('\n');
    report.classList.remove('hidden');
  };
  if(draftHasContentSong(d)){
    if(confirm('La griglia contiene già delle note: convertire la melodia la sovrascriverà. Continuare?')) doFill();
  } else doFill();
};

el('#song-click-strong-beats').onclick = ()=>{
  const d = state.songDraft;
  d.battute.forEach(bar=> bar.forEach((slot,idx)=>{
    if(idx % d.tempo.suddivisione === 0) slot.click = true;
  }));
  renderSongBars(el('#song-bars'), d, {editable:true});
};

/* Cambio tempo a scrittura iniziata */
el('#song-tempo-change-btn').onclick = ()=>{
  const d = state.songDraft;
  fillBeatsSelect(el('#song-change-beats'), d.tempo.battiti);
  el('#song-change-subdiv').value = d.tempo.suddivisione;
  el('#song-tempo-change-panel').classList.remove('hidden');
};
el('#song-tempo-cancel').onclick = ()=> el('#song-tempo-change-panel').classList.add('hidden');
el('#song-tempo-apply').onclick = ()=>{
  const d = state.songDraft;
  const nb = parseInt(el('#song-change-beats').value,10);
  const ns = parseInt(el('#song-change-subdiv').value,10);
  if(nb===d.tempo.battiti && ns===d.tempo.suddivisione){ el('#song-tempo-change-panel').classList.add('hidden'); return; }
  const apply = ()=>{
    resizeDraftTempo(d, nb, ns, false);
    state.songSelected = null;
    el('#song-tempo-change-panel').classList.add('hidden');
    updateTempoLabel('song', d);
    renderSongBars(el('#song-bars'), d, {editable:true});
  };
  if(draftHasContentSong(d)){
    if(confirm('Cambiare tempo o suddivisione adatterà la griglia esistente: le misure verranno troncate o allungate e le note oltre la nuova lunghezza andranno perse. Continuare?')) apply();
  } else apply();
};

el('#song-audio-file').addEventListener('change', (e)=>{
  const f = e.target.files[0];
  if(!f) return;
  el('#song-audio-label').value = f.name;
  const url = URL.createObjectURL(f);
  const player = el('#song-audio-player');
  player.src = url;
  player.classList.remove('hidden');
});

el('#song-image-file').addEventListener('change', (e)=>{
  const f = e.target.files[0];
  if(!f) return;
  el('#song-image-label').value = f.name;
  const url = URL.createObjectURL(f);
  const preview = el('#song-image-preview');
  preview.src = url;
  preview.classList.remove('hidden');
});

function collectSongFormIntoDraft(){
  const d = state.songDraft;
  d.titolo = el('#song-title').value.trim();
  d.bpm = el('#song-bpm').value ? parseInt(el('#song-bpm').value,10) : null;
  d.preferito = el('#song-favorite').checked;
  d.note = el('#song-notes').value;
  d.categorie = Array.from(el('#song-cat-select').querySelectorAll('.chip.active')).map(c=>c.textContent);
  d.audio = { nomeFile: el('#song-audio-label').value.trim(), url: el('#song-audio-url').value.trim() };
  d.spartito = { nomeFile: el('#song-image-label').value.trim() };
  d.melodiaTesto = el('#song-melody-draft').value;
}

el('#song-save').onclick = ()=>{
  collectSongFormIntoDraft();
  const d = state.songDraft;
  if(!d.titolo){ alert('Dai un titolo alla canzone prima di salvare.'); return; }
  d.dataModifica = nowIso();
  const idx = DATA.canzoni.findIndex(r=>r.id===d.id);
  if(idx>=0) DATA.canzoni[idx]=d; else { d.ordine = nextManualOrder(DATA.canzoni); DATA.canzoni.push(d); }
  saveData();
  stopAllPlayback();
  openSongDetail(d.id);
};

el('#song-delete').onclick = ()=>{
  const d = state.songDraft;
  if(confirm(`Eliminare definitivamente "${d.titolo||'questa canzone'}"? L'operazione non può essere annullata (usa un backup per recuperarla).`)){
    DATA.canzoni = DATA.canzoni.filter(r=>r.id!==d.id);
    saveData();
    showTab('songs');
  }
};

el('#song-back').onclick = ()=>{ stopAllPlayback(); showTab('songs'); };

let songScheduler = null;
el('#song-play-toggle').onclick = ()=> toggleSongPlayback(state.songDraft, el('#song-play-toggle'), el('#song-bars'));

function toggleSongPlayback(draft, btn, barsContainer){
  if(songScheduler && songScheduler.isRunning()){
    songScheduler.stop();
    songScheduler = null;
    ActivePlayback.song = false;
    WakeLockMgr.release();
    btn.textContent = '▶ Riproduci in loop';
    clearPlayingHighlight(barsContainer);
    return;
  }
  const flatSlots = [].concat(...draft.battute);
  const bpm = draft.bpm || 96;
  songScheduler = createStepScheduler({
    bpm, subdivision: draft.tempo.suddivisione, totalSteps: flatSlots.length, loop:true,
    stepCallback:(idx,time)=>{
      const slot = flatSlots[idx];
      slot.n.forEach(note=>{
        if(note.num==='tak'){ AudioEngine.playTak(time, INTENSITIES[note.i]); return; }
        if(note.num==='ghost'){ AudioEngine.playGhost(time); return; }
        const map = resolveNoteMapEntry(note.num);
        const freq = map ? noteFreqFromAnglo(map.anglo) : null;
        if(freq) AudioEngine.playNote(freq, time, INTENSITIES[note.i]);
      });
      if(slot.click) AudioEngine.click(time, false);
    },
    onVisualStep:(idx)=>{
      clearPlayingHighlight(barsContainer);
      const btns = barsContainer.querySelectorAll('.slot-btn');
      if(btns[idx]) btns[idx].classList.add('playing');
    }
  });
  songScheduler.start();
  ActivePlayback.song = true;
  WakeLockMgr.acquire();
  btn.textContent = '■ Ferma riproduzione';
}

/* =========================================================
   16. DETTAGLIO RITMO / CANZONE
   ========================================================= */
function buildTabFlowGeneric(bars, symbolFn){
  const wrap = document.createElement('div');
  wrap.className = 'tab-flow';
  const spans = [];
  bars.forEach((bar,bi)=>{
    const block = document.createElement('span');
    block.className = 'tab-bar-block';
    bar.forEach(slot=>{
      const s = document.createElement('span');
      const info = symbolFn(slot);
      s.className = 'tsym' + (info.isRest ? ' rest':'') + (info.extraClass ? ' '+info.extraClass : '');
      s.innerHTML = info.html;
      block.appendChild(s);
      spans.push(s);
    });
    wrap.appendChild(block);
    if(bi < bars.length-1){
      const sep = document.createElement('span');
      sep.className = 'tab-sep'; sep.textContent = '|';
      wrap.appendChild(sep);
    }
  });
  return { wrap, spans };
}
function buildTabDisplayRhythm(item){
  const wrap = document.createElement('div'); wrap.className = 'tab-flow';
  const spans = [];
  const spb = slotsPerBar(item);
  item.battute.forEach((bar, bi)=>{
    const block = document.createElement('span'); block.className = 'tab-bar-block';
    for(let s=0; s<spb; s++){
      const colpi = [];
      bar.righe.forEach(riga=>{ if(riga[s] && riga[s].c) colpi.push(riga[s]); });
      const span = document.createElement('span');
      span.className = 'tsym' + (colpi.length ? '' : ' rest');
      span.innerHTML = colpi.length ? colpi.map(c=>{
        const cls = ['hit-'+c.c];
        if(c.i===1) cls.push('hit-forte'); if(c.i===2) cls.push('hit-debole');
        return `<span class="${cls.join(' ')}">${({dum:'D',ta:'T',ka:'K'})[c.c]}</span>`;
      }).join('') : '·';
      block.appendChild(span);
      spans.push(span);
    }
    wrap.appendChild(block);
    if(bi < item.battute.length-1){
      const sep = document.createElement('span'); sep.className='tab-sep'; sep.textContent='|';
      wrap.appendChild(sep);
    }
  });
  return { wrap, spans };
}
function buildTabDisplaySong(item){
  return buildTabFlowGeneric(item.battute, slot=>{
    const extraClass = slot.click ? 'has-click' : '';
    if(!slot.n.length) return { html:'·', isRest:true, extraClass };
    return { html: slot.n.map(noteChipHtml).join(''), isRest:false, extraClass };
  });
}

function openRhythmDetail(id){
  stopAllPlayback();
  const item = DATA.ritmi.find(r=>r.id===id);
  state.detailRhythmId = id;
  el('#rd-title').textContent = item.titolo;
  el('#rd-fav').classList.toggle('active', !!item.preferito);
  el('#rd-chips').innerHTML = item.categorie.map(c=>`<span class="mini-chip">${escapeHtml(c)}</span>`).join('');
  el('#rd-bpm').textContent = [
    item.bpm ? item.bpm+' BPM' : null,
    tempoSignatureText(item),
    item.battute.length+' misure'
  ].filter(Boolean).join(' · ');
  el('#rd-notes').textContent = item.note || '';
  const tabHost = el('#rd-tab'); tabHost.innerHTML='';
  const built = buildTabDisplayRhythm(item);
  tabHost.appendChild(built.wrap);
  state.rdTabSpans = built.spans;
  el('#rd-play').textContent = '▶ Riproduci in loop';
  wireBpmStepper('rd', ()=>DATA.ritmi.find(r=>r.id===state.detailRhythmId), ()=>rhythmDetailScheduler, (it)=>{ it.dataModifica=nowIso(); saveData(); });
  showView('view-rhythm-detail');
}
el('#rd-back').onclick = ()=>{ stopAllPlayback(); showTab('rhythms'); };
el('#rd-fav').onclick = ()=>{
  const item = DATA.ritmi.find(r=>r.id===state.detailRhythmId);
  item.preferito = !item.preferito; item.dataModifica=nowIso(); saveData();
  el('#rd-fav').classList.toggle('active', item.preferito);
};
el('#rd-edit').onclick = ()=> openRhythmEditor(state.detailRhythmId);
el('#rd-dup').onclick = ()=>{
  const item = DATA.ritmi.find(r=>r.id===state.detailRhythmId);
  const clone = JSON.parse(JSON.stringify(item));
  clone.id = genId();
  clone.titolo = (clone.titolo||'Ritmo') + ' (copia)';
  clone.dataCreazione = nowIso(); clone.dataModifica = nowIso();
  clone.ordine = nextManualOrder(DATA.ritmi);
  DATA.ritmi.push(clone);
  saveData();
  openRhythmDetail(clone.id);
};
el('#rd-play').onclick = ()=>{
  const item = DATA.ritmi.find(r=>r.id===state.detailRhythmId);
  toggleRhythmDetailPlayback(item);
};
let rhythmDetailScheduler=null;
function toggleRhythmDetailPlayback(item){
  const btn = el('#rd-play');
  if(rhythmDetailScheduler && rhythmDetailScheduler.isRunning()){
    rhythmDetailScheduler.stop(); rhythmDetailScheduler=null;
    ActivePlayback.rhythm=false; WakeLockMgr.release();
    btn.textContent='▶ Riproduci in loop';
    state.rdTabSpans.forEach(s=>s.classList.remove('playing'));
    return;
  }
  const steps = flattenRhythmSteps(item);
  rhythmDetailScheduler = createStepScheduler({
    bpm: item.bpm||96, subdivision:item.tempo.suddivisione, totalSteps: steps.length, loop:true,
    stepCallback:(idx,time)=>{ steps[idx].forEach(s=> AudioEngine.playPerc(s.c,time,INTENSITIES[s.i])); },
    onVisualStep:(idx)=>{
      state.rdTabSpans.forEach(s=>s.classList.remove('playing'));
      if(state.rdTabSpans[idx]) state.rdTabSpans[idx].classList.add('playing');
    }
  });
  rhythmDetailScheduler.start();
  ActivePlayback.rhythm=true; WakeLockMgr.acquire();
  btn.textContent='■ Ferma riproduzione';
}

function openSongDetail(id){
  stopAllPlayback();
  const item = DATA.canzoni.find(r=>r.id===id);
  state.detailSongId = id;
  el('#sd-title').textContent = item.titolo;
  el('#sd-fav').classList.toggle('active', !!item.preferito);
  el('#sd-chips').innerHTML = item.categorie.map(c=>`<span class="mini-chip">${escapeHtml(c)}</span>`).join('');
  el('#sd-bpm').textContent = [
    item.bpm ? item.bpm+' BPM' : null,
    tempoSignatureText(item),
    item.battute.length+' misure'
  ].filter(Boolean).join(' · ');
  el('#sd-notes').textContent = item.note || '';
  const audioWrap = el('#sd-audio-wrap'); audioWrap.innerHTML='';
  if(item.audio && (item.audio.nomeFile || item.audio.url)){
    const label = document.createElement('div');
    label.className='hint-text';
    label.textContent = '♪ ' + (item.audio.nomeFile || 'traccia collegata');
    audioWrap.appendChild(label);
    if(item.audio.url){
      const a = document.createElement('a');
      a.href = item.audio.url; a.target='_blank'; a.rel='noopener';
      a.className='btn btn-secondary btn-block';
      a.textContent = 'Apri traccia (link)';
      audioWrap.appendChild(a);
    } else {
      const btn = document.createElement('button');
      btn.className='btn btn-secondary btn-block';
      btn.textContent = 'Scegli file audio dal dispositivo…';
      btn.onclick = ()=>{
        const inp = document.createElement('input');
        inp.type='file'; inp.accept='audio/*';
        inp.onchange = ()=>{
          if(inp.files[0]){
            const audio = document.createElement('audio');
            audio.controls = true; audio.src = URL.createObjectURL(inp.files[0]);
            audioWrap.appendChild(audio);
          }
        };
        inp.click();
      };
      audioWrap.appendChild(btn);
    }
  }
  const imageWrap = el('#sd-image-wrap'); imageWrap.innerHTML='';
  if(item.spartito && item.spartito.nomeFile){
    const label = document.createElement('div');
    label.className='hint-text';
    label.textContent = '🖼 Spartito: ' + item.spartito.nomeFile;
    imageWrap.appendChild(label);
    const btn = document.createElement('button');
    btn.className='btn btn-secondary btn-block';
    btn.textContent = 'Apri immagine dal dispositivo…';
    btn.onclick = ()=>{
      const inp = document.createElement('input');
      inp.type='file'; inp.accept='image/*';
      inp.onchange = ()=>{
        if(inp.files[0]){
          const img = document.createElement('img');
          img.className = 'song-image-preview';
          img.src = URL.createObjectURL(inp.files[0]);
          imageWrap.appendChild(img);
        }
      };
      inp.click();
    };
    imageWrap.appendChild(btn);
  }
  const melodyWrap = el('#sd-melody-wrap'); melodyWrap.innerHTML='';
  if(item.melodiaTesto && item.melodiaTesto.trim()){
    const h = document.createElement('div'); h.className='section-h-sm'; h.textContent='Melodia (bozza testuale)';
    const p = document.createElement('p'); p.className='hint-text'; p.style.whiteSpace='pre-wrap'; p.textContent = item.melodiaTesto;
    melodyWrap.appendChild(h); melodyWrap.appendChild(p);
  }
  renderNotationToggle('#sd-notation-toggle', ()=> rebuildSongDetailTab(item));
  rebuildSongDetailTab(item);
  el('#sd-play').textContent = '▶ Riproduci in loop';
  wireBpmStepper('sd', ()=>DATA.canzoni.find(r=>r.id===state.detailSongId), ()=>songDetailScheduler, (it)=>{ it.dataModifica=nowIso(); saveData(); });
  showView('view-song-detail');
}
function rebuildSongDetailTab(item){
  const tabHost = el('#sd-tab'); tabHost.innerHTML='';
  const built = buildTabDisplaySong(item);
  tabHost.appendChild(built.wrap);
  state.sdTabSpans = built.spans;
}
el('#sd-back').onclick = ()=>{ stopAllPlayback(); showTab('songs'); };
el('#sd-fav').onclick = ()=>{
  const item = DATA.canzoni.find(r=>r.id===state.detailSongId);
  item.preferito = !item.preferito; item.dataModifica=nowIso(); saveData();
  el('#sd-fav').classList.toggle('active', item.preferito);
};
el('#sd-edit').onclick = ()=> openSongEditor(state.detailSongId);
el('#sd-dup').onclick = ()=>{
  const item = DATA.canzoni.find(r=>r.id===state.detailSongId);
  const clone = JSON.parse(JSON.stringify(item));
  clone.id = genId();
  clone.titolo = (clone.titolo||'Canzone') + ' (copia)';
  clone.dataCreazione = nowIso(); clone.dataModifica = nowIso();
  clone.ordine = nextManualOrder(DATA.canzoni);
  DATA.canzoni.push(clone);
  saveData();
  openSongDetail(clone.id);
};
let songDetailScheduler=null;
el('#sd-play').onclick = ()=>{
  const item = DATA.canzoni.find(r=>r.id===state.detailSongId);
  const btn = el('#sd-play');
  if(songDetailScheduler && songDetailScheduler.isRunning()){
    songDetailScheduler.stop(); songDetailScheduler=null;
    ActivePlayback.song=false; WakeLockMgr.release();
    btn.textContent='▶ Riproduci in loop';
    state.sdTabSpans.forEach(s=>s.classList.remove('playing'));
    return;
  }
  const flatSlots = [].concat(...item.battute);
  songDetailScheduler = createStepScheduler({
    bpm:item.bpm||96, subdivision:item.tempo.suddivisione, totalSteps:flatSlots.length, loop:true,
    stepCallback:(idx,time)=>{
      const s=flatSlots[idx];
      s.n.forEach(note=>{
        if(note.num==='tak'){ AudioEngine.playTak(time, INTENSITIES[note.i]); return; }
        if(note.num==='ghost'){ AudioEngine.playGhost(time); return; }
        const map = resolveNoteMapEntry(note.num);
        const freq = map ? noteFreqFromAnglo(map.anglo) : null;
        if(freq) AudioEngine.playNote(freq, time, INTENSITIES[note.i]);
      });
      if(s.click) AudioEngine.click(time, false);
    },
    onVisualStep:(idx)=>{
      state.sdTabSpans.forEach(s=>s.classList.remove('playing'));
      if(state.sdTabSpans[idx]) state.sdTabSpans[idx].classList.add('playing');
    }
  });
  songDetailScheduler.start();
  ActivePlayback.song=true; WakeLockMgr.acquire();
  btn.textContent='■ Ferma riproduzione';
};

function stopAllPlayback(){
  if(rhythmScheduler && rhythmScheduler.isRunning()){ rhythmScheduler.stop(); rhythmScheduler=null; el('#rhythm-play-toggle').textContent='▶ Riproduci in loop'; }
  if(songScheduler && songScheduler.isRunning()){ songScheduler.stop(); songScheduler=null; el('#song-play-toggle').textContent='▶ Riproduci in loop'; }
  if(rhythmDetailScheduler && rhythmDetailScheduler.isRunning()){ rhythmDetailScheduler.stop(); rhythmDetailScheduler=null; state.rdTabSpans.forEach(s=>s.classList.remove('playing')); }
  if(songDetailScheduler && songDetailScheduler.isRunning()){ songDetailScheduler.stop(); songDetailScheduler=null; state.sdTabSpans.forEach(s=>s.classList.remove('playing')); }
  if(metroScheduler && metroScheduler.isRunning()){ metroScheduler.stop(); metroScheduler=null; el('#metro-play').textContent='▶ Avvia metronomo'; }
  if(patternScheduler && patternScheduler.isRunning()){
    patternScheduler.stop(); patternScheduler=null;
    const btn = el('#pattern-play-toggle'); if(btn) btn.textContent='▶ Riproduci';
    clearPatternEditorHighlights();
  }
  if(patternDetailScheduler && patternDetailScheduler.isRunning()){
    patternDetailScheduler.stop(); patternDetailScheduler=null;
    const btn = el('#pd-play'); if(btn) btn.textContent='▶ Riproduci';
    clearPatternDetailHighlights();
  }
  ActivePlayback.rhythm=false; ActivePlayback.song=false; ActivePlayback.metronome=false; ActivePlayback.pattern=false;
  WakeLockMgr.release();
}

/* =========================================================
   16b. PENTAGRAMMA (comando esplicito, libreria caricata su richiesta)
   ========================================================= */
const VEXFLOW_CDN = 'https://cdn.jsdelivr.net/npm/vexflow@4/build/cjs/vexflow.js';
let vexflowLoadPromise = null;

function ensureVexFlowLoaded(){
  if(window.Vex && window.Vex.Flow) return Promise.resolve();
  if(vexflowLoadPromise) return vexflowLoadPromise;
  vexflowLoadPromise = new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = VEXFLOW_CDN;
    s.onload = ()=> resolve();
    s.onerror = ()=>{ vexflowLoadPromise = null; reject(new Error('Impossibile caricare la libreria di notazione musicale: verifica la connessione internet e riprova.')); };
    document.head.appendChild(s);
  });
  return vexflowLoadPromise;
}

// Converte una nota della mappa (es. "Bb3") nel formato chiave di VexFlow (es. "bb/3") + eventuale alterazione da disegnare.
function vexKeyFromAnglo(anglo){
  const m = (anglo||'').match(/^([A-Ga-g])(#|b)?(\d+)$/);
  if(!m) return null;
  const letter = m[1].toLowerCase();
  const acc = m[2] || '';
  const octave = m[3];
  return { key: letter+acc+'/'+octave, accidental: acc || null };
}

const VEX_DURATION_BY_SUBDIV = { 1:'q', 2:'8', 3:'8', 4:'16' };

// Raggruppa gli slot di una misura in "tempi" (gruppi da <suddivisione> slot), per beaming e terzine.
function groupSlotsByBeat(bar, suddivisione){
  const beats = [];
  for(let i=0;i<bar.length;i+=suddivisione) beats.push(bar.slice(i, i+suddivisione));
  return beats;
}

function buildScoreStatusMessage(item){
  return `${item.titolo} — ${tempoSignatureText(item)}${item.bpm?` · ${item.bpm} BPM`:''}`;
}

async function renderSongScore(item){
  const status = el('#score-status');
  const container = el('#score-svg-container');
  el('#score-title').textContent = item.titolo || '(senza titolo)';
  container.innerHTML = '';
  status.textContent = 'Carico la libreria di notazione musicale…';

  try{
    await ensureVexFlowLoaded();
  }catch(err){
    status.textContent = err.message;
    return;
  }

  status.textContent = buildScoreStatusMessage(item);
  try{
    const VF = window.Vex.Flow;
    const suddivisione = item.tempo.suddivisione;
    const isTriplet = suddivisione === 3;
    const durBase = VEX_DURATION_BY_SUBDIV[suddivisione] || '8';
    const timeSigText = `${item.tempo.battiti}/${suddivisione===1?4:(suddivisione===2?8:(suddivisione===3?4:16))}`;

    const barGroups = item.battute.map(bar => groupSlotsByBeat(bar, suddivisione));

    const pageWidth = Math.min(760, Math.max(360, container.clientWidth || 720));
    const barWidth = Math.max(150, 55 + slotsPerBar(item)*24);
    const barsPerRow = Math.max(1, Math.floor((pageWidth-20) / barWidth));
    const rows = Math.max(1, Math.ceil(barGroups.length / barsPerRow));
    const rowHeight = 130;
    const svgWidth = barsPerRow*barWidth + 30;
    const svgHeight = rows*rowHeight + 40;

    const renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
    renderer.resize(svgWidth, svgHeight);
    const ctx = renderer.getContext();

    let barIdx = 0;
    for(let row=0; row<rows; row++){
      for(let col=0; col<barsPerRow; col++){
        if(barIdx >= barGroups.length) break;
        const x = 15 + col*barWidth;
        const y = 15 + row*rowHeight;
        const stave = new VF.Stave(x, y, barWidth);
        if(col===0) stave.addClef('treble');
        if(barIdx===0) stave.addTimeSignature(timeSigText);
        stave.setContext(ctx).draw();

        const beatGroups = barGroups[barIdx];
        const allNotes = [];
        const beams = [];
        const tuplets = [];

        beatGroups.forEach(beatSlots=>{
          const beatNotes = beatSlots.map(slot=>{
            if(!slot.n || !slot.n.length){
              return new VF.StaveNote({ keys:['b/4'], duration: durBase+'r' });
            }
            const keys = []; const accidentals = [];
            let hasPercMarker = false;
            slot.n.forEach(note=>{
              if(note.num==='tak' || note.num==='ghost'){
                // Tak e Ghost non hanno intonazione: un'unica "x" su una posizione guida fissa,
                // separata dal rigo melodico (non è una nota intonata, solo un marcatore ritmico).
                if(!hasPercMarker){ keys.push('f/5/x2'); accidentals.push(null); hasPercMarker = true; }
                return;
              }
              const mapEntry = resolveNoteMapEntry(note.num);
              const parsed = mapEntry ? vexKeyFromAnglo(mapEntry.anglo) : null;
              if(parsed){ keys.push(parsed.key); accidentals.push(parsed.accidental); }
            });
            if(!keys.length) return new VF.StaveNote({ keys:['b/4'], duration: durBase+'r' });
            const sn = new VF.StaveNote({ keys, duration: durBase });
            accidentals.forEach((acc,i)=>{ if(acc) sn.addModifier(new VF.Accidental(acc), i); });
            return sn;
          });

          allNotes.push(...beatNotes);

          // beam solo se il tempo è "pieno" (nessun silenzio), per evitare travature spezzate
          if(durBase !== 'q' && beatNotes.every(n=>!n.isRest()) && beatNotes.length>1){
            beams.push(new VF.Beam(beatNotes));
          }
          // le terzine si raggruppano sempre sotto la stessa parentesi, silenzi inclusi
          if(isTriplet && beatNotes.length===3){
            tuplets.push(new VF.Tuplet(beatNotes));
          }
        });

        const voice = new VF.Voice({ num_beats: item.tempo.battiti, beat_value: 4 });
        voice.setStrict(false);
        voice.addTickables(allNotes);

        new VF.Formatter().joinVoices([voice]).format([voice], barWidth-40);
        voice.draw(ctx, stave);
        beams.forEach(b=> b.setContext(ctx).draw());
        tuplets.forEach(t=> t.setContext(ctx).draw());

        barIdx++;
      }
    }
    status.textContent = buildScoreStatusMessage(item) + ' — pronto.';
  }catch(err){
    console.error(err);
    status.textContent = 'Errore nella generazione del pentagramma (' + err.message + '). Riprova o segnalalo così lo correggo.';
  }
}

el('#sd-score-btn').onclick = ()=>{
  stopAllPlayback();
  const item = DATA.canzoni.find(r=>r.id===state.detailSongId);
  showView('view-song-score');
  renderSongScore(item);
};
el('#score-back').onclick = ()=> openSongDetail(state.detailSongId);
el('#score-print-btn').onclick = ()=> window.print();

/* =========================================================
   17. METRONOMO
   ========================================================= */
const metroState = {
  bpm:96, battiti:4, suddivisione:2, accenti:[], barsOn:4, barsOff:0
};
let metroScheduler = null;
function metroSlotsPerBar(){ return metroState.battiti*metroState.suddivisione; }
function initMetronomeGrid(){
  const spb = metroSlotsPerBar();
  if(metroState.accenti.length !== spb){
    metroState.accenti = Array.from({length:spb}, (_,i)=> i%metroState.suddivisione===0 ? (i===0?'accento':'normale') : 'muto');
  }
  renderMetroGrid();
}
function renderMetroGrid(){
  const grid = el('#metro-grid'); grid.innerHTML='';
  metroState.accenti.forEach((val, idx)=>{
    const b = document.createElement('button');
    b.type='button';
    b.className = 'metro-slot ' + val;
    b.textContent = idx%metroState.suddivisione===0 ? (Math.floor(idx/metroState.suddivisione)+1) : '+';
    b.onclick = ()=>{
      const order=['muto','normale','accento'];
      metroState.accenti[idx] = order[(order.indexOf(val)+1)%3];
      renderMetroGrid();
    };
    grid.appendChild(b);
  });
}
fillBeatsSelect(el('#metro-beats'), 4);
initMetronomeGrid();

el('#metro-beats').onchange = ()=>{ metroState.battiti=parseInt(el('#metro-beats').value,10); metroState.accenti=[]; initMetronomeGrid(); };
el('#metro-subdiv').onchange = ()=>{ metroState.suddivisione=parseInt(el('#metro-subdiv').value,10); metroState.accenti=[]; initMetronomeGrid(); };
el('#metro-bars-on').onchange = ()=>{ metroState.barsOn = Math.max(1,parseInt(el('#metro-bars-on').value,10)||1); };
el('#metro-bars-off').onchange = ()=>{ metroState.barsOff = Math.max(0,parseInt(el('#metro-bars-off').value,10)||0); };

function updateBpmDisplay(){
  el('#metro-bpm-display').textContent = metroState.bpm;
  el('#metro-bpm-slider').value = metroState.bpm;
  if(metroScheduler) metroScheduler.setBpm(metroState.bpm);
}
el('#metro-bpm-slider').oninput = ()=>{ metroState.bpm = parseInt(el('#metro-bpm-slider').value,10); updateBpmDisplay(); };
el('#metro-bpm-minus').onclick = ()=>{ metroState.bpm = Math.max(30, metroState.bpm-1); updateBpmDisplay(); };
el('#metro-bpm-plus').onclick = ()=>{ metroState.bpm = Math.min(220, metroState.bpm+1); updateBpmDisplay(); };
updateBpmDisplay();

el('#metro-play').onclick = ()=>{
  const btn = el('#metro-play');
  if(metroScheduler && metroScheduler.isRunning()){
    metroScheduler.stop(); metroScheduler=null;
    ActivePlayback.metronome=false; WakeLockMgr.release();
    btn.textContent='▶ Avvia metronomo';
    el('#metro-pulse').classList.remove('pulse');
    return;
  }
  const spb = metroSlotsPerBar();
  const barsCycle = metroState.barsOn + metroState.barsOff;
  const totalSteps = spb * barsCycle;
  metroScheduler = createStepScheduler({
    bpm: metroState.bpm, subdivision: metroState.suddivisione, totalSteps, loop:true,
    stepCallback:(idx,time)=>{
      const barNum = Math.floor(idx/spb);
      const isMuteBar = barNum >= metroState.barsOn;
      if(isMuteBar) return;
      const posInBar = idx % spb;
      const val = metroState.accenti[posInBar];
      if(val==='muto') return;
      AudioEngine.click(time, val==='accento');
    },
    onVisualStep:(idx)=>{
      renderMetroGrid();
      const posInBar = idx % spb;
      const barNum = Math.floor(idx/spb);
      const isMuteBar = barNum >= metroState.barsOn;
      const grid = el('#metro-grid');
      if(!isMuteBar && grid.children[posInBar]) grid.children[posInBar].classList.add('playing');
      const pulse = el('#metro-pulse');
      pulse.classList.remove('pulse'); void pulse.offsetWidth; pulse.classList.add('pulse');
    }
  });
  metroScheduler.start();
  ActivePlayback.metronome=true; WakeLockMgr.acquire();
  btn.textContent='■ Ferma metronomo';
};

/* =========================================================
   18. IMPOSTAZIONI: notazione, mappa note, categorie, backup
   ========================================================= */
el('#btn-settings').onclick = ()=>{ stopAllPlayback(); showView('view-settings'); renderSettings(); };

// Vero se, con il nuovo elenco di numeri validi, qualche nota già scritta in una canzone o in un
// giro di un pattern diventerebbe orfana (numero non più presente in mappa). Controllo unico e
// complessivo, non elemento per elemento (un solo avviso di conferma, non uno per ogni elemento).
function dataWouldOrphan(newNumeros){
  const set = new Set(newNumeros);
  const hasOrphanInBattute = (battute)=> (battute||[]).some(bar=>
    bar.some(slot=> slot.n.some(note=> typeof note.num==='number' && !set.has(note.num)))
  );
  const inSongs = (DATA.canzoni||[]).some(song=> hasOrphanInBattute(song.battute));
  const inPatterns = (DATA.patterns||[]).some(p=> (p.giri||[]).some(giro=> hasOrphanInBattute(giro.battute)));
  return inSongs || inPatterns;
}

function renderSettings(){
  el('#setting-notation-mode').value = DATA.notationMode;
  el('#schema-version').textContent = DATA.versione_schema;
  el('#setting-note-count').value = DATA.noteCount;
  el('#setting-note-start').value = String(DATA.startIndex);
  el('#note-config-hint').textContent = '';

  const nm = el('#note-map-editor'); nm.innerHTML='';
  DATA.mappaNote.forEach(n=>{
    const row = document.createElement('div');
    row.className='note-map-row';
    row.innerHTML = `
      <span class="idx">${n.numero===0?'Dum':n.numero}</span>
      <input type="text" value="${escapeHtml(n.anglo)}" data-field="anglo" placeholder="Lettera (es. D4)">
      <input type="text" value="${escapeHtml(n.solf)}" data-field="solf" placeholder="Solfeggio (es. Re4)">`;
    row.querySelector('[data-field=anglo]').onchange = (e)=>{ n.anglo=e.target.value.trim(); saveData(); };
    row.querySelector('[data-field=solf]').onchange = (e)=>{ n.solf=e.target.value.trim(); saveData(); };
    nm.appendChild(row);
  });

  renderCategoryManageList();
}

el('#setting-notation-mode').onchange = ()=>{ DATA.notationMode = el('#setting-notation-mode').value; saveData(); };

el('#btn-apply-note-config').onclick = ()=>{
  const newCount = Math.max(1, Math.min(24, parseInt(el('#setting-note-count').value,10) || DATA.mappaNote.length));
  const newStart = parseInt(el('#setting-note-start').value,10);
  const oldMap = DATA.mappaNote;
  const newNumeros = Array.from({length:newCount}, (_,i)=> newStart+i);
  const oldNumeros = oldMap.map(m=>m.numero);
  const unchanged = oldNumeros.length===newNumeros.length && oldNumeros.every((v,i)=>v===newNumeros[i]);
  if(unchanged) return;

  const apply = ()=>{
    // Ricostruisce la mappa per posizione (non per numero), preservando lettera/solfeggio
    // già inseriti dove possibile; le posizioni nuove restano vuote da compilare.
    const nm = newNumeros.map((numero, i)=>{
      const old = oldMap[i];
      return { numero, anglo: old?old.anglo:'', solf: old?old.solf:'' };
    });
    DATA.mappaNote = nm;
    DATA.noteCount = newCount;
    DATA.startIndex = newStart;
    saveData();
    renderSettings();
    el('#note-config-hint').textContent = 'Mappa aggiornata.';
  };

  if(dataWouldOrphan(newNumeros)){
    if(confirm('Questa modifica può rendere orfane alcune note già scritte in canzoni o pattern: appariranno come "+" o "-" (nessun dato viene cancellato). Continuare?')) apply();
  } else apply();
};

function renderCategoryManageList(){
  const wrap = el('#category-manage-list'); wrap.innerHTML='';
  DATA.categorie.forEach(cat=>{
    const chip = document.createElement('span');
    chip.className='chip';
    chip.innerHTML = `${escapeHtml(cat)} <span class="x">✕</span>`;
    chip.querySelector('.x').onclick = (e)=>{
      e.stopPropagation();
      if(confirm(`Rimuovere la categoria "${cat}"? Resterà comunque assegnata ai ritmi/canzoni che la usano già.`)){
        DATA.categorie = DATA.categorie.filter(c=>c!==cat);
        saveData(); renderCategoryManageList();
      }
    };
    wrap.appendChild(chip);
  });
}
el('#btn-add-category').onclick = ()=>{
  const inp = el('#new-category-input');
  const v = inp.value.trim();
  if(!v) return;
  if(!DATA.categorie.includes(v)) DATA.categorie.push(v);
  saveData(); inp.value=''; renderCategoryManageList();
};

/* Backup */
el('#btn-export').onclick = ()=>{
  const blob = new Blob([JSON.stringify(DATA, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
  a.href = url; a.download = `rhythm-database-backup-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};

el('#import-file').addEventListener('change', (e)=>{
  const f = e.target.files[0];
  if(!f) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const incoming = migrate(JSON.parse(reader.result));
      const result = mergeBackup(incoming);
      saveData();
      el('#import-result').textContent = `Importati: ${result.ritmiAggiunti} ritmi, ${result.canzoniAggiunte} canzoni, ${result.patternAggiunti} pattern, ${result.categorieAggiunte} nuove categorie.` + (result.duplicatiRinominati? ` ${result.duplicatiRinominati} elementi con ID già esistente sono stati aggiunti come duplicati.`:'');
      renderSettings();
    }catch(err){
      el('#import-result').textContent = 'File non valido: impossibile leggere il backup.';
    }
  };
  reader.readAsText(f);
  e.target.value = '';
});

function mergeBackup(incoming){
  let ritmiAggiunti=0, canzoniAggiunte=0, categorieAggiunte=0, duplicatiRinominati=0;
  incoming.categorie.forEach(c=>{ if(!DATA.categorie.includes(c)){ DATA.categorie.push(c); categorieAggiunte++; } });

  const mergeList = (targetArr, incomingArr)=>{
    let added=0, renamed=0;
    incomingArr.forEach(item=>{
      const exists = targetArr.find(t=>t.id===item.id);
      if(!exists){
        targetArr.push(item); added++;
      } else {
        // stesso id già presente: aggiunge come nuovo elemento distinto per non perdere dati
        const clone = JSON.parse(JSON.stringify(item));
        clone.id = genId();
        clone.titolo = (clone.titolo||'') + ' (importato)';
        targetArr.push(clone);
        added++; renamed++;
      }
    });
    return {added, renamed};
  };
  const r1 = mergeList(DATA.ritmi, incoming.ritmi);
  const r2 = mergeList(DATA.canzoni, incoming.canzoni);
  const r3 = mergeList(DATA.patterns, incoming.patterns||[]);
  // gli elementi importati potrebbero venire da un backup precedente a questa funzionalità
  // (privi di ordine), o avere valori di ordine in collisione con quelli locali: non è un
  // problema per l'ordinamento manuale (i duplicati vengono semplicemente messi in fondo),
  // ma assegna comunque un valore a chi ne è privo.
  ensureManualOrder(DATA.ritmi); ensureManualOrder(DATA.canzoni); ensureManualOrder(DATA.patterns);
  ritmiAggiunti = r1.added; canzoniAggiunte = r2.added;
  duplicatiRinominati = r1.renamed + r2.renamed + r3.renamed;
  return {ritmiAggiunti, canzoniAggiunte, patternAggiunti: r3.added, categorieAggiunte, duplicatiRinominati};
}

/* =========================================================
   18b. SEZIONE PATTERN — struttura dati, editor, dettaglio, riproduzione
   ========================================================= */

// Un "giro" è strutturalmente una mini-canzone interna al pattern: stesse battute in stile
// Canzone (note dalla mappa configurabile, mano sx/dx, Tak, Ghost, accenti), lunghezza libera
// e indipendente dal ritmo guida. L'etichetta di default è "Giro N", liberamente rinominabile.
function newGiro(spb, n){
  return { id: genId(), label: `Giro ${n}`, ripetizioni: 1, battute: [ newEmptySongBar(spb) ] };
}

// Ritmo guida e giri non hanno un proprio campo "tempo" nello schema dati (è unico a livello di
// pattern, per design): renderRhythmBars/renderSongBars/songTotalSlots però si aspettano un
// oggetto con .battute E .tempo. Questi wrapper "prestano" il tempo del pattern senza copiarlo:
// battute resta la STESSA reference dell'array reale, quindi ogni mutazione (splice/push fatta
// dalle funzioni condivise) si riflette correttamente sui dati veri del giro/ritmo guida.
function giroAsDraft(pattern, giro){ return { battute: giro.battute, tempo: pattern.tempo }; }
function guideAsDraft(pattern){ return { battute: pattern.ritmoGuida.battute, tempo: pattern.tempo }; }

// Cambia tempo/suddivisione a scrittura iniziata: adatta SIA il ritmo guida SIA le battute di
// ogni giro, riusando la stessa logica di resize già validata per ritmi e canzoni (nessuna
// duplicazione: si passa un wrapper temporaneo con lo shape atteso da resizeDraftTempo).
function resizePatternTempo(pattern, battiti, suddivisione){
  const guideWrap = { battute: pattern.ritmoGuida.battute, tempo: pattern.tempo };
  resizeDraftTempo(guideWrap, battiti, suddivisione, true);
  pattern.ritmoGuida.battute = guideWrap.battute;

  pattern.giri.forEach(giro=>{
    const songWrap = { battute: giro.battute, tempo: pattern.tempo };
    resizeDraftTempo(songWrap, battiti, suddivisione, false);
    giro.battute = songWrap.battute;
  });
  pattern.tempo = { battiti, suddivisione };
}
function patternDraftHasContent(pattern){
  const guideHas = draftHasContentRhythm({ battute: pattern.ritmoGuida.battute });
  const giriHas = pattern.giri.some(giro => draftHasContentSong({ battute: giro.battute }));
  return guideHas || giriHas;
}

/* ---- Liste ---- */
function patternPreviewString(item){
  const bar = item.ritmoGuida.battute[0];
  let guidePrev = '';
  if(bar && bar.righe && bar.righe[0]){
    guidePrev = bar.righe[0].map(s=> s.c ? ({dum:'D',ta:'T',ka:'K'})[s.c] : '·').join(' ');
  }
  const more = item.ritmoGuida.battute.length>1 ? '  |  …' : '';
  const giriCount = item.giri.length;
  return guidePrev + more + `   ·   ${giriCount} gir${giriCount===1?'o':'i'}`;
}
function renderPatternsList(){
  renderCatFilterChips(el('#patterns-cat-chips'), state.patternsCats, renderPatternsList);
  let items = DATA.patterns.slice();
  const q = state.patternsSearch.trim().toLowerCase();
  if(q) items = items.filter(r => (r.titolo+' '+r.note).toLowerCase().includes(q));
  if(state.patternsFav) items = items.filter(r=>r.preferito);
  if(state.patternsCats.size) items = items.filter(r=> r.categorie.some(c=>state.patternsCats.has(c)));
  items = sortItems(items, state.patternsSort);

  const list = el('#patterns-list');
  list.innerHTML = '';
  el('#patterns-empty').classList.toggle('hidden', items.length>0);
  items.forEach((item, idx)=>{
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-top">
        <span class="item-title">${escapeHtml(item.titolo||'(senza titolo)')}</span>
        <span class="item-fav">${item.preferito?'★':''}</span>
      </div>
      <div class="item-preview">${escapeHtml(patternPreviewString(item))}</div>
      <div class="item-meta-row">
        ${item.bpm?`<span class="mini-chip">${item.bpm} bpm</span>`:''}
        ${item.categorie.map(c=>`<span class="mini-chip">${escapeHtml(c)}</span>`).join('')}
      </div>`;
    card.onclick = ()=> openPatternDetail(item.id);
    attachManualOrderButtons(card, items, idx, state.patternsSort, renderPatternsList);
    list.appendChild(card);
  });
}

/* ---- Editor ---- */
function openPatternEditor(existingId){
  state.editingPatternId = existingId || null;
  const setupBox = el('#pattern-setup');
  const form = el('#pattern-form');
  el('#pattern-delete').classList.toggle('hidden', !existingId);
  el('#pattern-tempo-change-panel').classList.add('hidden');
  state.songSelected = null;
  state.patternActiveGiroIdx = 0;
  stopAllPlayback();

  if(existingId){
    const item = DATA.patterns.find(p=>p.id===existingId);
    state.patternDraft = JSON.parse(JSON.stringify(item));
    setupBox.classList.add('hidden');
    form.classList.remove('hidden');
    fillPatternForm();
  } else {
    state.patternDraft = null;
    setupBox.classList.remove('hidden');
    form.classList.add('hidden');
    fillBeatsSelect(el('#pattern-setup-beats'), 4);
  }
  showView('view-pattern-editor');
}

el('#pattern-setup-confirm').onclick = ()=>{
  const battiti = parseInt(el('#pattern-setup-beats').value,10);
  const suddivisione = parseInt(el('#pattern-setup-subdiv').value,10);
  const spb = battiti*suddivisione;
  state.patternDraft = {
    id: genId(), titolo:'', note:'', bpm:null, categorie:[], preferito:false,
    tempo:{battiti, suddivisione},
    ritmoGuida: { battute: [ newEmptyRhythmBar(spb) ] },
    giri: [ newGiro(spb, 1) ],
    dataCreazione: nowIso(), dataModifica: nowIso()
  };
  state.patternActiveGiroIdx = 0;
  state.songSelected = null;
  el('#pattern-setup').classList.add('hidden');
  el('#pattern-form').classList.remove('hidden');
  fillPatternForm();
};

function fillPatternForm(){
  const d = state.patternDraft;
  el('#pattern-title').value = d.titolo||'';
  el('#pattern-bpm').value = d.bpm||'';
  el('#pattern-favorite').checked = !!d.preferito;
  el('#pattern-notes').value = d.note||'';
  renderCatSelector(el('#pattern-cat-select'), new Set(d.categorie));
  updateTempoLabel('pattern', d);
  renderRhythmBars(el('#pattern-guide-bars'), guideAsDraft(d), {editable:true, singleRiga:true, clipboardKey:'barClipboardGuide'});
  renderPatternGiriEditor();
  wireBpmStepper('pattern', ()=>state.patternDraft, ()=>patternScheduler, (it)=>{ el('#pattern-bpm').value = it.bpm; });
}
el('#pattern-bpm').addEventListener('input', ()=>{
  const d = state.patternDraft;
  const v = parseInt(el('#pattern-bpm').value,10);
  if(!d || !v) return;
  d.bpm = Math.max(20, Math.min(300, v));
  el('#pattern-bpm-live-val').textContent = d.bpm;
  if(patternScheduler && patternScheduler.isRunning()) patternScheduler.setBpm(d.bpm);
});

el('#pattern-guide-add-bar').onclick = ()=>{
  const d = state.patternDraft;
  d.ritmoGuida.battute.push(newEmptyRhythmBar(slotsPerBar(d)));
  renderRhythmBars(el('#pattern-guide-bars'), guideAsDraft(d), {editable:true, singleRiga:true, clipboardKey:'barClipboardGuide'});
};

/* Cambio tempo a scrittura iniziata (blocca-con-conferma come ritmi/canzoni) */
el('#pattern-tempo-change-btn').onclick = ()=>{
  const d = state.patternDraft;
  fillBeatsSelect(el('#pattern-change-beats'), d.tempo.battiti);
  el('#pattern-change-subdiv').value = d.tempo.suddivisione;
  el('#pattern-tempo-change-panel').classList.remove('hidden');
};
el('#pattern-tempo-cancel').onclick = ()=> el('#pattern-tempo-change-panel').classList.add('hidden');
el('#pattern-tempo-apply').onclick = ()=>{
  const d = state.patternDraft;
  const nb = parseInt(el('#pattern-change-beats').value,10);
  const ns = parseInt(el('#pattern-change-subdiv').value,10);
  if(nb===d.tempo.battiti && ns===d.tempo.suddivisione){ el('#pattern-tempo-change-panel').classList.add('hidden'); return; }
  const apply = ()=>{
    resizePatternTempo(d, nb, ns);
    state.songSelected = null;
    el('#pattern-tempo-change-panel').classList.add('hidden');
    updateTempoLabel('pattern', d);
    renderRhythmBars(el('#pattern-guide-bars'), guideAsDraft(d), {editable:true, singleRiga:true, clipboardKey:'barClipboardGuide'});
    renderPatternGiriEditor();
  };
  if(patternDraftHasContent(d)){
    if(confirm('Cambiare tempo o suddivisione adatterà ritmo guida e tutti i giri: il contenuto oltre la nuova lunghezza andrà perso. Continuare?')) apply();
  } else apply();
};

/* Elenco giri: riordino, ripetizioni (singole e in blocco), etichetta, eliminazione */
function renderPatternGiriEditor(){
  const d = state.patternDraft;
  const wrap = el('#pattern-giri-list');
  wrap.innerHTML = '';
  d.giri.forEach((giro, gi)=>{
    const block = document.createElement('div');
    block.className = 'giro-block' + (gi===state.patternActiveGiroIdx ? ' active':'');

    const head = document.createElement('div');
    head.className = 'giro-head';
    head.innerHTML = `
      <div class="giro-order-btns">
        <button type="button" class="btn-round-sm" data-act="up" ${gi===0?'disabled':''} title="Sposta su">↑</button>
        <button type="button" class="btn-round-sm" data-act="down" ${gi===d.giri.length-1?'disabled':''} title="Sposta giù">↓</button>
      </div>
      <input type="text" class="giro-label-input" value="${escapeHtml(giro.label)}" placeholder="Nome del giro">
      <label class="giro-reps-field">Rip. <input type="number" min="0" max="99" value="${giro.ripetizioni}" class="giro-reps-input"></label>
      <button type="button" class="btn-icon-danger" data-act="del" title="Elimina giro">🗑</button>`;
    head.querySelector('[data-act=up]').onclick = ()=>{
      if(gi===0) return;
      const tmp = d.giri[gi-1]; d.giri[gi-1]=d.giri[gi]; d.giri[gi]=tmp;
      if(state.patternActiveGiroIdx===gi) state.patternActiveGiroIdx=gi-1;
      else if(state.patternActiveGiroIdx===gi-1) state.patternActiveGiroIdx=gi;
      renderPatternGiriEditor();
    };
    head.querySelector('[data-act=down]').onclick = ()=>{
      if(gi===d.giri.length-1) return;
      const tmp = d.giri[gi+1]; d.giri[gi+1]=d.giri[gi]; d.giri[gi]=tmp;
      if(state.patternActiveGiroIdx===gi) state.patternActiveGiroIdx=gi+1;
      else if(state.patternActiveGiroIdx===gi+1) state.patternActiveGiroIdx=gi;
      renderPatternGiriEditor();
    };
    head.querySelector('.giro-label-input').onchange = (e)=>{ giro.label = e.target.value.trim() || `Giro ${gi+1}`; };
    head.querySelector('.giro-reps-input').onchange = (e)=>{
      giro.ripetizioni = Math.max(0, Math.min(99, parseInt(e.target.value,10)||0));
    };
    head.querySelector('[data-act=del]').onclick = ()=>{
      if(d.giri.length<=1){ alert('Il pattern deve avere almeno un giro.'); return; }
      const hasContent = draftHasContentSong({battute: giro.battute});
      const doDelete = ()=>{
        d.giri.splice(gi,1);
        if(state.patternActiveGiroIdx>=d.giri.length) state.patternActiveGiroIdx = d.giri.length-1;
        state.songSelected = null;
        renderPatternGiriEditor();
      };
      if(hasContent){ if(confirm(`Eliminare "${giro.label}"? Contiene già delle note.`)) doDelete(); }
      else doDelete();
    };
    block.appendChild(head);

    const barsContainer = document.createElement('div');
    barsContainer.className = 'bars-wrap pattern-giro-bars';
    barsContainer.id = `pgb-${giro.id}`;
    // Qualsiasi interazione dentro questo giro lo rende quello attivo per le scorciatoie da
    // tastiera (capture-phase: precede il click del singolo slot gestito da renderSongBars).
    barsContainer.addEventListener('click', ()=>{ state.patternActiveGiroIdx = gi; }, true);
    block.appendChild(barsContainer);
    renderSongBars(barsContainer, giroAsDraft(d, giro), {editable:true});

    const addBarBtn = document.createElement('button');
    addBarBtn.type='button'; addBarBtn.className='btn btn-secondary btn-block';
    addBarBtn.textContent = '+ Aggiungi misura a questo giro';
    addBarBtn.onclick = ()=>{
      giro.battute.push(newEmptySongBar(slotsPerBar(d)));
      renderSongBars(barsContainer, giroAsDraft(d, giro), {editable:true});
    };
    block.appendChild(addBarBtn);

    wrap.appendChild(block);
  });
  const giroSel = el('#pattern-play-giro');
  if(giroSel && giroSel._refreshOptions) giroSel._refreshOptions(); // aggiorna il selettore giro della riproduzione, se già inizializzato
}

el('#pattern-add-giro').onclick = ()=>{
  const d = state.patternDraft;
  d.giri.push(newGiro(slotsPerBar(d), d.giri.length+1));
  state.patternActiveGiroIdx = d.giri.length-1;
  state.songSelected = null;
  renderPatternGiriEditor();
};
el('#pattern-bulk-reps-apply').onclick = ()=>{
  const v = Math.max(0, Math.min(99, parseInt(el('#pattern-bulk-reps').value,10)||0));
  state.patternDraft.giri.forEach(g=> g.ripetizioni = v);
  renderPatternGiriEditor();
};

function collectPatternFormIntoDraft(){
  const d = state.patternDraft;
  d.titolo = el('#pattern-title').value.trim();
  d.bpm = el('#pattern-bpm').value ? parseInt(el('#pattern-bpm').value,10) : null;
  d.preferito = el('#pattern-favorite').checked;
  d.note = el('#pattern-notes').value;
  d.categorie = Array.from(el('#pattern-cat-select').querySelectorAll('.chip.active')).map(c=>c.textContent);
}

el('#pattern-save').onclick = ()=>{
  collectPatternFormIntoDraft();
  const d = state.patternDraft;
  if(!d.titolo){ alert('Dai un titolo al pattern prima di salvare.'); return; }
  d.dataModifica = nowIso();
  const idx = DATA.patterns.findIndex(p=>p.id===d.id);
  if(idx>=0) DATA.patterns[idx]=d; else { d.ordine = nextManualOrder(DATA.patterns); DATA.patterns.push(d); }
  saveData();
  stopAllPlayback();
  openPatternDetail(d.id);
};
el('#pattern-delete').onclick = ()=>{
  const d = state.patternDraft;
  if(confirm(`Eliminare definitivamente "${d.titolo||'questo pattern'}"? L'operazione non può essere annullata (usa un backup per recuperarlo).`)){
    DATA.patterns = DATA.patterns.filter(p=>p.id!==d.id);
    saveData();
    showTab('patterns');
  }
};
el('#pattern-back').onclick = ()=>{ stopAllPlayback(); showTab('patterns'); };

/* ---- Riproduzione (motore condiviso editor + dettaglio) ---- */
// Sequenza di step del ritmo guida (righe[0] di ogni battuta, single-riga per costruzione):
// gira in loop continuo per conto proprio, indipendentemente dal giro/ripetizione in corso.
function buildGuideFlatSteps(pattern){
  const steps = [];
  pattern.ritmoGuida.battute.forEach(bar=> bar.righe[0].forEach(slot=> steps.push(slot)));
  return steps;
}
function buildGiroFlatSteps(giro){
  const steps = [];
  giro.battute.forEach(bar=> bar.forEach(slot=> steps.push(slot)));
  return steps;
}
// Sequenza concatenata di un giro completo del pattern intero, rispettando le ripetizioni di
// ciascun giro (0 = giro saltato, semplicemente non contribuisce alla sequenza).
// giroStartFlat[i] = offset (in step) a cui inizia il giro i nella sequenza: usato per far
// partire la riproduzione "da un giro in poi" senza dover ricostruire una sequenza diversa.
function buildPatternSequence(pattern){
  const steps = [];
  const giroStartFlat = [];
  pattern.giri.forEach((giro, gi)=>{
    giroStartFlat[gi] = steps.length;
    const gs = buildGiroFlatSteps(giro);
    const reps = Math.max(0, giro.ripetizioni||0);
    for(let r=0; r<reps; r++){
      gs.forEach((s,li)=> steps.push({ slot:s, giroIdx:gi, localIdx:li }));
    }
  });
  return { steps, giroStartFlat };
}
// mode 'full': tutto il pattern in loop rispettando le ripetizioni, poi torna al giro 1.
// mode 'giro': solo un giro specifico, loop semplice, le ripetizioni non si applicano.
// mode 'from': come 'full' ma a partire dal giro indicato (poi torna comunque al giro 1).
function patternPlaybackSequence(pattern, mode, giroIdx){
  if(mode==='giro'){
    const gi = giroIdx||0;
    const gs = buildGiroFlatSteps(pattern.giri[gi]).map((s,li)=>({ slot:s, giroIdx:gi, localIdx:li }));
    return { steps: gs, offset: 0 };
  }
  const { steps, giroStartFlat } = buildPatternSequence(pattern);
  if(mode==='from') return { steps, offset: giroStartFlat[giroIdx||0] || 0 };
  return { steps, offset: 0 };
}
// Ad ogni step suona SIA la posizione corrente del ritmo guida (in loop indipendente, modulo
// la propria lunghezza) SIA la posizione corrente della sequenza di giri (modulo la propria
// lunghezza, con l'offset di partenza per la modalità "da un giro in poi").
function playPatternStep(guideSteps, seq, offset, idx, time){
  if(guideSteps.length){
    const gStep = guideSteps[idx % guideSteps.length];
    if(gStep.c) AudioEngine.playPerc(gStep.c, time, INTENSITIES[gStep.i]);
  }
  if(seq.length){
    const entry = seq[(offset+idx) % seq.length];
    const slot = entry.slot;
    slot.n.forEach(note=>{
      if(note.num==='tak'){ AudioEngine.playTak(time, INTENSITIES[note.i]); return; }
      if(note.num==='ghost'){ AudioEngine.playGhost(time); return; }
      const map = resolveNoteMapEntry(note.num);
      const freq = map ? noteFreqFromAnglo(map.anglo) : null;
      if(freq) AudioEngine.playNote(freq, time, INTENSITIES[note.i]);
    });
    if(slot.click) AudioEngine.click(time, false);
  }
}

// Popola/aggiorna i due selettori di modalità di riproduzione (modalità + eventuale giro),
// condivisi da editor e dettaglio tramite prefisso id.
function wirePatternPlayModeSelectors(prefix, getPattern){
  const modeSel = el(`#${prefix}-play-mode`);
  const giroSel = el(`#${prefix}-play-giro`);
  function refreshGiroOptions(){
    const p = getPattern();
    const prevVal = giroSel.value;
    giroSel.innerHTML = '';
    (p ? p.giri : []).forEach((g,i)=>{
      const o = document.createElement('option'); o.value=i; o.textContent = g.label || `Giro ${i+1}`;
      giroSel.appendChild(o);
    });
    if(prevVal && Array.from(giroSel.options).some(o=>o.value===prevVal)) giroSel.value = prevVal;
  }
  function refreshVisibility(){
    giroSel.classList.toggle('hidden', modeSel.value==='full');
  }
  modeSel.onchange = refreshVisibility;
  giroSel._refreshOptions = refreshGiroOptions; // proprietà JS diretta: dataset non può contenere funzioni
  refreshGiroOptions();
  refreshVisibility();
}

let patternScheduler = null;
function togglePatternEditorPlayback(){
  const btn = el('#pattern-play-toggle');
  if(patternScheduler && patternScheduler.isRunning()){
    patternScheduler.stop(); patternScheduler=null;
    ActivePlayback.pattern=false; WakeLockMgr.release();
    btn.textContent = '▶ Riproduci';
    clearPatternEditorHighlights();
    return;
  }
  const d = state.patternDraft;
  const mode = el('#pattern-play-mode').value;
  const giroIdx = parseInt(el('#pattern-play-giro').value,10) || 0;
  const guideSteps = buildGuideFlatSteps(d);
  const { steps: seq, offset } = patternPlaybackSequence(d, mode, giroIdx);
  if(!guideSteps.length && !seq.length){ alert('Nulla da riprodurre: aggiungi colpi al ritmo guida o note ai giri.'); return; }
  const bpm = d.bpm || 96;
  patternScheduler = createStepScheduler({
    bpm, subdivision: d.tempo.suddivisione, totalSteps: 1e9, loop:true,
    stepCallback:(idx,time)=> playPatternStep(guideSteps, seq, offset, idx, time),
    onVisualStep:(idx)=> highlightPatternEditorStep(d, guideSteps, seq, offset, idx)
  });
  patternScheduler.start();
  ActivePlayback.pattern = true; WakeLockMgr.acquire();
  btn.textContent = '■ Ferma riproduzione';
}
el('#pattern-play-toggle').onclick = togglePatternEditorPlayback;

function clearPatternEditorHighlights(){
  const gc = el('#pattern-guide-bars'); if(gc) clearPlayingHighlight(gc);
  els('.pattern-giro-bars').forEach(c=> clearPlayingHighlight(c));
}
function highlightPatternEditorStep(pattern, guideSteps, seq, offset, idx){
  const gc = el('#pattern-guide-bars');
  if(gc){
    clearPlayingHighlight(gc);
    if(guideSteps.length){
      const gIdx = idx % guideSteps.length;
      const spb = slotsPerBar(pattern);
      const barIdx = Math.floor(gIdx/spb), slotIdx = gIdx%spb;
      gc.querySelectorAll(`[data-bar="${barIdx}"][data-slot="${slotIdx}"]`).forEach(b=>b.classList.add('playing'));
    }
  }
  els('.pattern-giro-bars').forEach(c=> clearPlayingHighlight(c));
  if(seq.length){
    const entry = seq[(offset+idx) % seq.length];
    const giro = pattern.giri[entry.giroIdx];
    const cnt = giro ? el(`#pgb-${giro.id}`) : null;
    if(cnt){
      const btns = cnt.querySelectorAll('.slot-btn');
      if(btns[entry.localIdx]) btns[entry.localIdx].classList.add('playing');
    }
  }
}

/* ---- Dettaglio ---- */
function openPatternDetail(id){
  stopAllPlayback();
  const item = DATA.patterns.find(p=>p.id===id);
  state.detailPatternId = id;
  el('#pd-title').textContent = item.titolo;
  el('#pd-fav').classList.toggle('active', !!item.preferito);
  el('#pd-chips').innerHTML = item.categorie.map(c=>`<span class="mini-chip">${escapeHtml(c)}</span>`).join('');
  el('#pd-bpm').textContent = [
    item.bpm ? item.bpm+' BPM' : null,
    tempoSignatureText(item),
    item.giri.length+' gir'+(item.giri.length===1?'o':'i')
  ].filter(Boolean).join(' · ');
  el('#pd-notes').textContent = item.note || '';
  rebuildPatternDetailDisplay(item);
  el('#pd-play').textContent = '▶ Riproduci';
  wirePatternPlayModeSelectors('pd', ()=>DATA.patterns.find(p=>p.id===state.detailPatternId));
  wireBpmStepper('pd', ()=>DATA.patterns.find(p=>p.id===state.detailPatternId), ()=>patternDetailScheduler, (it)=>{ it.dataModifica=nowIso(); saveData(); });
  showView('view-pattern-detail');
}
// Il ritmo guida resta compatto (solo riferimento); i giri sono SEMPRE mostrati per intero,
// con priorità visiva sulle note rispetto al ritmo guida, mai un'anteprima collassata.
function rebuildPatternDetailDisplay(item){
  const guideHost = el('#pd-guide-tab'); guideHost.innerHTML='';
  const guideBuilt = buildTabDisplayRhythm({ battute:item.ritmoGuida.battute, tempo:item.tempo });
  guideHost.appendChild(guideBuilt.wrap);
  state.pdGuideSpans = guideBuilt.spans;

  const giriHost = el('#pd-giri-list'); giriHost.innerHTML='';
  state.pdGiroSpansById = {};
  item.giri.forEach(giro=>{
    const block = document.createElement('div');
    block.className = 'giro-detail-block';
    const head = document.createElement('div');
    head.className = 'giro-detail-head';
    head.innerHTML = `<span class="giro-detail-label">${escapeHtml(giro.label)}</span><span class="mini-chip">×${giro.ripetizioni}</span>`;
    block.appendChild(head);
    const tabHost = document.createElement('div'); tabHost.className='tab-display tab-display-song';
    const built = buildTabDisplaySong({ battute: giro.battute });
    tabHost.appendChild(built.wrap);
    state.pdGiroSpansById[giro.id] = built.spans;
    block.appendChild(tabHost);
    giriHost.appendChild(block);
  });
}
el('#pd-back').onclick = ()=>{ stopAllPlayback(); showTab('patterns'); };
el('#pd-fav').onclick = ()=>{
  const item = DATA.patterns.find(p=>p.id===state.detailPatternId);
  item.preferito = !item.preferito; item.dataModifica=nowIso(); saveData();
  el('#pd-fav').classList.toggle('active', item.preferito);
};
el('#pd-edit').onclick = ()=> openPatternEditor(state.detailPatternId);
el('#pd-dup').onclick = ()=>{
  const item = DATA.patterns.find(p=>p.id===state.detailPatternId);
  const clone = JSON.parse(JSON.stringify(item));
  clone.id = genId();
  clone.titolo = (clone.titolo||'Pattern') + ' (copia)';
  clone.giri.forEach(g=> g.id = genId());
  clone.dataCreazione = nowIso(); clone.dataModifica = nowIso();
  clone.ordine = nextManualOrder(DATA.patterns);
  DATA.patterns.push(clone);
  saveData();
  openPatternDetail(clone.id);
};

let patternDetailScheduler = null;
el('#pd-play').onclick = ()=>{
  const btn = el('#pd-play');
  if(patternDetailScheduler && patternDetailScheduler.isRunning()){
    patternDetailScheduler.stop(); patternDetailScheduler=null;
    ActivePlayback.pattern=false; WakeLockMgr.release();
    btn.textContent = '▶ Riproduci';
    clearPatternDetailHighlights();
    return;
  }
  const item = DATA.patterns.find(p=>p.id===state.detailPatternId);
  const mode = el('#pd-play-mode').value;
  const giroIdx = parseInt(el('#pd-play-giro').value,10) || 0;
  const guideSteps = buildGuideFlatSteps(item);
  const { steps: seq, offset } = patternPlaybackSequence(item, mode, giroIdx);
  if(!guideSteps.length && !seq.length){ alert('Nulla da riprodurre.'); return; }
  patternDetailScheduler = createStepScheduler({
    bpm: item.bpm||96, subdivision: item.tempo.suddivisione, totalSteps: 1e9, loop:true,
    stepCallback:(idx,time)=> playPatternStep(guideSteps, seq, offset, idx, time),
    onVisualStep:(idx)=> highlightPatternDetailStep(item, guideSteps, seq, offset, idx)
  });
  patternDetailScheduler.start();
  ActivePlayback.pattern=true; WakeLockMgr.acquire();
  btn.textContent = '■ Ferma riproduzione';
};
function clearPatternDetailHighlights(){
  (state.pdGuideSpans||[]).forEach(s=>s.classList.remove('playing'));
  Object.values(state.pdGiroSpansById||{}).forEach(arr=> arr.forEach(s=>s.classList.remove('playing')));
}
function highlightPatternDetailStep(pattern, guideSteps, seq, offset, idx){
  (state.pdGuideSpans||[]).forEach(s=>s.classList.remove('playing'));
  if(guideSteps.length && state.pdGuideSpans[idx % guideSteps.length]){
    state.pdGuideSpans[idx % guideSteps.length].classList.add('playing');
  }
  Object.values(state.pdGiroSpansById||{}).forEach(arr=> arr.forEach(s=>s.classList.remove('playing')));
  if(seq.length){
    const entry = seq[(offset+idx) % seq.length];
    const giro = pattern.giri[entry.giroIdx];
    const spans = giro ? state.pdGiroSpansById[giro.id] : null;
    if(spans && spans[entry.localIdx]) spans[entry.localIdx].classList.add('playing');
  }
}

/* =========================================================
   19. NAVIGAZIONE GENERALE
   ========================================================= */
els('.tab-btn').forEach(btn=>{
  btn.onclick = ()=>{ stopAllPlayback(); showTab(btn.dataset.tab); };
});

el('#fab-new').onclick = ()=>{
  stopAllPlayback();
  if(state.currentTab==='songs') openSongEditor(null);
  else if(state.currentTab==='patterns') openPatternEditor(null);
  else openRhythmEditor(null);
};

el('#rhythms-search').addEventListener('input', debounce(e=>{ state.rhythmsSearch=e.target.value; renderRhythmsList(); }, 150));
el('#songs-search').addEventListener('input', debounce(e=>{ state.songsSearch=e.target.value; renderSongsList(); }, 150));
el('#patterns-search').addEventListener('input', debounce(e=>{ state.patternsSearch=e.target.value; renderPatternsList(); }, 150));
el('#rhythms-fav-toggle').onclick = ()=>{ state.rhythmsFav=!state.rhythmsFav; el('#rhythms-fav-toggle').classList.toggle('active', state.rhythmsFav); renderRhythmsList(); };
el('#songs-fav-toggle').onclick = ()=>{ state.songsFav=!state.songsFav; el('#songs-fav-toggle').classList.toggle('active', state.songsFav); renderSongsList(); };
el('#patterns-fav-toggle').onclick = ()=>{ state.patternsFav=!state.patternsFav; el('#patterns-fav-toggle').classList.toggle('active', state.patternsFav); renderPatternsList(); };
el('#rhythms-sort').onchange = e=>{ state.rhythmsSort=e.target.value; renderRhythmsList(); };
el('#songs-sort').onchange = e=>{ state.songsSort=e.target.value; renderSongsList(); };
el('#patterns-sort').onchange = e=>{ state.patternsSort=e.target.value; renderPatternsList(); };

/* Stepper BPM live: regola il tempo mentre un loop è in riproduzione, senza fermarlo.
   getItem() deve restituire l'oggetto (draft o item salvato) con il campo bpm da modificare;
   getScheduler() restituisce lo scheduler attivo corrente (o null); onChange è chiamato dopo ogni modifica. */
function wireBpmStepper(prefix, getItem, getScheduler, onChange){
  const valEl = el(`#${prefix}-bpm-live-val`);
  const sync = ()=>{ const it = getItem(); if(it) valEl.textContent = it.bpm || 96; };
  const step = (delta)=>{
    const it = getItem();
    if(!it) return;
    it.bpm = Math.max(20, Math.min(300, (it.bpm||96) + delta));
    sync();
    const sch = getScheduler();
    if(sch && sch.isRunning()) sch.setBpm(it.bpm);
    if(onChange) onChange(it);
  };
  el(`#${prefix}-bpm-minus-live`).onclick = ()=> step(-1);
  el(`#${prefix}-bpm-plus-live`).onclick = ()=> step(1);
  sync();
}

/* =========================================================
   20. AVVIO
   ========================================================= */
showTab('rhythms');

if('serviceWorker' in navigator){
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', ()=>{
    if(refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', async ()=>{
    try{
      const reg = await navigator.serviceWorker.register('sw.js');
      if(reg.waiting) showUpdateBanner(reg.waiting);
      reg.addEventListener('updatefound', ()=>{
        const newWorker = reg.installing;
        if(!newWorker) return;
        newWorker.addEventListener('statechange', ()=>{
          // se esiste già un controller, questo non è il primo install ma un vero aggiornamento
          if(newWorker.state==='installed' && navigator.serviceWorker.controller){
            showUpdateBanner(newWorker);
          }
        });
      });
      // ricontrolla ad ogni apertura e ogni volta che l'app torna in primo piano
      reg.update().catch(()=>{});
      document.addEventListener('visibilitychange', ()=>{
        if(document.visibilityState==='visible') reg.update().catch(()=>{});
      });
    }catch(e){ /* funziona comunque online, solo senza cache offline */ }
  });
}
function showUpdateBanner(waitingWorker){
  const banner = el('#update-banner');
  banner.classList.remove('hidden');
  el('#update-banner-btn').onclick = ()=>{
    waitingWorker.postMessage({type:'SKIP_WAITING'});
    banner.classList.add('hidden');
  };
}
