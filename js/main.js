// ====================== VideoPress - Main JS ======================

const { FFmpeg } = FFmpegWASM;
const { fetchFile, toBlobURL } = FFmpegUtil;

let ffmpeg = null;
let loaded = false;
let currentFile = null;
let outputBlob = null;
let outputFilename = '';

const qualityLabels = {
    '1': 'Máxima compresión',
    '2': 'Alta',
    '3': 'Sin pérdida'
};

const qualityCRF = {
    '1': '32',
    '2': '24',
    '3': '18'
};

// ====================== Funciones de Utilidad ======================

function updateQuality(v) {
    document.getElementById('qualityVal').textContent = qualityLabels[v];
    updateEstimate();
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
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

    if (res === '1280x720') factor *= 0.65;
    else if (res === '854x480') factor *= 0.4;
    else if (res === '640x360') factor *= 0.25;
    else if (res === '1920x1080') factor *= 0.85;

    if (fps === '30') factor *= 0.85;
    else if (fps === '24') factor *= 0.75;

    const est = Math.round(orig * factor);
    const saved = Math.round((1 - factor) * 100);

    document.getElementById('origSize').textContent = formatBytes(orig);
    document.getElementById('estSize').textContent = formatBytes(est);
    document.getElementById('savings').textContent = saved + '%';
}

// ====================== FFmpeg ======================

async function loadFFmpeg() {
    if (loaded) return;

    const overlay = document.getElementById('initOverlay');
    overlay.classList.add('show');

    try {
        ffmpeg = new FFmpeg();

        ffmpeg.on('log', ({ message }) => {
            const timeMatch = message.match(/time=(\d+):(\d+):(\d+\.\d+)/);
            if (timeMatch && window._duration) {
                const h = parseInt(timeMatch[1]);
                const m = parseInt(timeMatch[2]);
                const s = parseFloat(timeMatch[3]);
                const current = h * 3600 + m * 60 + s;
                const pct = Math.min(99, Math.round((current / window._duration) * 100));
                setProgress(pct, `Procesando: ${timeMatch[0].replace('time=', '')}`);
            }
        });

        const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
        
        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });

        loaded = true;
    } catch (e) {
        showError('Error cargando el motor: ' + e.message + '. Asegúrate de tener conexión a internet.');
    } finally {
        overlay.classList.remove('show');
    }
}

function setProgress(pct, msg) {
    document.getElementById('progressBar').style.width = pct + '%';
    document.getElementById('progressPct').textContent = pct + '%';
    if (msg) document.getElementById('progressMsg').textContent = msg;
}

function showError(msg) {
    const box = document.getElementById('errorBox');
    box.style.display = 'block';
    box.textContent = '⚠ ' + msg;
}

function hideError() {
    document.getElementById('errorBox').style.display = 'none';
}

// ====================== Drag & Drop ======================

function initDragAndDrop() {
    const dz = document.getElementById('dropzone');
    
    dz.addEventListener('dragover', e => {
        e.preventDefault();
        dz.classList.add('drag');
    });

    dz.addEventListener('dragleave', () => {
        dz.classList.remove('drag');
    });

    dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.classList.remove('drag');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('video/')) {
            handleFile(file);
        } else {
            showError('Por favor selecciona un archivo de video válido.');
        }
    });

    document.getElementById('fileInput').addEventListener('change', e => {
        if (e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    });
}

function handleFile(file) {
    hideError();
    currentFile = file;

    document.getElementById('dropzone').style.display = 'none';
    document.getElementById('previewSection').style.display = 'block';
    document.getElementById('resultSection').style.display = 'none';

    document.getElementById('fileName').textContent = file.name;
    document.getElementById('fileMeta').textContent = 
        formatBytes(file.size) + ' · ' + file.type.replace('video/', '').toUpperCase();

    updateEstimate();

    // Obtener duración del video
    const url = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.src = url;
    
    vid.onloadedmetadata = () => {
        window._duration = vid.duration;
        URL.revokeObjectURL(url);
        
        const dur = Math.floor(vid.duration);
        const m = Math.floor(dur / 60);
        const s = dur % 60;
        
        document.getElementById('fileMeta').textContent = 
            formatBytes(file.size) + ' · ' +
            file.type.replace('video/', '').toUpperCase() + ' · ' +
            m + ':' + String(s).padStart(2, '0');
    };

    vid.onerror = () => URL.revokeObjectURL(url);

    loadFFmpeg();
}

// ====================== Compresión ======================

async function startCompress() {
    hideError();
    if (!currentFile) return;

    if (!loaded) {
        await loadFFmpeg();
        if (!loaded) return;
    }

    const btn = document.getElementById('compressBtn');
    btn.disabled = true;

    document.getElementById('previewSection').style.display = 'none';
    document.getElementById('progressSection').style.display = 'block';
    document.getElementById('resultSection').style.display = 'none';

    setProgress(0, 'Leyendo archivo…');

    try {
        const quality = document.getElementById('qualitySlider').value;
        const res = document.getElementById('resSelect').value;
        const fps = document.getElementById('fpsSelect').value;
        const format = document.getElementById('formatSelect').value;
        const audioBitrate = document.getElementById('audioBitrate').value;
        const crf = qualityCRF[quality];

        const ext = currentFile.name.split('.').pop().toLowerCase();
        const inputName = 'input.' + (ext || 'mp4');
        const outputName = 'output.' + format;

        setProgress(5, 'Cargando video en memoria…');
        await ffmpeg.writeFile(inputName, await fetchFile(currentFile));

        const args = ['-i', inputName];

        // Codec de video
        if (format === 'webm') {
            args.push('-c:v', 'libvpx-vp9', '-crf', crf, '-b:v', '0');
        } else {
            args.push('-c:v', 'libx264', '-crf', crf, '-preset', 'fast', '-movflags', '+faststart');
        }

        // Resolución
        if (res !== 'original') {
            const [w, h] = res.split('x');
            args.push('-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`);
        }

        // FPS
        if (fps !== 'original') {
            args.push('-r', fps);
        }

        // Audio
        args.push('-c:a', format === 'webm' ? 'libopus' : 'aac', '-b:a', audioBitrate);
        args.push('-y', outputName);

        setProgress(10, 'Comprimiendo… esto puede tomar varios minutos');
        document.getElementById('progressTitle').textContent = 'Comprimiendo video…';

        await ffmpeg.exec(args);

        setProgress(95, 'Finalizando…');
        const data = await ffmpeg.readFile(outputName);

        const mimeType = format === 'webm' ? 'video/webm' : 'video/mp4';
        outputBlob = new Blob([data.buffer], { type: mimeType });

        const baseName = currentFile.name.replace(/\.[^.]+$/, '');
        outputFilename = baseName + '_compressed.' + format;

        // Cleanup
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);

        setProgress(100, 'Completado');
        showResult();

    } catch (e) {
        document.getElementById('progressSection').style.display = 'none';
        document.getElementById('previewSection').style.display = 'block';
        showError('Error durante la compresión: ' + e.message);
        btn.disabled = false;
    }
}

function showResult() {
    document.getElementById('progressSection').style.display = 'none';
    document.getElementById('resultSection').style.display = 'block';

    const origSize = currentFile.size;
    const newSize = outputBlob.size;
    const saved = Math.round((1 - newSize / origSize) * 100);

    document.getElementById('rOrigSize').textContent = formatBytes(origSize);
    document.getElementById('rNewSize').textContent = formatBytes(newSize);
    document.getElementById('rSaved').textContent = (saved > 0 ? '-' : '+') + Math.abs(saved) + '%';

    const url = URL.createObjectURL(outputBlob);
    const dl = document.getElementById('downloadLink');
    dl.href = url;
    dl.download = outputFilename;

    dl.innerHTML = `
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
        </svg>
        Descargar (${formatBytes(newSize)})
    `;

    const quality = document.getElementById('qualitySlider').value;
    document.getElementById('resultSub').textContent = 
        `Calidad: ${qualityLabels[quality]} · Formato: ${document.getElementById('formatSelect').value.toUpperCase()}`;
}

function resetAll() {
    currentFile = null;
    outputBlob = null;
    window._duration = null;

    document.getElementById('dropzone').style.display = 'block';
    document.getElementById('previewSection').style.display = 'none';
    document.getElementById('progressSection').style.display = 'none';
    document.getElementById('resultSection').style.display = 'none';
    document.getElementById('fileInput').value = '';
    document.getElementById('compressBtn').disabled = false;

    document.getElementById('progressTitle').textContent = 'Procesando video…';
    document.getElementById('origSize').textContent = '—';
    document.getElementById('estSize').textContent = '—';
    document.getElementById('savings').textContent = '—';

    hideError();
    setProgress(0, '');
}

// ====================== Inicialización ======================

document.addEventListener('DOMContentLoaded', () => {
    initDragAndDrop();
    
    // Inicializar calidad
    updateQuality(document.getElementById('qualitySlider').value);
});