Aquí tienes únicamente el código **JavaScript (`main.js`)** limpio, sin los comandos de la terminal ni el HTML, listo para que lo uses directamente en tu proyecto:

```javascript
// Carga FFmpeg completamente desde blobs — sin Workers externos
async function loadFFmpegFromBlobs() {    
    const toBlob = async (url, type) => {        
        const res = await fetch(url);        
        const buf = await res.arrayBuffer();        
        return URL.createObjectURL(new Blob([buf], { type }));    
    };    
    
    // Descarga el script principal de ffmpeg como blob    
    const ffmpegScriptURL = await toBlob(        
        'https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/umd/ffmpeg.js',        
        'text/javascript'    
    );    
    
    await new Promise((resolve, reject) => {        
        const s = document.createElement('script');        
        s.src = ffmpegScriptURL;        
        s.onload = resolve;        
        s.onerror = reject;        
        document.head.appendChild(s);    
    });    
    
    URL.revokeObjectURL(ffmpegScriptURL);
}

let ffmpeg = null;
let loaded = false;
let currentFile = null;
let outputBlob = null;
let outputFilename = '';

const qualityLabels = { '1': 'Máxima compresión', '2': 'Alta', '3': 'Sin pérdida' };
const qualityCRF    = { '1': '32',                '2': '24',  '3': '18'           };

function updateQuality(v) {    
    document.getElementById('qualityVal').textContent = qualityLabels[v];    
    updateEstimate();
}

function formatBytes(bytes) {    
    if (!bytes) return '0 B';    
    const k = 1024, sizes = ['B','KB','MB','GB'];    
    const i = Math.floor(Math.log(bytes) / Math.log(k));    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function updateEstimate() {    
    if (!currentFile) return;    
    const orig = currentFile.size;    
    const q = document.getElementById('qualitySlider').value;    
    const res = document.getElementById('resSelect').value;    
    const fps = document.getElementById('fpsSelect').value;    
    
    let factor = { '1': 0.25, '2': 0.45, '3': 0.7 }[q];    
    if (res === '1280x720')        factor *= 0.65;    
    else if (res === '854x480')    factor *= 0.4;    
    else if (res === '640x360')    factor *= 0.25;    
    else if (res === '1920x1080')  factor *= 0.85;    
    
    if (fps === '30')      factor *= 0.85;    
    else if (fps === '24') factor *= 0.75;    
    
    document.getElementById('origSize').textContent = formatBytes(orig);    
    document.getElementById('estSize').textContent  = formatBytes(Math.round(orig * factor));    
    document.getElementById('savings').textContent  = Math.round((1 - factor) * 100) + '%';
}

async function loadFFmpeg() {    
    if (loaded) return;    
    document.getElementById('initOverlay').classList.add('show');    
    try {        
        // Si FFmpegWASM no está disponible aún, cárgalo como blob        
        if (typeof FFmpegWASM === 'undefined') {            
            await loadFFmpegFromBlobs();        
        }        
        const { FFmpeg } = FFmpegWASM;        
        const { fetchFile, toBlobURL } = FFmpegUtil;        
        
        ffmpeg = new FFmpeg();        
        ffmpeg.on('log', ({ message }) => {            
            const m = message.match(/time=(\d+):(\d+):(\d+\.\d+)/);            
            if (m && window._duration) {                
                const cur = +m[1]*3600 + +m[2]*60 + parseFloat(m[3]);                
                setProgress(Math.min(99, Math.round(cur / window._duration * 100)),                    
                    'Procesando: ' + m[0].replace('time=',''));            
            }        
        });        
        
        const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';        
        // Carga core y wasm como blobs para evitar restricciones CORS en Workers        
        const [coreURL, wasmURL] = await Promise.all([            
            toBlobURL(`${base}/ffmpeg-core.js`,   'text/javascript'),            
            toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),        
        ]);        
        
        await ffmpeg.load({ coreURL, wasmURL });        
        loaded = true;    
    } catch (e) {        
        showError('Error cargando el motor: ' + e.message);    
    } finally {        
        document.getElementById('initOverlay').classList.remove('show');    
    }
}

function setProgress(pct, msg) {    
    document.getElementById('progressBar').style.width = pct + '%';    
    document.getElementById('progressPct').textContent = pct + '%';    
    if (msg) document.getElementById('progressMsg').textContent = msg;
}

function showError(msg) {    
    const b = document.getElementById('errorBox');    
    b.style.display = 'block';    
    b.textContent = '⚠ ' + msg;
}

function hideError() { 
    document.getElementById('errorBox').style.display = 'none'; 
}

function initDragAndDrop() {    
    const dz = document.getElementById('dropzone');    
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag'); });    
    dz.addEventListener('dragleave', () => dz.classList.remove('drag'));    
    dz.addEventListener('drop', e => {        
        e.preventDefault(); dz.classList.remove('drag');        
        const f = e.dataTransfer.files[0];        
        if (f && f.type.startsWith('video/')) handleFile(f);        
        else showError('Por favor selecciona un archivo de video válido.');    
    });    
    document.getElementById('fileInput').addEventListener('change', e => {        
        if (e.target.files[0]) handleFile(e.target.files[0]);    
    });
}

function handleFile(file) {    
    hideError(); currentFile = file;    
    document.getElementById('dropzone').style.display       = 'none';    
    document.getElementById('previewSection').style.display = 'block';    
    document.getElementById('resultSection').style.display  = 'none';    
    document.getElementById('fileName').textContent = file.name;    
    document.getElementById('fileMeta').textContent = formatBytes(file.size) + ' · ' + file.type.replace('video/','').toUpperCase();    
    
    updateEstimate();    
    
    const url = URL.createObjectURL(file);    
    const vid = document.createElement('video');    
    vid.src = url;    
    vid.onloadedmetadata = () => {        
        window._duration = vid.duration;        
        URL.revokeObjectURL(url);        
        const m = Math.floor(vid.duration/60), s = Math.floor(vid.duration%60);        
        document.getElementById('fileMeta').textContent =            
            formatBytes(file.size) + ' · ' + file.type.replace('video/','').toUpperCase() +            
            ' · ' + m + ':' + String(s).padStart(2,'0');    
    };    
    vid.onerror = () => URL.revokeObjectURL(url);    
    loadFFmpeg();
}

async function startCompress() {    
    hideError();    
    if (!currentFile) return;    
    if (!loaded) { await loadFFmpeg(); if (!loaded) return; }    
    
    const { fetchFile } = FFmpegUtil;    
    document.getElementById('compressBtn').disabled = true;    
    document.getElementById('previewSection').style.display  = 'none';    
    document.getElementById('progressSection').style.display = 'block';    
    document.getElementById('resultSection').style.display   = 'none';    
    
    setProgress(0, 'Leyendo archivo…');    
    try {        
        const quality      = document.getElementById('qualitySlider').value;        
        const res          = document.getElementById('resSelect').value;        
        const fps          = document.getElementById('fpsSelect').value;        
        const format       = document.getElementById('formatSelect').value;        
        const audioBitrate = document.getElementById('audioBitrate').value;        
        const crf          = qualityCRF[quality];        
        const ext          = currentFile.name.split('.').pop().toLowerCase() || 'mp4';        
        const inputName    = 'input.' + ext;        
        const outputName   = 'output.' + format;        
        
        setProgress(5, 'Cargando video en memoria…');        
        await ffmpeg.writeFile(inputName, await fetchFile(currentFile));        
        
        const args = ['-i', inputName];        
        if (format === 'webm') {            
            args.push('-c:v','libvpx-vp9','-crf',crf,'-b:v','0');        
        } else {            
            args.push('-c:v','libx264','-crf',crf,'-preset','fast','-movflags','+faststart');        
        }        
        
        if (res !== 'original') {            
            const [w,h] = res.split('x');            
            args.push('-vf',`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`);        
        }        
        
        if (fps !== 'original') args.push('-r', fps);        
        args.push('-c:a', format==='webm' ? 'libopus' : 'aac', '-b:a', audioBitrate, '-y', outputName);        
        
        setProgress(10, 'Comprimiendo… esto puede tomar varios minutos');        
        document.getElementById('progressTitle').textContent = 'Comprimiendo video…';        
        
        await ffmpeg.exec(args);        
        setProgress(95, 'Finalizando…');        
        
        const data = await ffmpeg.readFile(outputName);        
        outputBlob = new Blob([data.buffer], { type: format==='webm' ? 'video/webm' : 'video/mp4' });        
        outputFilename = currentFile.name.replace(/\.[^.]+$/,'') + '_compressed.' + format;        
        
        await ffmpeg.deleteFile(inputName);        
        await ffmpeg.deleteFile(outputName);        
        setProgress(100, 'Completado');        
        showResult();    
    } catch(e) {        
        document.getElementById('progressSection').style.display = 'none';        
        document.getElementById('previewSection').style.display  = 'block';        
        showError('Error durante la compresión: ' + e.message);        
        document.getElementById('compressBtn').disabled = false;    
    }
}

function showResult() {    
    document.getElementById('progressSection').style.display = 'none';    
    document.getElementById('resultSection').style.display   = 'block';    
    
    const orig  = currentFile.size, nuevo = outputBlob.size;    
    const saved = Math.round((1 - nuevo/orig) * 100);    
    
    document.getElementById('rOrigSize').textContent = formatBytes(orig);    
    document.getElementById('rNewSize').textContent  = formatBytes(nuevo);    
    document.getElementById('rSaved').textContent    = (saved>0?'-':'+') + Math.abs(saved) + '%';    
    
    const url = URL.createObjectURL(outputBlob);    
    const dl  = document.getElementById('downloadLink');    
    dl.href = url; dl.download = outputFilename;    
    dl.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>Descargar (${formatBytes(nuevo)})`;    
    
    const quality = document.getElementById('qualitySlider').value;    
    document.getElementById('resultSub').textContent =        
        `Calidad: ${qualityLabels[quality]} · Formato: ${document.getElementById('formatSelect').value.toUpperCase()}`;}

function resetAll() {    
    currentFile = outputBlob = window._duration = null;    
    ['previewSection','progressSection','resultSection'].forEach(id =>        
        document.getElementById(id).style.display = 'none');    
    document.getElementById('dropzone').style.display    = 'block';    
    document.getElementById('fileInput').value           = '';    
    document.getElementById('compressBtn').disabled      = false;    
    document.getElementById('progressTitle').textContent = 'Procesando video…';    
    ['origSize','estSize','savings'].forEach(id =>        
        document.getElementById(id).textContent = '—');    
    hideError(); setProgress(0,'');
}

document.addEventListener('DOMContentLoaded', () => {    
    initDragAndDrop();    
    updateQuality(document.getElementById('qualitySlider').value);
});

```
