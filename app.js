'use strict';

/* =========================================================
   1. COSTANTI & DEFAULT
   ========================================================= */
const SCHEMA_VERSION = 2;
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

// Frequenze approssimative (Hz) usate solo per la riproduzione sintetica di riferimento.
const NOTE_FREQ = { D3:146.8,A3:220.0,Bb3:233.1,C4:261.6,D4:293.7,E4:329.6,F4:349.2,G4:392.0,A4:440.0 };

function defaultData(){
  return {
    versione_schema: SCHEMA_VERSION,
    categorie: DEFAULT_CATEGORIES.slice(),
    mappaNote: DEFAULT_NOTE_MAP.map(n=>({...n})),
    notationMode: 'numero',
    migrazioni: ['cat-2-4'],
    ritmi: [],
    canzoni: []
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
  if(!d.migrazioni) d.migrazioni = [];

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

function noteLabel(numero){
  const n = DATA.mappaNote.find(m=>m.numero===numero) || {anglo:'?',solf:'?'};
  if(DATA.notationMode==='lettera') return n.anglo;
  if(DATA.notationMode==='solfeggio') return n.solf;
  return String(numero);
}
function noteChipHtml(note){
  const cls = ['note-chip'];
  if(note.i===1) cls.push('i-forte');
  if(note.i===2) cls.push('i-debole');
  if(note.mano==='dx') cls.push('hand-dx');
  if(note.mano==='sx') cls.push('hand-sx');
  return `<span class="${cls.join(' ')}">${escapeHtml(noteLabel(note.num))}</span>`;
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
  editingRhythmId: null, editingSongId: null,
  rhythmDraft: null, songDraft: null,
  detailRhythmId: null, detailSongId: null,
  barClipboardRhythm: null, barClipboardSong: null,
  songSelected: null, // {barIdx, slotIdx} — selezione corrente nell'editor canzone
  rdTabSpans: [], sdTabSpans: [],
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

  // Suoni percussivi sintetizzati per Dum/Ta/Ka (oscillatore + inviluppo breve).
  function playPerc(type, time, intensity){
    const c = ensureCtx();
    const gainMul = intensity==='forte'?1.0:(intensity==='debole'?0.45:0.75);

    if(type==='dum'){
      // Corpo grave + un breve transiente più acuto: senza il transiente,
      // un tono puramente grave risulta troppo debole su altoparlanti piccoli.
      const dur = 0.42;
      const body = c.createOscillator();
      const bodyGain = c.createGain();
      body.type = 'sine';
      body.frequency.setValueAtTime(155, time);
      body.frequency.exponentialRampToValueAtTime(88, time+dur);
      bodyGain.gain.setValueAtTime(0.0001, time);
      bodyGain.gain.exponentialRampToValueAtTime(1.0*gainMul, time+0.008);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, time+dur);
      body.connect(bodyGain).connect(c.destination);
      body.start(time); body.stop(time+dur+0.02);

      const click = c.createOscillator();
      const clickGain = c.createGain();
      click.type = 'triangle';
      click.frequency.setValueAtTime(340, time);
      clickGain.gain.setValueAtTime(0.0001, time);
      clickGain.gain.exponentialRampToValueAtTime(0.55*gainMul, time+0.004);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, time+0.05);
      click.connect(clickGain).connect(c.destination);
      click.start(time); click.stop(time+0.07);
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

  return { ensureCtx, playPerc, playNote, click, now:()=>ensureCtx().currentTime };
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
  metronome:false, rhythm:false, song:false,
  anyActive(){ return this.metronome||this.rhythm||this.song; }
};

/* =========================================================
   7. GRIGLIA RITMO — struttura dati e rendering
   ========================================================= */
function newEmptyRhythmBar(n){
  return Array.from({length:n}, ()=>({ c:null, i:0 })); // c: null|'dum'|'ta'|'ka'  i: 0 normale,1 forte,2 debole
}
function newEmptySongBar(n){
  return Array.from({length:n}, ()=>({ n:[] })); // n: [{num, i, mano}]
}

const INTENSITIES = ['normale','forte','debole'];

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
        <button data-act="copy" title="Copia">⧉</button>
        <button data-act="paste" title="Incolla">📋</button>
        <button data-act="dup" title="Duplica dopo">+1</button>
        <button data-act="del" title="Elimina">✕</button>`;
      tools.querySelector('[data-act=copy]').onclick = ()=>{ state.barClipboardRhythm = JSON.parse(JSON.stringify(bar)); };
      tools.querySelector('[data-act=paste]').onclick = ()=>{
        if(state.barClipboardRhythm){ draft.battute[barIdx] = JSON.parse(JSON.stringify(state.barClipboardRhythm)); renderRhythmBars(container, draft, {editable}); }
      };
      tools.querySelector('[data-act=dup]').onclick = ()=>{
        draft.battute.splice(barIdx+1, 0, JSON.parse(JSON.stringify(bar)));
        renderRhythmBars(container, draft, {editable});
      };
      tools.querySelector('[data-act=del]').onclick = ()=>{
        if(draft.battute.length<=1) return;
        draft.battute.splice(barIdx,1);
        renderRhythmBars(container, draft, {editable});
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
      b.className = 'slot-btn' + (slotIdx % draft.tempo.suddivisione===0 ? ' beat-start':'') +
        (slot.c ? ' '+slot.c : '') + (slot.c && slot.i===1 ? ' intensity-forte':'') + (slot.c && slot.i===2 ? ' intensity-debole':'');
      b.dataset.bar = barIdx; b.dataset.slot = slotIdx;
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
    row.appendChild(grid);
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
        <button data-act="copy" title="Copia">⧉</button>
        <button data-act="paste" title="Incolla">📋</button>
        <button data-act="dup" title="Duplica dopo">+1</button>
        <button data-act="del" title="Elimina">✕</button>`;
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
      b.className = 'slot-btn' + (slotIdx % draft.tempo.suddivisione===0 ? ' beat-start':'') + (slot.n.length ? ' has-notes':'') + (isSelected?' selected':'');
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

function openNotePicker(draft, barIdx, slotIdx, containerToRefresh){
  const slot = draft.battute[barIdx][slotIdx];
  const sheet = el('#note-picker');
  const grid = el('#note-picker-grid');
  grid.innerHTML = '';
  for(let num=0; num<=8; num++){
    const existing = slot.n.find(x=>x.num===num);
    const cell = document.createElement('div');
    cell.className = 'note-pick-cell';

    const main = document.createElement('button');
    main.type='button';
    main.className = 'note-pick-btn' + (existing?' selected':'') +
      (existing&&existing.i===1?' intensity-forte':'') + (existing&&existing.i===2?' intensity-debole':'') +
      (existing&&existing.mano==='dx'?' hand-dx':'') + (existing&&existing.mano==='sx'?' hand-sx':'');
    main.innerHTML = `<span>${escapeHtml(noteLabel(num))}</span><span class="small">${num===0?'Dum':'#'+num}</span>`;
    main.onclick = ()=>{
      const i = slot.n.findIndex(x=>x.num===num);
      if(i>=0) slot.n.splice(i,1);
      else slot.n.push({num, i:0, mano:null});
      openNotePicker(draft, barIdx, slotIdx, containerToRefresh);
    };
    cell.appendChild(main);

    if(existing){
      const controls = document.createElement('div');
      controls.className = 'note-pick-controls';
      const intBtn = document.createElement('button');
      intBtn.type='button'; intBtn.className='sub-chip';
      intBtn.textContent = existing.i===1?'Forte':(existing.i===2?'Debole':'Normale');
      intBtn.onclick = (e)=>{ e.stopPropagation(); existing.i=(existing.i+1)%3; openNotePicker(draft,barIdx,slotIdx,containerToRefresh); };
      const manoBtn = document.createElement('button');
      manoBtn.type='button'; manoBtn.className='sub-chip';
      manoBtn.textContent = existing.mano==='dx'?'Mano dx':(existing.mano==='sx'?'Mano sx':'Mano —');
      manoBtn.onclick = (e)=>{
        e.stopPropagation();
        existing.mano = existing.mano===null ? 'dx' : (existing.mano==='dx' ? 'sx' : null);
        openNotePicker(draft,barIdx,slotIdx,containerToRefresh);
      };
      controls.appendChild(intBtn); controls.appendChild(manoBtn);
      cell.appendChild(controls);
    }
    grid.appendChild(cell);
  }
  sheet.classList.remove('hidden');
  el('#note-picker-done').onclick = ()=>{
    sheet.classList.add('hidden');
    renderSongBars(containerToRefresh, draft, {editable:true});
  };
}

/* Navigazione e digitazione da tastiera nell'editor canzone */
function handleSongEditorKeydown(e){
  if(el('#view-song-editor').classList.contains('hidden')) return;
  if(el('#song-form').classList.contains('hidden')) return;
  if(!el('#note-picker').classList.contains('hidden')) return; // popup aperto: non intercettare
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return;

  const d = state.songDraft;
  if(!d) return;
  if(!state.songSelected) state.songSelected = {barIdx:0, slotIdx:0};
  const total = songTotalSlots(d);
  let flat = songFlatIndex(d, state.songSelected.barIdx, state.songSelected.slotIdx);
  const container = el('#song-bars');

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
  if(/^[0-8]$/.test(e.key)){
    e.preventDefault();
    const num = parseInt(e.key,10);
    const pos = state.songSelected;
    const slot = d.battute[pos.barIdx][pos.slotIdx];
    const i = slot.n.findIndex(x=>x.num===num);
    if(i>=0) slot.n.splice(i,1);
    else slot.n.push({num, i:0, mano:null});
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
  draft.battute = draft.battute.map(bar=>{
    let nb = bar.slice(0, spb);
    while(nb.length < spb) nb.push(isRhythm ? {c:null,i:0} : {n:[]});
    return nb;
  });
  draft.tempo = { battiti, suddivisione };
}
function draftHasContentRhythm(draft){
  return draft.battute.some(bar=>bar.some(s=>s.c));
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
  const bar = item.battute[0] || [];
  const syms = bar.map(s => s.c ? ({dum:'D',ta:'T',ka:'K'})[s.c] : '·').join(' ');
  const more = item.battute.length>1 ? '  |  …' : '';
  return syms + more;
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
  items.forEach(item=>{
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
    list.appendChild(card);
  });
}

function sortItems(items, mode){
  if(mode==='titolo-asc') return items.sort((a,b)=> (a.titolo||'').localeCompare(b.titolo||''));
  if(mode==='creazione-desc') return items.sort((a,b)=> new Date(b.dataCreazione)-new Date(a.dataCreazione));
  return items.sort((a,b)=> new Date(b.dataModifica)-new Date(a.dataModifica));
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
  items.forEach(item=>{
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
  if(idx>=0) DATA.ritmi[idx]=d; else DATA.ritmi.push(d);
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
  const flatSlots = [].concat(...draft.battute);
  const bpm = draft.bpm || 96;
  rhythmScheduler = createStepScheduler({
    bpm, subdivision: draft.tempo.suddivisione, totalSteps: flatSlots.length, loop:true,
    stepCallback:(idx,time)=>{
      const slot = flatSlots[idx];
      if(slot.c) AudioEngine.playPerc(slot.c, time, INTENSITIES[slot.i]);
    },
    onVisualStep:(idx)=>{
      clearPlayingHighlight(barsContainer);
      const btns = barsContainer.querySelectorAll('.slot-btn');
      if(btns[idx]) btns[idx].classList.add('playing');
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

function collectSongFormIntoDraft(){
  const d = state.songDraft;
  d.titolo = el('#song-title').value.trim();
  d.bpm = el('#song-bpm').value ? parseInt(el('#song-bpm').value,10) : null;
  d.preferito = el('#song-favorite').checked;
  d.note = el('#song-notes').value;
  d.categorie = Array.from(el('#song-cat-select').querySelectorAll('.chip.active')).map(c=>c.textContent);
  d.audio = { nomeFile: el('#song-audio-label').value.trim(), url: el('#song-audio-url').value.trim() };
}

el('#song-save').onclick = ()=>{
  collectSongFormIntoDraft();
  const d = state.songDraft;
  if(!d.titolo){ alert('Dai un titolo alla canzone prima di salvare.'); return; }
  d.dataModifica = nowIso();
  const idx = DATA.canzoni.findIndex(r=>r.id===d.id);
  if(idx>=0) DATA.canzoni[idx]=d; else DATA.canzoni.push(d);
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
        const map = DATA.mappaNote.find(m=>m.numero===note.num);
        const freq = map ? NOTE_FREQ[map.anglo] : null;
        if(freq) AudioEngine.playNote(freq, time, INTENSITIES[note.i]);
      });
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
      s.className = 'tsym' + (info.isRest ? ' rest':'');
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
  return buildTabFlowGeneric(item.battute, slot=>{
    if(!slot.c) return { html:'·', isRest:true };
    return { html: `<span class="${slot.c}">${({dum:'D',ta:'T',ka:'K'})[slot.c]}</span>`, isRest:false };
  });
}
function buildTabDisplaySong(item){
  return buildTabFlowGeneric(item.battute, slot=>{
    if(!slot.n.length) return { html:'·', isRest:true };
    return { html: slot.n.map(noteChipHtml).join(''), isRest:false };
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
  const flatSlots = [].concat(...item.battute);
  rhythmDetailScheduler = createStepScheduler({
    bpm: item.bpm||96, subdivision:item.tempo.suddivisione, totalSteps: flatSlots.length, loop:true,
    stepCallback:(idx,time)=>{ const s=flatSlots[idx]; if(s.c) AudioEngine.playPerc(s.c,time,INTENSITIES[s.i]); },
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
        const map = DATA.mappaNote.find(m=>m.numero===note.num);
        const freq = map ? NOTE_FREQ[map.anglo] : null;
        if(freq) AudioEngine.playNote(freq, time, INTENSITIES[note.i]);
      });
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
  ActivePlayback.rhythm=false; ActivePlayback.song=false; ActivePlayback.metronome=false;
  WakeLockMgr.release();
}

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

function renderSettings(){
  el('#setting-notation-mode').value = DATA.notationMode;
  el('#schema-version').textContent = DATA.versione_schema;

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
      el('#import-result').textContent = `Importati: ${result.ritmiAggiunti} ritmi, ${result.canzoniAggiunte} canzoni, ${result.categorieAggiunte} nuove categorie.` + (result.duplicatiRinominati? ` ${result.duplicatiRinominati} elementi con ID già esistente sono stati aggiunti come duplicati.`:'');
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
  ritmiAggiunti = r1.added; canzoniAggiunte = r2.added;
  duplicatiRinominati = r1.renamed + r2.renamed;
  return {ritmiAggiunti, canzoniAggiunte, categorieAggiunte, duplicatiRinominati};
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
  else openRhythmEditor(null);
};

el('#rhythms-search').addEventListener('input', debounce(e=>{ state.rhythmsSearch=e.target.value; renderRhythmsList(); }, 150));
el('#songs-search').addEventListener('input', debounce(e=>{ state.songsSearch=e.target.value; renderSongsList(); }, 150));
el('#rhythms-fav-toggle').onclick = ()=>{ state.rhythmsFav=!state.rhythmsFav; el('#rhythms-fav-toggle').classList.toggle('active', state.rhythmsFav); renderRhythmsList(); };
el('#songs-fav-toggle').onclick = ()=>{ state.songsFav=!state.songsFav; el('#songs-fav-toggle').classList.toggle('active', state.songsFav); renderSongsList(); };
el('#rhythms-sort').onchange = e=>{ state.rhythmsSort=e.target.value; renderRhythmsList(); };
el('#songs-sort').onchange = e=>{ state.songsSort=e.target.value; renderSongsList(); };

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
