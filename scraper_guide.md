# Panduan Scraper Data Strapping Tanki (Strapping Tank 2)

Dokumen ini berisi script otomatis (Bookmarklet) khusus untuk mengambil data **Strapping Tank 2** pada web ASP.NET Pertamina (`apps.pertamina.com`).

Bookmarklet ini berguna untuk mengunduh seluruh data (Tinggi, Volume) secara beruntun dari **Halaman 1 sampai Halaman Terakhir** secara otomatis.

---

## Script Bookmarklet (2 Kolom - Multi-page)
**URL Target:** `.../MD_StrappingTank2.aspx?tank=31T003&plant=UjQwMQ==`

Copy seluruh teks di dalam kotak kode di bawah ini:

```javascript
javascript:(async function(){const tableSelector='table[id*="gvMaster"], table[id*="gvDetail"]';function extractData(doc){const table=doc.querySelector(tableSelector);if(!table)return[];let data=[];const rows=table.rows;for(let i=0;i<rows.length;i++){const cols=rows[i].cells;if(cols.length>=2){const h=cols[0].innerText.trim();const v=cols[1].innerText.trim();const cleanH=h.replace(/,/g,'').trim();const cleanV=v.replace(/,/g,'').trim();if(h!==""&&v!==""&&!h.toLowerCase().includes('tinggi')&&!isNaN(parseFloat(cleanH))&&!isNaN(parseFloat(cleanV))){data.push([h,v]);}}}return data;}let allData=[];let seen=new Set();let initialData=extractData(document);if(initialData.length===0){alert("Gagal mendeteksi tabel dengan 2 kolom.");return;}initialData.forEach(r=>{allData.push(r);seen.add(r.join('|'));});let targetID='';const links=document.querySelectorAll('a[href^="javascript:__doPostBack"]');for(let l of links){const m=l.href.match(/__doPostBack\s*\(\s*['"]([^'"]+)['"]/);if(m&&m[1]&&m[1].includes('gvMaster')){targetID=m[1];break;}}if(!targetID){const tb=document.querySelector(tableSelector);if(tb)targetID=tb.name||tb.id.replace(/_/g,'$');}const form=document.forms[0]||document.querySelector('form');const formUrl=form.action||window.location.href;let currentDoc=document;let page=2;const statusDiv=document.createElement('div');statusDiv.style.cssText='position:fixed;bottom:20px;right:20px;background:#333;color:#fff;padding:15px;border-radius:8px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-family:sans-serif;';document.body.appendChild(statusDiv);let errors=0;while(true){statusDiv.innerHTML='<b>Scraping Halaman '+page+'...</b><br>Total: '+allData.length;const formData=new URLSearchParams();currentDoc.querySelectorAll('input, select, textarea').forEach(i=>{if(i.name&&i.value!==undefined)formData.append(i.name,i.value);});formData.set('__EVENTTARGET',targetID);formData.set('__EVENTARGUMENT','Page$'+page);try{const res=await fetch(formUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:formData.toString()});if(!res.ok)throw new Error('HTTP '+res.status);const html=await res.text();currentDoc=new DOMParser().parseFromString(html,'text/html');const pageData=extractData(currentDoc);let newRows=0;pageData.forEach(r=>{const k=r.join('|');if(!seen.has(k)){allData.push(r);seen.add(k);newRows++;}});if(newRows===0)break;errors=0;page++;await new Promise(r=>setTimeout(r,1000));}catch(e){errors++;if(errors>=3){alert("Gagal memuat halaman beruntun.");break;}await new Promise(r=>setTimeout(r,2000));}}let csvContent="Tinggi;Volume\n"+allData.map(r=>r.join(';')).join('\n');statusDiv.innerHTML='<b>Selesai! ('+allData.length+' baris)</b><br><button id="sBtn" style="margin-top:10px;width:100%">Simpan CSV</button>';statusDiv.querySelector('#sBtn').onclick=()=>{const blob=new Blob([csvContent],{type:'text/csv;charset=utf-8;'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='strapping_tank2.csv';document.body.appendChild(link);link.click();document.body.removeChild(link);document.body.removeChild(statusDiv);};})();
```

---

### Cara Penggunaan:
1. Klik kanan pada **Bookmarks bar** di browser Anda, lalu pilih **"Add page..."** atau **"Add bookmark..."**
2. Beri nama bookmark (misal: `"Scrape Strapping 2"`).
3. Di bagian **URL**, hapus URL yang ada dan *Paste* seluruh script javascript di atas.
4. Klik **Save**.
5. Buka web Pertamina dan masuk ke halaman target: `MD_StrappingTank2.aspx?...`
6. Pastikan Anda berada di **Halaman 1** (sangat penting agar scraping mulai dari awal).
7. Klik bookmark **"Scrape Strapping 2"** yang baru dibuat.
8. Tunggu hingga proses scraping selesai, lalu klik tombol **"Simpan CSV"** yang muncul di pojok kanan bawah layar untuk mengunduh datanya.
