
// ── PHOTO ENHANCEMENT ──────────────────────────────────────────────────────────
function enhancePhoto(file,cb){const r=new FileReader();r.onload=ev=>{const img=new Image();img.onload=()=>{const c=document.getElementById('enhance-canvas');const W=800,H=500;c.width=W;c.height=H;const ctx=c.getContext('2d');const sr=img.width/img.height,tr=W/H;let sx=0,sy=0,sw=img.width,sh=img.height;if(sr>tr){sw=img.height*tr;sx=(img.width-sw)/2;}else{sh=img.width/tr;sy=(img.height-sh)*.45;}ctx.drawImage(img,sx,sy,sw,sh,0,0,W,H);const id=ctx.getImageData(0,0,W,H);const d=id.data;for(let i=0;i<d.length;i+=4){let r=d[i]*1.05,g=d[i+1]*1.05,b=d[i+2]*1.05;r=(r-128)*1.15+128;g=(g-128)*1.15+128;b=(b-128)*1.15+128;const l=.2126*r+.7152*g+.0722*b;r=l+(r-l)*1.2;g=l+(g-l)*1.2;b=l+(b-l)*1.2;d[i]=Math.max(0,Math.min(255,r));d[i+1]=Math.max(0,Math.min(255,g));d[i+2]=Math.max(0,Math.min(255,b));}ctx.putImageData(id,0,0);const v=ctx.createRadialGradient(W/2,H/2,H*.3,W/2,H/2,H*.85);v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,0,0,0.45)');ctx.fillStyle=v;ctx.fillRect(0,0,W,H);const g2=ctx.createLinearGradient(0,H*.6,0,H);g2.addColorStop(0,'rgba(0,0,0,0)');g2.addColorStop(1,'rgba(0,0,0,0.65)');ctx.fillStyle=g2;ctx.fillRect(0,0,W,H);cb(c.toDataURL('image/jpeg',.88));};img.src=ev.target.result;};r.readAsDataURL(file);}

// ── CAR SVG SILHOUETTES ───────────────────────────────────────────────────────
const _S=(d,vb='0 0 120 50')=>`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><path d="${d}" fill="white"/></svg>`)}`;
const CAR_SVG={
// ─ SEDANS ─
'camry':_S('M10 38h6a6 6 0 0112 0h52a6 6 0 0112 0h10c2 0 4-1 4-3v-4l-8-4-18-12c-2-1-4-2-7-2H39c-4 0-7 1-10 3L14 26l-8 3v6c0 2 1 3 4 3zM22 38a4 4 0 108 0 4 4 0 00-8 0zM86 38a4 4 0 108 0 4 4 0 00-8 0z'),
'civic':_S('M10 38h8a6 6 0 0112 0h48a6 6 0 0112 0h8c3 0 4-2 4-4v-3l-6-3-20-13c-2-1-5-2-8-2H38c-4 0-7 1-9 3L14 27l-8 3v4c0 2 2 4 4 4zM24 38a4 4 0 108 0 4 4 0 00-8 0zM84 38a4 4 0 108 0 4 4 0 00-8 0z'),
'accord':_S('M8 38h8a6 6 0 0112 0h50a6 6 0 0112 0h10c3 0 4-1 4-3v-5l-7-3-19-12c-2-2-5-2-8-2H38c-4 0-7 1-10 3L13 27l-9 3v5c0 2 1 3 4 3zM22 38a4 4 0 108 0 4 4 0 00-8 0zM86 38a4 4 0 108 0 4 4 0 00-8 0z'),
'altima':_S('M10 38h7a6 6 0 0112 0h50a6 6 0 0112 0h9c3 0 4-1 4-3v-5l-7-3-18-12c-2-1-5-2-8-2H40c-4 0-7 1-10 3L15 27l-9 3v5c0 2 1 3 4 3zM23 38a4 4 0 108 0 4 4 0 00-8 0zM85 38a4 4 0 108 0 4 4 0 00-8 0z'),
'corolla':_S('M10 38h8a6 6 0 0112 0h48a6 6 0 0112 0h8c2 0 4-2 4-4v-3l-7-4-18-11c-2-2-5-3-8-3H39c-3 0-6 1-9 3L16 26l-9 4v4c0 2 2 4 3 4zM24 38a4 4 0 108 0 4 4 0 00-8 0zM84 38a4 4 0 108 0 4 4 0 00-8 0z'),
'malibu':_S('M9 38h7a6 6 0 0112 0h52a6 6 0 0112 0h8c3 0 4-1 4-3v-5l-7-3-19-12c-2-1-4-2-7-2H39c-4 0-7 1-10 3L14 27l-9 3v5c0 2 1 3 4 3zM22 38a4 4 0 108 0 4 4 0 00-8 0zM86 38a4 4 0 108 0 4 4 0 00-8 0z'),
'sonata':_S('M10 38h7a6 6 0 0112 0h50a6 6 0 0112 0h9c3 0 4-1 4-3v-4l-8-4-17-12c-3-1-5-2-8-2H39c-4 0-7 1-10 3L14 27l-8 3v5c0 2 1 3 4 3zM23 38a4 4 0 108 0 4 4 0 00-8 0zM85 38a4 4 0 108 0 4 4 0 00-8 0z'),
'elantra':_S('M12 38h6a6 6 0 0112 0h48a6 6 0 0112 0h8c3 0 4-2 4-4v-3l-6-3-19-13c-2-1-4-2-7-2H40c-3 0-6 1-9 3L16 27l-8 3v4c0 2 1 4 4 4zM24 38a4 4 0 108 0 4 4 0 00-8 0zM84 38a4 4 0 108 0 4 4 0 00-8 0z'),
// ─ TRUCKS ─
'f-150':_S('M6 40h8a7 7 0 0114 0h40a7 7 0 0114 0h10c3 0 4-1 4-3v-6H80V18c0-2-1-3-3-3H52c-3 0-5 1-7 3l-9 10H14l-8 4v5c0 2 1 3 4 3zM20 40a5 5 0 1010 0 5 5 0 00-10 0zM76 40a5 5 0 1010 0 5 5 0 00-10 0z','0 0 108 50'),
'f150':_S('M6 40h8a7 7 0 0114 0h40a7 7 0 0114 0h10c3 0 4-1 4-3v-6H80V18c0-2-1-3-3-3H52c-3 0-5 1-7 3l-9 10H14l-8 4v5c0 2 1 3 4 3zM20 40a5 5 0 1010 0 5 5 0 00-10 0zM76 40a5 5 0 1010 0 5 5 0 00-10 0z','0 0 108 50'),
'silverado':_S('M6 40h7a7 7 0 0114 0h42a7 7 0 0114 0h9c3 0 4-1 4-3v-7H82V17c0-2-1-3-3-3H50c-3 0-5 1-7 3L34 28H14l-8 4v5c0 2 1 3 4 3zM19 40a5 5 0 1010 0 5 5 0 00-10 0zM77 40a5 5 0 1010 0 5 5 0 00-10 0z','0 0 108 50'),
'ram':_S('M6 40h8a7 7 0 0114 0h38a7 7 0 0114 0h12c3 0 4-1 4-3v-7H84V16c0-2-1-3-3-3H54c-3 0-6 1-8 3L36 28H14l-8 4v5c0 2 1 3 4 3zM20 40a5 5 0 1010 0 5 5 0 00-10 0zM74 40a5 5 0 1010 0 5 5 0 00-10 0z','0 0 108 50'),
'tundra':_S('M6 40h7a7 7 0 0114 0h42a7 7 0 0114 0h9c3 0 4-1 4-3v-7H82V17c0-2-1-3-3-3H52c-3 0-5 1-7 3L36 28H14l-8 4v5c0 2 1 3 4 3zM19 40a5 5 0 1010 0 5 5 0 00-10 0zM77 40a5 5 0 1010 0 5 5 0 00-10 0z','0 0 108 50'),
'tacoma':_S('M8 40h7a6 6 0 0112 0h42a6 6 0 0112 0h9c3 0 4-1 4-3v-6H78V19c0-2-1-3-3-3H52c-3 0-5 1-6 3L37 28H16l-8 4v5c0 2 1 3 4 3zM21 40a4 4 0 108 0 4 4 0 00-8 0zM75 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 104 50'),
'colorado':_S('M8 40h7a6 6 0 0112 0h42a6 6 0 0112 0h9c3 0 4-1 4-3v-6H78V19c0-2-1-3-3-3H53c-3 0-5 1-6 3L38 28H16l-8 4v5c0 2 1 3 4 3zM21 40a4 4 0 108 0 4 4 0 00-8 0zM75 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 104 50'),
'canyon':_S('M8 40h7a6 6 0 0112 0h42a6 6 0 0112 0h9c3 0 4-1 4-3v-6H78V19c0-2-1-3-3-3H53c-3 0-5 1-6 3L38 28H16l-8 4v5c0 2 1 3 4 3zM21 40a4 4 0 108 0 4 4 0 00-8 0zM75 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 104 50'),
'ranger':_S('M8 40h7a6 6 0 0112 0h44a6 6 0 0112 0h7c3 0 4-1 4-3v-6H80V20c0-2-1-3-3-3H54c-3 0-5 1-6 3L39 28H16l-8 4v5c0 2 1 3 4 3zM21 40a4 4 0 108 0 4 4 0 00-8 0zM77 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 104 50'),
'frontier':_S('M8 40h7a6 6 0 0112 0h42a6 6 0 0112 0h9c3 0 4-1 4-3v-6H78V19c0-2-1-3-3-3H52c-3 0-5 1-6 3L37 28H16l-8 4v5c0 2 1 3 4 3zM21 40a4 4 0 108 0 4 4 0 00-8 0zM75 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 104 50'),
'ridgeline':_S('M6 40h8a7 7 0 0114 0h40a7 7 0 0114 0h10c3 0 4-1 4-3v-6H80V19c0-2-1-3-3-3H53c-3 0-5 1-7 3l-8 9H15l-9 4v5c0 2 1 3 4 3zM20 40a5 5 0 1010 0 5 5 0 00-10 0zM76 40a5 5 0 1010 0 5 5 0 00-10 0z','0 0 108 50'),
// ─ SUVs ─
'cr-v':_S('M8 40h7a6 6 0 0112 0h50a6 6 0 0112 0h7c3 0 4-1 4-3v-6l-6-2V20c0-2-2-4-4-4H36c-3 0-5 1-7 3L16 28l-8 3v6c0 2 1 3 4 3zM21 40a4 4 0 108 0 4 4 0 00-8 0zM83 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 110 50'),
'rav4':_S('M8 40h7a6 6 0 0112 0h50a6 6 0 0112 0h7c3 0 4-1 4-3v-6l-6-2V19c0-2-2-4-4-4H37c-3 0-5 1-7 3L17 28l-9 3v6c0 2 1 3 4 3zM21 40a4 4 0 108 0 4 4 0 00-8 0zM83 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 110 50'),
'equinox':_S('M8 40h7a6 6 0 0112 0h50a6 6 0 0112 0h7c3 0 4-1 4-3v-6l-6-2V20c0-2-2-4-4-4H37c-3 0-5 1-7 3L17 28l-9 3v6c0 2 1 3 4 3zM21 40a4 4 0 108 0 4 4 0 00-8 0zM83 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 110 50'),
'rogue':_S('M8 40h7a6 6 0 0112 0h50a6 6 0 0112 0h7c3 0 4-1 4-3v-6l-6-2V20c0-2-2-4-4-4H37c-3 0-5 1-7 3L17 28l-9 3v6c0 2 1 3 4 3zM21 40a4 4 0 108 0 4 4 0 00-8 0zM83 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 110 50'),
'escape':_S('M8 40h7a6 6 0 0112 0h50a6 6 0 0112 0h7c3 0 4-1 4-3v-6l-6-2V20c0-2-2-4-4-4H36c-3 0-5 1-7 3L16 28l-8 3v6c0 2 1 3 4 3zM21 40a4 4 0 108 0 4 4 0 00-8 0zM83 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 110 50'),
'explorer':_S('M6 40h7a7 7 0 0114 0h48a7 7 0 0114 0h7c3 0 4-1 4-3v-7l-6-2V18c0-2-2-4-4-4H35c-3 0-6 1-8 3L14 28l-8 3v6c0 2 1 3 4 3zM19 40a5 5 0 1010 0 5 5 0 00-10 0zM83 40a5 5 0 1010 0 5 5 0 00-10 0z','0 0 112 50'),
'pilot':_S('M6 40h7a7 7 0 0114 0h48a7 7 0 0114 0h7c3 0 4-1 4-3v-7l-6-2V18c0-2-2-4-4-4H36c-3 0-6 1-8 3L15 28l-9 3v6c0 2 1 3 4 3zM19 40a5 5 0 1010 0 5 5 0 00-10 0zM83 40a5 5 0 1010 0 5 5 0 00-10 0z','0 0 112 50'),
'highlander':_S('M6 40h7a7 7 0 0114 0h48a7 7 0 0114 0h7c3 0 4-1 4-3v-7l-6-2V18c0-2-2-4-4-4H36c-3 0-6 1-8 3L15 28l-9 3v6c0 2 1 3 4 3zM19 40a5 5 0 1010 0 5 5 0 00-10 0zM83 40a5 5 0 1010 0 5 5 0 00-10 0z','0 0 112 50'),
'4runner':_S('M6 40h7a7 7 0 0114 0h46a7 7 0 0114 0h9c3 0 4-1 4-3v-8l-5-1V16c0-2-2-4-4-4H36c-3 0-6 1-8 3L14 28l-8 3v6c0 2 1 3 4 3zM19 40a5 5 0 1010 0 5 5 0 00-10 0zM81 40a5 5 0 1010 0 5 5 0 00-10 0z','0 0 112 50'),
'tahoe':_S('M4 40h7a7 7 0 0114 0h50a7 7 0 0114 0h7c3 0 4-1 4-3v-8l-5-1V15c0-2-2-4-4-4H34c-4 0-6 1-8 3L12 28l-8 3v6c0 2 1 3 4 3zM17 40a5 5 0 1010 0 5 5 0 00-10 0zM85 40a5 5 0 1010 0 5 5 0 00-10 0z','0 0 114 50'),
'suburban':_S('M4 42h7a7 7 0 0114 0h54a7 7 0 0114 0h7c3 0 4-1 4-3v-8l-5-2V15c0-2-2-4-4-4H32c-4 0-6 1-9 3L10 28l-8 4v7c0 2 1 3 4 3zM17 42a5 5 0 1010 0 5 5 0 00-10 0zM89 42a5 5 0 1010 0 5 5 0 00-10 0z','0 0 120 52'),
'sportage':_S('M8 40h7a6 6 0 0112 0h50a6 6 0 0112 0h7c3 0 4-1 4-3v-6l-6-2V20c0-2-2-4-4-4H37c-3 0-5 1-7 3L17 28l-9 3v6c0 2 1 3 4 3zM21 40a4 4 0 108 0 4 4 0 00-8 0zM83 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 110 50'),
'tucson':_S('M8 40h7a6 6 0 0112 0h50a6 6 0 0112 0h7c3 0 4-1 4-3v-6l-6-2V20c0-2-2-4-4-4H37c-3 0-5 1-7 3L17 28l-9 3v6c0 2 1 3 4 3zM21 40a4 4 0 108 0 4 4 0 00-8 0zM83 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 110 50'),
'cx-5':_S('M8 40h7a6 6 0 0112 0h50a6 6 0 0112 0h7c3 0 4-1 4-3v-6l-6-2V19c0-2-2-4-4-4H37c-3 0-5 1-7 3L17 28l-9 3v6c0 2 1 3 4 3zM21 40a4 4 0 108 0 4 4 0 00-8 0zM83 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 110 50'),
'bronco':_S('M6 40h7a7 7 0 0114 0h46a7 7 0 0114 0h9c3 0 4-1 4-3v-8l-5-1V14c0-2-2-3-4-3H36c-3 0-6 1-8 3L14 27l-8 4v6c0 2 1 3 4 3zM19 40a5 5 0 1010 0 5 5 0 00-10 0zM81 40a5 5 0 1010 0 5 5 0 00-10 0z','0 0 112 50'),
'wrangler':_S('M6 40h7a7 7 0 0114 0h44a7 7 0 0114 0h9c3 0 4-1 4-3v-9l-4-1V13c0-2-2-3-4-3H38c-3 0-4 1-4 3v15H16l-8 4v5c0 2 1 3 4 3zM19 40a5 5 0 1010 0 5 5 0 00-10 0zM79 40a5 5 0 1010 0 5 5 0 00-10 0z','0 0 108 50'),
// ─ VANS ─
'odyssey':_S('M4 40h7a6 6 0 0112 0h56a6 6 0 0112 0h5c3 0 4-1 4-3v-8l-4-1V16c0-2-2-3-4-3H24c-3 0-5 1-7 3L8 28l-4 3v6c0 2 1 3 4 3zM17 40a4 4 0 108 0 4 4 0 00-8 0zM85 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 114 50'),
'sienna':_S('M4 40h7a6 6 0 0112 0h56a6 6 0 0112 0h5c3 0 4-1 4-3v-8l-4-1V16c0-2-2-3-4-3H24c-3 0-5 1-7 3L8 28l-4 3v6c0 2 1 3 4 3zM17 40a4 4 0 108 0 4 4 0 00-8 0zM85 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 114 50'),
'pacifica':_S('M4 40h7a6 6 0 0112 0h58a6 6 0 0112 0h3c3 0 4-1 4-3v-8l-4-1V15c0-2-2-3-4-3H22c-3 0-5 1-7 3L6 28l-2 3v6c0 2 1 3 4 3zM17 40a4 4 0 108 0 4 4 0 00-8 0zM87 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 116 50'),
'caravan':_S('M4 40h7a6 6 0 0112 0h56a6 6 0 0112 0h5c3 0 4-1 4-3v-8l-4-1V16c0-2-2-3-4-3H24c-3 0-5 1-7 3L8 28l-4 3v6c0 2 1 3 4 3zM17 40a4 4 0 108 0 4 4 0 00-8 0zM85 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 114 50'),
// ─ SPORTS ─
'mustang':_S('M12 38h6a6 6 0 0112 0h52a6 6 0 0112 0h6c3 0 4-2 4-4v-3l-8-5-14-13c-3-2-6-3-9-3H40c-4 0-7 1-9 3L18 24l-10 5v5c0 2 1 4 4 4zM24 38a4 4 0 108 0 4 4 0 00-8 0zM88 38a4 4 0 108 0 4 4 0 00-8 0z'),
'camaro':_S('M14 38h4a6 6 0 0112 0h52a6 6 0 0112 0h4c3 0 4-2 4-4v-2l-8-6-14-14c-3-2-6-2-9-2H42c-4 0-7 1-9 2L20 24l-10 5v5c0 2 1 4 4 4zM24 38a4 4 0 108 0 4 4 0 00-8 0zM88 38a4 4 0 108 0 4 4 0 00-8 0z'),
'challenger':_S('M10 38h8a6 6 0 0112 0h50a6 6 0 0112 0h6c3 0 4-2 4-4v-3l-6-4-14-14c-2-2-5-3-9-3H42c-4 0-8 1-10 3L18 24l-10 5v5c0 2 1 4 2 4zM24 38a4 4 0 108 0 4 4 0 00-8 0zM86 38a4 4 0 108 0 4 4 0 00-8 0z'),
'corvette':_S('M16 38h4a5 5 0 0110 0h54a5 5 0 0110 0h4c2 0 4-2 4-4v-2l-6-4-16-15c-2-2-5-3-8-3H44c-4 0-7 1-9 3L22 24l-10 5v5c0 2 2 4 4 4zM25 38a3 3 0 106 0 3 3 0 00-6 0zM90 38a3 3 0 106 0 3 3 0 00-6 0z'),
'charger':_S('M10 38h8a6 6 0 0112 0h50a6 6 0 0112 0h8c3 0 4-2 4-4v-3l-7-4-16-14c-2-2-5-3-8-3H40c-4 0-7 1-10 3L17 24l-9 5v5c0 2 1 4 2 4zM24 38a4 4 0 108 0 4 4 0 00-8 0zM86 38a4 4 0 108 0 4 4 0 00-8 0z'),
'supra':_S('M14 38h6a5 5 0 0110 0h50a5 5 0 0110 0h6c2 0 4-2 4-4v-2l-6-5-14-14c-2-2-5-3-8-3H44c-4 0-7 1-9 3L22 24l-10 5v5c0 2 2 4 4 4zM25 38a3 3 0 106 0 3 3 0 00-6 0zM89 38a3 3 0 106 0 3 3 0 00-6 0z'),
// ─ GENERIC FALLBACKS ─
'_sedan':_S('M10 38h6a6 6 0 0112 0h52a6 6 0 0112 0h10c2 0 4-1 4-3v-4l-8-4-18-12c-2-1-4-2-7-2H39c-4 0-7 1-10 3L14 26l-8 3v6c0 2 1 3 4 3zM22 38a4 4 0 108 0 4 4 0 00-8 0zM86 38a4 4 0 108 0 4 4 0 00-8 0z'),
'_truck':_S('M6 40h8a7 7 0 0114 0h40a7 7 0 0114 0h10c3 0 4-1 4-3v-6H80V18c0-2-1-3-3-3H52c-3 0-5 1-7 3l-9 10H14l-8 4v5c0 2 1 3 4 3zM20 40a5 5 0 1010 0 5 5 0 00-10 0zM76 40a5 5 0 1010 0 5 5 0 00-10 0z','0 0 108 50'),
'_suv':_S('M8 40h7a6 6 0 0112 0h50a6 6 0 0112 0h7c3 0 4-1 4-3v-6l-6-2V20c0-2-2-4-4-4H36c-3 0-5 1-7 3L16 28l-8 3v6c0 2 1 3 4 3zM21 40a4 4 0 108 0 4 4 0 00-8 0zM83 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 110 50'),
'_van':_S('M4 40h7a6 6 0 0112 0h56a6 6 0 0112 0h5c3 0 4-1 4-3v-8l-4-1V16c0-2-2-3-4-3H24c-3 0-5 1-7 3L8 28l-4 3v6c0 2 1 3 4 3zM17 40a4 4 0 108 0 4 4 0 00-8 0zM85 40a4 4 0 108 0 4 4 0 00-8 0z','0 0 114 50'),
'_sport':_S('M12 38h6a6 6 0 0112 0h52a6 6 0 0112 0h6c3 0 4-2 4-4v-3l-8-5-14-13c-3-2-6-3-9-3H40c-4 0-7 1-9 3L18 24l-10 5v5c0 2 1 4 4 4zM24 38a4 4 0 108 0 4 4 0 00-8 0zM88 38a4 4 0 108 0 4 4 0 00-8 0z')
};
function carImage(n){
  const v=(n||'').toLowerCase();
  // Try specific model match
  for(const k in CAR_SVG){if(k[0]!=='_'&&v.includes(k))return'<img src="'+CAR_SVG[k]+'" style="width:100%;height:100%;object-fit:contain;opacity:0.35;padding:12%"/>';}
  // Fall back to category
  if(/truck|f-150|f150|silverado|ram\s?\d|tundra|tacoma|colorado|canyon|ranger|frontier|ridgeline/.test(v))return'<img src="'+CAR_SVG._truck+'" style="width:100%;height:100%;object-fit:contain;opacity:0.35;padding:12%"/>';
  if(/van|odyssey|sienna|pacifica|caravan/.test(v))return'<img src="'+CAR_SVG._van+'" style="width:100%;height:100%;object-fit:contain;opacity:0.35;padding:12%"/>';
  if(/mustang|camaro|challenger|corvette|charger|supra/.test(v))return'<img src="'+CAR_SVG._sport+'" style="width:100%;height:100%;object-fit:contain;opacity:0.35;padding:12%"/>';
  if(/cr-v|rav4|equinox|rogue|escape|explorer|pilot|highlander|4runner|tahoe|suburban|sportage|tucson|cx-5|bronco|wrangler/.test(v))return'<img src="'+CAR_SVG._suv+'" style="width:100%;height:100%;object-fit:contain;opacity:0.35;padding:12%"/>';
  return'<img src="'+CAR_SVG._sedan+'" style="width:100%;height:100%;object-fit:contain;opacity:0.35;padding:12%"/>';
}

// ── CURATED CATEGORY PHOTOS (B&W, hand-picked from Pexels) ────────────────────
const pxCache={};
const CAT_SVG={
  sedan:`<svg viewBox="0 0 300 100" xmlns="http://www.w3.org/2000/svg"><rect width="300" height="100" fill="#e8e8e8"/><circle cx="65" cy="82" r="17" fill="#1a1a1a"/><circle cx="65" cy="82" r="7" fill="#888"/><circle cx="235" cy="82" r="17" fill="#1a1a1a"/><circle cx="235" cy="82" r="7" fill="#888"/><path fill="#1a1a1a" d="M5,76 L5,66 Q8,58 20,54 L76,50 Q85,44 92,34 L112,20 Q122,15 142,15 L172,15 Q190,15 198,21 L215,34 Q221,42 225,49 L248,52 Q268,54 278,60 L290,66 Q294,71 294,76 Z"/></svg>`,
  coupe:`<svg viewBox="0 0 320 100" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="100" fill="#e8e8e8"/><circle cx="78" cy="82" r="17" fill="#1a1a1a"/><circle cx="78" cy="82" r="7" fill="#888"/><circle cx="246" cy="82" r="17" fill="#1a1a1a"/><circle cx="246" cy="82" r="7" fill="#888"/><path fill="#1a1a1a" d="M5,76 L5,64 Q8,56 22,52 L85,48 Q97,38 108,25 L132,17 Q148,14 170,14 L200,14 Q220,14 230,21 L250,44 Q256,49 260,52 L282,54 Q302,57 314,64 L316,68 Q317,72 315,76 Z"/></svg>`,
  suv:`<svg viewBox="0 0 300 100" xmlns="http://www.w3.org/2000/svg"><rect width="300" height="100" fill="#e8e8e8"/><circle cx="62" cy="84" r="18" fill="#1a1a1a"/><circle cx="62" cy="84" r="8" fill="#888"/><circle cx="238" cy="84" r="18" fill="#1a1a1a"/><circle cx="238" cy="84" r="8" fill="#888"/><path fill="#1a1a1a" d="M5,76 L5,64 Q8,54 22,50 L46,46 L58,22 Q66,12 86,11 L214,11 Q232,11 240,22 L254,44 L276,48 Q290,54 293,64 L293,76 Z"/></svg>`,
  truck:`<svg viewBox="0 0 340 100" xmlns="http://www.w3.org/2000/svg"><rect width="340" height="100" fill="#e8e8e8"/><circle cx="78" cy="82" r="17" fill="#1a1a1a"/><circle cx="78" cy="82" r="7" fill="#888"/><circle cx="210" cy="82" r="17" fill="#1a1a1a"/><circle cx="210" cy="82" r="7" fill="#888"/><path fill="#1a1a1a" d="M5,74 L5,60 Q8,50 22,46 L46,44 L58,20 Q66,12 86,11 L176,11 Q192,11 200,22 L215,46 L218,74 Z"/><path fill="#1a1a1a" d="M220,74 L220,48 L322,48 L328,54 Q332,60 332,66 L332,74 Z"/><rect x="218" y="48" width="4" height="26" fill="#2d2d2d"/></svg>`,
  van:`<svg viewBox="0 0 300 100" xmlns="http://www.w3.org/2000/svg"><rect width="300" height="100" fill="#e8e8e8"/><circle cx="62" cy="84" r="17" fill="#1a1a1a"/><circle cx="62" cy="84" r="7" fill="#888"/><circle cx="238" cy="84" r="17" fill="#1a1a1a"/><circle cx="238" cy="84" r="7" fill="#888"/><path fill="#1a1a1a" d="M8,76 L8,38 Q10,22 28,16 L236,14 Q256,14 264,26 L272,42 L276,52 Q280,60 280,68 L280,76 Z"/></svg>`
};
function carCategory(name){
  const v=(name||'').toLowerCase();
  if(/truck|pickup|f-?150|f-?250|f-?350|silverado|sierra|ram\s?\d|tundra|tacoma|colorado|canyon|ranger|frontier|ridgeline|titan/.test(v))return'truck';
  if(/van|odyssey|sienna|pacifica|caravan|transit|express|savana|sprinter|metris|town.country/.test(v))return'van';
  if(/mustang|camaro|challenger|corvette|charger|supra|370z|350z|brz|86|miata|mx-?5|genesis.coupe|stinger/.test(v))return'coupe';
  if(/cr-?v|rav4|equinox|rogue|escape|explorer|pilot|highlander|4runner|tahoe|suburban|yukon|escalade|expedition|navigator|sportage|tucson|cx-?5|cx-?9|bronco|wrangler|cherokee|durango|traverse|enclave|acadia|mdx|rdx|qx|q5|q7|x3|x5|rx|gx|lx|gls|gle|murano|pathfinder|armada|sequoia|atlas|tiguan|sorento|santa.fe|outback|forester|crosstrek|defender|discovery/.test(v))return'suv';
  return'sedan';
}
const CAT_PHOTO={sedan:'stock-sedan.png',coupe:'stock-coupe.png',truck:'stock-truck.png',van:'stock-van.png',suv:'stock-sedan.png'};
function fetchPexels(car){
  const cat=carCategory(car.name);
  return Promise.resolve(CAT_PHOTO[cat]||'stock-sedan.png');
}

function applyPexels(cars){
  (cars||[]).forEach(car=>{
    if(!car||car.photo)return;
    if(pxCache[String(car.id)]){_swapPx(car.id,pxCache[String(car.id)]);return;}
    fetchPexels(car).then(url=>{if(url)_swapPx(car.id,url);});
  });
}

function _swapPx(id,url){
  // Grid tile photo-wrap
  const ph=document.querySelector(`.tile-ph[data-px="${id}"]`);
  if(ph&&ph.parentElement){ph.parentElement.innerHTML=`<img class="tile-photo" src="${url}"/><div class="tile-vig"></div><div class="tile-grad"></div>`;}
  // Inventory thumb
  const inv=document.querySelector(`.inv-thumb-ph[data-px="${id}"]`);
  if(inv){inv.outerHTML=`<img class="inv-thumb" src="${url}"/>`;}
  // Review card
  const rc=document.querySelector(`.rc-img-ph[data-px="${id}"]`);
  if(rc){rc.outerHTML=`<img class="rc-img" src="${url}"/>`;}
}

// ── SUPABASE CONFIG ────────────────────────────────────────────────────────────
const SB_URL = 'https://hphlouzqlimainczuqyc.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwaGxvdXpxbGltYWluY3p1cXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjY0MTIsImV4cCI6MjA4OTM0MjQxMn0.-nmd36YCd2p_Pyt5VImN7rJk9MCLRdkyv0INmuFwAVo';
const SB_HEADERS = {'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation'};

/* ── OneSignal Push Notifications ── */
const OS_APP_ID = 'ff6238d8-1a7b-4415-a589-229cd4059233';
const OS_API_KEY = 'os_v2_app_75rdrwa2pncbljmjekonibmsgockubkbqhye6s4z4gqacioqkjnikx3h2c4kmvnegu7lrveqk22en7uzkrhw56fqc3cms2jduc2aojq';

window.OneSignalDeferred = window.OneSignalDeferred || [];
OneSignalDeferred.push(async function(OneSignal){
  await OneSignal.init({
    appId: OS_APP_ID,
    safari_web_id: 'web.onesignal.auto.3437296f-1581-4c9c-99a7-ef947df2b18c',
    notifyButton: { enable: false },
    autoPrompt: false
  });
});

// Call after login to link user + show enable bar if needed
function initOneSignalUser(name){
  window._osExternalId = name.toLowerCase().replace(/\s+/g,'_');
  // Use native Notification API — always available, no async needed
  const perm = (typeof Notification !== 'undefined') ? Notification.permission : 'granted';
  if(perm !== 'granted'){ showNotifEnableBar(); }
  // Link user to OneSignal whenever SDK is ready
  function linkUser(OS){
    try{ OS.login(window._osExternalId); }catch(e){}
  }
  if(window.OneSignal && typeof window.OneSignal.login==='function'){
    linkUser(window.OneSignal);
  } else {
    OneSignalDeferred.push(linkUser);
  }
}

function showNotifEnableBar(){
  if(document.getElementById('notif-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'notif-bar';
  bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9999;background:#1a1a2e;border-bottom:1px solid #4f46e5;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;';
  bar.innerHTML='<span style="font-size:13px;color:#ccc;">🔔 Enable push notifications</span><button onclick="enableOSNotifications()" style="background:#4f46e5;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;">Enable</button><button onclick="document.getElementById(\'notif-bar\').remove()" style="background:none;border:none;color:#666;font-size:20px;cursor:pointer;padding:0 4px;">×</button>';
  document.body.appendChild(bar);
}

async function enableOSNotifications(){
  try{
    // Request via OneSignal if ready, fallback to native API
    if(window.OneSignal && window.OneSignal.Notifications){
      await window.OneSignal.Notifications.requestPermission();
    } else {
      await Notification.requestPermission();
    }
    document.getElementById('notif-bar')?.remove();
    // Link user after granting
    if(window._osExternalId && window.OneSignal && window.OneSignal.login){
      window.OneSignal.login(window._osExternalId);
    }
  }catch(e){ console.log('Enable notif err:',e); }
}

async function sendPushNotification(targetNames, title, body){
  if(!targetNames||targetNames.length===0) return;
  const externalIds = targetNames.map(n=>n.toLowerCase().replace(/\s+/g,'_'));
  try{
    await fetch('https://onesignal.com/api/v1/notifications',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Key '+OS_API_KEY},
      body:JSON.stringify({
        app_id: OS_APP_ID,
        include_external_user_ids: externalIds,
        channel_for_external_user_ids: 'push',
        headings:{ en: title },
        contents:{ en: body }
      })
    });
  }catch(e){ console.log('Push failed:',e); }
}

async function sbGet(table, params='') {
  const r = await fetch(SB_URL+'/rest/v1/'+table+'?'+params, {headers:SB_HEADERS});
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}
async function sbPost(table, body) {
  const r = await fetch(SB_URL+'/rest/v1/'+table, {method:'POST',headers:SB_HEADERS,body:JSON.stringify(body)});
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}
async function sbPatch(table, id, body) {
  const r = await fetch(SB_URL+'/rest/v1/'+table+'?id=eq.'+id, {method:'PATCH',headers:SB_HEADERS,body:JSON.stringify(body)});
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}
async function sbDelete(table, id) {
  const r = await fetch(SB_URL+'/rest/v1/'+table+'?id=eq.'+id, {method:'DELETE',headers:SB_HEADERS});
  if(!r.ok) throw new Error(await r.text());
}

// ── NOTIFICATIONS ───────────────────────────────────────────────────────────
async function fetchNotifications(){
  if(!me) return;
  try{
    const rows=await sbGet('notifications','recipient_id=eq.'+me.id+'&read=eq.false&order=created_at.desc&limit=50');
    S.notifications=rows.map(r=>({id:r.id,message:r.message,assignmentId:r.assignment_id,carName:r.car_name,createdBy:r.created_by,createdAt:r.created_at,read:r.read}));
    updateNotifBadge();
  }catch(e){ S.notifications=[]; }
}
async function createNotification(recipientId, message, assignmentId, carName){
  try{
    await sbPost('notifications',{recipient_id:recipientId,message,assignment_id:assignmentId,car_name:carName,created_by:me.name,read:false});
  }catch(e){}
}
function updateNotifBadge(){
  const count=S.notifications.filter(n=>!n.read).length;
  const badge=document.getElementById('notif-count');
  if(!badge) return;
  if(count>0){badge.style.display='block';badge.textContent=count>9?'9+':count;}
  else{badge.style.display='none';}
}
async function openNotifPanel(){
  const el=document.getElementById('notif-list');
  if(!S.notifications.length){
    el.innerHTML='<div style="text-align:center;color:#444;padding:40px 0;font-size:14px;">No new notifications</div>';
  } else {
    el.innerHTML=S.notifications.map(n=>`
      <div style="padding:12px;background:#0a0a0a;border-radius:10px;margin-bottom:8px;border:1px solid #1a1a1a;">
        <div style="font-size:14px;color:#ccc;">${n.message}</div>
        <div style="font-size:11px;color:#444;margin-top:4px;">${new Date(n.createdAt).toLocaleString()}</div>
      </div>`).join('');
    // Mark all as read
    try{
      for(const n of S.notifications){
        if(!n.read) await sbPatch('notifications',n.id,{read:true});
      }
      S.notifications=[];
      updateNotifBadge();
    }catch(e){}
  }
  openM('m-notifs');
}

// ── STATE ──────────────────────────────────────────────────────────────────────
const DEFAULT_TASKS=[{name:'Repairs',urgent:false},{name:'Parts',urgent:false},{name:'Detail',urgent:false},{name:'Photos',urgent:false}];

// S holds local cache - Supabase is the source of truth
let S={employees:[],inventory:[],assignments:[],notifications:[],calendarEvents:[]};
let me=null,curAssign=null,curTaskId=null,uploadedPhotos=[],pendingCarPhoto=null,invFilter='',customTasksForAssign=[];

// Local cache save/load (fallback + session persistence)
function sv(){try{localStorage.setItem('cf_sb2',JSON.stringify(S));}catch(e){}}
function ld(){/* localStorage disabled - Supabase is source of truth */}

// Show loading state
function showLoading(msg){
  document.getElementById('load-overlay').style.display='flex';
  document.getElementById('load-msg').textContent=msg||'Loading...';
}
function hideLoading(){document.getElementById('load-overlay').style.display='none';}

// ── SUPABASE DATA SYNC ─────────────────────────────────────────────────────────
async function syncFromSupabase(){
  showLoading('Syncing data...');
  try{
    // Always fetch ALL data from Supabase - never use localStorage for inventory/employees
    const [emps, inv, asgn, calEvRaw] = await Promise.all([
      sbGet('employees', 'order=name&limit=500'),
      sbGet('inventory', 'order=name&limit=500&select=*'),
      sbGet('assignments', 'select=*&order=assigned_at.desc&limit=500'),
      sbGet('calendar_events', 'order=event_date.asc&limit=500').catch(()=>[])
    ]);
    S.calendarEvents = Array.isArray(calEvRaw) ? calEvRaw : [];
    if(!emps || !inv) throw new Error('Empty response from Supabase');
    // Completely replace — never merge with stale localStorage
    S.employees = emps.map(e=>({id:e.id,name:e.name,username:e.username,pin:e.pin,role:e.role,location:e.location}));
    const colorMap=JSON.parse(localStorage.getItem('cf_colormap')||'{}');
    const pxSaved=localStorage.getItem('px_cache');
    S.inventory = inv.map(c=>({id:c.id,name:c.name,stock:c.stock,vin:c.vin||'',color:c.color||colorMap[c.vin]||colorMap[c.stock]||'',location:c.location,photo:c.photo||null,work:c.work||{}}));
    S.assignments = asgn.map(a=>({id:a.id,inventoryId:a.inventory_id,employeeId:a.employee_id,tasks:a.tasks||[],submitted:a.submitted,approved:a.approved,photos:a.photos||[],assignedAt:a.assigned_at,submittedAt:a.submitted_at}));
    // Wipe localStorage completely and save fresh Supabase data
    Object.keys(localStorage).filter(k=>!k.startsWith("cf_work_")).forEach(k=>localStorage.removeItem(k));
    if(Object.keys(colorMap).length) localStorage.setItem('cf_colormap',JSON.stringify(colorMap));
    if(pxSaved) localStorage.setItem('px_cache',pxSaved);
    sv();
    console.log('Synced from Supabase:', S.inventory.length, 'cars,', S.employees.length, 'employees');
  } catch(e){
    console.error('Sync failed:', e);
    showLoading('Sync failed — retrying...');
    setTimeout(()=>syncFromSupabase(), 2000);
    return;
  }
  hideLoading();
}

// ── OFFLINE DETECTION ──────────────────────────────────────────────────────────
window.addEventListener('online',()=>{document.getElementById('offline-notice').style.display='none';});
window.addEventListener('offline',()=>{document.getElementById('offline-notice').style.display='block';});
if(!navigator.onLine) document.getElementById('offline-notice').style.display='block';

// ── AUTH ───────────────────────────────────────────────────────────────────────
async function doLogin(){
  const u=document.getElementById('lu').value.trim().toLowerCase();
  const p=document.getElementById('lp').value.trim();
  // First try local cache, then sync
  showLoading('Signing in...');
  try {
    const emps = await sbGet('employees','select=*');
    S.employees = emps.map(e=>({id:e.id,name:e.name,username:e.username,pin:e.pin,role:e.role,location:e.location}));
  } catch(e) { ld(); }
  hideLoading();
  const e=S.employees.find(x=>x.username.toLowerCase()===u&&x.pin===p);
  if(!e){document.getElementById('lerr').textContent='Invalid username or PIN';return;}
  me=e;
  // Save session for auto-login if remember-me is checked
  const rememberMe=document.getElementById('remember-me');
  if(!rememberMe||rememberMe.checked){localStorage.setItem('cf_session',JSON.stringify(me));localStorage.setItem('cf_saved_user',document.getElementById('lu').value.trim());localStorage.setItem('cf_saved_pin',document.getElementById('lp').value.trim());}
  initOneSignalUser(e.name);
  document.getElementById('login').style.display='none';
  document.getElementById('app').style.display='flex';
  document.getElementById('ub').textContent=e.name;
  await syncFromSupabase();
  fetchNotifications();
  if(e.role==='manager'){document.getElementById('mtabs').style.display='none';showView('mgr-home');updateTabBadges();updateHomeBadges();}
  else{document.getElementById('mtabs').style.display='none';document.getElementById('emp-tabs').style.display='flex';document.getElementById('emp-tab-name').textContent=e.name.split(' ')[0];document.getElementById('greeting').textContent='Hi '+e.name.split(' ')[0]+', your cars today';document.getElementById('personal-greeting').textContent=e.name.split(' ')[0]+"'s Assignments";showView('emp-home');empTabGo('detail',document.querySelector('#emp-tabs .mt'));}
}
function doSync(){
  const btn=document.getElementById('sync-btn');
  btn.style.color='#30d158';
  btn.style.pointerEvents='none';
  btn.style.animation='spin 1s linear infinite';
  // Save session so user stays logged in after reload
  if(me) localStorage.setItem('cf_session', JSON.stringify(me));
  // Tell SW to fetch fresh app version
  if('serviceWorker' in navigator && navigator.serviceWorker.controller){
    navigator.serviceWorker.controller.postMessage('SYNC');
    // Fallback: if SW doesn't respond in 5s, reload anyway
    setTimeout(()=>{ if(btn.style.pointerEvents==='none') window.location.reload(); }, 5000);
  } else {
    // No SW — just reload
    window.location.reload();
  }
}
function doLogout(){me=null;localStorage.removeItem('cf_session');var tb=document.querySelector('.tb');if(tb)tb.style.display='';var bb=document.getElementById('mgr-back-bar');if(bb)bb.style.display='none';document.getElementById('app').style.display='none';document.getElementById('login').style.display='flex';document.getElementById('lu').value='';document.getElementById('lp').value='';document.getElementById('lerr').textContent='';document.getElementById('mtabs').style.display='none';}
document.getElementById('lp').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});

// ── NAV ────────────────────────────────────────────────────────────────────────
function showView(id){document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));document.getElementById(id).classList.add('on');}
function mgrGo(id,btn){document.querySelectorAll('#mtabs .mt').forEach(b=>b.classList.remove('on'));btn.classList.add('on');showView('mgr-'+id);if(id==='inventory')renderInv();if(id==='assigned')renderAssigned();if(id==='detail')renderMgrDetail();if(id==='photos')renderMgrPhotos();if(id==='parts')renderMgrParts();if(id==='tasks')renderReview();if(id==='employees')renderTeam();updateTabBadges();}

function updateTabBadges(){
  const tabTasks=document.getElementById('tab-tasks');
  const tabDetail=document.getElementById('tab-detail');
  const tabPhotos=document.getElementById('tab-photos');
  const tabRepair=document.getElementById('tab-repair');
  function setBadge(el,label,count){
    if(!el) return;
    if(count>0){
      el.innerHTML=label+' <span style="background:#ff453a;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:10px;margin-left:2px;">'+count+'</span>';
    }else{
      el.textContent=label;
    }
  }
  const taskReviewCount=S.assignments.filter(a=>a.submitted&&!a.approved).length;
  setBadge(tabTasks,'Tasks',taskReviewCount);
  const detailCount=S.inventory.filter(car=>{
    const ws=getWorkState(car.id);
    return ws.categories&&ws.categories.detail&&ws.categories.detail.done&&!ws.categories.detail.reviewed;
  }).length;
  setBadge(tabDetail,'Detail',detailCount);
  const photosCount=S.inventory.filter(car=>{
    const ws=getWorkState(car.id);
    return ws.categories&&ws.categories.photos&&ws.categories.photos.done&&!ws.categories.photos.reviewed;
  }).length;
  setBadge(tabPhotos,'Photos',photosCount);
  setBadge(tabRepair,'Repair',taskReviewCount);
}

// ── EMPLOYEE GRID ──────────────────────────────────────────────────────────────
function renderGrid(){
  const mine=S.assignments.filter(a=>a.employeeId===me.id&&!a.approved);
  const grid=document.getElementById('car-grid');const empty=document.getElementById('grid-empty');
  if(!mine.length){grid.style.display='none';empty.style.display='flex';return;}
  grid.style.display='grid';empty.style.display='none';
  grid.innerHTML=mine.map(a=>{
    const car=S.inventory.find(c=>c.id===a.inventoryId);if(!car)return'';
    const done=a.tasks.filter(t=>t.done).length;const total=a.tasks.length;
    const pct=total?Math.round(done/total*100):0;
    const status=a.submitted?'review':done===total?'done':'prog';
    const hasUrgent=a.tasks.some(t=>t.urgent&&!t.done);
    const badge=status==='review'?'<span class="tile-badge tbr">Review</span>':status==='done'?'<span class="tile-badge tbd">Done</span>':`<span class="tile-badge tbp">${done}/${total}</span>`;
    const urgentBadge=hasUrgent?'<span class="tile-urgent">&#x26A0; Urgent</span>':'';
    const pxUrl=!car.photo&&pxCache[String(car.id)];
    const photoHTML=car.photo?`<img class="tile-photo" src="${car.photo}"/><div class="tile-vig"></div><div class="tile-grad"></div>`:pxUrl?`<img class="tile-photo" src="${pxUrl}"/><div class="tile-vig"></div><div class="tile-grad"></div>`:`<div class="tile-ph" data-px="${car.id}">${carImage(car.name)}</div>`;
    const vinLast6=car.vin?car.vin.slice(-6):car.stock;const colorStr=car.color?car.color:'';const tileSubLine=colorStr?`${vinLast6} · ${colorStr}`:vinLast6;
    return`<div class="car-tile st-${status}" onclick="openTaskView(${a.id})">${badge}${urgentBadge}<div class="tile-photo-wrap">${photoHTML}</div><div class="tile-body"><div class="tile-name">${car.name}</div><div class="tile-stock">${tileSubLine}</div><div class="tile-pb"><div class="tile-pf ${status==='done'||status==='review'?'pfg':'pfw'}" style="width:${pct}%"></div></div><div class="tile-pct">${pct}% complete</div></div></div>`;
  }).join('');
  applyPexels(mine.map(a=>S.inventory.find(c=>c.id===a.inventoryId)).filter(Boolean));
}

// ── EMPLOYEE TABS ─────────────────────────────────────────────────────────────
let curEmpTab='detail';
function empTabGo(tab,btn){
  curEmpTab=tab;
  document.querySelectorAll('#emp-tabs .mt').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  ['detail','photos','parts','tasks','personal'].forEach(t=>{
    const el=document.getElementById('emp-tab-'+t);
    if(el) el.style.display=t===tab?'block':'none';
  });
  if(tab==='detail') renderDetailQueue();
  else if(tab==='photos') renderPhotosQueue();
  else if(tab==='parts') renderPartsQueue();
  else if(tab==='tasks') renderGrid();
  else if(tab==='personal') renderPersonalTab();
}
function renderDetailQueue(){
  // Show only cars assigned to Detail section pool
  const cars=S.inventory.filter(car=>{
    const ws=getWorkState(car.id);
    return ws.categories&&ws.categories.detail&&ws.categories.detail.sectionPool;
  });
  const grid=document.getElementById('detail-grid');
  const empty=document.getElementById('detail-empty');
  if(!cars.length){grid.style.display='none';empty.style.display='flex';return;}
  grid.style.display='grid';empty.style.display='none';
  grid.innerHTML=cars.map(car=>{
    const ws=getWorkState(car.id);
    const isDetail=ws.categories&&ws.categories.detail&&ws.categories.detail.sectionPool;
    const isPhotos=ws.categories&&ws.categories.photos&&ws.categories.photos.sectionPool;
    const pxUrl=!car.photo&&pxCache[String(car.id)];
    const photoHTML=car.photo?`<img class="tile-photo" src="${car.photo}"/><div class="tile-vig"></div><div class="tile-grad"></div>`:pxUrl?`<img class="tile-photo" src="${pxUrl}"/><div class="tile-vig"></div><div class="tile-grad"></div>`:`<div class="tile-ph" data-px="${car.id}">${carImage(car.name)}</div>`;
    const vinLast6=car.vin?car.vin.slice(-6):car.stock;
    const detailDone=ws.categories&&ws.categories.detail&&ws.categories.detail.done;
    return`<a href="javascript:void(0)" onclick="openDetailDoneModal(${car.id})" class="car-tile" style="display:block;text-decoration:none;color:inherit;border-color:${detailDone?'rgba(48,209,88,.4)':'#1e3a1e'};">
      <div class="tile-photo-wrap">${photoHTML}</div>
      <div class="tile-body"><div class="tile-name">${car.name}</div><div class="tile-stock">${vinLast6}${car.color?' · '+car.color:''}</div>
      <div style="color:#30d158;font-size:10px;font-weight:600;margin-top:4px;">✨ Detail</div>
      ${detailDone?'<div style="color:#30d158;font-size:11px;margin-top:2px;">✓ Done</div>':''}
      </div>
    </a>`;
  }).join('');
  applyPexels(cars);
}
function renderPersonalTab(){
  // Show cars where photos/detail is assigned to THIS employee specifically
  const cars=S.inventory.filter(car=>{
    const ws=getWorkState(car.id);
    if(!ws.categories) return false;
    return Object.values(ws.categories).some(c=>c.assignedTo===me.id);
  });
  const grid=document.getElementById('personal-grid');
  const empty=document.getElementById('personal-empty');
  if(!cars.length){grid.style.display='none';empty.style.display='flex';return;}
  grid.style.display='grid';empty.style.display='none';
  grid.innerHTML=cars.map(car=>{
    const ws=getWorkState(car.id);
    const assigned=Object.entries(ws.categories||{}).filter(([k,v])=>v.assignedTo===me.id).map(([k])=>k);
    const tags=assigned.map(k=>`<span style="color:#64d2ff;font-size:10px;font-weight:600;">${catIcon(k)} ${k}</span>`).join(' ');
    const pxUrl=!car.photo&&pxCache[String(car.id)];
    const photoHTML=car.photo?`<img class="tile-photo" src="${car.photo}"/><div class="tile-vig"></div><div class="tile-grad"></div>`:pxUrl?`<img class="tile-photo" src="${pxUrl}"/><div class="tile-vig"></div><div class="tile-grad"></div>`:`<div class="tile-ph" data-px="${car.id}">${carImage(car.name)}</div>`;
    const vinLast6=car.vin?car.vin.slice(-6):car.stock;
    return`<div class="car-tile" style="border-color:#1a2a3a;">
      <div class="tile-photo-wrap">${photoHTML}</div>
      <div class="tile-body"><div class="tile-name">${car.name}</div><div class="tile-stock">${vinLast6}${car.color?' · '+car.color:''}</div><div style="margin-top:4px;">${tags}</div></div>
    </div>`;
  }).join('');
  applyPexels(cars);
}

// ── DETAIL DONE MODAL ─────────────────────────────────────────────────────────
function openDetailDoneModal(carId){
  const car=S.inventory.find(c=>c.id===carId);
  if(!car) return;
  const ws=getWorkState(carId);
  const cats=ws.categories||{};
  const isDetail=cats.detail&&cats.detail.sectionPool;
  const isPhotos=cats.photos&&cats.photos.sectionPool;
  const detailDone=cats.detail&&cats.detail.done;
  const photosDone=cats.photos&&cats.photos.done;
  let html=`<div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:16px;">${car.name}</div>`;
  if(isDetail){
    html+=`<button onclick="markDetailDone(${carId},'detail')" style="width:100%;padding:14px;background:${detailDone?'#30d158':'#1a1a1a'};border:1px solid ${detailDone?'#30d158':'#333'};border-radius:10px;color:${detailDone?'#000':'#fff'};font-size:14px;font-weight:600;cursor:pointer;margin-bottom:8px;text-align:left;">
      ✨ Detail — ${detailDone?'✓ Done (tap to undo)':'Tap to mark done'}
    </button>`;
  }
  if(isPhotos){
    html+=`<button onclick="markDetailDone(${carId},'photos')" style="width:100%;padding:14px;background:${photosDone?'#30d158':'#1a1a1a'};border:1px solid ${photosDone?'#30d158':'#333'};border-radius:10px;color:${photosDone?'#000':'#fff'};font-size:14px;font-weight:600;cursor:pointer;margin-bottom:8px;text-align:left;">
      📷 Photos — ${photosDone?'✓ Done (tap to undo)':'Tap to mark done'}
    </button>`;
  }
  html+=`<button onclick="closeM('m-detail-done')" style="width:100%;padding:12px;background:none;border:1px solid #333;border-radius:10px;color:#888;font-size:14px;cursor:pointer;margin-top:8px;">Close</button>`;
  document.getElementById('detail-done-body').innerHTML=html;
  openM('m-detail-done');
}
async function markDetailDone(carId,section){
  const ws=getWorkState(carId);
  if(!ws.categories) ws.categories={};
  if(!ws.categories[section]) ws.categories[section]={selected:false,description:'',repairs:[],sectionPool:true};
  ws.categories[section].done=!ws.categories[section].done;
  ws.categories[section].doneBy=ws.categories[section].done?me.name:null;
  const car=S.inventory.find(c=>c.id===carId);
  if(car) car.work=ws;
  saveWorkState(carId);
  // Notify owner (all managers)
  if(ws.categories[section].done){
    const carName=car?car.name:'vehicle';
    const msg=me.name+' completed '+section+' on '+carName;
    const managers=S.employees.filter(e=>e.role==='manager');
    for(const m of managers){
      try{await createNotification(m.id,msg,null,carName);}catch(e){}
    }
    const mgrNames=managers.map(m=>m.name);
    await sendPushNotification(mgrNames,'✅ Detail Ready',me.name+' marked '+carName+' detail as done');
  }
  openDetailDoneModal(carId);
  renderDetailQueue();
  updateTabBadges();
}

// ── TASK VIEW ──────────────────────────────────────────────────────────────────
function openTaskView(aid){
  curTaskId=aid;uploadedPhotos=[];
  const a=S.assignments.find(x=>x.id===aid);
  const car=S.inventory.find(c=>c.id===a.inventoryId);
  const img=document.getElementById('th-img');const ph=document.getElementById('th-ph');
  if(car.photo){img.src=car.photo;img.style.display='block';ph.style.display='none';}
  else{
    const cached=pxCache[String(car.id)];
    if(cached){img.src=cached;img.style.display='block';ph.style.display='none';}
    else{img.style.display='none';ph.style.display='flex';ph.innerHTML=carImage(car.name);
      fetchPexels(car).then(url=>{if(url){img.src=url;img.style.display='block';ph.style.display='none';}});}
  }
  document.getElementById('th-name').textContent=car.name;
  const _vinLast6=car.vin?car.vin.slice(-6):car.stock;const _detailSub=[_vinLast6,car.color].filter(Boolean).join(' · ');document.getElementById('th-stock').textContent=_detailSub;
  updateProg(a);renderTaskItems(a);
  document.getElementById('photo-grid').innerHTML='';
  updateSubBtn(a);showView('emp-tasks');
  // scroll to top
  document.querySelector('.content').scrollTop=0;
}

const EXPANDABLE_TASKS=['repairs','parts'];
function renderTaskItems(a){
  document.getElementById('task-list').innerHTML=a.tasks.map((t,i)=>{
    const isExpand=EXPANDABLE_TASKS.includes(t.name.toLowerCase());
    const expanded=t.editingNote||false;
    if(isExpand){
      // Expandable task: tap name to toggle textarea
      return`<div class="ti">
      <div class="ti-left"><div class="chk ${t.done?'on':''}" onclick="togTask(${a.id},${i})"><span class="chk-m">&#x2713;</span></div></div>
      <div class="ti-main">
        <div class="ti-top">
          <span class="ti-name ${t.done?'dn':''}" onclick="toggleNote(${a.id},${i})" style="cursor:pointer;">${t.name}</span>
          <span style="color:#444;font-size:12px;margin-left:6px;" onclick="toggleNote(${a.id},${i})">${expanded?'▲':'▼'}</span>
          ${t.urgent?'<span class="ti-urgent-flag">&#x26A0; Urgent</span>':''}
        </div>
        ${expanded?`<textarea class="ti-note-input" rows="3" placeholder="Describe ${t.name.toLowerCase()}..." onblur="saveNote(${a.id},${i},this.value)" autofocus>${t.note||''}</textarea>`
          :t.note?`<div class="ti-note" onclick="toggleNote(${a.id},${i})">${t.note}</div>`:''}
        ${t.by?`<div class="ti-by">Done by ${t.by}</div>`:''}
        ${(t.repairs&&t.repairs.length)?t.repairs.map(r=>`<div class="ti-note" style="margin-top:4px;">+ ${r.text} <span style="color:#444;font-size:10px;">— ${r.by}</span></div>`).join(''):''}
        <div class="ti-actions">
          <button class="ti-act-btn ${t.urgent?'urgent-on':''}" onclick="togUrgent(${a.id},${i})">&#x26A0; ${t.urgent?'Urgent':'Mark urgent'}</button>
          <button class="ti-act-btn" onclick="this.style.display='none';this.nextElementSibling.style.display='flex'">+ Add</button>
        </div>
        <div style="display:none;gap:6px;margin-top:6px;align-items:center;">
          <input class="ti-note-input" style="flex:1;" placeholder="Add repair/part..." id="emp-add-${a.id}-${i}"/>
          <button class="ti-act-btn" onclick="empAddRepair(${i},document.getElementById('emp-add-${a.id}-${i}').value);this.parentElement.style.display='none';">Save</button>
        </div>
      </div>
    </div>`;
    } else {
      // Simple checkbox task (Detail, Photos)
      return`<div class="ti">
      <div class="ti-left"><div class="chk ${t.done?'on':''}" onclick="togTask(${a.id},${i})"><span class="chk-m">&#x2713;</span></div></div>
      <div class="ti-main">
        <div class="ti-top">
          <span class="ti-name ${t.done?'dn':''}" onclick="togTask(${a.id},${i})">${t.name}</span>
          ${t.urgent?'<span class="ti-urgent-flag">&#x26A0; Urgent</span>':''}
        </div>
        ${t.by?`<div class="ti-by">Done by ${t.by}</div>`:''}
        ${(t.repairs&&t.repairs.length)?t.repairs.map(r=>`<div class="ti-note" style="margin-top:4px;">+ ${r.text} <span style="color:#444;font-size:10px;">— ${r.by}</span></div>`).join(''):''}
        <div class="ti-actions">
          <button class="ti-act-btn ${t.urgent?'urgent-on':''}" onclick="togUrgent(${a.id},${i})">&#x26A0; ${t.urgent?'Urgent':'Mark urgent'}</button>
          <button class="ti-act-btn" onclick="this.style.display='none';this.nextElementSibling.style.display='flex'">+ Add</button>
        </div>
        <div style="display:none;gap:6px;margin-top:6px;align-items:center;">
          <input class="ti-note-input" style="flex:1;" placeholder="Add repair/part..." id="emp-add-${a.id}-${i}"/>
          <button class="ti-act-btn" onclick="empAddRepair(${i},document.getElementById('emp-add-${a.id}-${i}').value);this.parentElement.style.display='none';">Save</button>
        </div>
      </div>
    </div>`;
    }
  }).join('');
}

function togTask(aid,idx){
  const a=S.assignments.find(x=>x.id===aid);
  if(a.submitted)return;
  a.tasks[idx].done=!a.tasks[idx].done;
  if(a.tasks[idx].done)a.tasks[idx].by=me.name;
  else a.tasks[idx].by=null;
  sv();renderTaskItems(a);updateProg(a);updateSubBtn(a);
  // Async save to Supabase (non-blocking)
  sbPatch('assignments',aid,{tasks:a.tasks}).catch(e=>console.warn('Sync warn:',e));
}
function togUrgent(aid,idx){const a=S.assignments.find(x=>x.id===aid);a.tasks[idx].urgent=!a.tasks[idx].urgent;sv();renderTaskItems(a);renderGrid();}
function toggleNote(aid,idx){const a=S.assignments.find(x=>x.id===aid);a.tasks[idx].editingNote=!a.tasks[idx].editingNote;sv();renderTaskItems(a);}
function saveNote(aid,idx,val){
  const a=S.assignments.find(x=>x.id===aid);
  a.tasks[idx].note=val.trim();a.tasks[idx].editingNote=false;
  sv();renderTaskItems(a);
  sbPatch('assignments',aid,{tasks:a.tasks}).catch(e=>console.warn('Sync warn:',e));
}
function updateProg(a){const done=a.tasks.filter(t=>t.done).length;const pct=a.tasks.length?Math.round(done/a.tasks.length*100):0;document.getElementById('th-pf').style.width=pct+'%';}
function updateSubBtn(a){const btn=document.getElementById('sub-btn');const all=a.tasks.every(t=>t.done);btn.disabled=!all||a.submitted;btn.textContent=a.submitted?'Submitted for Review \u2713':'Submit for Review';}

function handlePhotos(e){Array.from(e.target.files).forEach(file=>{enhancePhoto(file,url=>{uploadedPhotos.push(url);const g=document.getElementById('photo-grid');const img=document.createElement('img');img.className='photo-thumb';img.src=url;g.appendChild(img);const a=S.assignments.find(x=>x.id===curTaskId);if(a&&a.tasks.every(t=>t.done))updateSubBtn(a);});});}

async function submitReview(){
  const a=S.assignments.find(x=>x.id===curTaskId);
  if(!a.tasks.every(t=>t.done)){alert('Complete all tasks first');return;}
  showLoading('Submitting for review...');
  try {
    const now = new Date().toISOString();
    await sbPatch('assignments',a.id,{submitted:true,photos:uploadedPhotos,submitted_at:now,tasks:a.tasks});
    a.submitted=true;a.photos=uploadedPhotos;a.submittedAt=now;sv();
    updateSubBtn(a);
  } catch(e){alert('Error: '+e.message);}
  hideLoading();
  setTimeout(()=>backToGrid(),400);
}
function backToGrid(){showView('emp-home');renderGrid();}

// ── MANAGER INVENTORY ──────────────────────────────────────────────────────────
function filterInv(v){invFilter=v.toLowerCase();renderInv();}
function renderInv(){
  const items=S.inventory.filter(c=>!invFilter||(c.name+c.stock).toLowerCase().includes(invFilter)).sort((a,b)=>{
    const aHas=S.assignments.some(x=>x.inventoryId===a.id&&!x.approved)?1:0;
    const bHas=S.assignments.some(x=>x.inventoryId===b.id&&!x.approved)?1:0;
    if(bHas!==aHas) return bHas-aHas;
    return b.id-a.id;
  });
  if(S.lastSync)document.getElementById('sync-tm').textContent='Last synced: '+new Date(S.lastSync).toLocaleString();
  if(S.syncUrl)document.getElementById('sync-st').textContent='Ready to sync';
  document.getElementById('inv-list').innerHTML=items.map(car=>{
    const asgns=S.assignments.filter(a=>a.inventoryId===car.id&&!a.approved);
    const pxI=!car.photo&&pxCache[String(car.id)];
    const ws=getWorkState(car.id);
    const carSel=ws.selected||false;
    const thImg=car.photo?`<img class="inv-thumb" src="${car.photo}"/>`:pxI?`<img class="inv-thumb" src="${pxI}"/>`:`<div class="inv-thumb-ph" data-px="${car.id}">${carImage(car.name)}</div>`;
    const tags=asgns.filter(a=>a.tasks&&a.tasks.length>0).map(a=>{const e=S.employees.find(x=>x.id===a.employeeId);return`<div class="inv-assigned-tag">\u2192 ${e?e.name:'?'}</div>`;}).join('');
    return`<div class="inv-card" style="border:2px solid ${carSel?'#30d158':'rgba(255,255,255,.15)'};transition:border-color .2s,box-shadow .2s;box-shadow:${carSel?'0 0 12px rgba(48,209,88,.3)':'none'};"><div class="inv-card-top"><a href="javascript:void(0)" onclick="openWorkScreen(${car.id});return false;" style="flex-shrink:0;display:block;-webkit-tap-highlight-color:rgba(0,0,0,0);touch-action:manipulation;">${thImg}</a><div class="inv-info" onclick="openWorkScreen(${car.id})"><div class="inv-name">${car.name}</div><div class="inv-meta">${car.vin?car.vin.slice(-6):car.stock}${car.color?' \xB7 '+car.color:''}</div>${tags}</div><button onclick="event.stopPropagation();toggleCarWorkSel(${car.id})" style="width:22px;height:22px;border-radius:50%;border:2px solid ${carSel?'#30d158':'transparent'};background:${carSel?'#30d158':'transparent'};flex-shrink:0;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;padding:0;opacity:${carSel?'1':'0'};"></button>`
    + `</div></div>`;
  }).join('');
  applyPexels(items);
}

// ── ASSIGN ─────────────────────────────────────────────────────────────────────
let selectedEmpsForAssign=new Set();
function openAssign(carId){
  curAssign=carId;pendingCarPhoto=null;
  customTasksForAssign=[...DEFAULT_TASKS.map(t=>({...t}))];
  // Pre-select already-assigned employees
  selectedEmpsForAssign=new Set(S.assignments.filter(a=>a.inventoryId===carId&&!a.approved).map(a=>a.employeeId));
  const car=S.inventory.find(c=>c.id===carId);
  document.getElementById('assign-info').innerHTML=`<strong style="color:#fff;">${car.name}</strong><br><span>${car.stock} \xB7 ${car.location}</span>`;
  const lbl=document.getElementById('car-photo-lbl');
  if(car.photo){lbl.innerHTML=`<img class="cpu-preview" src="${car.photo}"/><span class="cpu-txt" style="margin-top:8px;">Tap to change photo</span>`;}
  else{lbl.innerHTML='<span class="cpu-txt">&#x1F4F7; Tap to photograph the car</span>';}
  renderEmpPicker();
  renderTaskBuilder();
  openM('m-assign');
}
function renderEmpPicker(){
  const emps=S.employees.filter(e=>e.id!==me.id);
  const allSel=emps.every(e=>selectedEmpsForAssign.has(e.id));
  document.getElementById('all-emp-btn').style.color=allSel?'#30d158':'#888';
  document.getElementById('all-emp-btn').style.borderColor=allSel?'rgba(48,209,88,.4)':'#222';
  document.getElementById('assign-emp-list').innerHTML=emps.map(e=>{
    const checked=selectedEmpsForAssign.has(e.id);
    const existing=S.assignments.find(a=>a.inventoryId===curAssign&&a.employeeId===e.id&&!a.approved);
    return`<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#000;border-radius:10px;margin-bottom:8px;border:1px solid ${checked?'rgba(48,209,88,.25)':'#1a1a1a'};cursor:pointer;" onclick="toggleEmpCheck(${e.id})">
      <div style="width:20px;height:20px;border-radius:6px;border:2px solid ${checked?'#30d158':'#333'};background:${checked?'#30d158':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px;color:#000;">${checked?'&#x2713;':''}</div>
      <span style="flex:1;font-size:14px;color:#ccc;">${e.name}</span>
      <span style="font-size:12px;color:#444;">${e.location}</span>
      ${existing?'<span style="font-size:11px;color:#30d158;background:rgba(48,209,88,.1);padding:2px 6px;border-radius:4px;">Active</span>':''}
    </div>`;
  }).join('');
}
function toggleEmpCheck(empId){if(selectedEmpsForAssign.has(empId))selectedEmpsForAssign.delete(empId);else selectedEmpsForAssign.add(empId);renderEmpPicker();}
function selectAllEmps(){const emps=S.employees.filter(e=>e.id!==me.id);if(emps.every(e=>selectedEmpsForAssign.has(e.id)))selectedEmpsForAssign.clear();else emps.forEach(e=>selectedEmpsForAssign.add(e.id));renderEmpPicker();}

function renderTaskBuilder(){
  document.getElementById('task-builder').innerHTML=customTasksForAssign.map((t,i)=>{
    const isExpand=EXPANDABLE_TASKS.includes(t.name.toLowerCase());
    const expanded=t.expanded||false;
    if(isExpand){
      return`<div style="background:#000;border-radius:10px;margin-bottom:8px;border:1px solid #1a1a1a;overflow:hidden;">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;" onclick="toggleBuilderExpand(${i})">
          <span style="flex:1;font-size:14px;color:#ccc;cursor:pointer;">${t.name}</span>
          <span style="color:#444;font-size:12px;">${expanded?'▲':'▼'}</span>
          <button onclick="event.stopPropagation();toggleTaskUrgentBuilder(${i})" style="background:none;border:1px solid ${t.urgent?'rgba(255,69,58,.4)':'#222'};border-radius:7px;color:${t.urgent?'#ff453a':'#444'};font-size:11px;padding:4px 9px;cursor:pointer;">&#x26A0;</button>
          <button onclick="event.stopPropagation();removeTaskBuilder(${i})" style="background:none;border:none;color:#333;font-size:16px;cursor:pointer;">&#x2715;</button>
        </div>
        ${expanded?`<textarea style="width:100%;box-sizing:border-box;background:#0a0a0a;border:none;border-top:1px solid #1a1a1a;color:#ccc;padding:10px 12px;font-size:13px;resize:none;" rows="3" placeholder="Describe ${t.name.toLowerCase()}..." onblur="saveBuilderNote(${i},this.value)">${t.note||''}</textarea>`:''}
      </div>`;
    }
    return`<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#000;border-radius:10px;margin-bottom:8px;border:1px solid #1a1a1a;">
      <span style="flex:1;font-size:14px;color:#ccc;">${t.name}</span>
      <button onclick="toggleTaskUrgentBuilder(${i})" style="background:none;border:1px solid ${t.urgent?'rgba(255,69,58,.4)':'#222'};border-radius:7px;color:${t.urgent?'#ff453a':'#444'};font-size:11px;padding:4px 9px;cursor:pointer;">&#x26A0;</button>
      <button onclick="removeTaskBuilder(${i})" style="background:none;border:none;color:#333;font-size:16px;cursor:pointer;">&#x2715;</button>
    </div>`;
  }).join('');
}
function toggleTaskUrgentBuilder(i){customTasksForAssign[i].urgent=!customTasksForAssign[i].urgent;renderTaskBuilder();}
function toggleBuilderExpand(i){customTasksForAssign[i].expanded=!customTasksForAssign[i].expanded;renderTaskBuilder();}
function saveBuilderNote(i,val){customTasksForAssign[i].note=val.trim();}
function removeTaskBuilder(i){customTasksForAssign.splice(i,1);renderTaskBuilder();}
function addCustomTask(){const n=prompt('Task name:');if(n&&n.trim())customTasksForAssign.push({name:n.trim(),urgent:false});renderTaskBuilder();}

function handleCarPhoto(e){const f=e.target.files[0];if(!f)return;enhancePhoto(f,url=>{pendingCarPhoto=url;const lbl=document.getElementById('car-photo-lbl');lbl.innerHTML=`<img class="cpu-preview" src="${url}"/><span class="cpu-txt" style="margin-top:8px;">Tap to retake</span>`;});}

async function doAssign(){
  if(!selectedEmpsForAssign.size){alert('Select at least one employee.');return;}
  const tasks=customTasksForAssign.map(t=>({name:t.name,urgent:t.urgent,done:false,by:null,note:t.note||'',editingNote:false}));
  showLoading('Assigning vehicle...');
  try{
    if(pendingCarPhoto){
      await sbPatch('inventory',curAssign,{photo:pendingCarPhoto});
      S.inventory.find(c=>c.id===curAssign).photo=pendingCarPhoto;
    }
    // Only create assignments for newly selected employees (not already assigned)
    const existingEmpIds=new Set(S.assignments.filter(a=>a.inventoryId===curAssign&&!a.approved).map(a=>a.employeeId));
    const newEmpIds=[...selectedEmpsForAssign].filter(id=>!existingEmpIds.has(id));
    for(const empId of newEmpIds){
      const rows=await sbPost('assignments',{inventory_id:curAssign,employee_id:empId,tasks,submitted:false,approved:false,photos:[]});
      const row=rows[0];
      S.assignments.push({id:row.id,inventoryId:row.inventory_id,employeeId:row.employee_id,tasks:row.tasks,submitted:false,approved:false,photos:[],assignedAt:row.assigned_at});
      // Notify the newly assigned employee
      const car=S.inventory.find(c=>c.id===curAssign);
      createNotification(empId, me.name+' assigned you to '+(car?car.name:'a vehicle'), row.id, car?car.name:'');
    }
    sv();
  }catch(e){alert('Error: '+e.message);}
  hideLoading();
  closeM('m-assign');renderInv();renderAssigned();
  if(curWorkCarId) openWorkScreen(curWorkCarId);
}

// ── ASSIGNED VIEW ──────────────────────────────────────────────────────────────
function renderAssigned(){
  const el=document.getElementById('assigned-list');
  const allAsgns=S.assignments.filter(a=>!a.approved);
  if(!allAsgns.length){el.innerHTML='<div class="empty"><div class="ei">&#x1F697;</div><div class="et">No active tasks</div></div>';return;}
  el.innerHTML='<div class="car-grid">'+allAsgns.map(a=>{
    const car=S.inventory.find(c=>c.id===a.inventoryId);if(!car)return'';
    const emp=S.employees.find(e=>e.id===a.employeeId);
    const done=a.tasks.filter(t=>t.done).length;const total=a.tasks.length;
    const pct=total?Math.round(done/total*100):0;
    const status=a.submitted?'review':done===total?'done':'prog';
    const badge=status==='review'?'<span class="tile-badge tbr">Review</span>':status==='done'?'<span class="tile-badge tbd">Done</span>':`<span class="tile-badge tbp">${done}/${total}</span>`;
    const pxUrl=!car.photo&&pxCache[String(car.id)];
    const photoHTML=car.photo?`<img class="tile-photo" src="${car.photo}"/><div class="tile-vig"></div><div class="tile-grad"></div>`:pxUrl?`<img class="tile-photo" src="${pxUrl}"/><div class="tile-vig"></div><div class="tile-grad"></div>`:`<div class="tile-ph" data-px="${car.id}">${carImage(car.name)}</div>`;
    const vinLast6=car.vin?car.vin.slice(-6):car.stock;const colorStr=car.color?car.color:'';const tileSubLine=colorStr?`${vinLast6} \xB7 ${colorStr}`:vinLast6;
    return`<a href="javascript:openMgrAssign('${a.id}')" class="car-tile st-${status}" style="display:block;text-decoration:none;color:inherit;">${badge}<div class="tile-photo-wrap">${photoHTML}</div><div class="tile-body"><div class="tile-name">${car.name}</div><div class="tile-stock">${tileSubLine}</div><div style="font-size:11px;color:#64d2ff;margin:2px 0;">\u2192 ${emp?emp.name:'?'}</div><div class="tile-pb"><div class="tile-pf ${status==='done'||status==='review'?'pfg':'pfw'}" style="width:${pct}%"></div></div><div class="tile-pct">${pct}% complete</div></div></a>`;
  }).join('')+'</div>';
  applyPexels(allAsgns.map(a=>S.inventory.find(c=>c.id===a.inventoryId)).filter(Boolean));
}

// ── MGR ASSIGN EDIT ────────────────────────────────────────────────────────────
let curMgrAssignId=null;
function openMgrAssign(assignId){
  curMgrAssignId=assignId;
  const a=S.assignments.find(x=>String(x.id)===String(assignId));
  const car=S.inventory.find(c=>c.id===a.inventoryId);
  const emp=S.employees.find(e=>e.id===a.employeeId);
  document.getElementById('mgr-assign-title').textContent=car?car.name:'Vehicle';
  document.getElementById('mgr-assign-sub').textContent=(emp?emp.name:'?')+' · '+(car?car.stock:'');
  renderMgrTaskList();
  openM('m-mgr-assign');
}
function renderMgrTaskList(){
  const a=S.assignments.find(x=>String(x.id)===String(curMgrAssignId));
  if(!a) return;
  document.getElementById('mgr-task-list').innerHTML=a.tasks.map((t,i)=>`
    <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#000;border-radius:10px;margin-bottom:8px;border:1px solid ${t.done?'rgba(48,209,88,.25)':'#1a1a1a'};">
      <div style="width:22px;height:22px;border-radius:6px;border:2px solid ${t.done?'#30d158':'#333'};background:${t.done?'#30d158':'transparent'};display:flex;align-items:center;justify-content:center;font-size:13px;color:#000;flex-shrink:0;cursor:pointer;" onclick="mgrToggleTask(${i})">${t.done?'✓':''}</div>
      <input value="${t.name.replace(/"/g,'&quot;')}" onblur="mgrEditTask(${i},this.value)" style="flex:1;background:none;border:none;color:${t.done?'#555':'#ccc'};font-size:15px;text-decoration:${t.done?'line-through':'none'};outline:none;padding:0;"/>
      ${t.by?'<span style="font-size:11px;color:#444;white-space:nowrap;">'+t.by+'</span>':''}
      <button onclick="mgrRemoveTask(${i})" style="background:none;border:none;color:#555;font-size:16px;cursor:pointer;padding:0 4px;flex-shrink:0;">✕</button>
    </div>`).join('');
}
async function mgrToggleTask(taskIdx){
  const a=S.assignments.find(x=>String(x.id)===String(curMgrAssignId));
  if(!a) return;
  a.tasks[taskIdx].done=!a.tasks[taskIdx].done;
  a.tasks[taskIdx].by=a.tasks[taskIdx].done?me.name:null;
  showLoading('Saving...');
  try{
    await sbPatch('assignments',a.id,{tasks:a.tasks});
    sv();
    renderMgrTaskList();
    // Send notification to assignee
    const emp=S.employees.find(e=>e.id===a.employeeId);
    const car=S.inventory.find(c=>c.id===a.inventoryId);
    if(emp && emp.id!==me.id){
      const taskName=a.tasks[taskIdx].name;
      const status=a.tasks[taskIdx].done?'completed':'uncompleted';
      createNotification(emp.id, me.name+' marked "'+taskName+'" as '+status+' on '+(car?car.name:'a vehicle'), a.id, car?car.name:'');
    }
  }catch(e){alert('Error: '+e.message);}
  hideLoading();
}
async function mgrEditTask(idx,val){
  const a=S.assignments.find(x=>String(x.id)===String(curMgrAssignId));
  if(!a||a.tasks[idx].name===val) return;
  a.tasks[idx].name=val;
  try{
    await sbPatch('assignments',a.id,{tasks:a.tasks});sv();
    if(val){
      const emp=S.employees.find(e=>e.id===a.employeeId);
      const car=S.inventory.find(c=>c.id===a.inventoryId);
      if(emp&&emp.role!=='manager') await sendPushNotification([emp.name],'📋 Task Updated',me.name+' updated a task on '+(car?car.name:'a vehicle'));
    }
  }catch(e){alert('Error: '+e.message);}
}
async function mgrAddTask(){
  const a=S.assignments.find(x=>String(x.id)===String(curMgrAssignId));
  if(!a) return;
  a.tasks.push({name:'',done:false,urgent:false,note:'',by:null});
  showLoading('Saving...');
  try{
    await sbPatch('assignments',a.id,{tasks:a.tasks});sv();renderMgrTaskList();
    const emp=S.employees.find(e=>e.id===a.employeeId);
    const car=S.inventory.find(c=>c.id===a.inventoryId);
    if(emp&&emp.role!=='manager') await sendPushNotification([emp.name],'📋 New Task Added',me.name+' added a task to '+(car?car.name:'a vehicle'));
  }catch(e){alert('Error: '+e.message);}
  hideLoading();
  // Focus the new empty input
  setTimeout(()=>{const inputs=document.querySelectorAll('#mgr-task-list input');if(inputs.length)inputs[inputs.length-1].focus();},100);
}
async function mgrUnassign(){
  const a=S.assignments.find(x=>String(x.id)===String(curMgrAssignId));
  if(!a) return;
  const car=S.inventory.find(c=>c.id===a.inventoryId);
  const emp=S.employees.find(e=>e.id===a.employeeId);
  if(!confirm('Unassign '+(emp?emp.name:'this employee')+' from '+(car?car.name:'this vehicle')+'?')) return;
  showLoading('Removing...');
  try{
    await sbDelete('assignments',a.id);
    S.assignments=S.assignments.filter(x=>x.id!==a.id);
    sv();
    closeM('m-mgr-assign');
    renderAssigned();
    renderInv();
  }catch(e){alert('Error: '+e.message);}
  hideLoading();
}
async function mgrRemoveTask(idx){
  const a=S.assignments.find(x=>String(x.id)===String(curMgrAssignId));
  if(!a) return;
  a.tasks.splice(idx,1);
  showLoading('Saving...');
  try{await sbPatch('assignments',a.id,{tasks:a.tasks});sv();renderMgrTaskList();renderAssigned();}catch(e){alert('Error: '+e.message);}
  hideLoading();
}

// ── REVIEW ─────────────────────────────────────────────────────────────────────
function renderMgrDetail(){
  const el=document.getElementById('mgr-detail-list');
  // Only cars assigned to Detail section pool
  const cars=S.inventory.filter(car=>{
    const ws=getWorkState(car.id);
    return ws.categories&&(
      (ws.categories.detail&&ws.categories.detail.sectionPool)
    );
  });
  if(!cars.length){el.innerHTML='<div class="empty"><div class="ei">✨</div><div class="et">No vehicles in Detail queue</div></div>';return;}
  el.innerHTML=cars.map(car=>{
    const ws=getWorkState(car.id);
    const detailDone=ws.categories&&ws.categories.detail&&ws.categories.detail.done;
    const photosDone=ws.categories&&ws.categories.photos&&ws.categories.photos.sectionPool&&ws.categories.photos.done;
    const detailReviewed=ws.categories&&ws.categories.detail&&ws.categories.detail.reviewed;
    const photosReviewed=ws.categories&&ws.categories.photos&&ws.categories.photos.reviewed;
    const needsReview=(detailDone&&!detailReviewed)||(photosDone&&!photosReviewed);
    const pxUrl=!car.photo&&pxCache[String(car.id)];
    const photoHTML=car.photo?`<img class="rc-img" src="${car.photo}"/>`:pxUrl?`<img class="rc-img" src="${pxUrl}"/>`:`<div class="rc-img-ph" data-px="${car.id}">${carImage(car.name)}</div>`;
    return`<div class="rev-card" style="border-color:${needsReview?'rgba(255,69,58,.4)':'#1a1a1a'};">
      <div class="rc-head">${photoHTML}<div class="rc-info">
        <div class="rc-name">${car.name}</div>
        <div class="rc-meta">${car.vin?car.vin.slice(-6):car.stock}${car.color?' · '+car.color:''}</div>
        ${needsReview?'<div style="color:#ff453a;font-size:12px;font-weight:600;margin-top:4px;">⚠ Needs Review</div>':''}
      </div></div>
      <div class="rc-tasks-list">
        <div class="rc-task"><div class="rc-dot ${detailDone?'dot-on':'dot-off'}"></div><div class="rc-tn"><div class="rc-tn-name">✨ Detail${detailDone?' — done by '+(ws.categories.detail.doneBy||'employee'):''}</div></div></div>
      </div>
      <div class="rc-actions">
        <button class="rc-btn rc-back" onclick="removeFromDetailQueue(${car.id})">↩ Remove</button>
        ${needsReview?`<button class="rc-btn rc-back" onclick="rejectDetail(${car.id})" style="background:#1a1a1a;">↩ Send Back</button>
        <button class="rc-btn rc-approve" onclick="approveDetail(${car.id})">✓ Approve</button>`:''}
      </div>
    </div>`;
  }).join('');
  applyPexels(cars);
}
async function approveDetail(carId){
  const ws=getWorkState(carId);
  if(!ws.categories) return;
  if(ws.categories.detail&&ws.categories.detail.done) ws.categories.detail.reviewed=true;
  if(ws.categories.detail) ws.categories.detail.sectionPool=false;
  const car=S.inventory.find(c=>c.id===carId);
  if(car) car.work=ws;
  await saveWorkState(carId);
  renderMgrDetail();
  updateTabBadges();
}
async function rejectDetail(carId){
  const ws=getWorkState(carId);
  if(!ws.categories) return;
  if(ws.categories.detail) ws.categories.detail.done=false;
  if(ws.categories.photos) ws.categories.photos.done=false;
  const car=S.inventory.find(c=>c.id===carId);
  if(car) car.work=ws;
  await saveWorkState(carId);
  renderMgrDetail();
  updateTabBadges();
}
async function removeFromDetailQueue(carId){
  const ws=getWorkState(carId);
  if(!ws.categories) return;
  if(ws.categories.detail){ws.categories.detail.sectionPool=false;ws.categories.detail.done=false;ws.categories.detail.reviewed=false;}
  const car=S.inventory.find(c=>c.id===carId);
  if(car) car.work=ws;
  await saveWorkState(carId);
  renderMgrDetail();
  updateTabBadges();
}

// ── PHOTOS QUEUE (mirrors Detail exactly) ───────────────────────────────────
function renderPhotosQueue(){
  const cars=S.inventory.filter(car=>{
    const ws=getWorkState(car.id);
    return ws.categories&&ws.categories.photos&&ws.categories.photos.sectionPool;
  });
  const grid=document.getElementById('photos-grid');
  const empty=document.getElementById('photos-empty');
  if(!cars.length){if(grid)grid.style.display='none';if(empty)empty.style.display='flex';return;}
  if(grid)grid.style.display='grid';if(empty)empty.style.display='none';
  grid.innerHTML=cars.map(car=>{
    const ws=getWorkState(car.id);
    const done=ws.categories&&ws.categories.photos&&ws.categories.photos.done;
    const pxUrl=!car.photo&&pxCache[String(car.id)];
    const photoHTML=car.photo?`<img class="tile-photo" src="${car.photo}"/><div class="tile-vig"></div><div class="tile-grad"></div>`:pxUrl?`<img class="tile-photo" src="${pxUrl}"/><div class="tile-vig"></div><div class="tile-grad"></div>`:`<div class="tile-ph" data-px="${car.id}">${carImage(car.name)}</div>`;
    const vinLast6=car.vin?car.vin.slice(-6):car.stock;
    return`<a href="javascript:void(0)" onclick="openPhotosDoneModal(${car.id})" class="car-tile" style="display:block;text-decoration:none;color:inherit;border-color:${done?'rgba(48,209,88,.4)':'#1e3a1e'};">
      <div class="tile-photo-wrap">${photoHTML}</div>
      <div class="tile-body"><div class="tile-name">${car.name}</div><div class="tile-stock">${vinLast6}${car.color?' · '+car.color:''}</div>
      ${done?'<div style="color:#30d158;font-size:11px;margin-top:2px;">✓ Photos done</div>':'<div style="color:#64d2ff;font-size:10px;font-weight:600;margin-top:4px;">📷 Photos</div>'}
      </div>
    </a>`;
  }).join('');
  applyPexels(cars);
}
function openPhotosDoneModal(carId){
  const car=S.inventory.find(c=>c.id===carId);
  if(!car) return;
  const ws=getWorkState(carId);
  const done=ws.categories&&ws.categories.photos&&ws.categories.photos.done;
  let html=`<div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:16px;">${car.name}</div>`;
  html+=`<button onclick="markPhotosDone(${carId})" style="width:100%;padding:14px;background:${done?'#30d158':'#1a1a1a'};border:1px solid ${done?'#30d158':'#333'};border-radius:10px;color:${done?'#000':'#fff'};font-size:14px;font-weight:600;cursor:pointer;margin-bottom:8px;text-align:left;">
    📷 Photos — ${done?'✓ Done (tap to undo)':'Tap to mark done'}
  </button>`;
  html+=`<button onclick="closeM('m-detail-done')" style="width:100%;padding:12px;background:none;border:1px solid #333;border-radius:10px;color:#888;font-size:14px;cursor:pointer;margin-top:8px;">Close</button>`;
  document.getElementById('detail-done-body').innerHTML=html;
  openM('m-detail-done');
}
async function markPhotosDone(carId){
  const ws=getWorkState(carId);
  if(!ws.categories) ws.categories={};
  if(!ws.categories.photos) ws.categories.photos={selected:false,description:'',repairs:[],sectionPool:true};
  ws.categories.photos.done=!ws.categories.photos.done;
  ws.categories.photos.doneBy=ws.categories.photos.done?me.name:null;
  const car=S.inventory.find(c=>c.id===carId);
  if(car) car.work=ws;
  saveWorkState(carId);
  if(ws.categories.photos.done){
    const carName=car?car.name:'vehicle';
    const managers=S.employees.filter(e=>e.role==='manager');
    for(const m of managers){
      try{await createNotification(m.id,me.name+' completed photos on '+carName,null,carName);}catch(e){}
    }
    await sendPushNotification(managers.map(m=>m.name),'📸 Photos Ready',me.name+' finished photos on '+carName);
  }
  openPhotosDoneModal(carId);
  renderPhotosQueue();
  updateTabBadges();
}
function renderMgrPhotos(){
  const el=document.getElementById('mgr-photos-list');
  const cars=S.inventory.filter(car=>{
    const ws=getWorkState(car.id);
    return ws.categories&&ws.categories.photos&&ws.categories.photos.sectionPool;
  });
  if(!cars.length){el.innerHTML='<div class="empty"><div class="ei">📷</div><div class="et">No vehicles in Photos queue</div></div>';return;}
  el.innerHTML=cars.map(car=>{
    const ws=getWorkState(car.id);
    const done=ws.categories&&ws.categories.photos&&ws.categories.photos.done;
    const reviewed=ws.categories&&ws.categories.photos&&ws.categories.photos.reviewed;
    const needsReview=done&&!reviewed;
    const pxUrl=!car.photo&&pxCache[String(car.id)];
    const photoHTML=car.photo?`<img class="rc-img" src="${car.photo}"/>`:pxUrl?`<img class="rc-img" src="${pxUrl}"/>`:`<div class="rc-img-ph" data-px="${car.id}">${carImage(car.name)}</div>`;
    return`<div class="rev-card" style="border-color:${needsReview?'rgba(255,69,58,.4)':'#1a1a1a'};">
      <div class="rc-head">${photoHTML}<div class="rc-info">
        <div class="rc-name">${car.name}</div>
        <div class="rc-meta">${car.vin?car.vin.slice(-6):car.stock}${car.color?' · '+car.color:''}</div>
        ${needsReview?'<div style="color:#ff453a;font-size:12px;font-weight:600;margin-top:4px;">⚠ Needs Review</div>':''}
      </div></div>
      <div class="rc-tasks-list">
        <div class="rc-task"><div class="rc-dot ${done?'dot-on':'dot-off'}"></div><div class="rc-tn"><div class="rc-tn-name">📷 Photos${done?' — done by '+(ws.categories.photos.doneBy||'employee'):''}</div></div></div>
      </div>
      <div class="rc-actions">
        <button class="rc-btn rc-back" onclick="removeFromPhotosQueue(${car.id})">↩ Remove</button>
        ${needsReview?`<button class="rc-btn rc-back" onclick="rejectPhotos(${car.id})" style="background:#1a1a1a;">↩ Send Back</button>
        <button class="rc-btn rc-approve" onclick="approvePhotos(${car.id})">✓ Approve</button>`:''}
      </div>
    </div>`;
  }).join('');
  applyPexels(cars);
}
async function approvePhotos(carId){
  const ws=getWorkState(carId);
  if(!ws.categories) return;
  if(ws.categories.photos){ws.categories.photos.reviewed=true;ws.categories.photos.sectionPool=false;}
  const car=S.inventory.find(c=>c.id===carId);
  if(car) car.work=ws;
  await saveWorkState(carId);
  renderMgrPhotos();updateTabBadges();
}
async function rejectPhotos(carId){
  const ws=getWorkState(carId);
  if(!ws.categories) return;
  if(ws.categories.photos) ws.categories.photos.done=false;
  const car=S.inventory.find(c=>c.id===carId);
  if(car) car.work=ws;
  await saveWorkState(carId);
  renderMgrPhotos();updateTabBadges();
}
async function removeFromPhotosQueue(carId){
  const ws=getWorkState(carId);
  if(!ws.categories) return;
  if(ws.categories.photos){ws.categories.photos.sectionPool=false;ws.categories.photos.done=false;ws.categories.photos.reviewed=false;}
  const car=S.inventory.find(c=>c.id===carId);
  if(car) car.work=ws;
  await saveWorkState(carId);
  renderMgrPhotos();updateTabBadges();
}

// ── PARTS QUEUE (mirrors Detail/Photos exactly) ──────────────────────────────
function renderPartsQueue(){
  const cars=S.inventory.filter(car=>{
    const ws=getWorkState(car.id);
    return ws.categories&&ws.categories.parts&&ws.categories.parts.sectionPool;
  });
  const grid=document.getElementById('parts-grid');
  const empty=document.getElementById('parts-empty');
  if(!cars.length){if(grid)grid.style.display='none';if(empty)empty.style.display='flex';return;}
  if(grid)grid.style.display='grid';if(empty)empty.style.display='none';
  grid.innerHTML=cars.map(car=>{
    const ws=getWorkState(car.id);
    const done=ws.categories&&ws.categories.parts&&ws.categories.parts.done;
    const pxUrl=!car.photo&&pxCache[String(car.id)];
    const photoHTML=car.photo?`<img class="tile-photo" src="${car.photo}"/><div class="tile-vig"></div><div class="tile-grad"></div>`:pxUrl?`<img class="tile-photo" src="${pxUrl}"/><div class="tile-vig"></div><div class="tile-grad"></div>`:`<div class="tile-ph" data-px="${car.id}">${carImage(car.name)}</div>`;
    const vinLast6=car.vin?car.vin.slice(-6):car.stock;
    const repairs=ws.categories.parts.repairs||[];
    return`<a href="javascript:void(0)" onclick="openPartsDoneModal(${car.id})" class="car-tile" style="display:block;text-decoration:none;color:inherit;border-color:${done?'rgba(48,209,88,.4)':'#1e2a3a'};">
      <div class="tile-photo-wrap">${photoHTML}</div>
      <div class="tile-body"><div class="tile-name">${car.name}</div><div class="tile-stock">${vinLast6}${car.color?' · '+car.color:''}</div>
      <div style="color:#ff9f0a;font-size:10px;font-weight:600;margin-top:4px;">📦 Parts${repairs.length?' ('+repairs.length+' item'+(repairs.length>1?'s':'')+')':''}</div>
      ${done?'<div style="color:#30d158;font-size:11px;margin-top:2px;">✓ Done</div>':''}
      </div>
    </a>`;
  }).join('');
  applyPexels(cars);
}
function openPartsDoneModal(carId){
  const car=S.inventory.find(c=>c.id===carId);
  if(!car) return;
  const ws=getWorkState(carId);
  const done=ws.categories&&ws.categories.parts&&ws.categories.parts.done;
  const repairs=(ws.categories&&ws.categories.parts&&ws.categories.parts.repairs)||[];
  let html=`<div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:8px;">${car.name}</div>`;
  if(repairs.length){
    html+=`<div style="margin-bottom:12px;">${repairs.map(r=>`<div style="padding:8px;background:#111;border-radius:8px;margin-bottom:4px;font-size:13px;color:#ccc;">📦 ${typeof r==='string'?r:(r.text||r)}</div>`).join('')}</div>`;
  }
  html+=`<button onclick="markPartsDone(${carId})" style="width:100%;padding:14px;background:${done?'#30d158':'#1a1a1a'};border:1px solid ${done?'#30d158':'#333'};border-radius:10px;color:${done?'#000':'#fff'};font-size:14px;font-weight:600;cursor:pointer;margin-bottom:8px;text-align:left;">
    📦 Parts — ${done?'✓ Done (tap to undo)':'Tap to mark done'}
  </button>`;
  html+=`<button onclick="closeM('m-detail-done')" style="width:100%;padding:12px;background:none;border:1px solid #333;border-radius:10px;color:#888;font-size:14px;cursor:pointer;margin-top:8px;">Close</button>`;
  document.getElementById('detail-done-body').innerHTML=html;
  openM('m-detail-done');
}
async function markPartsDone(carId){
  const ws=getWorkState(carId);
  if(!ws.categories) ws.categories={};
  if(!ws.categories.parts) ws.categories.parts={selected:false,description:'',repairs:[],sectionPool:true};
  ws.categories.parts.done=!ws.categories.parts.done;
  ws.categories.parts.doneBy=ws.categories.parts.done?me.name:null;
  const car=S.inventory.find(c=>c.id===carId);
  if(car) car.work=ws;
  saveWorkState(carId);
  if(ws.categories.parts.done){
    const carName=car?car.name:'vehicle';
    const managers=S.employees.filter(e=>e.role==='manager');
    for(const m of managers){
      try{await createNotification(m.id,me.name+' completed parts on '+carName,null,carName);}catch(e){}
    }
    await sendPushNotification(managers.map(m=>m.name),'🔩 Parts Ready',me.name+' finished parts on '+carName);
  }
  openPartsDoneModal(carId);
  renderPartsQueue();
  updateTabBadges();
}
function renderMgrParts(){
  const el=document.getElementById('mgr-parts-list');
  const cars=S.inventory.filter(car=>{
    const ws=getWorkState(car.id);
    return ws.categories&&ws.categories.parts&&ws.categories.parts.sectionPool;
  });
  if(!cars.length){el.innerHTML='<div class="empty"><div class="ei">📦</div><div class="et">No vehicles in Parts queue</div></div>';return;}
  el.innerHTML=cars.map(car=>{
    const ws=getWorkState(car.id);
    const done=ws.categories&&ws.categories.parts&&ws.categories.parts.done;
    const reviewed=ws.categories&&ws.categories.parts&&ws.categories.parts.reviewed;
    const needsReview=done&&!reviewed;
    const repairs=(ws.categories.parts.repairs)||[];
    const pxUrl=!car.photo&&pxCache[String(car.id)];
    const photoHTML=car.photo?`<img class="rc-img" src="${car.photo}"/>`:pxUrl?`<img class="rc-img" src="${pxUrl}"/>`:`<div class="rc-img-ph" data-px="${car.id}">${carImage(car.name)}</div>`;
    return`<div class="rev-card" style="border-color:${needsReview?'rgba(255,69,58,.4)':'#1a1a1a'};">
      <div class="rc-head">${photoHTML}<div class="rc-info">
        <div class="rc-name">${car.name}</div>
        <div class="rc-meta">${car.vin?car.vin.slice(-6):car.stock}${car.color?' · '+car.color:''}</div>
        ${needsReview?'<div style="color:#ff453a;font-size:12px;font-weight:600;margin-top:4px;">⚠ Needs Review</div>':''}
      </div></div>
      ${repairs.length?`<div style="padding:8px 0;">${repairs.map(r=>`<div class="rc-task"><div class="rc-dot ${done?'dot-on':'dot-off'}"></div><div class="rc-tn"><div class="rc-tn-name">📦 ${typeof r==='string'?r:(r.text||r)}</div></div></div>`).join('')}</div>`:''}
      <div class="rc-tasks-list"><div class="rc-task"><div class="rc-dot ${done?'dot-on':'dot-off'}"></div><div class="rc-tn"><div class="rc-tn-name">📦 Parts${done?' — done by '+(ws.categories.parts.doneBy||'employee'):''}</div></div></div></div>
      <div class="rc-actions">
        <button class="rc-btn rc-back" onclick="removeFromPartsQueue(${car.id})">↩ Remove</button>
        ${needsReview?`<button class="rc-btn rc-back" onclick="rejectParts(${car.id})" style="background:#1a1a1a;">↩ Send Back</button>
        <button class="rc-btn rc-approve" onclick="approveParts(${car.id})">✓ Approve</button>`:''}
      </div>
    </div>`;
  }).join('');
  applyPexels(cars);
}
async function approveParts(carId){
  const ws=getWorkState(carId);
  if(!ws.categories) return;
  if(ws.categories.parts){ws.categories.parts.reviewed=true;ws.categories.parts.sectionPool=false;}
  const car=S.inventory.find(c=>c.id===carId);
  if(car) car.work=ws;
  await saveWorkState(carId);
  renderMgrParts();updateTabBadges();
}
async function rejectParts(carId){
  const ws=getWorkState(carId);
  if(!ws.categories) return;
  if(ws.categories.parts) ws.categories.parts.done=false;
  const car=S.inventory.find(c=>c.id===carId);
  if(car) car.work=ws;
  await saveWorkState(carId);
  renderMgrParts();updateTabBadges();
}
async function removeFromPartsQueue(carId){
  const ws=getWorkState(carId);
  if(!ws.categories) return;
  if(ws.categories.parts){ws.categories.parts.sectionPool=false;ws.categories.parts.done=false;ws.categories.parts.reviewed=false;}
  const car=S.inventory.find(c=>c.id===carId);
  if(car) car.work=ws;
  await saveWorkState(carId);
  renderMgrParts();updateTabBadges();
}

function renderReview(){
  const p=S.assignments.filter(a=>a.submitted&&!a.approved);const el=document.getElementById('rev-list');
  if(!p.length){el.innerHTML='<div class="empty"><div class="ei">&#x2705;</div><div class="et">No tasks pending review</div></div>';return;}
  el.innerHTML=p.map(a=>{
    const car=S.inventory.find(c=>c.id===a.inventoryId);const emp=S.employees.find(e=>e.id===a.employeeId);
    const pxR=!car.photo&&pxCache[String(car.id)];
    const th=car.photo?`<img class="rc-img" src="${car.photo}"/>`:pxR?`<img class="rc-img" src="${pxR}"/>`:`<div class="rc-img-ph" data-px="${car.id}">${carImage(car.name)}</div>`;
    return`<div class="rev-card"><div class="rc-head">${th}<div class="rc-info"><div class="rc-name">${car.name}</div><div class="rc-meta">${car.vin?car.vin.slice(-6):car.stock}${car.color?' \xB7 '+car.color:''} \xB7 by ${emp?emp.name:'?'}</div></div></div><div class="rc-tasks-list">${a.tasks.map(t=>{const _exp=EXPANDABLE_TASKS.includes(t.name.toLowerCase());return`<div class="rc-task"><div class="rc-dot ${t.done?'dot-on':'dot-off'}"></div><div class="rc-tn"><div class="rc-tn-name">${t.name}${t.urgent?' &#x26A0;':''}</div>${t.note?`<div class="rc-tn-note" style="${_exp?'white-space:pre-wrap;color:#888;font-style:normal;':''}">${_exp?t.note:'"'+t.note+'"'}</div>`:''}</div></div>`;}).join('')}</div>${a.photos&&a.photos.length?`<div class="rc-photos-grid">${a.photos.map(p=>`<img class="rc-ph" src="${p}">`).join('')}</div>`:''}<div class="rc-actions"><button class="rc-btn rc-back" onclick="sendBack('${a.id}')">&#x21A9; Send Back</button><button class="rc-btn rc-approve" onclick="approve('${a.id}')">&#x2713; Approve</button></div></div>`;
  }).join('');
  applyPexels(p.map(a=>S.inventory.find(c=>c.id===a.inventoryId)).filter(Boolean));
}
async function approve(aid){
  showLoading('Approving...');
  try{await sbPatch('assignments',aid,{approved:true});const a=S.assignments.find(x=>String(x.id)===String(aid));a.approved=true;sv();}
  catch(e){alert('Error: '+e.message);}
  hideLoading();renderReview();
}
async function sendBack(aid){
  showLoading('Sending back...');
  try{
    const a=S.assignments.find(x=>String(x.id)===String(aid));
    a.tasks.forEach(t=>{t.done=false;t.by=null;});
    await sbPatch('assignments',aid,{submitted:false,tasks:a.tasks});
    a.submitted=false;sv();
  }catch(e){alert('Error: '+e.message);}
  hideLoading();renderReview();
}

// ── TEAM ───────────────────────────────────────────────────────────────────────
function renderTeam(){document.getElementById('team-list').innerHTML=S.employees.map(e=>{const ac=S.assignments.filter(a=>a.employeeId===e.id&&!a.approved).length;const isMe=me&&e.id===me.id;return`<div class="emp-row"><div class="emp-av">${e.name[0]}</div><div class="emp-inf"><div class="emp-nm">${e.name}</div><div class="emp-mt">${e.role==="manager"?"Owner":"Employee"} \xB7 ${e.location} \xB7 @${e.username}</div><div class="emp-at">${ac} active assignment${ac!==1?'s':''}</div></div>${isMe?'':'<button onclick="deleteEmp('+e.id+',\''+e.name.replace(/'/g,"\\'")+'\')" style="background:none;border:1px solid rgba(255,69,58,.3);border-radius:8px;color:#ff453a;font-size:12px;padding:6px 10px;cursor:pointer;flex-shrink:0;">Remove</button>'}</div>`;}).join('');}
async function deleteEmp(empId, empName){
  if(!confirm('Remove '+empName+' from the team?')) return;
  showLoading('Removing...');
  try{
    await sbDelete('employees', empId);
    S.employees = S.employees.filter(e=>e.id!==empId);
    sv();
    renderTeam();
  }catch(e){alert('Error: '+e.message);}
  hideLoading();
}
async function addEmp(){
  const n=document.getElementById('ne-n').value.trim();
  const u=document.getElementById('ne-u').value.trim();
  const p=document.getElementById('ne-p').value.trim();
  const r=document.getElementById('ne-r').value;
  const l=document.getElementById('ne-l').value;
  if(!n||!u||!p)return;
  showLoading('Adding employee...');
  try{
    const rows=await sbPost('employees',{name:n,username:u,pin:p,role:r,location:l});
    const row=rows[0];
    S.employees.push({id:row.id,name:row.name,username:row.username,pin:row.pin,role:row.role,location:row.location});
    sv();
  }catch(e){alert('Error: '+e.message);}
  hideLoading();
  closeM('m-add-emp');
  ['ne-n','ne-u','ne-p'].forEach(id=>document.getElementById(id).value='');
  renderTeam();
}

// ── CSV SYNC ───────────────────────────────────────────────────────────────────

async function importFromReport(){
  document.getElementById('sync-st').textContent = 'Fetching daily report...';
  try {
    const url = 'https://raw.githubusercontent.com/varutyunov/carfactory-daily-report/main/carfactory_daily_report.txt?t=' + Date.now();
    const r = await fetch(url);
    if(!r.ok) throw new Error('HTTP ' + r.status);
    const txt = await r.text();
    if(txt.includes('Initializing')) throw new Error('Report not populated yet — run daily skill first');
    // Parse late accounts from report
    const lines = txt.split('\n');
    let added = 0;
    const ex = new Set(S.inventory.map(c => c.stock));
    lines.forEach(line => {
      // Match lines like: "  John Smith — 45 days — Acct CF-1234"
      const m = line.match(/Acct\s+([A-Z0-9-]+)/i);
      if(m){
        const acct = m[1].trim();
        if(!ex.has(acct)){
          // Extract name from line
          const namePart = line.trim().split('—')[0].trim();
          S.inventory.push({id:Date.now()+Math.random(), name:'Account: '+namePart, stock:acct, vin:'', location:'DeBary', photo:null});
          ex.add(acct);
          added++;
        }
      }
    });
    S.lastSync = Date.now(); sv();
    document.getElementById('sync-st').textContent = added > 0 ? added + ' accounts imported from report.' : 'No new accounts found in report.';
    document.getElementById('sync-tm').textContent = 'Last synced: ' + new Date(S.lastSync).toLocaleString();
    renderInv();
  } catch(e) {
    document.getElementById('sync-st').textContent = 'Import failed: ' + e.message;
  }
}

async function syncNow(){if(!S.syncUrl){openM('m-sync');return;}document.getElementById('sync-st').textContent='Syncing...';try{const r=await fetch(S.syncUrl+'?t='+Date.now());if(!r.ok)throw new Error('HTTP '+r.status);const csv=await r.text();const imp=parseCSV(csv);if(!imp.length)throw new Error('No vehicles found');const ex=new Set(S.inventory.map(c=>c.stock));let added=0;const colorMap=JSON.parse(localStorage.getItem('cf_colormap')||'{}');imp.forEach(c=>{if(c.color){if(c.vin)colorMap[c.vin]=c.color;if(c.stock)colorMap[c.stock]=c.color;}if(!ex.has(c.stock)){S.inventory.push(c);added++;}});localStorage.setItem('cf_colormap',JSON.stringify(colorMap));S.inventory.forEach(c=>{if(!c.color&&(colorMap[c.vin]||colorMap[c.stock]))c.color=colorMap[c.vin]||colorMap[c.stock];});S.lastSync=Date.now();sv();document.getElementById('sync-st').textContent=`Synced! ${added} new vehicle${added!==1?'s':''} added.`;document.getElementById('sync-tm').textContent='Last synced: '+new Date(S.lastSync).toLocaleString();renderInv();}catch(e){document.getElementById('sync-st').textContent='Sync failed: '+e.message;}}
function parseCSV(csv){const lines=csv.trim().split('\n');if(lines.length<2)return[];const hdr=lines[0].split(',').map(h=>h.trim().replace(/^"|"$/g,'').toLowerCase());const cars=[];for(let i=1;i<lines.length;i++){const vals=lines[i].split(',').map(v=>v.trim().replace(/^"|"$/g,''));const row={};hdr.forEach((h,j)=>row[h]=vals[j]||'');const stock=row['stock']||row['stock #']||row['stockno']||'';const year=row['year']||'';const make=row['make']||'';const model=row['model']||'';const vin=row['vin']||'';const color=row['color']||row['colorexterior']||row['ext color']||row['exterior color']||row['ext. color']||'';const loc=row['location']||'DeBary';if(!stock&&!vin)continue;cars.push({id:Date.now()+Math.random(),name:[year,make,model].filter(Boolean).join(' ')||'Unknown',stock:stock||vin.slice(-6),vin,color,location:loc.toLowerCase().includes('land')?'DeLand':'DeBary',photo:null});}return cars;}
function saveSyncUrl(){S.syncUrl=document.getElementById('sync-url').value.trim();sv();closeM('m-sync');renderInv();}

// ── MODALS ─────────────────────────────────────────────────────────────────────
function openM(id){document.getElementById(id).classList.add('on');}
function closeM(id){document.getElementById(id).classList.remove('on');}
document.querySelectorAll('.mb').forEach(m=>{m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('on');});});

// Service worker registration with forced updates
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js', {updateViaCache:'none'}).then(reg=>{
    reg.update();
    // Force waiting SW to activate immediately
    if(reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
    reg.addEventListener('updatefound',()=>{
      const nw=reg.installing;
      nw.addEventListener('statechange',()=>{
        if(nw.state==='installed'&&navigator.serviceWorker.controller) nw.postMessage('SKIP_WAITING');
      });
    });
    // Reload when new SW takes control
    navigator.serviceWorker.addEventListener('controllerchange',()=>window.location.reload());
    // Listen for messages from SW
    navigator.serviceWorker.addEventListener('message', e=>{
      if(e.data==='UPDATED') window.location.reload();
      else if(e.data==='SYNC_FAILED'){
        const btn=document.getElementById('sync-btn');
        if(btn){btn.style.color='#ff453a';setTimeout(()=>{btn.style.color='#555';btn.style.pointerEvents='auto';},2000);}
      }
    });
  });
}


async function addCarManually(){
  const name = document.getElementById('ac-name').value.trim();
  const stock = document.getElementById('ac-stock').value.trim();
  const vin = document.getElementById('ac-vin').value.trim();
  const loc = document.getElementById('ac-loc').value;
  if(!name || !stock){ alert('Name and Stock # required'); return; }
  if(S.inventory.find(c => c.stock === stock)){ alert('Stock # already exists'); return; }
  showLoading('Adding vehicle...');
  try{
    const rows=await sbPost('inventory',{name,stock,vin,location:loc,photo:null});
    const row=rows[0];
    S.inventory.push({id:row.id,name:row.name,stock:row.stock,vin:row.vin||'',color:row.color||'',location:row.location,photo:null});
    sv();
  }catch(e){alert('Error: '+e.message);}
  hideLoading();
  closeM('m-add-car');
  ['ac-name','ac-stock','ac-vin'].forEach(id => document.getElementById(id).value = '');
  renderInv();
}

// Restore session if coming back from a sync reload
const _savedSession = localStorage.getItem('cf_session');
const _savedUser = localStorage.getItem('cf_saved_user');
const _savedPin = localStorage.getItem('cf_saved_pin');
// Wipe ALL localStorage on every load - Supabase is always the source of truth
Object.keys(localStorage).filter(k=>!k.startsWith("cf_work_")).forEach(k=>localStorage.removeItem(k));
// Always pre-fill credentials if saved
if(_savedUser){ try{ const _u=document.getElementById('lu'); if(_u)_u.value=_savedUser; }catch(e){} }
if(_savedPin){ try{ const _p=document.getElementById('lp'); if(_p)_p.value=_savedPin; }catch(e){} }
if(_savedSession){
  try{
    const _s = JSON.parse(_savedSession);
    if(_s && _s.id){
      me = _s;
      // Re-save immediately so session survives even if sync fails
      localStorage.setItem('cf_session', JSON.stringify(me));
      localStorage.setItem('cf_saved_user', _savedUser||'');
      localStorage.setItem('cf_saved_pin', _savedPin||'');
      document.getElementById('login').style.display='none';
      document.getElementById('app').style.display='flex';
      document.getElementById('ub').textContent=me.name;
      syncFromSupabase().then(()=>{
        fetchNotifications();
        if(me.role==='manager'){document.getElementById('mtabs').style.display='none';showView('mgr-home');updateTabBadges();updateHomeBadges();}
        else{document.getElementById('emp-tabs').style.display='flex';document.getElementById('emp-tab-name').textContent=me.name.split(' ')[0];document.getElementById('greeting').textContent='Hi '+me.name.split(' ')[0]+', your cars today';document.getElementById('personal-greeting').textContent=me.name.split(' ')[0]+"'s Assignments";showView('emp-home');empTabGo('detail',document.querySelector('#emp-tabs .mt'));}
      });
    }
  }catch(e){}
} else if(_savedUser && _savedPin) {
  // Session missing or invalid but credentials saved — auto-login silently
  setTimeout(function(){ doLogin(); }, 100);
}
ld();

// ── AUTO-SYNC ─────────────────────────────────────────────────────────────────
// Poll Supabase every 2 minutes while app is open
setInterval(function(){
  if(me && document.getElementById('app').style.display!=='none'){
    syncFromSupabase();
  }
}, 2 * 60 * 1000);

// Sync immediately when user comes back to the app (phone switches back to tab)
document.addEventListener('visibilitychange', function(){
  if(!document.hidden && me && document.getElementById('app').style.display!=='none'){
    syncFromSupabase();
  }
});

// ── WORK SCREEN ──────────────────────────────────────────────────────────────
let curWorkCarId=null, curCatName=null, curCatTab='desc';

function getWorkState(carId){
  const car=S.inventory.find(c=>c.id===carId);
  if(car && car.work && typeof car.work==='object') return car.work;
  try{const ls=localStorage.getItem('cf_work_'+carId);if(ls)return JSON.parse(ls);}catch(e){}
  return {selected:false,categories:{}};
}
function getCatState(carId,catName){
  const ws=getWorkState(carId);
  if(!ws.categories) ws.categories={};
  if(!ws.categories[catName]) ws.categories[catName]={selected:false,description:'',repairs:[]};
  return ws.categories[catName];
}
async function saveWorkState(carId){
  const car=S.inventory.find(c=>c.id===carId);
  if(!car) return;
  const ws=getWorkState(carId);
  try{localStorage.setItem('cf_work_'+carId, JSON.stringify(ws));}catch(e){}
  try{await sbPatch('inventory',carId,{work:ws});}catch(e){}
}

function openWorkScreen(carId){
  if(me && me.role==='manager'){ openCarActions(carId); return; }
  curWorkCarId=carId;
  const car=S.inventory.find(c=>c.id===carId);
  if(!car) return;
  document.getElementById('ws-car-name').textContent=car.name;
  document.getElementById('ws-car-sub').textContent=(car.vin?car.vin.slice(-6):car.stock)+(car.color?' · '+car.color:'');
  renderWorkGrid();
  document.getElementById('work-screen').style.display='flex';
}

function toggleCarWorkSel(carId){
  const ws=getWorkState(carId);
  ws.selected=!ws.selected;
  const car=S.inventory.find(c=>c.id===carId);
  if(car) car.work=ws;
  saveWorkState(carId);
  renderInv();
}
function closeWorkScreen(){
  document.getElementById('work-screen').style.display='none';
  curWorkCarId=null;
  renderInv();
}

const CAT_ICONS={repairs:'🔧',parts:'📦',detail:'✨',photos:'📷',other:'📋'};
function catIcon(name){const k=name.toLowerCase();return CAT_ICONS[k]||'📋';}

function renderWorkGrid(){
  const ws=getWorkState(curWorkCarId);
  const cats=ws.categories||{};
  const catNames=DEFAULT_TASKS.map(t=>t.name);
  Object.keys(cats).forEach(k=>{if(!catNames.map(n=>n.toLowerCase()).includes(k.toLowerCase()))catNames.push(k);});
  document.getElementById('ws-grid').innerHTML=catNames.map(name=>{
    const key=name.toLowerCase();
    const catState=cats[key]||{selected:false};
    const sel=catState.selected;
    return`<div class="ws-cat-card${sel?' sel':''}" id="wscat-${key}" onclick="handleCatCardTap(event,'${name}')">
      <div class="ws-cat-icon">${catIcon(name)}</div>
      <div class="ws-cat-name">${name}</div>
      <div class="ws-cat-center" onclick="event.stopPropagation();openCatScreen('${name}')"></div>
    </div>`;
  }).join('');
}

function handleCatCardTap(e,catName){
  toggleCatSelected(catName);
}

function toggleCatSelected(catName){
  const ws=getWorkState(curWorkCarId);
  if(!ws.categories) ws.categories={};
  const key=catName.toLowerCase();
  if(!ws.categories[key]) ws.categories[key]={selected:false,description:'',repairs:[]};
  ws.categories[key].selected=!ws.categories[key].selected;
  const car=S.inventory.find(c=>c.id===curWorkCarId);
  if(car) car.work=ws;
  saveWorkState(curWorkCarId);
  renderWorkGrid();
}

function openCatScreen(catName){
  curCatName=catName;
  document.getElementById('cs-title').textContent=catName;
  renderCatBody();
  document.getElementById('cat-screen').style.display='flex';
}
function closeCatScreen(){
  document.getElementById('cat-screen').style.display='none';
}
function renderCatBody(){
  const key=curCatName.toLowerCase();
  // Photos and Detail use assign UI, not repair items
  if(key==='photos'||key==='detail'){
    renderAssignCatBody();
    return;
  }
  const cs=getCatState(curWorkCarId,key);
  const repairs=cs.repairs||[];
  const items=repairs.map(r=>typeof r==='string'?{text:r,part:''}:r);
  if(items.some((r,i)=>typeof repairs[i]==='string')){cs.repairs=items;const car=S.inventory.find(c=>c.id===curWorkCarId);if(car)car.work=getWorkState(curWorkCarId);saveWorkState(curWorkCarId);}
  document.getElementById('cs-body').innerHTML=items.map((r,i)=>`
    <div class="cs-repair-item">
      <div style="display:flex;gap:6px;align-items:center;">
        <input class="cs-repair-input" value="${(r.text||'').replace(/"/g,'&quot;')}" placeholder="Repair item..." onblur="saveCatRepair(${i},'text',this.value)"/>
        <button class="cs-repair-rm" onclick="removeCatRepair(${i})">✕</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-top:4px;">
        <input class="cs-part-input" value="${(r.part||'').replace(/"/g,'&quot;')}" placeholder="Assign part (optional)..." onblur="saveCatRepair(${i},'part',this.value)"/>
        ${r.part?`<span style="color:#30d158;font-size:12px;white-space:nowrap;">📦 → Parts</span>`:''}
      </div>
    </div>`).join('')+`<button class="cs-add-btn" onclick="addCatRepair()">+ Add Repair</button>`;
}
function renderAssignCatBody(){
  const key=curCatName.toLowerCase();
  const ws=getWorkState(curWorkCarId);
  if(!ws.categories) ws.categories={};
  if(!ws.categories[key]) ws.categories[key]={selected:false,description:'',repairs:[],assignedTo:null,sectionPool:false};
  const cs=ws.categories[key];
  const car=S.inventory.find(c=>c.id===curWorkCarId);
  const carName=car?car.name:'Vehicle';
  const emps=S.employees.filter(e=>e.role==='employee');
  const assignedEmp=cs.assignedTo?S.employees.find(e=>e.id===cs.assignedTo):null;
  document.getElementById('cs-body').innerHTML=`
    <div style="padding:8px 0;">
      <div style="color:#888;font-size:13px;margin-bottom:16px;">${curCatName} assignment for ${carName}</div>
      ${cs.sectionPool?`<div style="background:rgba(48,209,88,.1);border:1px solid rgba(48,209,88,.3);border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="color:#30d158;font-weight:600;font-size:14px;">✓ Assigned to ${curCatName} Section</div>
        <div style="color:#666;font-size:12px;margin-top:4px;">Visible to all employees</div>
        <button onclick="unassignSection()" style="margin-top:10px;background:none;border:1px solid #333;color:#888;padding:6px 14px;border-radius:8px;font-size:12px;cursor:pointer;">Remove from section</button>
      </div>`:''}
      ${assignedEmp?`<div style="background:rgba(100,210,255,.1);border:1px solid rgba(100,210,255,.3);border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="color:#64d2ff;font-weight:600;font-size:14px;">✓ Assigned to ${assignedEmp.name}</div>
        <div style="color:#666;font-size:12px;margin-top:4px;">Private to this employee</div>
        <button onclick="unassignPerson()" style="margin-top:10px;background:none;border:1px solid #333;color:#888;padding:6px 14px;border-radius:8px;font-size:12px;cursor:pointer;">Remove assignment</button>
      </div>`:''}
      <button onclick="assignToSection()" class="cs-assign-btn" style="background:#1a1a1a;border:1px solid ${cs.sectionPool?'#30d158':'#333'};color:${cs.sectionPool?'#30d158':'#fff'};padding:14px;border-radius:12px;width:100%;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:10px;text-align:left;">
        📋 Assign to ${curCatName} Section<br><span style="color:#666;font-size:12px;font-weight:400;">All employees can see this</span>
      </button>
      <div style="color:#555;font-size:12px;text-align:center;margin:6px 0;">— or assign to a specific person —</div>
      ${emps.map(e=>`<button onclick="assignToPerson('${e.id}')" class="cs-assign-btn" style="background:#1a1a1a;border:1px solid ${cs.assignedTo===e.id?'#64d2ff':'#222'};color:#fff;padding:12px;border-radius:10px;width:100%;font-size:14px;cursor:pointer;margin-bottom:6px;text-align:left;">
        👤 ${e.name}
      </button>`).join('')}
    </div>`;
}
async function assignToSection(){
  const key=curCatName.toLowerCase();
  const ws=getWorkState(curWorkCarId);
  if(!ws.categories[key]) ws.categories[key]={selected:false,description:'',repairs:[]};
  ws.categories[key].sectionPool=true;
  ws.categories[key].selected=true;
  const car=S.inventory.find(c=>c.id===curWorkCarId);
  if(car) car.work=ws;
  await saveWorkState(curWorkCarId);
  // Notify all employees
  const carName=car?car.name:'vehicle';
  const msg=me.name+' added '+carName+' to '+curCatName+' section';
  for(const e of S.employees.filter(e=>e.role==='employee')){
    try{await createNotification(e.id,msg,null,carName);}catch(ex){}
  }
  renderAssignCatBody();
  renderWorkGrid();
}
async function unassignSection(){
  const key=curCatName.toLowerCase();
  const ws=getWorkState(curWorkCarId);
  if(ws.categories&&ws.categories[key]) ws.categories[key].sectionPool=false;
  const car=S.inventory.find(c=>c.id===curWorkCarId);
  if(car) car.work=ws;
  await saveWorkState(curWorkCarId);
  renderAssignCatBody();
  renderWorkGrid();
}
async function assignToPerson(empId){
  const key=curCatName.toLowerCase();
  const ws=getWorkState(curWorkCarId);
  if(!ws.categories[key]) ws.categories[key]={selected:false,description:'',repairs:[]};
  ws.categories[key].assignedTo=empId;
  ws.categories[key].selected=true;
  const car=S.inventory.find(c=>c.id===curWorkCarId);
  if(car) car.work=ws;
  await saveWorkState(curWorkCarId);
  const emp=S.employees.find(e=>e.id===empId);
  const carName=car?car.name:'vehicle';
  if(emp){
    try{await createNotification(empId,me.name+' assigned '+curCatName+' on '+carName+' to you',null,carName);}catch(e){}
  }
  renderAssignCatBody();
  renderWorkGrid();
}
async function unassignPerson(){
  const key=curCatName.toLowerCase();
  const ws=getWorkState(curWorkCarId);
  if(ws.categories&&ws.categories[key]) ws.categories[key].assignedTo=null;
  const car=S.inventory.find(c=>c.id===curWorkCarId);
  if(car) car.work=ws;
  await saveWorkState(curWorkCarId);
  renderAssignCatBody();
  renderWorkGrid();
}
function saveCatRepair(idx,field,val){
  const ws=getWorkState(curWorkCarId);
  const key=curCatName.toLowerCase();
  if(ws.categories&&ws.categories[key]&&ws.categories[key].repairs){
    const r=ws.categories[key].repairs[idx];
    if(typeof r==='string'){ws.categories[key].repairs[idx]={text:r,part:''};}
    ws.categories[key].repairs[idx][field]=val;
    // If a part was assigned, auto-populate the Parts category
    if(field==='part'&&val.trim()){
      autoPopulatePart(ws,key,idx,val);
    }
    const car=S.inventory.find(c=>c.id===curWorkCarId);
    if(car) car.work=ws;
    saveWorkState(curWorkCarId);
    renderCatBody();
  }
}
async function autoPopulatePart(ws,repairCatKey,repairIdx,partName){
  if(!ws.categories) ws.categories={};
  if(!ws.categories.parts) ws.categories.parts={selected:false,description:'',repairs:[]};
  const repairText=ws.categories[repairCatKey].repairs[repairIdx].text||'';
  const entry={text:partName,part:'',fromRepair:repairText,fromCategory:repairCatKey};
  // Don't add duplicates
  const exists=ws.categories.parts.repairs.some(p=>(typeof p==='object'?p.text:p)===partName&&(typeof p==='object'?p.fromRepair:'')=== repairText);
  if(!exists){
    ws.categories.parts.repairs.push(entry);
    ws.categories.parts.selected=true;
  }
  // Send notifications
  const car=S.inventory.find(c=>c.id===curWorkCarId);
  const carName=car?car.name:'vehicle';
  const msg=me.name+' assigned part "'+partName+'" to repair "'+repairText+'" on '+carName;
  const notifyIds=new Set();
  // Notify Vlad specifically (all managers)
  S.employees.filter(e=>e.role==='manager').forEach(e=>notifyIds.add(e.id));
  // Notify all assigned workers on this vehicle
  S.assignments.filter(a=>a.inventoryId===curWorkCarId&&!a.approved).forEach(a=>notifyIds.add(a.employeeId));
  notifyIds.delete(me.id);
  for(const rid of notifyIds){
    try{await createNotification(rid,msg,null,carName);}catch(e){}
  }
}
function addCatRepair(){
  const ws=getWorkState(curWorkCarId);
  if(!ws.categories) ws.categories={};
  const key=curCatName.toLowerCase();
  if(!ws.categories[key]) ws.categories[key]={selected:false,description:'',repairs:[]};
  ws.categories[key].repairs.push({text:'',part:''});
  const car=S.inventory.find(c=>c.id===curWorkCarId);
  if(car) car.work=ws;
  saveWorkState(curWorkCarId);
  renderCatBody();
}
function removeCatRepair(idx){
  const ws=getWorkState(curWorkCarId);
  const key=curCatName.toLowerCase();
  if(ws.categories&&ws.categories[key]){
    ws.categories[key].repairs.splice(idx,1);
    const car=S.inventory.find(c=>c.id===curWorkCarId);
    if(car) car.work=ws;
    saveWorkState(curWorkCarId);
    renderCatBody();
  }
}

function openWorkAssign(){
  openAssign(curWorkCarId);
}

// ── EMPLOYEE REPAIR ADDITION ──────────────────────────────────────────────────
async function empAddRepair(taskIdx, value){
  if(!value.trim()) return;
  const a=S.assignments.find(x=>x.id===curTaskId);
  if(!a) return;
  if(!a.tasks[taskIdx].repairs) a.tasks[taskIdx].repairs=[];
  a.tasks[taskIdx].repairs.push({text:value,by:me.name,at:new Date().toISOString()});
  showLoading('Saving...');
  try{
    await sbPatch('assignments',a.id,{tasks:a.tasks});
    sv();
    const car=S.inventory.find(c=>c.id===a.inventoryId);
    const allAssignments=S.assignments.filter(x=>x.inventoryId===a.inventoryId&&!x.approved);
    const notifyIds=new Set();
    allAssignments.forEach(x=>notifyIds.add(x.employeeId));
    S.employees.filter(e=>e.role==='manager').forEach(e=>notifyIds.add(e.id));
    notifyIds.delete(me.id);
    for(const rid of notifyIds){
      await createNotification(rid, me.name+' added to '+a.tasks[taskIdx].name+' on '+(car?car.name:'vehicle'), a.id, car?car.name:'');
    }
  }catch(e){alert('Error: '+e.message);}
  hideLoading();
  renderTaskItems(a);
}
/* ── MGR HOME NAVIGATION ── */
function mgrGoSection(id, label){
  showView('mgr-'+id);
  var tb=document.querySelector('.tb');
  if(tb) tb.style.display='none';
  var bar=document.getElementById('mgr-back-bar');
  if(bar) bar.style.display='flex';
  var titleEl=document.getElementById('mgr-back-bar-title');
  if(titleEl) titleEl.textContent=label||id;
  var view=document.getElementById('mgr-'+id);
  if(view){var fc=view.querySelector('div');if(fc&&!fc.classList.contains('mgr-section-pad'))fc.classList.add('mgr-section-pad');}
  if(id==='inventory')renderInv();
  else if(id==='assigned')renderAssigned();
  else if(id==='detail')renderMgrDetail();
  else if(id==='photos')renderMgrPhotos();
  else if(id==='parts')renderMgrParts();
  else if(id==='tasks')renderReview();
  else if(id==='employees')renderTeam();
  else if(id==='workflow')renderWorkflow();
  else if(id==='calendar')renderCalendar();
  else if(id==='paint')renderMgrPaint();
  updateTabBadges();
}

function goHome(){
  if(!me) return;
  if(me.role==='manager') goMgrHome();
  else {
    showView('emp-home');
    document.getElementById('content')&&(document.querySelector('.content').scrollTop=0);
  }
}
function goMgrHome(){
  document.querySelectorAll('.mgr-section-pad').forEach(function(el){el.classList.remove('mgr-section-pad');});
  var bar=document.getElementById('mgr-back-bar');
  if(bar) bar.style.display='none';
  var tb=document.querySelector('.tb');
  if(tb) tb.style.display='';
  showView('mgr-home');
  updateHomeBadges();
}

function updateHomeBadges(){
  var taskCount=S.assignments?S.assignments.filter(function(a){return !a.approved;}).length:0;
  var hbt=document.getElementById('hbadge-tasks');
  if(hbt){hbt.textContent=taskCount;hbt.style.display=taskCount>0?'block':'none';}
  var detailCount=S.inventory?S.inventory.filter(function(c){var w=getWorkState(c.id);return w.categories&&w.categories.detail&&w.categories.detail.done&&!w.categories.detail.reviewed;}).length:0;
  var hbd=document.getElementById('hbadge-detail');
  if(hbd){hbd.textContent=detailCount;hbd.style.display=detailCount>0?'block':'none';}
  var photosCount=S.inventory?S.inventory.filter(function(c){var w=getWorkState(c.id);return w.categories&&w.categories.photos&&w.categories.photos.done&&!w.categories.photos.reviewed;}).length:0;
  var hbp=document.getElementById('hbadge-photos');
  if(hbp){hbp.textContent=photosCount;hbp.style.display=photosCount>0?'block':'none';}
}

/* ── WORKFLOW VIEW ── */
function renderWorkflow(){
  var el=document.getElementById('mgr-workflow-content');
  if(!el) return;
  var wfIds = getWorkflowCars();
  if(!wfIds.length){
    el.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 24px;gap:16px;">' +
      '<div style="font-size:40px;">📋</div>' +
      '<div style="font-size:18px;font-weight:700;color:#fff;font-family:\'Barlow Condensed\',sans-serif;letter-spacing:1px;">NO CARS IN WORKFLOW</div>' +
      '<div style="font-size:13px;color:#444;text-align:center;line-height:1.5;">Go to Inventory, tap a car, then tap the Workflow tile to add it here.</div>' +
    '</div>';
    return;
  }
  var cars = wfIds.map(function(id){ return S.inventory.find(function(c){ return c.id === id; }); }).filter(Boolean);
  if(!cars.length){
    el.innerHTML = '<p style="color:#555;padding:20px;font-size:13px;">Cars not found — they may have been removed from inventory.</p>';
    return;
  }
  var out = '<div style="display:flex;flex-direction:column;gap:14px;padding-bottom:40px;">';
  for(var i = 0; i < cars.length; i++){
    var car = cars[i];
    var asgns = (S.assignments||[]).filter(function(a){ return a.inventoryId === car.id && !a.approved; });
    var taskCount = asgns.reduce(function(n,a){ return n + (a.tasks ? a.tasks.length : 0); }, 0);
    out += '<div style="background:#0d0d0d;border-radius:16px;border:1px solid #1e1e1e;overflow:hidden;">';
    // Car header
    out += '<div style="padding:14px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1a1a1a;">';
    out += '<div>';
    out += '<div style="font-size:17px;font-weight:700;color:#fff;font-family:\'Barlow Condensed\',sans-serif;letter-spacing:1px;">' + car.name + '</div>';
    out += '<div style="font-size:12px;color:#444;margin-top:2px;">' + (car.stock||'') + (car.color ? ' · ' + car.color : '') + ' · ' + taskCount + ' task' + (taskCount===1?'':'s') + '</div>';
    out += '</div>';
    out += '<div style="display:flex;gap:8px;align-items:center;">';
    out += '<button onclick="openWfTask('+car.id+')" style="background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.35);color:#a78bfa;font-size:13px;font-weight:600;border-radius:10px;padding:8px 14px;cursor:pointer;">+ Task</button>';
    out += '<button onclick="removeFromWorkflow('+car.id+');renderWorkflow();renderInv();" style="background:none;border:none;color:#333;font-size:18px;cursor:pointer;padding:4px 8px;" title="Remove from workflow">✕</button>';
    out += '</div>';
    out += '</div>';
    // Tasks list
    if(asgns.length){
      out += '<div style="padding:10px 16px 14px;">';
      for(var j = 0; j < asgns.length; j++){
        var asgn = asgns[j];
        var emp = S.employees.find(function(e){ return e.id === asgn.employeeId; });
        var empName = emp ? emp.name : 'Unknown';
        var empTasks = asgn.tasks || [];
        if(empTasks.length){
          out += '<div style="margin-bottom:10px;">';
          out += '<div style="font-size:11px;color:#555;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">→ ' + empName + '</div>';
          for(var k = 0; k < empTasks.length; k++){
            var t = empTasks[k];
            var tText = typeof t === 'object' ? t.text : t;
            var tDone = typeof t === 'object' ? t.done : false;
            out += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #0f0f0f;">';
            out += '<div style="width:8px;height:8px;border-radius:50%;background:' + (tDone ? '#30d158' : '#333') + ';flex-shrink:0;"></div>';
            out += '<div style="font-size:13px;color:' + (tDone ? '#555' : '#ccc') + ';' + (tDone ? 'text-decoration:line-through;' : '') + '">' + tText + '</div>';
            out += '</div>';
          }
          out += '</div>';
        }
      }
      out += '</div>';
    } else {
      out += '<div style="padding:14px 16px;font-size:13px;color:#333;">No tasks assigned yet.</div>';
    }
    out += '</div>';
  }
  out += '</div>';
  el.innerHTML = out;
}

/* ── CALENDAR VIEW ── */
var _calDate=new Date();
function renderCalendar(){
  var el=document.getElementById('mgr-calendar-content');
  if(!el) return;
  var today=new Date();
  var year=_calDate.getFullYear(), month=_calDate.getMonth();
  var MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var MON3=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var arrivalMap={}, customMap={};
  (S.inventory||[]).forEach(function(car){
    if(!car.created_at) return;
    var d=new Date(car.created_at);
    var key=d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
    if(!arrivalMap[key]) arrivalMap[key]=[];
    arrivalMap[key].push(car.name);
  });
  (S.calendarEvents||[]).forEach(function(ev){
    if(!ev.event_date) return;
    var p=ev.event_date.split('-');
    var key=parseInt(p[0])+'-'+parseInt(p[1])+'-'+parseInt(p[2]);
    if(!customMap[key]) customMap[key]=[];
    customMap[key].push(ev);
  });
  var daysInMonth=new Date(year,month+1,0).getDate();
  var firstDay=new Date(year,month,1).getDay();
  var out='<div class="cal-wrap">';
  out+='<div class="cal-nav"><button class="cal-nav-btn" onclick="calPrev()">&#8249;</button>';
  out+='<div class="cal-month">'+MON[month]+' '+year+'</div>';
  out+='<button class="cal-nav-btn" onclick="calNext()">&#8250;</button></div>';
  out+='<div class="cal-grid">';
  ['SUN','MON','TUE','WED','THU','FRI','SAT'].forEach(function(d){out+='<div class="cal-dow">'+d+'</div>';});
  for(var i=0;i<firstDay;i++) out+='<div class="cal-day empty"></div>';
  for(var d=1;d<=daysInMonth;d++){
    var key=year+'-'+(month+1)+'-'+d;
    var ar=arrivalMap[key]||[], cu=customMap[key]||[];
    var isToday=today.getFullYear()===year&&today.getMonth()===month&&today.getDate()===d;
    var cls='cal-day'+(isToday?' today':'')+(ar.length?' has-events':'')+(cu.length?' has-custom':'');
    var dots='';
    if(ar.length||cu.length){
      dots='<div class="cal-dots">';
      for(var j=0;j<Math.min(ar.length,2);j++) dots+='<div class="cal-dot"></div>';
      for(var k=0;k<Math.min(cu.length,2);k++) dots+='<div class="cal-dot-ev"></div>';
      dots+='</div>';
    }
    out+='<div class="'+cls+'" onclick="calSelectDay('+d+')"><div class="cal-day-num">'+d+'</div>'+dots+'</div>';
  }
  out+='</div>';
  out+='<div class="cal-detail" id="cal-detail-panel">';
  if(year===today.getFullYear()&&month===today.getMonth()){
    out+=_calDayHTML(today.getDate(),year,month,arrivalMap,customMap,MON,MON3);
  } else {
    out+='<div class="cal-detail-hdr"><div class="cal-detail-title">'+MON[month]+'</div>';
    out+='<button class="cal-add-btn" onclick="calAddEvent(null)">+ Add Event</button></div>';
    out+='<div style="color:#333;font-size:13px;">Tap a day to see events</div>';
  }
  out+='</div>';
  out+=_calUpcomingHTML(today,MON3);
  out+='</div>';
  el.innerHTML=out;
}
function _calDayHTML(d,year,month,arrivalMap,customMap,MON,MON3){
  var key=year+'-'+(month+1)+'-'+d;
  var ar=arrivalMap[key]||[], cu=customMap[key]||[];
  var m2=(month+1)<10?'0'+(month+1):''+(month+1);
  var d2=d<10?'0'+d:''+d;
  var dateStr=year+'-'+m2+'-'+d2;
  var out='<div class="cal-detail-hdr"><div class="cal-detail-title">'+MON[month]+' '+d+'</div>';
  out+='<button class="cal-add-btn" onclick="calAddEvent(\''+dateStr+'\')">'+'+ Add</button></div>';
  if(!ar.length&&!cu.length){
    out+='<div style="color:#333;font-size:13px;padding:4px 0;">No events</div>';
    return out;
  }
  ar.forEach(function(name){
    out+='<div class="cal-event"><div class="cal-event-dot"></div><div class="cal-event-body"><div class="cal-event-text">'+_esc(name)+'</div><div class="cal-event-meta">Vehicle received</div></div></div>';
  });
  cu.forEach(function(ev){
    out+='<div class="cal-event"><div class="cal-event-dot-custom"></div><div class="cal-event-body">';
    out+='<div class="cal-event-text">'+_esc(ev.title)+'</div>';
    if(ev.event_time) out+='<div class="cal-event-meta">'+_fmtTime(ev.event_time)+'</div>';
    if(ev.notes) out+='<div class="cal-event-meta">'+_esc(ev.notes)+'</div>';
    if(ev.notify) out+='<div class="cal-event-notif">&#128276; Notification set</div>';
    out+='</div><button class="cal-event-del" onclick="calDeleteEvent(\''+ev.id+'\')">&#x2715;</button></div>';
  });
  return out;
}
function _calUpcomingHTML(today,MON3){
  var now=new Date(today.getFullYear(),today.getMonth(),today.getDate());
  var upcoming=(S.calendarEvents||[]).filter(function(ev){
    if(!ev.event_date) return false;
    var p=ev.event_date.split('-');
    return new Date(parseInt(p[0]),parseInt(p[1])-1,parseInt(p[2]))>=now;
  }).slice(0,20);
  var out='<div class="upcoming-section"><div class="upcoming-hdr">Upcoming Events</div>';
  if(!upcoming.length){
    out+='<div class="upcoming-empty">No upcoming events. Tap a day to add one.</div>';
  } else {
    upcoming.forEach(function(ev){
      var p=ev.event_date.split('-');
      var dn=parseInt(p[2]), mo=parseInt(p[1])-1;
      out+='<div class="upcoming-item">';
      out+='<div class="upcoming-date-col"><div class="upcoming-day-num">'+dn+'</div><div class="upcoming-mon">'+MON3[mo]+'</div></div>';
      out+='<div class="upcoming-body"><div class="upcoming-title-text">'+_esc(ev.title)+'</div>';
      if(ev.event_time) out+='<div class="upcoming-time">'+_fmtTime(ev.event_time)+'</div>';
      if(ev.notes) out+='<div class="upcoming-notes-text">'+_esc(ev.notes)+'</div>';
      if(ev.notify) out+='<span class="upcoming-notif-badge">&#128276; notified</span>';
      out+='</div><button class="upcoming-del" onclick="calDeleteEvent(\''+ev.id+'\')">✕</button></div>';
    });
  }
  return out+'</div>';
}
function _fmtTime(t){
  if(!t) return '';
  var p=t.split(':'), h=parseInt(p[0]), m=parseInt(p[1]||0);
  var ap=h>=12?'PM':'AM'; h=h%12||12;
  return h+':'+(m<10?'0':'')+m+' '+ap;
}
function _esc(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function calPrev(){_calDate.setMonth(_calDate.getMonth()-1);renderCalendar();}
function calNext(){_calDate.setMonth(_calDate.getMonth()+1);renderCalendar();}
function calSelectDay(d){
  var year=_calDate.getFullYear(), month=_calDate.getMonth();
  var MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var MON3=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.querySelectorAll('.cal-day.selected').forEach(function(el){el.classList.remove('selected');});
  var days=document.querySelectorAll('#mgr-calendar-content .cal-day:not(.empty)');
  if(days[d-1]) days[d-1].classList.add('selected');
  var arrivalMap={}, customMap={};
  (S.inventory||[]).forEach(function(car){
    if(!car.created_at) return;
    var cd=new Date(car.created_at);
    var key=cd.getFullYear()+'-'+(cd.getMonth()+1)+'-'+cd.getDate();
    if(!arrivalMap[key]) arrivalMap[key]=[];
    arrivalMap[key].push(car.name);
  });
  (S.calendarEvents||[]).forEach(function(ev){
    if(!ev.event_date) return;
    var p=ev.event_date.split('-');
    var key=parseInt(p[0])+'-'+parseInt(p[1])+'-'+parseInt(p[2]);
    if(!customMap[key]) customMap[key]=[];
    customMap[key].push(ev);
  });
  var panel=document.getElementById('cal-detail-panel');
  if(panel) panel.innerHTML=_calDayHTML(d,year,month,arrivalMap,customMap,MON,MON3);
}
function calAddEvent(dateStr){
  var modal=document.getElementById('cal-add-modal');
  if(!modal) return;
  document.getElementById('cal-ev-title').value='';
  document.getElementById('cal-ev-notes').value='';
  document.getElementById('cal-ev-time').value='';
  var nb=document.getElementById('cal-notif-toggle');
  if(nb) nb.classList.remove('on');
  if(!dateStr){
    var now=new Date();
    var m2=(now.getMonth()+1)<10?'0'+(now.getMonth()+1):''+(now.getMonth()+1);
    var d2=now.getDate()<10?'0'+now.getDate():''+now.getDate();
    dateStr=now.getFullYear()+'-'+m2+'-'+d2;
  }
  document.getElementById('cal-ev-date').value=dateStr;
  modal.classList.add('open');
  setTimeout(function(){document.getElementById('cal-ev-title').focus();},200);
}
function calCloseModal(){
  var modal=document.getElementById('cal-add-modal');
  if(modal) modal.classList.remove('open');
}
async function calSaveEvent(){
  var title=document.getElementById('cal-ev-title').value.trim();
  var date=document.getElementById('cal-ev-date').value;
  var time=document.getElementById('cal-ev-time').value||null;
  var notes=document.getElementById('cal-ev-notes').value.trim()||null;
  var notify=document.getElementById('cal-notif-toggle').classList.contains('on');
  if(!title){alert('Please enter an event title.');return;}
  if(!date){alert('Please select a date.');return;}
  var btn=document.querySelector('.cal-save-btn');
  if(btn){btn.textContent='Saving...';btn.disabled=true;}
  var evObj={title:title,event_date:date,event_time:time,notes:notes,notify:notify,created_by:me?me.name:''};
  var saved=null;
  try{
    var res=await sbPost('calendar_events',evObj);
    saved=Array.isArray(res)?res[0]:res;
    if(!saved||!saved.id) throw new Error('no id');
    if(!S.calendarEvents) S.calendarEvents=[];
    S.calendarEvents.push(saved);
    S.calendarEvents.sort(function(a,b){return (a.event_date||'').localeCompare(b.event_date||'');});
  } catch(e){
    evObj.id='local_'+Date.now();
    if(!S.calendarEvents) S.calendarEvents=[];
    S.calendarEvents.push(evObj);
    S.calendarEvents.sort(function(a,b){return (a.event_date||'').localeCompare(b.event_date||'');});
    try{localStorage.setItem('cf_cal_ev',JSON.stringify(S.calendarEvents));}catch(e2){}
    saved=evObj;
  }
  if(notify&&saved) calScheduleNotification(saved);
  calCloseModal();
  if(btn){btn.textContent='Save Event';btn.disabled=false;}
  var p=date.split('-');
  _calDate=new Date(parseInt(p[0]),parseInt(p[1])-1,1);
  renderCalendar();
  setTimeout(function(){calSelectDay(parseInt(p[2]));},50);
}
async function calDeleteEvent(id){
  if(!id) return;
  if(!confirm('Delete this event?')) return;
  S.calendarEvents=(S.calendarEvents||[]).filter(function(e){return e.id!==id;});
  if(!String(id).startsWith('local_')){
    try{await sbDelete('calendar_events',id);}catch(e){}
  } else {
    try{localStorage.setItem('cf_cal_ev',JSON.stringify(S.calendarEvents));}catch(e){}
  }
  renderCalendar();
}
async function calScheduleNotification(ev){
  try{
    var MON3=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var p=ev.event_date.split('-');
    var dateLabel=MON3[parseInt(p[1])-1]+' '+parseInt(p[2]);
    var bodyTxt=dateLabel+(ev.event_time?' at '+_fmtTime(ev.event_time):'')+(ev.notes?' — '+ev.notes:'');
    var payload={app_id:OS_APP_ID,headings:{en:'Event Reminder: '+ev.title},contents:{en:bodyTxt},included_segments:['All']};
    if(ev.event_date&&ev.event_time){
      var sendAt=new Date(ev.event_date+'T'+ev.event_time);
      if(sendAt>new Date()) payload.send_after=sendAt.toUTCString();
    }
    await fetch('https://onesignal.com/api/v1/notifications',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Key '+OS_API_KEY},
      body:JSON.stringify(payload)
    });
  }catch(e){console.warn('Notification error',e);}
}

function getWorkflowCars(){
  try{ return JSON.parse(localStorage.getItem('cf_workflow_cars')||'[]'); }catch(e){return [];}
}
function isInWorkflow(carId){
  return getWorkflowCars().indexOf(carId) !== -1;
}
function addToWorkflow(carId){
  var wf = getWorkflowCars();
  if(wf.indexOf(carId) === -1){ wf.push(carId); localStorage.setItem('cf_workflow_cars', JSON.stringify(wf)); }
}
function removeFromWorkflow(carId){
  var wf = getWorkflowCars().filter(function(id){ return id !== carId; });
  localStorage.setItem('cf_workflow_cars', JSON.stringify(wf));
}
function toggleWorkflow(carId){
  if(isInWorkflow(carId)) removeFromWorkflow(carId);
  else addToWorkflow(carId);
  renderInv();
  // If workflow view is visible, re-render it too
  var wv = document.getElementById('mgr-workflow');
  if(wv && wv.classList.contains('on')) renderWorkflow();
}

// Workflow task modal state
var wfTaskCarId = null;

function openWfTask(carId){
  wfTaskCarId = carId;
  var car = S.inventory.find(function(c){ return c.id === carId; });
  var el = document.getElementById('m-wf-task');
  if(!el || !car) return;
  document.getElementById('wf-task-car-name').textContent = car.name;
  document.getElementById('wf-task-type').value = 'repair';
  document.getElementById('wf-task-desc').value = '';
  document.getElementById('wf-task-assign-all').classList.remove('wf-assign-active');
  // Render employee buttons
  var empBtns = document.getElementById('wf-task-emp-btns');
  var emps = (S.employees||[]);
  empBtns.innerHTML = emps.map(function(e){
    return '<button class="wf-emp-btn" data-id="'+e.id+'" onclick="wfToggleEmp(this,'+e.id+')">'+e.name+'</button>';
  }).join('');
  el.style.display = 'flex';
}

function wfToggleEmp(btn, empId){
  btn.classList.toggle('wf-assign-active');
  // If individual picked, deactivate "All"
  document.getElementById('wf-task-assign-all').classList.remove('wf-assign-active');
}

function wfToggleAll(){
  var btn = document.getElementById('wf-task-assign-all');
  var isActive = btn.classList.toggle('wf-assign-active');
  // Deactivate all individual employee buttons
  document.querySelectorAll('.wf-emp-btn').forEach(function(b){ b.classList.remove('wf-assign-active'); });
}

function closeWfTask(){
  var el = document.getElementById('m-wf-task');
  if(el) el.style.display = 'none';
  wfTaskCarId = null;
}

async function submitWfTask(){
  if(!wfTaskCarId) return;
  var taskType = document.getElementById('wf-task-type').value;
  var desc = document.getElementById('wf-task-desc').value.trim();
  if(!desc){ alert('Please enter a task description.'); return; }

  var assignAll = document.getElementById('wf-task-assign-all').classList.contains('wf-assign-active');
  var selectedIds = [];

  if(assignAll){
    selectedIds = (S.employees||[]).map(function(e){ return e.id; });
  } else {
    document.querySelectorAll('.wf-emp-btn.wf-assign-active').forEach(function(b){
      selectedIds.push(parseInt(b.getAttribute('data-id')));
    });
  }

  if(!selectedIds.length){ alert('Please select who to assign this to.'); return; }

  var car = S.inventory.find(function(c){ return c.id === wfTaskCarId; });
  var taskLabel = taskType.charAt(0).toUpperCase() + taskType.slice(1);
  var taskText = '['+taskLabel+'] ' + desc;
  var tasks = [{text: taskText, done: false, urgent: false}];

  var btn = document.getElementById('wf-task-submit-btn');
  if(btn){ btn.disabled = true; btn.textContent = 'Sending...'; }

  try {
    for(var i = 0; i < selectedIds.length; i++){
      var empId = selectedIds[i];
      // Check if assignment already exists for this car/employee
      var existing = S.assignments.find(function(a){ return a.inventoryId === wfTaskCarId && a.employeeId === empId && !a.approved; });
      if(existing){
        // Add task to existing assignment
        existing.tasks = (existing.tasks||[]).concat(tasks);
        await sbPatch('assignments', existing.id, {tasks: existing.tasks});
      } else {
        var rows = await sbPost('assignments', {inventory_id: wfTaskCarId, employee_id: empId, tasks: tasks, submitted: false, approved: false, photos: []});
        if(rows && rows[0]){
          var row = rows[0];
          S.assignments.push({id:row.id, inventoryId:row.inventory_id, employeeId:row.employee_id, tasks:row.tasks, submitted:false, approved:false, photos:[], assignedAt:row.assigned_at});
        }
      }
      // Send notification
      var msg = (assignAll ? 'New task for all: ' : 'New task for you: ') + taskText + ' — ' + (car ? car.name : '');
      await sendNotification(empId, msg, null, car ? car.name : '');
    }
    closeWfTask();
    renderWorkflow();
    updateTabBadges();
    updateHomeBadges();
  } catch(e) {
    alert('Error sending task. Please try again.');
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = 'Send Task'; }
  }
}

// ── CAR ACTION SHEET ──────────────────────────────────────────────────────────
var caCarId = null;
var caAssignType = null;

function openCarActions(carId){
  caCarId = carId;
  var car = S.inventory.find(function(c){ return c.id === carId; });
  if(!car) return;
  document.getElementById('ca-car-name').textContent = car.name;
  document.getElementById('ca-car-sub').textContent = (car.vin ? car.vin.slice(-6) : car.stock||'') + (car.color ? ' · ' + car.color : '');
  document.getElementById('m-car-actions').style.display = 'flex';
}

function closeCarActions(){
  document.getElementById('m-car-actions').style.display = 'none';
  caCarId = null;
}

function addCarToWorkflow(){
  if(!caCarId) return;
  addToWorkflow(caCarId);
  closeCarActions();
  renderInv();
  mgrGoSection('workflow', 'Workflow');
}

function openCarAssign(type){
  caAssignType = type;
  var car = S.inventory.find(function(c){ return c.id === caCarId; });
  var labels = {repair:'Repair', task:'Task', parts:'Parts', photos:'Photos'};
  document.getElementById('ca-assign-title').textContent = labels[type] || type;
  document.getElementById('ca-assign-sub').textContent = car ? car.name : '';
  document.getElementById('ca-assign-note').value = '';
  document.getElementById('ca-assign-all-btn').classList.remove('wf-assign-active');
  var empBtns = document.getElementById('ca-assign-emp-btns');
  var emps = (S.employees||[]);
  empBtns.innerHTML = emps.map(function(e){
    return '<button class="wf-emp-btn" data-id="'+e.id+'" onclick="caToggleEmp(this)">'+e.name+'</button>';
  }).join('');
  document.getElementById('m-car-assign').style.display = 'flex';
}

function closeCarAssign(){
  document.getElementById('m-car-assign').style.display = 'none';
  caAssignType = null;
}

function caToggleEmp(btn){
  btn.classList.toggle('wf-assign-active');
  document.getElementById('ca-assign-all-btn').classList.remove('wf-assign-active');
}

function caToggleAll(){
  var btn = document.getElementById('ca-assign-all-btn');
  btn.classList.toggle('wf-assign-active');
  document.querySelectorAll('#ca-assign-emp-btns .wf-emp-btn').forEach(function(b){ b.classList.remove('wf-assign-active'); });
}

async function submitCarAssign(){
  if(!caCarId || !caAssignType) return;
  var note = document.getElementById('ca-assign-note').value.trim();
  var labels = {repair:'Repair', task:'Task', parts:'Parts', photos:'Photos'};
  var taskText = '[' + labels[caAssignType] + ']' + (note ? ' ' + note : '');
  var tasks = [{text: taskText, done: false, urgent: false}];

  var assignAll = document.getElementById('ca-assign-all-btn').classList.contains('wf-assign-active');
  var selectedIds = [];
  if(assignAll){
    selectedIds = (S.employees||[]).map(function(e){ return e.id; });
  } else {
    document.querySelectorAll('#ca-assign-emp-btns .wf-emp-btn.wf-assign-active').forEach(function(b){
      selectedIds.push(parseInt(b.getAttribute('data-id')));
    });
  }
  if(!selectedIds.length){ alert('Select who to assign this to.'); return; }

  var btn = document.getElementById('ca-assign-submit');
  if(btn){ btn.disabled = true; btn.textContent = 'Sending...'; }
  var car = S.inventory.find(function(c){ return c.id === caCarId; });

  try {
    for(var i = 0; i < selectedIds.length; i++){
      var empId = selectedIds[i];
      var existing = S.assignments.find(function(a){ return a.inventoryId === caCarId && a.employeeId === empId && !a.approved; });
      if(existing){
        existing.tasks = (existing.tasks||[]).concat(tasks);
        await sbPatch('assignments', existing.id, {tasks: existing.tasks});
      } else {
        var rows = await sbPost('assignments', {inventory_id: caCarId, employee_id: empId, tasks: tasks, submitted: false, approved: false, photos: []});
        if(rows && rows[0]){
          var row = rows[0];
          S.assignments.push({id:row.id, inventoryId:row.inventory_id, employeeId:row.employee_id, tasks:row.tasks, submitted:false, approved:false, photos:[], assignedAt:row.assigned_at});
        }
      }
      var msg = (assignAll?'New task for everyone: ':'New task: ') + taskText + (car?' — '+car.name:'');
      await sendNotification(empId, msg, null, car ? car.name : '');
    }
    closeCarAssign();
    closeCarActions();
    updateTabBadges();
    updateHomeBadges();
  } catch(e) {
    alert('Error sending. Try again.');
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = 'Assign'; }
  }
}

function renderMgrPaint(){
  var el=document.getElementById('mgr-paint-list');
  if(!el)return;
  var paintAsgns=(S.assignments||[]).filter(function(a){
    return !a.approved && a.tasks && a.tasks.some(function(t){
      var txt=typeof t==='object'?t.text:t;
      return txt && txt.toLowerCase().indexOf('[paint]')!==-1;
    });
  });
  if(!paintAsgns.length){
    el.innerHTML='<div style="display:flex;flex-direction:column;align-items:center;padding:60px 24px;gap:12px;"><div style="font-size:36px;">🎨</div><div style="font-size:16px;color:#444;">No paint tasks assigned yet.</div></div>';
    return;
  }
  var out='';
  paintAsgns.forEach(function(a){
    var car=S.inventory.find(function(c){return c.id===a.inventoryId;});
    var emp=S.employees.find(function(e){return e.id===a.employeeId;});
    var paintTasks=a.tasks.filter(function(t){var txt=typeof t==='object'?t.text:t;return txt&&txt.toLowerCase().indexOf('[paint]')!==-1;});
    out+='<div style="background:#0d0d0d;border-radius:14px;border:1px solid #1e1e1e;padding:14px 16px;margin-bottom:12px;">';
    out+='<div style="font-size:16px;font-weight:700;color:#fff;font-family:'Barlow Condensed',sans-serif;letter-spacing:1px;">'+(car?car.name:'Unknown Car')+'</div>';
    out+='<div style="font-size:12px;color:#555;margin-bottom:10px;">&rarr; '+(emp?emp.name:'Unknown')+'</div>';
    paintTasks.forEach(function(t){
      var txt=typeof t==='object'?t.text:t;
      var done=typeof t==='object'?t.done:false;
      out+='<div style="display:flex;align-items:center;gap:8px;padding:5px 0;">';
      out+='<div style="width:8px;height:8px;border-radius:50%;background:'+(done?'#ec4899':'#2a2a2a')+';flex-shrink:0;"></div>';
      out+='<div style="font-size:13px;color:'+(done?'#555':'#ccc')+';">'+txt+'</div>';
      out+='</div>';
    });
    out+='</div>';
  });
  el.innerHTML=out;
}

