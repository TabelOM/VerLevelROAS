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
    const [isDragOver, setIsDragOver] = useState(false);
    const [uploadError, setUploadError] = useState("");
    
    

    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressText, setProgressText] = useState("");
    const [combinedData, setCombinedData] = useState([]);
    
    const [searchQuery, setSearchQuery] = useState("");
    const [tooltipInfo, setTooltipInfo] = useState(null);
    const [chartMode, setChartMode] = useState('normal'); // 'normal' | 'zoom'
    const [anomalySort, setAnomalySort] = useState({ key: null, direction: 'asc' });
    
    // Interactive Zoom states
    const [zoomScaleY, setZoomScaleY] = useState(1);
    const [scrollYOffset, setScrollYOffset] = useState(0); 
    const [isDragging, setIsDragging] = useState(false);
    const [dragStartMouseY, setDragStartMouseY] = useState(0);
    const [dragStartScrollY, setDragStartScrollY] = useState(0);

    const canvasRef = useRef(null);

    const extractTankName = (fileName) => {
        const match = fileName.match(/(\d+T\d+|tank\d+|tank_\d+)/i);
        return match ? match[1] : "";
    };

    const handleReset = () => {
        setStrappingFile(null);
        setFractionFile(null);
        setStrappingRaw(null);
        setFractionRaw(null);
        setTankName("");
        setCombinedData([]);
        setStrappingPreview([]);
        setFractionPreview([]);
        setUploadError("");
        setTooltipInfo(null);
        setProgress(0);
        setProgressText("");
    };

    const handleFiles = (files) => {
        let invalidFiles = [];

        Array.from(files).forEach(file => {
            const fileName = file.name.toLowerCase();
            
            if (fileName.match(/\.(csv|xls|xlsx|html|htm)$/)) {
                const reader = new FileReader();
                reader.onload = (ev) => { 
                    const content = ev.target.result;
                    const textLower = content.toLowerCase();
                    
                    const isCSV = fileName.endsWith('.csv');
                    const hasDari = textLower.includes('dari') && textLower.includes('sampai');
                    
                    if (isCSV || !hasDari) {
                        setStrappingFile(file);
                        setStrappingRaw(content);
                        const d = extractTankName(file.name);
                        if (d) setTankName(prev => prev || d);
                    } else {
                        setFractionFile(file);
                        setFractionRaw(content);
                        const d = extractTankName(file.name);
                        if (d) setTankName(prev => prev || d);
                    }
                };
                reader.readAsText(file);
            } else {
                invalidFiles.push(file.name);
            }
        });

        if (invalidFiles.length > 0) {
            setUploadError(`Format tidak sesuai: ${invalidFiles.join(', ')}. Gunakan CSV (.csv) atau Excel/HTML (.xls, .xlsx, .html).`);
        } else {
            setUploadError("");
        }
    };

    const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 15));

    const parseStrapping = (text) => {
        const map = new Map();
        let lastCm = -1;
        let tankNo = "";

        if (text.trim().toLowerCase().startsWith('<table') || text.toLowerCase().includes('<th')) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');
            const rows = doc.querySelectorAll('tr');
            
            rows.forEach(row => {
                const cols = row.querySelectorAll('td, th');
                if (cols.length >= 2) {
                    const rowTexts = Array.from(cols).map(c => (c.textContent || '').trim().toLowerCase());
                    if (rowTexts.includes('tinggi')) return; 
                    
                    let tinggiStr = (cols[cols.length - 2].textContent || '').trim();
                    let volStr = (cols[cols.length - 1].textContent || '').trim();
                    
                    const cm = parseFloat(tinggiStr.replace(/,/g, ''));
                    const vol = parseFloat(volStr.replace(/,/g, ''));
                    
                    if (!isNaN(cm) && !isNaN(vol) && cm < 10000 && cm > lastCm) {
                        map.set(cm, vol);
                        lastCm = cm;
                        
                        if (!tankNo && cols.length >= 4) {
                            const possibleTank = (cols[1].textContent || '').trim();
                            if (possibleTank.match(/\d+T\d+/i)) tankNo = possibleTank;
                        }
                    }
                }
            });
        } else {
            const lines = text.split('\n');
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
                        if (cm < 10000 && cm > lastCm) {
                            map.set(cm, vol);
                            lastCm = cm;
                        }
                    }
                }
            }
        }
        return { map, tankNo };
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
                const rowTexts = Array.from(cols).map(c => (c.textContent || '').trim().toLowerCase());
                if (rowTexts.includes('dari')) return;
                let dariStr = (cols[2].textContent || '').trim();
                let sampaiStr = (cols[3].textContent || '').trim();
                let tinggiStr = (cols[4].textContent || '').trim();
                let volStr = (cols[5].textContent || '').trim();
                
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
            
            let strappingMap = new Map();
            let strapTankNo = "";
            
            if (strappingRaw) {
                const parsedStrap = parseStrapping(strappingRaw);
                strappingMap = parsedStrap.map;
                strapTankNo = parsedStrap.tankNo;
                if (strappingMap.size === 0) {
                    throw new Error("Data Strapping kosong atau format tidak sesuai (Tinggi;Volume).");
                }
            }

            setProgress(15);
            setProgressText("Membaca File Fraction...");
            await yieldToMain();
            
            let fractionRules = [];
            let fracTankNo = "";
            
            if (fractionRaw) {
                const parsedFrac = parseFraction(fractionRaw);
                fractionRules = parsedFrac.rules;
                fracTankNo = parsedFrac.tankNo;
                
                if (fractionRules.length === 0) {
                    throw new Error("Data Fraction kosong atau format tidak sesuai (dari;sampai;tinggi;volume). Pastikan formatnya benar.");
                }
            }

            if (!strappingRaw && fractionRules.length === 0) {
                throw new Error("Tidak ada data yang valid untuk diproses.");
            }

            let finalTankName = strapTankNo || fracTankNo || extractTankName(strappingFile?.name || "") || extractTankName(fractionFile?.name || "");
            if (finalTankName) setTankName(finalTankName);
            
            setProgress(25);
            setProgressText("Mempersiapkan indeks data...");
            await yieldToMain();

            const fractionLookup = {};
            const cincinMap = new Map();
            let cincinCounter = 1;

            fractionRules.forEach(r => {
                const rangeKey = `${r.minCm}-${r.maxCm}`;
                if (!cincinMap.has(rangeKey)) {
                    cincinMap.set(rangeKey, cincinCounter++);
                }
                const cincinNumber = cincinMap.get(rangeKey);
                
                for (let cm = r.minCm; cm <= r.maxCm; cm++) {
                    if (!fractionLookup[cm]) fractionLookup[cm] = { offsetMap: {}, cincinNumber };
                    fractionLookup[cm].offsetMap[r.offset_mm] = r.volume_tambahan;
                    fractionLookup[cm].cincinNumber = cincinNumber;
                }
            });
            
            let minCm = Infinity, maxCm = -Infinity;
            for (let cm of strappingMap.keys()) {
                if (cm < minCm) minCm = cm;
                if (cm > maxCm) maxCm = cm;
            }
            if (strappingMap.size === 0 && fractionRules.length > 0) {
                fractionRules.forEach(r => {
                    if (r.minCm < minCm) minCm = r.minCm;
                    if (r.maxCm > maxCm) maxCm = r.maxCm;
                });
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
                    // Only process if cm is in strapping map OR if we are processing fraction-only
                    if (strappingMap.has(cm) || strappingMap.size === 0) {
                        const baseVolume = strappingMap.has(cm) ? strappingMap.get(cm) : 0;
                        const cincinInfo = fractionLookup[cm];
                        const cincinNum = cincinInfo ? cincinInfo.cincinNumber : '-';
                        
                        results.push({ 
                            level_mm: cm * 10,
                            cm: cm,
                            mm: 0,
                            baseVolume: baseVolume,
                            addVol: 0,
                            totalVolume: baseVolume,
                            cincin: cincinNum
                        });
                        
                        if (cm < maxCm && fractionRules.length > 0) {
                            const cmFraction = cincinInfo ? cincinInfo.offsetMap : {};
                            for (let mm = 1; mm <= 9; mm++) {
                                const addVol = cmFraction[mm] || 0;
                                const totalVolume = baseVolume + addVol;
                                results.push({ 
                                    level_mm: (cm * 10) + mm, 
                                    cm: cm,
                                    mm: mm,
                                    baseVolume: baseVolume,
                                    addVol: addVol,
                                    totalVolume: totalVolume,
                                    cincin: cincinNum
                                });
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
                let delta = 0;
                if (idx > 0) {
                    delta = results[idx].totalVolume - results[idx - 1].totalVolume;
                }
                results[idx].delta = delta;
            }

            // Set strapping preview
            const strapArray = [];
            let strapCount = 0;
            for (let [cm, vol] of strappingMap.entries()) {
                if (strapCount >= 100) break;
                strapArray.push({ cm, vol });
                strapCount++;
            }
            setStrappingPreview(strapArray);

            // Set fraction preview to 100 items
            setFractionPreview(fractionRules.slice(0, 100));

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
            [`DATA ROAS TANGKI ${tankName ? tankName.toUpperCase() : '...'} LEVEL VS VOLUME`, '', '', '', '', '', '', ''],
            [],
            ['Level (mm)', 'Level Strapping (cm)', 'Level Fraction (mm)', 'Vol Strapping (L)', 'Vol Fraction (L)', 'Total Volume (L)', 'Delta Volume (L)', 'No Cincin']
        ];
        
        combinedData.forEach(r => {
            data.push([
                parseInt(r.level_mm),
                parseInt(r.cm),
                parseInt(r.mm),
                parseFloat(r.baseVolume),
                parseFloat(r.addVol),
                parseFloat(r.totalVolume),
                parseFloat(r.delta),
                r.cincin === '-' ? '-' : parseInt(r.cincin)
            ]);
        });
        
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(data);
        
        ws['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }
        ];
        
        // Format columns
        for (let r = 3; r < data.length; r++) {
            const levelCellRef = XLSX.utils.encode_cell({ r, c: 0 });
            const cmCellRef = XLSX.utils.encode_cell({ r, c: 1 });
            const mmCellRef = XLSX.utils.encode_cell({ r, c: 2 });
            const volStrapCellRef = XLSX.utils.encode_cell({ r, c: 3 });
            const volFracCellRef = XLSX.utils.encode_cell({ r, c: 4 });
            const totalVolCellRef = XLSX.utils.encode_cell({ r, c: 5 });
            const deltaCellRef = XLSX.utils.encode_cell({ r, c: 6 });
            
            if (ws[levelCellRef]) ws[levelCellRef].z = '#,##0';
            if (ws[cmCellRef]) ws[cmCellRef].z = '#,##0';
            if (ws[mmCellRef]) ws[mmCellRef].z = '#,##0';
            if (ws[volStrapCellRef]) ws[volStrapCellRef].z = '#,##0.00';
            if (ws[volFracCellRef]) ws[volFracCellRef].z = '#,##0.00';
            if (ws[totalVolCellRef]) ws[totalVolCellRef].z = '#,##0.00';
            if (ws[deltaCellRef]) ws[deltaCellRef].z = '#,##0.00';
        }
        
        XLSX.utils.book_append_sheet(wb, ws, 'Combined Data');
        XLSX.writeFile(wb, `Combined_Strapping_Tank_${tankName || 'Full'}_MM.xlsx`);
    };

    const filteredData = useMemo(() => {
        if (!searchQuery) return combinedData;
        const query = searchQuery.toLowerCase();
        return combinedData.filter(d => {
            return d.level_mm.toString().includes(query) || 
                   formatVolume(d.totalVolume).toString().includes(query) ||
                   formatVolume(d.delta).toString().includes(query);
        });
    }, [combinedData, searchQuery]);

    const anomalyData = useMemo(() => {
        if (combinedData.length < 2) return [];
        const deltaData = combinedData.slice(1).map((d, i) => {
            const prev = combinedData[i];
            return { level_mm: d.level_mm, delta_vol: d.totalVolume - prev.totalVolume };
        }).filter(d => d.delta_vol > 0);
        if (deltaData.length === 0) return [];
        
        const anomalies = [];
        const windowSize = 5;
        
        for (let i = 0; i < deltaData.length; i++) {
            const d = deltaData[i];
            let neighbors = [];
            for (let j = Math.max(0, i - windowSize); j <= Math.min(deltaData.length - 1, i + windowSize); j++) {
                if (i !== j) {
                    neighbors.push(deltaData[j].delta_vol);
                }
            }
            
            let localMedian = d.delta_vol;
            if (neighbors.length > 0) {
                neighbors.sort((a, b) => a - b);
                const mid = Math.floor(neighbors.length / 2);
                localMedian = neighbors.length % 2 !== 0 ? neighbors[mid] : (neighbors[mid - 1] + neighbors[mid]) / 2;
            }

            const devRatio = Math.abs(d.delta_vol - localMedian) / (localMedian || 1);
            const devAbs = Math.abs(d.delta_vol - localMedian);
            
            if (devRatio > 0.15 && devAbs > 50) {
                anomalies.push({
                    ...d,
                    devRatio,
                    localAvg: localMedian
                });
            }
        }
        return anomalies;
    }, [combinedData]);

    const requestSort = (key) => {
        let direction = 'asc';
        if (anomalySort.key === key && anomalySort.direction === 'asc') {
            direction = 'desc';
        }
        setAnomalySort({ key, direction });
    };

    const sortedAnomalyData = useMemo(() => {
        let sortableItems = [...anomalyData];
        if (anomalySort.key !== null) {
            sortableItems.sort((a, b) => {
                let valA = a[anomalySort.key];
                let valB = b[anomalySort.key];
                if (anomalySort.key === 'totalVolume') {
                     valA = (combinedData.find(c => c.level_mm === a.level_mm) || {}).totalVolume || 0;
                     valB = (combinedData.find(c => c.level_mm === b.level_mm) || {}).totalVolume || 0;
                }
                if (valA < valB) return anomalySort.direction === 'asc' ? -1 : 1;
                if (valA > valB) return anomalySort.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [anomalyData, anomalySort, combinedData]);

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

        // Prepare delta data (ignore 0 values)
        const deltaData = combinedData.slice(1).map((d, i) => {
            const prev = combinedData[i];
            return { level_mm: d.level_mm, delta_vol: d.totalVolume - prev.totalVolume };
        }).filter(d => d.delta_vol > 0);

        if (deltaData.length === 0) return;

        const sumDelta = deltaData.reduce((acc, curr) => acc + curr.delta_vol, 0);
        const avgDelta = sumDelta / deltaData.length;

        // Detect anomalies using local moving average (handles spherical/bullet tanks gracefully)
        const windowSize = 5;
        deltaData.forEach((d, i) => {
            let neighbors = [];
            for (let j = Math.max(0, i - windowSize); j <= Math.min(deltaData.length - 1, i + windowSize); j++) {
                if (i !== j) {
                    neighbors.push(deltaData[j].delta_vol);
                }
            }
            let localMedian = d.delta_vol;
            if (neighbors.length > 0) {
                neighbors.sort((a, b) => a - b);
                const mid = Math.floor(neighbors.length / 2);
                localMedian = neighbors.length % 2 !== 0 ? neighbors[mid] : (neighbors[mid - 1] + neighbors[mid]) / 2;
            }
            
            const devRatio = Math.abs(d.delta_vol - localMedian) / (localMedian || 1);
            const devAbs = Math.abs(d.delta_vol - localMedian);
            d.isAnomaly = devRatio > 0.15 && devAbs > 50; 
        });

        const trueMinLevel = deltaData[0].level_mm;
        const trueMaxLevel = deltaData[deltaData.length - 1].level_mm;
        
        let minLevel = trueMinLevel;
        let maxLevel = trueMaxLevel;

        if (chartMode === 'zoom') {
            const visibleRange = (trueMaxLevel - trueMinLevel) / zoomScaleY;
            const maxScroll = (trueMaxLevel - trueMinLevel) - visibleRange;
            const clampedScroll = Math.max(0, Math.min(scrollYOffset, maxScroll));
            
            minLevel = trueMinLevel + clampedScroll;
            maxLevel = minLevel + visibleRange;
        }

        // Calculate dynamic X bounds based ONLY on visible vertical range
        const visibleDeltaData = deltaData.filter(d => d.level_mm >= minLevel && d.level_mm <= maxLevel);
        const dataForXBounds = visibleDeltaData.length > 0 ? visibleDeltaData : deltaData;
        
        let minDeltaDraw = 0;
        
        const normalData = dataForXBounds.filter(d => !d.isAnomaly);
        let maxDeltaDraw = normalData.length > 0 ? Math.max(...normalData.map(d => d.delta_vol)) : Math.max(...dataForXBounds.map(d => d.delta_vol));
        
        // Add 10% margin so the cylinder/anomaly doesn't touch the edge
        maxDeltaDraw = maxDeltaDraw + (maxDeltaDraw * 0.1);

        if (chartMode === 'zoom') {
            let nMax = 0;
            let nMin = 0;

            if (normalData.length > 0) {
                nMax = Math.max(...normalData.map(d => d.delta_vol));
                nMin = Math.min(...normalData.map(d => d.delta_vol));
            } else {
                nMax = Math.max(...dataForXBounds.map(d => d.delta_vol));
                nMin = Math.min(...dataForXBounds.map(d => d.delta_vol));
            }

            let range = nMax - nMin;
            
            // Enforce a minimum display range to prevent microscopic variations (like 0.001L) 
            // from being magnified into massive visual dents on the silhouette chart.
            const minAllowedRange = Math.max(nMax * 0.05, 2.0); 
            
            if (range < minAllowedRange) {
                const center = (nMax + nMin) / 2;
                range = minAllowedRange;
                minDeltaDraw = Math.max(0, center - range / 2);
                maxDeltaDraw = center + range / 2;
            } else {
                minDeltaDraw = Math.max(0, nMin - range * 0.1);
                maxDeltaDraw = nMax + range * 0.1;
            }
        }

        const deltaRange = maxDeltaDraw - minDeltaDraw || 1;
        const paddingY = 45;
        const paddingX = 80;

        // Grid lines Y (Level)
        ctx.strokeStyle = '#e2e8f0';
        ctx.fillStyle = '#64748b';
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
            ctx.fillText(lblLevel.toLocaleString('id-ID') + ' mm', paddingX - 10, y);
        }

        const halfW = (width - paddingX * 2) / 2;
        
        const getXOffset = (delta) => {
            if (delta < minDeltaDraw) return 0;
            return Math.min(((delta - minDeltaDraw) / deltaRange) * halfW, halfW);
        };

        // Grid lines X (Delta Volume)
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#64748b';
        const xLines = 4;
        for(let i=0; i<=xLines; i++) {
            const val = minDeltaDraw + (i / xLines) * deltaRange;
            const offset = (i / xLines) * halfW;
            
            ctx.beginPath();
            ctx.moveTo(width / 2 - offset, paddingY);
            ctx.lineTo(width / 2 - offset, height - paddingY);
            if (i > 0) {
                ctx.moveTo(width / 2 + offset, paddingY);
                ctx.lineTo(width / 2 + offset, height - paddingY);
            }
            ctx.stroke();

            const lbl = val.toFixed(1);
            ctx.fillText(lbl, width / 2 - offset, height - paddingY + 15);
            if (i > 0) ctx.fillText(lbl, width / 2 + offset, height - paddingY + 15);
        }

        // Draw Average Line (Ideal Cylinder)
        const avgOffset = getXOffset(avgDelta);
        if (avgOffset > 0) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(234, 179, 8, 0.5)'; // yellow-500
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1;
            ctx.moveTo(width / 2 - avgOffset, paddingY);
            ctx.lineTo(width / 2 - avgOffset, height - paddingY);
            ctx.moveTo(width / 2 + avgOffset, paddingY);
            ctx.lineTo(width / 2 + avgOffset, height - paddingY);
            ctx.stroke();
            ctx.setLineDash([]);
            
            ctx.fillStyle = '#eab308';
            ctx.fillText(`Rata-rata: ${avgDelta.toFixed(1)} L`, width / 2, paddingY - 10);
        }

        // Title
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#334155';
        ctx.font = 'bold 12px Inter';
        ctx.fillText("Bentuk Dinding Tangki (Δ Volume per mm)", width/2, 10);
        
        const getY = (level) => height - paddingY - ((level - minLevel) / (maxLevel - minLevel)) * (height - paddingY * 2);

        // Draw Tank Silhouette

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
            ctx.lineTo(width / 2 - getXOffset(d.delta_vol), Math.max(paddingY, Math.min(height - paddingY, getY(d.level_mm))));
        });
        for (let i = deltaData.length - 1; i >= 0; i--) {
            const d = deltaData[i];
            ctx.lineTo(width / 2 + getXOffset(d.delta_vol), Math.max(paddingY, Math.min(height - paddingY, getY(d.level_mm))));
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Draw Anomalies (Warning Markers & Highlight)
        deltaData.forEach((d) => {
            if (d.isAnomaly) {
                const y = Math.max(paddingY, Math.min(height - paddingY, getY(d.level_mm)));
                const offset = getXOffset(d.delta_vol);
                
                // Draw a small red dot/marker near the Y axis
                ctx.fillStyle = '#ef4444'; // Red
                ctx.beginPath();
                ctx.arc(paddingX - 40, y, 4, 0, Math.PI * 2);
                ctx.fill();
                
                // Highlight the actual anomaly on the tank silhouette
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
                ctx.lineWidth = 2;
                ctx.moveTo(width / 2 - offset, y);
                ctx.lineTo(width / 2 + offset, y);
                ctx.stroke();

                // Draw red dots on the edges of the silhouette
                ctx.beginPath();
                ctx.arc(width / 2 - offset, y, 3, 0, Math.PI * 2);
                ctx.arc(width / 2 + offset, y, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // Center line
        ctx.beginPath();
        ctx.strokeStyle = '#e2e8f0';
        ctx.setLineDash([5, 5]);
        ctx.moveTo(width / 2, height - paddingY);
        ctx.lineTo(width / 2, paddingY);
        ctx.stroke();
        ctx.setLineDash([]);

    }, [combinedData, chartMode, zoomScaleY, scrollYOffset]);

    useEffect(() => {
        if (combinedData.length > 0 && !isProcessing) {
            drawChart();
            window.addEventListener('resize', drawChart);
            return () => window.removeEventListener('resize', drawChart);
        }
    }, [combinedData, isProcessing, drawChart]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const preventScroll = (e) => {
            if (chartMode === 'zoom') {
                e.preventDefault();
            }
        };
        canvas.addEventListener('wheel', preventScroll, { passive: false });
        return () => canvas.removeEventListener('wheel', preventScroll);
    }, [chartMode]);

    const toggleFullscreen = () => {
        const elem = document.getElementById('chart-panel');
        if (!document.fullscreenElement) {
            elem.requestFullscreen().catch(err => console.error(err));
        } else {
            document.exitFullscreen();
        }
    };

    const handleWheel = (e) => {
        if (chartMode !== 'zoom') return;
        e.preventDefault();
        
        const zoomSensitivity = 0.003;
        let newZoom = zoomScaleY * (1 - e.deltaY * zoomSensitivity);
        newZoom = Math.max(1, Math.min(newZoom, 500)); 
        setZoomScaleY(newZoom);
    };

    const handleMouseDown = (e) => {
        if (chartMode !== 'zoom') return;
        setIsDragging(true);
        setDragStartMouseY(e.clientY);
        setDragStartScrollY(scrollYOffset);
    };

    const handleMouseUp = () => setIsDragging(false);

    const handleMouseLeave = () => {
        setIsDragging(false);
        setTooltipInfo(null);
    };

    const handleCanvasMouseMove = (e) => {
        if (combinedData.length < 2) return;
        
        const deltaData = combinedData.slice(1).map((d, i) => {
            const prev = combinedData[i];
            return { level_mm: d.level_mm, delta_vol: d.totalVolume - prev.totalVolume };
        }).filter(d => d.delta_vol > 0);

        if (deltaData.length === 0) {
            setTooltipInfo(null);
            return;
        }

        const trueMinLevel = deltaData[0].level_mm;
        const trueMaxLevel = deltaData[deltaData.length - 1].level_mm;
        
        if (isDragging && chartMode === 'zoom') {
            const dy = e.clientY - dragStartMouseY;
            const scrollSensitivity = (trueMaxLevel - trueMinLevel) / zoomScaleY / canvasRef.current.offsetHeight;
            // drag down (dy > 0) means move viewport up (increase scrollY)
            let newScroll = dragStartScrollY + dy * scrollSensitivity;
            
            const visibleRange = (trueMaxLevel - trueMinLevel) / zoomScaleY;
            const maxScroll = (trueMaxLevel - trueMinLevel) - visibleRange;
            newScroll = Math.max(0, Math.min(newScroll, maxScroll));
            setScrollYOffset(newScroll);
            return; // Don't show tooltip while dragging
        }

        const rect = canvasRef.current.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const height = canvasRef.current.offsetHeight;
        const paddingY = 45; // Match with drawChart
        
        let minLevel = trueMinLevel;
        let maxLevel = trueMaxLevel;

        if (chartMode === 'zoom') {
            const visibleRange = (trueMaxLevel - trueMinLevel) / zoomScaleY;
            const maxScroll = (trueMaxLevel - trueMinLevel) - visibleRange;
            const clampedScroll = Math.max(0, Math.min(scrollYOffset, maxScroll));
            minLevel = trueMinLevel + clampedScroll;
            maxLevel = minLevel + visibleRange;
        }
        
        if (y < paddingY || y > height - paddingY) {
            setTooltipInfo(null);
            return;
        }

        const ratio = (height - paddingY - y) / (height - paddingY * 2);
        const hoverLevel = minLevel + ratio * (maxLevel - minLevel);
        
        // Interpolate visual delta_vol and level
        let lower = deltaData[0];
        let upper = deltaData[deltaData.length - 1];
        
        for (let i = 0; i < deltaData.length - 1; i++) {
            if (hoverLevel >= deltaData[i].level_mm && hoverLevel <= deltaData[i+1].level_mm) {
                lower = deltaData[i];
                upper = deltaData[i+1];
                break;
            }
        }
        
        let exactDelta = lower.delta_vol;
        if (upper.level_mm !== lower.level_mm) {
            const t = (hoverLevel - lower.level_mm) / (upper.level_mm - lower.level_mm);
            exactDelta = lower.delta_vol + t * (upper.delta_vol - lower.delta_vol);
        }
        
        // Find corresponding volume from combinedData using binary search for closest level
        let bestVol = 0;
        let left = 0;
        let right = combinedData.length - 1;
        let closestDist = Infinity;
        
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const dist = Math.abs(combinedData[mid].level_mm - hoverLevel);
            if (dist < closestDist) {
                closestDist = dist;
                bestVol = combinedData[mid].totalVolume;
            }
            if (combinedData[mid].level_mm === hoverLevel) {
                break;
            } else if (combinedData[mid].level_mm < hoverLevel) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        
        setTooltipInfo({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            level: Math.round(hoverLevel),
            delta: exactDelta.toFixed(2),
            volume: bestVol
        });
    };

    return (
        <div style={styles.container}>
            <header style={styles.header}>
                <h1 style={styles.title}>
                    Strapping & Fraction Combiner {tankName && ` - Tangki ${tankName}`}
                    <span style={{ 
                        fontSize: '0.9rem', 
                        verticalAlign: 'middle', 
                        padding: '0.2rem 0.6rem', 
                        background: 'rgba(59, 130, 246, 0.2)', 
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        borderRadius: '20px', 
                        marginLeft: '0.75rem', 
                        color: '#60a5fa',
                        fontWeight: '500'
                    }}>
                        v1.4.7
                    </span>
                </h1>
                <p style={styles.subtitle}>Verifikasi Level vs Volume Tanki ROAS</p>
            </header>

            <div style={styles.layoutGrid}>
                {/* LEFT COLUMN: Upload & Preview */}
                <div style={styles.leftCol}>
                    <div style={styles.glassPanelCompact}>
                        <h3 style={styles.panelTitle}>📂 Upload Files</h3>
                        <div style={styles.uploadGridCompact}>
                            <div 
                                style={{ ...styles.fileDropCompact, ...(isDragOver ? styles.fileDropActive : {}) }}
                                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                                onDragLeave={() => setIsDragOver(false)}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    setIsDragOver(false);
                                    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
                                }}
                            >
                                <span style={styles.fileLabelCompact}>📁 Drop atau Pilih Berkas di Sini</span>
                                <p style={styles.fileHintCompact}>Unggah file Strapping (CSV) &amp; Fraction (XLS/XLSX/HTML)</p>
                                <input 
                                    type="file" 
                                    multiple 
                                    style={styles.fileInput} 
                                    onChange={(e) => {
                                        if (e.target.files) handleFiles(e.target.files);
                                    }} 
                                />
                            </div>

                            {/* Status list */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '0.5rem', 
                                    fontSize: '0.85rem',
                                    color: strappingFile ? '#10b981' : '#94a3b8'
                                }}>
                                    <span>{strappingFile ? '✅' : '⏳'}</span>
                                    <span>Strapping (CSV): <strong>{strappingFile ? strappingFile.name : 'Belum diunggah'}</strong></span>
                                </div>
                                <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '0.5rem', 
                                    fontSize: '0.85rem',
                                    color: fractionFile ? '#10b981' : '#94a3b8'
                                }}>
                                    <span>{fractionFile ? '✅' : '⏳'}</span>
                                    <span>Fraction (XLS/HTML): <strong>{fractionFile ? fractionFile.name : 'Belum diunggah'}</strong></span>
                                </div>
                            </div>

                            {uploadError && (
                                <div style={{ 
                                    color: '#ef4444', 
                                    fontSize: '0.8rem', 
                                    marginTop: '0.5rem', 
                                    background: 'rgba(239, 68, 68, 0.1)', 
                                    padding: '0.5rem', 
                                    borderRadius: '6px',
                                    border: '1px solid rgba(239, 68, 68, 0.2)'
                                }}>
                                    ⚠️ {uploadError}
                                </div>
                            )}
                        </div>

                        {isProcessing && (
                            <div style={styles.progressWrapper}>
                                <div style={styles.progressText}>{progressText}</div>
                                <div style={styles.progressContainer}>
                                    <div style={{ ...styles.progressBar, width: `${progress}%` }}></div>
                                </div>
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                            <button 
                                style={{ 
                                    ...styles.btnProcess, 
                                    ...(!(strappingRaw || fractionRaw) || isProcessing ? styles.btnDisabled : {}),
                                    flex: 2
                                }}
                                disabled={!(strappingRaw || fractionRaw) || isProcessing}
                                onClick={handleProcess}
                            >
                                {isProcessing ? 'Memproses...' : (combinedData.length > 0 ? 'Proses Ulang' : 'Gabungkan Data')}
                            </button>
                            {(strappingFile || fractionFile) && (
                                <button 
                                    style={styles.btnReset}
                                    onClick={handleReset}
                                >
                                    Reset
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Previews (only shown when combinedData exists) */}
                    {combinedData.length > 0 && !isProcessing && strappingPreview.length > 0 && (
                        <div style={styles.glassPanelCompact}>
                            <h3 style={styles.panelTitle}>📄 Preview Data Input</h3>
                            
                            <h4 style={styles.previewTitlePrimary}>File 1: Data Strapping (100 Baris Pertama)</h4>
                            <div style={{ ...styles.tableContainerPreview, marginBottom: '1rem' }}>
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

                            <h4 style={styles.previewTitleSuccess}>File 2: Data Fraction (100 Baris Pertama)</h4>
                            <div style={styles.tableContainerPreview}>
                                <table style={styles.table}>
                                    <thead>
                                        <tr>
                                            <th style={styles.thPreview}>Dari (cm)</th>
                                            <th style={styles.thPreview}>Sampai (cm)</th>
                                            <th style={styles.thPreview}>Offs (mm)</th>
                                            <th style={styles.thPreview}>Vol Tambahan</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {fractionPreview.length === 0 ? (
                                            <tr>
                                                <td colSpan="4" style={{...styles.tdPreview, textAlign: 'center', color: '#94a3b8'}}>
                                                    Tidak ada data Fraction (Penggabungan diabaikan)
                                                </td>
                                            </tr>
                                        ) : (
                                            fractionPreview.map((row, idx) => (
                                                <tr key={idx} style={styles.tr}>
                                                    <td style={styles.tdPreview}>{row.minCm}</td>
                                                    <td style={styles.tdPreview}>{row.maxCm}</td>
                                                    <td style={styles.tdPreview}>{row.offset_mm}</td>
                                                    <td style={styles.tdPreview}>{row.volume_tambahan.toFixed(2)}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

                {/* RIGHT COLUMN: Chart & Table */}
                <div style={styles.rightCol}>
                    {combinedData.length === 0 && !isProcessing && (
                        <div style={styles.welcomePanel}>
                            <h3 style={{ margin: '0 0 0.5rem 0', color: '#2563eb' }}>Unggah berkas untuk memulai</h3>
                            <p style={{ margin: 0, color: '#64748b' }}>Unggah file strapping (.csv) dan file fraction (.xls/xlsx/html) di sebelah kiri, kemudian klik tombol proses.</p>
                        </div>
                    )}

                    {combinedData.length > 0 && !isProcessing && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            {/* Large Highlight Chart Panel */}
                            <div id="chart-panel" style={styles.glassPanel}>
                                <style>{`
                                    #chart-panel:fullscreen {
                                        background: #f8fafc !important;
                                        padding: 2rem !important;
                                        display: flex !important;
                                        flex-direction: column !important;
                                    }
                                    #chart-panel:fullscreen #chart-container {
                                        flex: 1 1 auto !important;
                                        height: 100% !important;
                                    }
                                `}</style>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                    <h3 style={{ ...styles.panelTitle, margin: 0 }}>📈 Grafik Siluet Tanki (Δ Volume per mm)</h3>
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
                                        <button 
                                            style={styles.btnMode}
                                            onClick={toggleFullscreen}
                                        >
                                            ⛶ Layar Penuh
                                        </button>
                                    </div>
                                </div>
                                <div id="chart-container" style={{
                                    ...styles.chartContainer,
                                    overflow: 'hidden'
                                }}>
                                    <canvas 
                                        ref={canvasRef} 
                                        style={{ 
                                            width: '100%', 
                                            height: '100%', 
                                            cursor: chartMode === 'zoom' ? (isDragging ? 'grabbing' : 'grab') : 'crosshair',
                                            display: 'block'
                                        }}
                                        onMouseMove={handleCanvasMouseMove}
                                        onMouseLeave={handleMouseLeave}
                                        onMouseDown={handleMouseDown}
                                        onMouseUp={handleMouseUp}
                                        onWheel={handleWheel}
                                    ></canvas>
                                    {tooltipInfo && (
                                        <>
                                            <div style={{
                                                position: 'absolute',
                                                top: tooltipInfo.y,
                                                left: 0,
                                                width: '100%',
                                                height: '1px',
                                                background: 'rgba(239, 68, 68, 0.6)',
                                                pointerEvents: 'none',
                                                zIndex: 10,
                                                boxShadow: '0 0 4px rgba(239, 68, 68, 0.5)'
                                            }} />
                                            <div style={{
                                                position: 'absolute',
                                                left: tooltipInfo.x + 15,
                                                top: tooltipInfo.y - 15,
                                                background: 'rgba(255, 255, 255, 0.95)',
                                                border: '1px solid #e2e8f0',
                                                padding: '8px 12px',
                                            borderRadius: '6px',
                                            pointerEvents: 'none',
                                            fontSize: '0.85rem',
                                            zIndex: 100,
                                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                            whiteSpace: 'nowrap',
                                            color: '#334155'
                                        }}>
                                            <div style={{ color: '#64748b', marginBottom: '4px' }}>Level: <strong style={{ color: '#0f172a' }}>{tooltipInfo.level.toLocaleString('id-ID')} mm</strong></div>
                                            <div style={{ color: '#64748b', marginBottom: '4px' }}>Δ Volume: <strong style={{ color: '#ef4444' }}>{tooltipInfo.delta.toLocaleString('id-ID', {maximumFractionDigits:2})} L</strong></div>
                                            <div style={{ color: '#64748b' }}>Total Vol: <strong style={{ color: '#10b981' }}>{tooltipInfo.volume.toLocaleString('id-ID', {maximumFractionDigits:2})} L</strong></div>
                                        </div>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Anomaly Table Panel */}
                            <div style={styles.glassPanel}>
                                <h3 style={{ ...styles.panelTitle, margin: '0 0 1rem 0', color: anomalyData.length > 0 ? '#ef4444' : '#10b981' }}>
                                    {anomalyData.length > 0 ? '⚠️ Daftar Anomali (Cacat Dinding Terdeteksi)' : '✅ Tidak Ada Anomali Signifikan'}
                                </h3>
                                {anomalyData.length > 0 ? (
                                    <div style={styles.tableContainer}>
                                        <table style={styles.table}>
                                            <thead style={styles.thead}>
                                                <tr>
                                                    <th style={{...styles.th, width: '60px'}}>#</th>
                                                    <th style={{...styles.th, cursor: 'pointer'}} onClick={() => requestSort('level_mm')}>
                                                        Level (mm) {anomalySort.key === 'level_mm' ? (anomalySort.direction === 'asc' ? '↑' : '↓') : ''}
                                                    </th>
                                                    <th style={{...styles.th, cursor: 'pointer'}} onClick={() => requestSort('totalVolume')}>
                                                        Total Vol (L) {anomalySort.key === 'totalVolume' ? (anomalySort.direction === 'asc' ? '↑' : '↓') : ''}
                                                    </th>
                                                    <th style={{...styles.th, cursor: 'pointer'}} onClick={() => requestSort('delta_vol')}>
                                                        Δ Aktual (L) {anomalySort.key === 'delta_vol' ? (anomalySort.direction === 'asc' ? '↑' : '↓') : ''}
                                                    </th>
                                                    <th style={{...styles.th, cursor: 'pointer'}} onClick={() => requestSort('devRatio')}>
                                                        Penyimpangan {anomalySort.key === 'devRatio' ? (anomalySort.direction === 'asc' ? '↑' : '↓') : ''}
                                                    </th>
                                                    <th style={styles.th}>Aksi</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {sortedAnomalyData.map((d, i) => {
                                                    // Find total volume for this anomaly level
                                                    const match = combinedData.find(c => c.level_mm === d.level_mm);
                                                    const totalVol = match ? match.totalVolume : 0;
                                                    
                                                    return (
                                                    <tr key={d.level_mm} style={{ ...styles.tr, background: 'rgba(239, 68, 68, 0.05)' }}>
                                                        <td style={styles.td}>{i + 1}</td>
                                                        <td style={styles.td}>{formatLevel(d.level_mm)}</td>
                                                        <td style={styles.td}>{totalVol.toLocaleString('id-ID', {maximumFractionDigits:2})}</td>
                                                        <td style={{...styles.td, color: '#ef4444', fontWeight: '600'}}>{d.delta_vol.toLocaleString('id-ID', {maximumFractionDigits:2})}</td>
                                                        <td style={{...styles.td, color: '#ef4444'}}>{(d.devRatio * 100).toFixed(1)}% (+{Math.abs(d.delta_vol - (d.localAvg || 0)).toFixed(1)} L)</td>
                                                        <td style={styles.td}>
                                                            <button 
                                                                style={{ padding: '0.25rem 0.5rem', background: 'transparent', color: '#3b82f6', border: '1px solid #3b82f6', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}
                                                                title="Lihat Detail"
                                                                onClick={() => {
                                                                    setSearchQuery(d.level_mm.toString());
                                                                    const mainTable = document.getElementById('main-table-panel');
                                                                    if (mainTable) mainTable.scrollIntoView({ behavior: 'smooth' });
                                                                }}
                                                            >
                                                                🔍 Lihat
                                                            </button>
                                                        </td>
                                                    </tr>
                                                )})}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div style={{ padding: '1.5rem', background: '#f0fdf4', color: '#166534', borderRadius: '8px', textAlign: 'center', border: '1px solid #bbf7d0' }}>
                                        Seluruh data tampak normal. Tidak ada lonjakan volume yang signifikan antar mm pada tangki ini.
                                    </div>
                                )}
                            </div>

                            {/* Main Table Panel */}
                            <div id="main-table-panel" style={styles.glassPanel}>
                                <div style={styles.toolbar}>
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Nama Tangki:</span>
                                        <span style={{ 
                                            background: 'rgba(59, 130, 246, 0.2)',
                                            color: '#60a5fa',
                                            padding: '0.25rem 0.75rem',
                                            borderRadius: '6px',
                                            fontWeight: '600',
                                            fontSize: '0.9rem',
                                            border: '1px solid rgba(59, 130, 246, 0.3)'
                                        }}>
                                            {tankName || 'TIDAK TERDETEKSI'}
                                        </span>
                                    </div>
                                    <input 
                                        type="text" 
                                        placeholder="Cari..." 
                                        style={{ ...styles.searchBox, maxWidth: '180px', padding: '0.5rem 0.75rem' }}
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                    <button style={styles.btnExport} onClick={handleExport}>
                                        Export to Excel (XLSX)
                                    </button>
                                </div>

                                <div style={styles.tableContainer}>
                                    <table style={styles.table}>
                                        <thead>
                                            <tr>
                                                <th style={styles.th}>Level (mm)</th>
                                                <th style={styles.th}>Level Strapping (cm)</th>
                                                {fractionPreview.length > 0 && <th style={styles.th}>Level Fraction (mm)</th>}
                                                <th style={styles.th}>Vol Strapping (L)</th>
                                                {fractionPreview.length > 0 && <th style={styles.th}>Vol Fraction (L)</th>}
                                                <th style={styles.th}>Total Volume (L)</th>
                                                <th style={styles.th}>Delta Volume (L)</th>
                                                {fractionPreview.length > 0 && <th style={styles.th}>No Cincin</th>}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredData.length === 0 && (
                                                <tr><td colSpan={fractionPreview.length > 0 ? "8" : "5"} style={styles.tdCenter}>Data tidak ditemukan.</td></tr>
                                            )}
                                            {filteredData.slice(0, 300).map((row, idx) => (
                                                <tr key={idx} style={styles.tr}>
                                                    <td style={styles.td}>{row.level_mm}</td>
                                                    <td style={styles.td}>{row.cm}</td>
                                                    {fractionPreview.length > 0 && <td style={styles.td}>{row.mm}</td>}
                                                    <td style={styles.td}>{formatVolume(row.baseVolume)}</td>
                                                    {fractionPreview.length > 0 && <td style={styles.td}>{formatVolume(row.addVol)}</td>}
                                                    <td style={styles.tdSuccess}>{formatVolume(row.totalVolume)}</td>
                                                    <td style={styles.td}>{formatVolume(row.delta)}</td>
                                                    {fractionPreview.length > 0 && <td style={{ ...styles.td, textAlign: 'center' }}>{row.cincin}</td>}
                                                </tr>
                                            ))}
                                            {filteredData.length > 300 && (
                                                <tr>
                                                    <td colSpan={fractionPreview.length > 0 ? "8" : "5"} style={styles.tdCenter}>
                                                        Menampilkan 300 dari total {filteredData.length} baris.<br/>
                                                        <em style={{opacity:0.7}}>Gunakan kotak pencarian di atas untuk mencari angka spesifik.</em>
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

const styles = {
    layoutGrid: {
        display: 'grid',
        gridTemplateColumns: '350px 1fr',
        gap: '1.5rem',
        maxWidth: '1400px',
        marginLeft: 'auto',
        marginRight: 'auto',
    },
    leftCol: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
    },
    rightCol: {
        minWidth: 0,
    },
    glassPanelCompact: {
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '1.25rem',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
    },
    panelTitle: {
        color: '#1e293b',
        fontSize: '1.1rem',
        fontWeight: '600',
        marginTop: 0,
        marginBottom: '1rem',
        borderBottom: '1px solid #e2e8f0',
        paddingBottom: '0.5rem',
    },
    uploadGridCompact: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        marginBottom: '1rem',
    },
    fileDropCompact: {
        border: '2px dashed #cbd5e1',
        borderRadius: '8px',
        padding: '1rem',
        textAlign: 'center',
        transition: 'all 0.3s ease',
        cursor: 'pointer',
        position: 'relative',
        background: '#f8fafc',
    },
    fileLabelCompact: {
        fontWeight: '600',
        fontSize: '0.9rem',
        display: 'block',
        pointerEvents: 'none',
        color: '#334155',
    },
    fileHintCompact: {
        fontSize: '0.75rem',
        color: '#64748b',
        margin: '0.25rem 0 0 0',
        pointerEvents: 'none',
    },
    fileStatusCompact: {
        fontSize: '0.75rem',
        marginTop: '0.5rem',
        pointerEvents: 'none',
        fontWeight: '500',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    previewTitlePrimary: {
        color: '#3b82f6',
        fontSize: '0.85rem',
        fontWeight: '600',
        marginTop: 0,
        marginBottom: '0.5rem',
    },
    previewTitleSuccess: {
        color: '#10b981',
        fontSize: '0.85rem',
        fontWeight: '600',
        marginTop: 0,
        marginBottom: '0.5rem',
    },
    welcomePanel: {
        background: '#ffffff',
        border: '1px dashed #cbd5e1',
        borderRadius: '16px',
        padding: '3rem 2rem',
        textAlign: 'center',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
    },
    container: {
        fontFamily: '"Inter", sans-serif',
        background: '#f1f5f9',
        color: '#334155',
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
        color: '#0f172a',
        margin: '0 0 0.5rem 0',
    },
    subtitle: {
        color: '#64748b',
        margin: 0,
    },
    glassPanel: {
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '16px',
        padding: '2rem',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
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
        border: '2px dashed #cbd5e1',
        borderRadius: '12px',
        padding: '2rem',
        textAlign: 'center',
        transition: 'all 0.3s ease',
        cursor: 'pointer',
        position: 'relative',
        background: '#f8fafc',
    },
    fileDropActive: {
        borderColor: '#3b82f6',
        background: '#eff6ff',
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
        color: '#334155'
    },
    fileHint: {
        fontSize: '0.85rem',
        color: '#64748b',
        margin: 0,
        pointerEvents: 'none',
    },
    fileStatus: {
        fontSize: '0.85rem',
        marginTop: '0.5rem',
        pointerEvents: 'none',
        color: '#10b981'
    },
    btnReset: {
        padding: '1rem',
        background: '#fef2f2',
        border: '1px solid #fecaca',
        borderRadius: '8px',
        color: '#ef4444',
        fontSize: '1rem',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        flex: 1,
        textAlign: 'center',
    },
    btnProcess: {
        width: '100%',
        padding: '1rem',
        background: '#3b82f6',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        fontSize: '1.1rem',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        boxShadow: '0 1px 3px rgba(59, 130, 246, 0.3)',
    },
    btnDisabled: {
        background: '#cbd5e1',
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
        color: '#64748b',
        marginBottom: '0.5rem',
    },
    progressContainer: {
        width: '100%',
        height: '8px',
        background: '#e2e8f0',
        borderRadius: '4px',
        overflow: 'hidden',
    },
    progressBar: {
        height: '100%',
        background: '#3b82f6',
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
        border: '1px solid #cbd5e1',
        background: '#ffffff',
        color: '#334155',
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
        border: '1px solid #e2e8f0',
        background: '#ffffff',
    },
    table: {
        width: '100%',
        borderCollapse: 'collapse',
        textAlign: 'left',
    },
    th: {
        position: 'sticky',
        top: 0,
        background: '#f8fafc',
        padding: '1rem',
        fontWeight: '600',
        color: '#475569',
        borderBottom: '1px solid #e2e8f0',
        zIndex: 10,
    },
    tr: {
        borderBottom: '1px solid #e2e8f0',
    },
    td: {
        padding: '0.75rem 1rem',
        fontFamily: 'monospace',
        fontWeight: '500',
        color: '#334155',
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
        color: '#64748b',
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
        background: '#f8fafc',
        color: '#475569',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        cursor: 'pointer',
        fontWeight: '500',
        transition: 'all 0.3s',
    },
    btnModeActive: {
        background: '#eff6ff',
        color: '#3b82f6',
        borderColor: '#bfdbfe',
    },
    chartContainer: {
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        height: '560px',
        position: 'relative',
        overflow: 'hidden'
    },
    tableContainerPreview: { 
        maxHeight: '260px',
        overflowY: 'auto',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        background: '#ffffff',
    },
    thPreview: {
        position: 'sticky',
        top: 0,
        background: '#f8fafc',
        padding: '0.5rem 0.75rem',
        fontWeight: '600',
        color: '#475569',
        borderBottom: '1px solid #e2e8f0',
        fontSize: '0.85rem',
    },
    tdPreview: {
        padding: '0.5rem 0.75rem',
        fontFamily: 'monospace',
        fontSize: '0.85rem',
        color: '#334155',
    }
};
