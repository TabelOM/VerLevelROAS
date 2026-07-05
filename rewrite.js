const fs = require('fs');
let content = fs.readFileSync('CombineTank.jsx', 'utf-8');

// 1. Update parseFraction loop logic
content = content.replace(
    /if \(\!isNaN\(dari\) && \!isNaN\(sampai\) && \!isNaN\(tinggi\) && \!isNaN\(vol\)\) \{[\s\S]*?const maxCm = Math\.floor\(sampai\);/g,
    `if (!isNaN(dari) && !isNaN(sampai) && !isNaN(tinggi) && !isNaN(vol)) {
                    const minCm = Math.ceil(dari); 
                    const maxCm = Math.floor(sampai);`
);

// 2. Add cincin mapping in handleProcess
content = content.replace(
    /const fractionLookup = \{\};\s+fractionRules\.forEach\(r => \{\s+for \(let cm = r\.minCm; cm <= r\.maxCm; cm\+\+\) \{\s+if \(\!fractionLookup\[cm\]\) fractionLookup\[cm\] = \{\};\s+fractionLookup\[cm\]\[r\.offset_mm\] = r\.volume_tambahan;\s+\}\s+\}\);/,
    `const fractionLookup = {};
            const cincinMap = new Map();
            let cincinCounter = 1;

            fractionRules.forEach(r => {
                const rangeKey = \`\${r.minCm}-\${r.maxCm}\`;
                if (!cincinMap.has(rangeKey)) {
                    cincinMap.set(rangeKey, cincinCounter++);
                }
                const cincinNumber = cincinMap.get(rangeKey);
                
                for (let cm = r.minCm; cm <= r.maxCm; cm++) {
                    if (!fractionLookup[cm]) fractionLookup[cm] = { offsetMap: {}, cincinNumber };
                    fractionLookup[cm].offsetMap[r.offset_mm] = r.volume_tambahan;
                    fractionLookup[cm].cincinNumber = cincinNumber;
                }
            });`
);

// 3. results.push for Base and Fraction
content = content.replace(
    /const baseVolume = strappingMap\.get\(cm\);\s+results\.push\(\{ level_mm: cm \* 10, volume: baseVolume\.toFixed\(2\) \}\);\s+if \(cm < maxCm\) \{\s+const cmFraction = fractionLookup\[cm\] \|\| \{\};\s+for \(let mm = 1; mm <= 9; mm\+\+\) \{\s+const addVol = cmFraction\[mm\] \|\| 0;\s+const totalVolume = baseVolume \+ addVol;\s+results\.push\(\{ level_mm: \(cm \* 10\) \+ mm, volume: totalVolume\.toFixed\(2\) \}\);\s+\}\s+\}/,
    `const baseVolume = strappingMap.get(cm);
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
                        
                        if (cm < maxCm) {
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
                        }`
);

// 4. Calculate delta
content = content.replace(
    /for \(let idx = 0; idx < results\.length; idx\+\+\) \{\s+const currentVol = parseFloat\(results\[idx\]\.volume\);\s+let delta = 0;\s+if \(idx > 0\) \{\s+const prevVol = parseFloat\(results\[idx - 1\]\.volume\);\s+delta = currentVol - prevVol;\s+\}\s+results\[idx\]\.delta = delta\.toFixed\(2\);\s+\}/,
    `for (let idx = 0; idx < results.length; idx++) {
                let delta = 0;
                if (idx > 0) {
                    delta = results[idx].totalVolume - results[idx - 1].totalVolume;
                }
                results[idx].delta = delta;
            }`
);

// 5. handleExport
content = content.replace(
    /const data = \[\s+\[\`DATA ROAS TANGKI \$\{tankName \? tankName\.toUpperCase\(\) : '\.\.\.'\} LEVEL VS VOLUME\`, '', '', ''\],\s+\[\],\s+\['Level \(mm\)', 'Nama Tangki', 'Volume', 'Delta'\]\s+\];\s+combinedData\.forEach\(r => \{\s+data\.push\(\[\s+parseInt\(r\.level_mm\),\s+tankName \|\| '',\s+parseFloat\(r\.volume\),\s+parseFloat\(r\.delta \|\| 0\)\s+\]\);\s+\}\);\s+const wb = XLSX\.utils\.book_new\(\);\s+const ws = XLSX\.utils\.aoa_to_sheet\(data\);\s+ws\['!merges'\] = \[\s+\{ s: \{ r: 0, c: 0 \}, e: \{ r: 0, c: 3 \} \}\s+\];\s+\/\/ Format columns\s+for \(let r = 3; r < data\.length; r\+\+\) \{\s+const levelCellRef = XLSX\.utils\.encode_cell\(\{ r, c: 0 \}\);\s+const volumeCellRef = XLSX\.utils\.encode_cell\(\{ r, c: 2 \}\);\s+const deltaCellRef = XLSX\.utils\.encode_cell\(\{ r, c: 3 \}\);\s+if \(ws\[levelCellRef\]\) \{\s+ws\[levelCellRef\]\.z = '#,##0';\s+\}\s+if \(ws\[volumeCellRef\]\) \{\s+ws\[volumeCellRef\]\.z = '#,##0\.00';\s+\}\s+if \(ws\[deltaCellRef\]\) \{\s+ws\[deltaCellRef\]\.z = '#,##0\.00';\s+\}\s+\}/,
    `const data = [
            [\`DATA ROAS TANGKI \${tankName ? tankName.toUpperCase() : '...'} LEVEL VS VOLUME\`, '', '', '', '', '', '', ''],
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
        }`
);

// 6. filteredData memo
content = content.replace(
    /const filteredData = useMemo\(\(\) => \{\s+if \(\!searchQuery\) return combinedData;\s+const query = searchQuery\.toLowerCase\(\);\s+return combinedData\.filter\(d => \{\s+const formattedVol = formatVolume\(d\.volume\);\s+const formattedLvl = formatLevel\(d\.level_mm\);\s+const formattedDelta = formatVolume\(d\.delta\);\s+return d\.level_mm\.toString\(\)\.includes\(query\) \|\|\s+d\.volume\.toString\(\)\.includes\(query\) \|\|\s+formattedVol\.includes\(query\) \|\|\s+formattedLvl\.includes\(query\) \|\|\s+formattedDelta\.includes\(query\) \|\|\s+\(tankName && tankName\.toLowerCase\(\)\.includes\(query\)\);\s+\}\);\s+\}, \[combinedData, searchQuery, tankName\]\);/,
    `const filteredData = useMemo(() => {
        if (!searchQuery) return combinedData;
        const query = searchQuery.toLowerCase();
        return combinedData.filter(d => {
            return d.level_mm.toString().includes(query) || 
                   formatVolume(d.totalVolume).toString().includes(query) ||
                   formatVolume(d.delta).toString().includes(query);
        });
    }, [combinedData, searchQuery]);`
);

// 7. drawChart delta calculation
content = content.replace(
    /const deltaData = \[\];\s+let sumDelta = 0;\s+for \(let i = 1; i < combinedData\.length; i\+\+\) \{\s+const dV = parseFloat\(combinedData\[i\]\.volume\) - parseFloat\(combinedData\[i-1\]\.volume\);\s+deltaData\.push\(\{ level_mm: combinedData\[i\]\.level_mm, delta_vol: dV \}\);\s+sumDelta \+= dV;\s+\}/,
    `const deltaData = combinedData.slice(1).map((d, i) => {
            const prev = combinedData[i];
            return { level_mm: d.level_mm, delta_vol: d.totalVolume - prev.totalVolume };
        });
        const sumDelta = deltaData.reduce((acc, curr) => acc + curr.delta_vol, 0);`
);

// 8. drawChart anomaly logic and volume -> totalVolume
content = content.replace(
    /d\.isAnomaly = Math\.abs\(d\.delta_vol - avgDelta\) \/ avgDelta > 0\.02;/g,
    `d.isAnomaly = Math.abs(d.delta_vol - avgDelta) / (avgDelta || 1) > 0.05;`
);

content = content.replace(
    /delta: delta\.toFixed\(2\),\s+volume: combinedData\[bestIdx\]\.volume/,
    `delta: delta.toFixed(2),
            volume: combinedData[bestIdx].totalVolume`
);

content = content.replace(
    /const delta = parseFloat\(combinedData\[bestIdx\]\.volume\) - parseFloat\(combinedData\[bestIdx - 1\]\.volume\);/,
    `const delta = combinedData[bestIdx].totalVolume - combinedData[bestIdx - 1].totalVolume;`
);

// 9. Table headers and body
content = content.replace(
    /<tr>\s*<th style=\{styles\.th\}>Level \(mm\)<\/th>\s*<th style=\{styles\.th\}>Nama Tangki<\/th>\s*<th style=\{styles\.th\}>Volume<\/th>\s*<th style=\{styles\.th\}>Delta<\/th>\s*<\/tr>/,
    `<tr>
                                        <th style={styles.th}>Level (mm)</th>
                                        <th style={styles.th}>Level Strapping (cm)</th>
                                        <th style={styles.th}>Level Fraction (mm)</th>
                                        <th style={styles.th}>Vol Strapping (L)</th>
                                        <th style={styles.th}>Vol Fraction (L)</th>
                                        <th style={styles.th}>Total Volume (L)</th>
                                        <th style={styles.th}>Delta Volume (L)</th>
                                        <th style={styles.th}>No Cincin</th>
                                    </tr>`
);

content = content.replace(
    /\{filteredData\.length === 0 && \(\s*<tr><td colSpan="4" style=\{styles\.tdCenter\}>Data tidak ditemukan\.<\/td><\/tr>\s*\)\}/,
    `{filteredData.length === 0 && (
                                        <tr><td colSpan="8" style={styles.tdCenter}>Data tidak ditemukan.</td></tr>
                                    )}`
);

content = content.replace(
    /<tr>\s*<td colSpan="4" style=\{styles\.tdCenter\}>\s*Menampilkan 300 dari total \{filteredData\.length\} baris\.<br\/>/,
    `<tr>
                                            <td colSpan="8" style={styles.tdCenter}>
                                                Menampilkan 300 dari total {filteredData.length} baris.<br/>`
);

content = content.replace(
    /<tr key=\{idx\} style=\{styles\.tr\}>\s*<td style=\{styles\.td\}>\{formatLevel\(row\.level_mm\)\}<\/td>\s*<td style=\{styles\.td\}>\{tankName \|\| "-"\}<\/td>\s*<td style=\{styles\.tdSuccess\}>\{formatVolume\(row\.volume\)\}<\/td>\s*<td style=\{styles\.td\}>\{formatVolume\(row\.delta\)\}<\/td>\s*<\/tr>/g,
    `<tr key={idx} style={styles.tr}>
                                            <td style={styles.td}>{row.level_mm}</td>
                                            <td style={styles.td}>{row.cm}</td>
                                            <td style={styles.td}>{row.mm}</td>
                                            <td style={styles.td}>{formatVolume(row.baseVolume)}</td>
                                            <td style={styles.td}>{formatVolume(row.addVol)}</td>
                                            <td style={styles.tdSuccess}>{formatVolume(row.totalVolume)}</td>
                                            <td style={styles.td}>{formatVolume(row.delta)}</td>
                                            <td style={{ ...styles.td, textAlign: 'center' }}>{row.cincin}</td>
                                        </tr>`
);

fs.writeFileSync('CombineTank.jsx', content);
