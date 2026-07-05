"use client";

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';

const formatVolume = (vol) => {
    const num = typeof vol === 'string' ? parseFloat(vol) : vol;
    if (isNaN(num)) return vol;
    return num.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatLevel = (lvl) => {
    const num = typeof lvl === 'string' ? parseInt(lvl) : lvl;
    if (isNaN(num)) return lvl;
    return num.toLocaleString('id-ID');
};

export default function CombineTank() {
    const [strappingFile, setStrappingFile] = useState(null);
    const [fractionFile, setFractionFile] = useState(null);
    const [strappingRaw, setStrappingRaw] = useState(null);
    const [fractionRaw, setFractionRaw] = useState(null);
    const [tankName, setTankName] = useState("");
    const [strappingPreview, setStrappingPreview] = useState([]);
    const [fractionPreview, setFractionPreview] = useState([]);
    
    const [isDragOverStrapping, setIsDragOverStrapping] = useState(false);
    const [isDragOverFraction, setIsDragOverFraction] = useState(false);

    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressText, setProgressText] = useState("");
    const [combinedData, setCombinedData] = useState([]);
    
    const [searchQuery, setSearchQuery] = useState("");
    const [tooltipInfo, setTooltipInfo] = useState(null);
    const [chartMode, setChartMode] = useState('normal'); // 'normal' | 'zoom'
    
    const canvasRef = useRef(null);

    const extractTankName = (fileName) => {
        const match = fileName.match(/(\d+T\d+|tank\d+|tank_\d+)/i);
        return match ? match[1] : "";
    };

    const handleDragOver = (e, setDragState) => { e.preventDefault(); e.stopPropagation(); setDragState(true); };
    const handleDragLeave = (e, setDragState) => { e.preventDefault(); e.stopPropagation(); setDragState(false); };
    const handleDrop = (e, setDragState, setFile, setRaw, expectedType) => {
        e.preventDefault(); e.stopPropagation(); setDragState(false);
        const file = e.dataTransfer.files[0];
        if (file) processFile(file, setFile, setRaw, expectedType);
    };
    const handleFileChange = (e, setFile, setRaw, expectedType) => {
        const file = e.target.files[0];
        if (file) processFile(file, setFile, setRaw, expectedType);
    };

    const processFile = (file, setFile, setRaw, expectedType) => {
        const fileName = file.name.toLowerCase();
        if (expectedType === 'strapping') {
            if (!fileName.endsWith('.csv')) {
                alert("File Strapping harus berformat CSV (.csv)!");
                return;
            }
            const detected = extractTankName(file.name);
            if (detected) setTankName(detected);
        } else if (expectedType === 'fraction') {
            const allowed = ['.xls', '.xlsx', '.html', '.htm'];
            const isValid = allowed.some(ext => fileName.endsWith(ext));
            if (!isValid) {
                alert("File Fraction harus berformat Excel atau HTML (.xls, .xlsx, .html)!");
                return;
            }
            const detected = extractTankName(file.name);
            if (detected) setTankName(detected);
        }
        
        setFile(file);
        const reader = new FileReader();
        reader.onload = (ev) => { setRaw(ev.target.result); };
        reader.readAsText(file);
    };

    const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 15));

    const parseStrapping = (csvText) => {
        const lines = csvText.split('\n');
        const map = new Map();
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const parts = line.split(/[;,]/);
            if (parts.length >= 2) {
                const rawCm = parts[0].trim();
                const rawVol = parts[1].trim();
                
                if (/^\d+(\.\d+)?$/.test(rawCm) && /^\d+(\.\d+)?$/.test(rawVol)) {
                    const cm = parseFloat(rawCm);
                    const vol = parseFloat(rawVol);
                    if (cm < 10000) { map.set(cm, vol); }
                }
            }
        }
        return map;
    };

    const parseFraction = (htmlText) => {
        const rules = [];
        let tankNo = "";
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const rows = doc.querySelectorAll('tr');
        rows.forEach(row => {
            const cols = row.querySelectorAll('td, th');
            if (cols.length >= 6) {
                const rowTexts = Array.from(cols).map(c => c.innerText.trim().toLowerCase());
                if (rowTexts.includes('dari')) return;
                let dariStr = cols[2].innerText.trim();
                let sampaiStr = cols[3].innerText.trim();
                let tinggiStr = cols[4].innerText.trim();
                let volStr = cols[5].innerText.trim();
                
                const dari = parseFloat(dariStr.replace(/,/g, ''));
                const sampai = parseFloat(sampaiStr.replace(/,/g, ''));
                const tinggi = parseInt(tinggiStr.replace(/,/g, ''));
                const vol = parseFloat(volStr.replace(/,/g, ''));
                
                if (!isNaN(dari) && !isNaN(sampai) && !isNaN(tinggi) && !isNaN(vol)) {
                    const minCm = Math.ceil(dari); 
                    const maxCm = Math.floor(sampai);
                    rules.push({ minCm, maxCm, offset_mm: tinggi, volume_tambahan: vol });
                    
                    if (!tankNo && cols[1]) {
                        const candidate = cols[1].innerText.trim();
                        if (candidate && candidate.toLowerCase() !== 'tank_no') {
                            tankNo = candidate;
                        }
                    }
                }
            }
        });
        return { rules, tankNo };
    };

    const handleProcess = async () => {
        try {
            setIsProcessing(true);
            setCombinedData([]);
            setTooltipInfo(null);
            setStrappingPreview([]);
            setFractionPreview([]);
            
            setProgress(5);
            setProgressText("Membaca File Strapping...");
            await yieldToMain();
            const strappingMap = parseStrapping(strappingRaw);

            if (strappingMap.size === 0) throw new Error("Data Strapping kosong atau format tidak sesuai (Tinggi;Volume).");

            setProgress(15);
            setProgressText("Membaca File Fraction...");
            await yieldToMain();
            const { rules: fractionRules, tankNo } = parseFraction(fractionRaw);
            if (tankNo && !tankName) setTankName(tankNo);
            
            if (fractionRules.length === 0) {
                throw new Error("Data Fraction kosong atau format tidak sesuai (dari;sampai;tinggi;volume). Pastikan formatnya benar.");
            }
            
            setProgress(25);
            setProgressText("Mempersiapkan indeks data...");
            await yieldToMain();

            const fractionLookup = {};
            fractionRules.forEach(r => {
                for (let cm = r.minCm; cm <= r.maxCm; cm++) {
                    if (!fractionLookup[cm]) fractionLookup[cm] = {};
                    fractionLookup[cm][r.offset_mm] = r.volume_tambahan;
                }
            });
            
            let minCm = Infinity, maxCm = -Infinity;
            for (let cm of strappingMap.keys()) {
                if (cm < minCm) minCm = cm;
                if (cm > maxCm) maxCm = cm;
            }

            const results = [];
            const chunkSize = 40; 
            const totalItems = maxCm - minCm + 1;
            const totalChunks = Math.ceil(totalItems / chunkSize);
            const startTime = performance.now();

            for (let i = 0; i < totalChunks; i++) {
                const startCm = minCm + (i * chunkSize);
                const endCm = Math.min(startCm + chunkSize - 1, maxCm);
                
                for (let cm = startCm; cm <= endCm; cm++) {
                    if (strappingMap.has(cm)) {
                        const baseVolume = strappingMap.get(cm);
                        results.push({ level_mm: cm * 10, volume: baseVolume.toFixed(2) });
                        if (cm < maxCm) {
                            const cmFraction = fractionLookup[cm] || {};
                            for (let mm = 1; mm <= 9; mm++) {
                                const addVol = cmFraction[mm] || 0;
                                const totalVolume = baseVolume + addVol;
                                results.push({ level_mm: (cm * 10) + mm, volume: totalVolume.toFixed(2) });
                            }
                        }
                    }
                }
                
                const elapsed = (performance.now() - startTime) / 1000;
                const ratio = (i + 1) / totalChunks;
                const eta = Math.max(0, (elapsed / ratio) - elapsed);
                const currentProgress = 25 + Math.round(ratio * 60);
                
                setProgress(currentProgress);
                setProgressText(`Menggabungkan data (${currentProgress}%)... Estimasi sisa waktu: ${eta.toFixed(1)} detik.`);
                await yieldToMain();
            }

            // Calculate delta
            for (let idx = 0; idx < results.length; idx++) {
                const currentVol = parseFloat(results[idx].volume);
                let delta = 0;
                if (idx > 0) {
                    const prevVol = parseFloat(results[idx - 1].volume);
                    delta = currentVol - prevVol;
                }
                results[idx].delta = delta.toFixed(2);
            }

            // Set strapping preview
            const strapArray = [];
            let strapCount = 0;
            for (let [cm, vol] of strappingMap.entries()) {
                if (strapCount >= 5) break;
                strapArray.push({ cm, vol });
                strapCount++;
            }
            setStrappingPreview(strapArray);

            // Set fraction preview
            setFractionPreview(fractionRules.slice(0, 5));

            setProgress(90);
            setProgressText("Menyiapkan Tampilan Tabel & Grafik...");
            await yieldToMain();
            
            setCombinedData(results);
            setProgress(100);
            setProgressText("Selesai!");
            
            setTimeout(() => { setIsProcessing(false); }, 800);

        } catch (error) {
            alert("Kesalahan: " + error.message);
            setIsProcessing(false);
        }
    };

    const handleExport = () => {
        if (combinedData.length === 0) return;
        
        const data = [
            [`DATA ROAS TANGKI ${tankName ? tankName.toUpperCase() : '...'} LEVEL VS VOLUME`, '', '', ''],
            [],
            ['Level (mm)', 'Nama Tangki', 'Volume', 'Delta']
        ];
        
        combinedData.forEach(r => {
            data.push([
                parseInt(r.level_mm),
                tankName || '',
                parseFloat(r.volume),
                parseFloat(r.delta || 0)
            ]);
        });
        
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(data);
        
        ws['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }
        ];
        
        // Format columns
        for (let r = 3; r < data.length; r++) {
            const levelCellRef = XLSX.utils.encode_cell({ r, c: 0 });
            const volumeCellRef = XLSX.utils.encode_cell({ r, c: 2 });
            const deltaCellRef = XLSX.utils.encode_cell({ r, c: 3 });
            
            if (ws[levelCellRef]) {
                ws[levelCellRef].z = '#,##0';
            }
            if (ws[volumeCellRef]) {
                ws[volumeCellRef].z = '#,##0.00';
            }
            if (ws[deltaCellRef]) {
                ws[deltaCellRef].z = '#,##0.00';
            }
        }
        
        XLSX.utils.book_append_sheet(wb, ws, 'Combined Data');
        XLSX.writeFile(wb, `Combined_Strapping_Tank_${tankName || 'Full'}_MM.xlsx`);
    };

    const filteredData = useMemo(() => {
        if (!searchQuery) return combinedData;
        const query = searchQuery.toLowerCase();
        return combinedData.filter(d => {
            const formattedVol = formatVolume(d.volume);
            const formattedLvl = formatLevel(d.level_mm);
            const formattedDelta = formatVolume(d.delta);
            return d.level_mm.toString().includes(query) || 
                   d.volume.toString().includes(query) ||
                   formattedVol.includes(query) ||
                   formattedLvl.includes(query) ||
                   formattedDelta.includes(query) ||
                   (tankName && tankName.toLowerCase().includes(query));
        });
    }, [combinedData, searchQuery, tankName]);

    const drawChart = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || combinedData.length < 2) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.offsetWidth;
        const height = canvas.offsetHeight;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        // Prepare delta data
        const deltaData = [];
        let sumDelta = 0;
        for (let i = 1; i < combinedData.length; i++) {
            const dV = parseFloat(combinedData[i].volume) - parseFloat(combinedData[i-1].volume);
            deltaData.push({ level_mm: combinedData[i].level_mm, delta_vol: dV });
            sumDelta += dV;
        }

        const avgDelta = sumDelta / deltaData.length;
        // Detect anomalies (>2% deviation from average)
        deltaData.forEach(d => {
            d.isAnomaly = Math.abs(d.delta_vol - avgDelta) / avgDelta > 0.02; 
        });

        const maxDelta = Math.max(...deltaData.map(d => d.delta_vol));
        let minDeltaDraw = 0;
        let maxDeltaDraw = maxDelta;

        if (chartMode === 'zoom') {
            const minD = Math.min(...deltaData.map(d => d.delta_vol));
            const range = maxDelta - minD;
            minDeltaDraw = Math.max(0, minD - range * 0.1); 
            // Give 10% padding
        }

        const deltaRange = maxDeltaDraw - minDeltaDraw;

        const minLevel = deltaData[0].level_mm;
        const maxLevel = deltaData[deltaData.length - 1].level_mm;
        const paddingY = 40;
        const paddingX = 40;

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px Inter';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        const lines = 10;
        for(let i=0; i<=lines; i++) {
            const y = height - paddingY - (i / lines) * (height - paddingY * 2);
            const lblLevel = Math.round(minLevel + (i / lines) * (maxLevel - minLevel));
            ctx.beginPath();
            ctx.moveTo(paddingX, y);
            ctx.lineTo(width - paddingX, y);
            ctx.stroke();
            ctx.fillText(lblLevel + 'mm', paddingX - 10, y);
        }

        // Title
        ctx.textAlign = 'center';
        ctx.fillText("Tank Silhouette (Δ Volume per mm)", width/2, 15);

        // Draw Tank Silhouette
        const halfW = (width - paddingX * 2) / 2;
        const getY = (level) => height - paddingY - ((level - minLevel) / (maxLevel - minLevel)) * (height - paddingY * 2);
        
        const getXOffset = (delta) => {
            if (delta < minDeltaDraw) return 0;
            return ((delta - minDeltaDraw) / deltaRange) * halfW;
        };

        // Base tank (normal data)
        ctx.beginPath();
        const fillGradient = ctx.createLinearGradient(0, height, 0, 0);
        fillGradient.addColorStop(0, 'rgba(16, 185, 129, 0.4)'); 
        fillGradient.addColorStop(1, 'rgba(59, 130, 246, 0.4)'); 
        ctx.fillStyle = fillGradient;
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 1;

        ctx.moveTo(width / 2, getY(minLevel));
        deltaData.forEach(d => {
            if (!d.isAnomaly) ctx.lineTo(width / 2 - getXOffset(d.delta_vol), Math.max(paddingY, Math.min(height - paddingY, getY(d.level_mm))));
        });
        for (let i = deltaData.length - 1; i >= 0; i--) {
            const d = deltaData[i];
            if (!d.isAnomaly) ctx.lineTo(width / 2 + getXOffset(d.delta_vol), Math.max(paddingY, Math.min(height - paddingY, getY(d.level_mm))));
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Draw Anomalies (Red Spikes)
        ctx.fillStyle = 'rgba(239, 68, 68, 0.8)'; // Red
        ctx.strokeStyle = '#f87171'; // Lighter red
        deltaData.forEach((d, i) => {
            if (d.isAnomaly) {
                const y = Math.max(paddingY, Math.min(height - paddingY, getY(d.level_mm)));
                const offset = getXOffset(d.delta_vol);
                const rectHeight = 3; // make it slightly thick to be visible
                
                ctx.beginPath();
                // Draw line across the entire width of the tank at that level
                ctx.rect(width / 2 - offset, y - rectHeight/2, offset * 2, rectHeight);
                ctx.fill();
                ctx.stroke();
            }
        });

        // Center line
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.setLineDash([5, 5]);
        ctx.moveTo(width / 2, height - paddingY);
        ctx.lineTo(width / 2, paddingY);
        ctx.stroke();
        ctx.setLineDash([]);

    }, [combinedData, chartMode]);

    useEffect(() => {
        if (combinedData.length > 0 && !isProcessing) {
            drawChart();
            window.addEventListener('resize', drawChart);
            return () => window.removeEventListener('resize', drawChart);
        }
    }, [combinedData, isProcessing, drawChart]);

    const handleCanvasMouseMove = (e) => {
        if (combinedData.length < 2) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const y = e.clientY - rect.top;
        
        const height = canvasRef.current.offsetHeight;
        const paddingY = 40;
        const minLevel = combinedData[1].level_mm;
        const maxLevel = combinedData[combinedData.length - 1].level_mm;
        
        if (y < paddingY || y > height - paddingY) {
            setTooltipInfo(null);
            return;
        }

        const ratio = (height - paddingY - y) / (height - paddingY * 2);
        const hoverLevel = minLevel + ratio * (maxLevel - minLevel);
        
        // Binary search
        let left = 1;
        let right = combinedData.length - 1;
        let bestIdx = 1;
        
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (combinedData[mid].level_mm === Math.round(hoverLevel)) {
                bestIdx = mid; break;
            } else if (combinedData[mid].level_mm < hoverLevel) {
                bestIdx = mid; left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        
        const delta = parseFloat(combinedData[bestIdx].volume) - parseFloat(combinedData[bestIdx - 1].volume);
        
        setTooltipInfo({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            level: combinedData[bestIdx].level_mm,
            delta: delta.toFixed(2),
            volume: combinedData[bestIdx].volume
        });
    };

    return (
        <div style={styles.container}>
            <header style={styles.header}>
                <h1 style={styles.title}>Strapping & Fraction Combiner</h1>
                <p style={styles.subtitle}>Deteksi anomali data melalui grafik Tank Silhouette.</p>
            </header>

            <div style={styles.glassPanel}>
                <div style={styles.uploadGrid}>
                    <div 
                        style={{ ...styles.fileDrop, ...(isDragOverStrapping ? styles.fileDropActive : {}) }}
                        onDragOver={(e) => handleDragOver(e, setIsDragOverStrapping)}
                        onDragLeave={(e) => handleDragLeave(e, setIsDragOverStrapping)}
                        onDrop={(e) => handleDrop(e, setIsDragOverStrapping, setStrappingFile, setStrappingRaw, 'strapping')}
                    >
                        <span style={styles.fileLabel}>📁 1. Drop / Pilih File Strapping (CSV)</span>
                        <p style={styles.fileHint}>Format: Tinggi(cm);Volume</p>
                        <input type="file" accept=".csv" style={styles.fileInput} onChange={(e) => handleFileChange(e, setStrappingFile, setStrappingRaw, 'strapping')} />
                        <div style={{ ...styles.fileStatus, color: strappingFile ? '#10b981' : '#94a3b8' }}>
                            {strappingFile ? `File Siap: ${strappingFile.name}` : 'Belum ada file.'}
                        </div>
                    </div>

                    <div 
                        style={{ ...styles.fileDrop, ...(isDragOverFraction ? styles.fileDropActive : {}) }}
                        onDragOver={(e) => handleDragOver(e, setIsDragOverFraction)}
                        onDragLeave={(e) => handleDragLeave(e, setIsDragOverFraction)}
                        onDrop={(e) => handleDrop(e, setIsDragOverFraction, setFractionFile, setFractionRaw, 'fraction')}
                    >
                        <span style={styles.fileLabel}>📁 2. Drop / Pilih File Fraction (XLS)</span>
                        <p style={styles.fileHint}>Format: Export HTML (dari;sampai;tinggi;volume)</p>
                        <input type="file" accept=".xls,.xlsx,.html,.htm" style={styles.fileInput} onChange={(e) => handleFileChange(e, setFractionFile, setFractionRaw, 'fraction')} />
                        <div style={{ ...styles.fileStatus, color: fractionFile ? '#10b981' : '#94a3b8' }}>
                            {fractionFile ? `File Siap: ${fractionFile.name}` : 'Belum ada file.'}
                        </div>
                    </div>
                </div>

                {isProcessing && (
                    <div style={styles.progressWrapper}>
                        <div style={styles.progressText}>{progressText}</div>
                        <div style={styles.progressContainer}>
                            <div style={{ ...styles.progressBar, width: `${progress}%` }}></div>
                        </div>
                    </div>
                )}

                <button 
                    style={{ ...styles.btnProcess, ...(!(strappingRaw && fractionRaw) || isProcessing ? styles.btnDisabled : {}) }}
                    disabled={!(strappingRaw && fractionRaw) || isProcessing}
                    onClick={handleProcess}
                >
                    {isProcessing ? 'Memproses...' : (combinedData.length > 0 ? 'Proses Ulang Data' : 'Proses & Gabungkan Data')}
                </button>
            </div>

            {combinedData.length > 0 && !isProcessing && (
                <div style={styles.glassPanel}>
                    <div style={styles.toolbar}>
                        <input 
                            type="text" 
                            placeholder="Cari Level (mm) atau Volume..." 
                            style={styles.searchBox}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Nama Tangki:</span>
                            <input 
                                type="text" 
                                placeholder="31T003..." 
                                style={{ ...styles.searchBox, maxWidth: '120px', padding: '0.75rem 1rem' }}
                                value={tankName}
                                onChange={(e) => setTankName(e.target.value)}
                            />
                        </div>
                        <button style={styles.btnExport} onClick={handleExport}>
                            Export to Excel (XLS)
                        </button>
                    </div>

                    <div style={styles.contentGrid}>
                        <div style={styles.tableContainer}>
                            <table style={styles.table}>
                                <thead>
                                    <tr>
                                        <th style={styles.th}>Level (mm)</th>
                                        <th style={styles.th}>Nama Tangki</th>
                                        <th style={styles.th}>Volume</th>
                                        <th style={styles.th}>Delta</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredData.length === 0 && (
                                        <tr><td colSpan="4" style={styles.tdCenter}>Data tidak ditemukan.</td></tr>
                                    )}
                                    {filteredData.slice(0, 300).map((row, idx) => (
                                        <tr key={idx} style={styles.tr}>
                                            <td style={styles.td}>{formatLevel(row.level_mm)}</td>
                                            <td style={styles.td}>{tankName || "-"}</td>
                                            <td style={styles.tdSuccess}>{formatVolume(row.volume)}</td>
                                            <td style={styles.td}>{formatVolume(row.delta)}</td>
                                        </tr>
                                    ))}
                                    {filteredData.length > 300 && (
                                        <tr>
                                            <td colSpan="4" style={styles.tdCenter}>
                                                Menampilkan 300 dari total {filteredData.length} baris.<br/>
                                                <em style={{opacity:0.7}}>Gunakan kotak pencarian di atas untuk mencari angka spesifik.</em>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        
                        <div style={styles.chartWrapper}>
                            <div style={styles.chartControls}>
                                <button 
                                    style={{ ...styles.btnMode, ...(chartMode === 'normal' ? styles.btnModeActive : {}) }}
                                    onClick={() => setChartMode('normal')}
                                >
                                    Mode Normal
                                </button>
                                <button 
                                    style={{ ...styles.btnMode, ...(chartMode === 'zoom' ? styles.btnModeActive : {}) }}
                                    onClick={() => setChartMode('zoom')}
                                >
                                    🔍 Mode Kaca Pembesar
                                </button>
                            </div>
                            <div style={styles.chartContainer}>
                                <canvas 
                                    ref={canvasRef} 
                                    style={{ width: '100%', height: '100%', cursor: 'crosshair' }}
                                    onMouseMove={handleCanvasMouseMove}
                                    onMouseLeave={() => setTooltipInfo(null)}
                                ></canvas>
                                {tooltipInfo && (
                                    <div style={{
                                        position: 'absolute',
                                        left: tooltipInfo.x + 15,
                                        top: tooltipInfo.y - 15,
                                        background: 'rgba(15, 23, 42, 0.95)',
                                        border: '1px solid rgba(255,255,255,0.2)',
                                        padding: '8px 12px',
                                        borderRadius: '6px',
                                        pointerEvents: 'none',
                                        fontSize: '0.85rem',
                                        zIndex: 100,
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                                        whiteSpace: 'nowrap'
                                    }}>
                                        <div style={{ color: '#94a3b8', marginBottom: '4px' }}>Level: <strong style={{ color: 'white' }}>{tooltipInfo.level} mm</strong></div>
                                        <div style={{ color: '#94a3b8', marginBottom: '4px' }}>Δ Volume: <strong style={{ color: '#ef4444' }}>{formatVolume(tooltipInfo.delta)} KL/mm</strong></div>
                                        <div style={{ color: '#94a3b8' }}>Total Vol: <strong style={{ color: '#10b981' }}>{formatVolume(tooltipInfo.volume)}</strong></div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {combinedData.length > 0 && !isProcessing && strappingPreview.length > 0 && (
                <div style={styles.glassPanel}>
                    <h3 style={{ color: '#f8fafc', marginBottom: '1.2rem', fontWeight: '600', fontSize: '1.2rem' }}>📄 Preview Data Input</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
                        <div>
                            <h4 style={{ color: '#60a5fa', marginBottom: '0.5rem', fontSize: '0.95rem' }}>File 1: Data Strapping (5 Baris Pertama)</h4>
                            <div style={styles.tableContainerPreview}>
                                <table style={styles.table}>
                                    <thead>
                                        <tr>
                                            <th style={styles.thPreview}>Tinggi (cm)</th>
                                            <th style={styles.thPreview}>Volume</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {strappingPreview.map((row, idx) => (
                                            <tr key={idx} style={styles.tr}>
                                                <td style={styles.tdPreview}>{row.cm} cm</td>
                                                <td style={styles.tdPreview}>{row.vol.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div>
                            <h4 style={{ color: '#10b981', marginBottom: '0.5rem', fontSize: '0.95rem' }}>File 2: Data Fraction (5 Baris Pertama)</h4>
                            <div style={styles.tableContainerPreview}>
                                <table style={styles.table}>
                                    <thead>
                                        <tr>
                                            <th style={styles.thPreview}>Dari (cm)</th>
                                            <th style={styles.thPreview}>Sampai (cm)</th>
                                            <th style={styles.thPreview}>Offset (mm)</th>
                                            <th style={styles.thPreview}>Vol Tambahan</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {fractionPreview.map((row, idx) => (
                                            <tr key={idx} style={styles.tr}>
                                                <td style={styles.tdPreview}>{row.minCm}</td>
                                                <td style={styles.tdPreview}>{row.maxCm}</td>
                                                <td style={styles.tdPreview}>{row.offset_mm}</td>
                                                <td style={styles.tdPreview}>{row.volume_tambahan.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const styles = {
    container: {
        fontFamily: '"Inter", sans-serif',
        background: 'linear-gradient(135deg, #0f172a 0%, #020617 100%)',
        color: '#f8fafc',
        minHeight: '100vh',
        padding: '2rem',
        boxSizing: 'border-box',
    },
    header: {
        textAlign: 'center',
        marginBottom: '2rem',
    },
    title: {
        fontSize: '2.5rem',
        fontWeight: '700',
        background: 'linear-gradient(to right, #60a5fa, #3b82f6)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        margin: '0 0 0.5rem 0',
    },
    subtitle: {
        color: '#94a3b8',
        margin: 0,
    },
    glassPanel: {
        background: 'rgba(30, 41, 59, 0.7)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        padding: '2rem',
        boxShadow: '0 4px 30px rgba(0, 0, 0, 0.1)',
        marginBottom: '2rem',
        maxWidth: '1200px',
        marginLeft: 'auto',
        marginRight: 'auto',
    },
    uploadGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '1.5rem',
        marginBottom: '1.5rem',
    },
    fileDrop: {
        border: '2px dashed rgba(255, 255, 255, 0.2)',
        borderRadius: '12px',
        padding: '2rem',
        textAlign: 'center',
        transition: 'all 0.3s ease',
        cursor: 'pointer',
        position: 'relative',
        background: 'rgba(255,255,255,0.02)',
    },
    fileDropActive: {
        borderColor: '#3b82f6',
        background: 'rgba(59, 130, 246, 0.1)',
        transform: 'scale(1.02)',
    },
    fileInput: {
        position: 'absolute',
        top: 0, left: 0, width: '100%', height: '100%',
        opacity: 0, cursor: 'pointer',
    },
    fileLabel: {
        fontWeight: '600',
        display: 'block',
        marginBottom: '0.5rem',
        pointerEvents: 'none',
    },
    fileHint: {
        fontSize: '0.85rem',
        color: '#94a3b8',
        margin: 0,
        pointerEvents: 'none',
    },
    fileStatus: {
        fontSize: '0.85rem',
        marginTop: '0.5rem',
        pointerEvents: 'none',
    },
    btnProcess: {
        width: '100%',
        padding: '1rem',
        background: 'linear-gradient(to right, #3b82f6, #2563eb)',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        fontSize: '1.1rem',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        boxShadow: '0 4px 15px rgba(59, 130, 246, 0.3)',
    },
    btnDisabled: {
        background: '#475569',
        cursor: 'not-allowed',
        boxShadow: 'none',
        opacity: 0.7,
    },
    progressWrapper: {
        marginBottom: '1rem',
    },
    progressText: {
        textAlign: 'center',
        fontSize: '0.9rem',
        color: '#94a3b8',
        marginBottom: '0.5rem',
    },
    progressContainer: {
        width: '100%',
        height: '8px',
        background: 'rgba(255,255,255,0.1)',
        borderRadius: '4px',
        overflow: 'hidden',
    },
    progressBar: {
        height: '100%',
        background: 'linear-gradient(90deg, #3b82f6, #10b981)',
        transition: 'width 0.3s ease',
    },
    toolbar: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
        gap: '1rem',
    },
    searchBox: {
        padding: '0.75rem 1rem',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        background: 'rgba(0,0,0,0.2)',
        color: 'white',
        width: '100%',
        maxWidth: '300px',
        fontFamily: '"Inter", sans-serif',
        outline: 'none',
    },
    btnExport: {
        padding: '0.75rem 1.5rem',
        background: '#10b981',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
    },
    contentGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '1.5rem',
    },
    tableContainer: {
        height: '600px',
        overflowY: 'auto',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        background: 'rgba(0,0,0,0.2)',
    },
    table: {
        width: '100%',
        borderCollapse: 'collapse',
        textAlign: 'left',
    },
    th: {
        position: 'sticky',
        top: 0,
        background: '#1e293b',
        padding: '1rem',
        fontWeight: '600',
        color: '#94a3b8',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        zIndex: 10,
    },
    tr: {
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    },
    td: {
        padding: '0.75rem 1rem',
        fontFamily: 'monospace',
        fontWeight: '500',
    },
    tdSuccess: {
        padding: '0.75rem 1rem',
        fontFamily: 'monospace',
        fontWeight: '600',
        color: '#10b981',
    },
    tdCenter: {
        padding: '1.5rem',
        textAlign: 'center',
        color: '#94a3b8',
    },
    chartWrapper: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
    },
    chartControls: {
        display: 'flex',
        gap: '0.5rem',
    },
    btnMode: {
        flex: 1,
        padding: '0.5rem',
        background: 'rgba(0,0,0,0.3)',
        color: '#94a3b8',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '8px',
        cursor: 'pointer',
        fontWeight: '500',
        transition: 'all 0.3s',
    },
    btnModeActive: {
        background: 'rgba(59, 130, 246, 0.2)',
        color: '#60a5fa',
        borderColor: '#3b82f6',
    },
    chartContainer: {
        background: 'rgba(0,0,0,0.2)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '8px',
        height: '560px',
        position: 'relative',
        overflow: 'hidden'
    },
    tableContainerPreview: {
        maxHeight: '220px',
        overflowY: 'auto',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        background: 'rgba(0,0,0,0.2)',
    },
    thPreview: {
        position: 'sticky',
        top: 0,
        background: '#1e293b',
        padding: '0.5rem 0.75rem',
        fontWeight: '600',
        color: '#94a3b8',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        fontSize: '0.85rem',
    },
    tdPreview: {
        padding: '0.5rem 0.75rem',
        fontFamily: 'monospace',
        fontSize: '0.85rem',
    }
};
