import re

with open('C:/Users/Vlad/Desktop/carfactory/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# === FIX 1: Replace the entire renderInv card generation ===
# Find the full card return statement (lines 895-909)
old_render = '''  document.getElementById('inv-list').innerHTML=items.map(car=>{
    const asgns=S.assignments.filter(a=>a.inventoryId===car.id&&!a.approved);
    const pxI=!car.photo&&pxCache[String(car.id)];
    const ws=getWorkState(car.id);
    const carSel=ws.selected||false;
    const thumbInner=car.photo
      ?`<img class="inv-thumb" src="${car.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;"/>`
      :pxI
        ?`<img class="inv-thumb" src="${pxI}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;"/>`
        :`<div class="inv-thumb-ph" data-px="${car.id}" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">${carImage(car.name)}</div>`;
    const th=`<div class="inv-thumb-wrap" data-carid="${car.id}" style="position:relative;width:80px;height:58px;flex-shrink:0;border-radius:8px;border:2px solid ${carSel?'#30d158':'transparent'};box-shadow:${carSel?'0 0 10px rgba(48,209,88,.5)':'none'};overflow:hidden;transition:border-color .2s,box-shadow .2s;background:#111;">${thumbInner}<button onclick="toggleCarWorkSel(${car.id})" style="position:absolute;inset:0;z-index:5;background:transparent;border:none;padding:0;cursor:pointer;border-radius:6px;-webkit-tap-highlight-color:transparent;"></button><button onclick="event.stopPropagation();openWorkScreen(${car.id})" style="position:absolute;inset:14px;z-index:6;background:transparent;border:none;padding:0;cursor:pointer;border-radius:3px;-webkit-tap-highlight-color:transparent;"></button></div>`;
    const tags=asgns.map(a=>{const e=S.employees.find(x=>x.id===a.employeeId);return`<div class="inv-assigned-tag">\\u2192 ${e?e.name:'?'}</div>`;}).join('');
    return`<div class="inv-card"><div class="inv-card-top">${th}<div class="inv-info"><div class="inv-name">${car.name}</div><div class="inv-meta">${car.vin?car.vin.slice(-6):car.stock}${car.color?' \\xB7 '+car.color:''}</div>${tags}</div></div></div>`;
  }).join('');'''

# New approach: entire card is tappable to open Work Screen
# Small green circle checkbox on top-left corner toggles highlight
new_render = r'''  document.getElementById('inv-list').innerHTML=items.map(car=>{
    const asgns=S.assignments.filter(a=>a.inventoryId===car.id&&!a.approved);
    const pxI=!car.photo&&pxCache[String(car.id)];
    const ws=getWorkState(car.id);
    const carSel=ws.selected||false;
    const th=car.photo?`<img class="inv-thumb" src="${car.photo}"/>`:pxI?`<img class="inv-thumb" src="${pxI}"/>`:`<div class="inv-thumb-ph" data-px="${car.id}">${carImage(car.name)}</div>`;
    const tags=asgns.map(a=>{const e=S.employees.find(x=>x.id===a.employeeId);return`<div class="inv-assigned-tag">\u2192 ${e?e.name:'?'}</div>`;}).join('');
    return`<div class="inv-card" onclick="openWorkScreen(${car.id})" style="cursor:pointer;border-left:3px solid ${carSel?'#30d158':'transparent'};transition:border-color .2s;"><div class="inv-card-top">${th}<div class="inv-info"><div class="inv-name">${car.name}</div><div class="inv-meta">${car.vin?car.vin.slice(-6):car.stock}${car.color?' \xB7 '+car.color:''}</div>${tags}</div><button onclick="event.stopPropagation();toggleCarWorkSel(${car.id})" style="width:28px;height:28px;border-radius:50%;border:2px solid ${carSel?'#30d158':'#333'};background:${carSel?'#30d158':'transparent'};flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;"><span style="color:${carSel?'#000':'transparent'};font-size:14px;font-weight:900;">✓</span></button></div></div>`;
  }).join('');'''

if old_render in content:
    content = content.replace(old_render, new_render)
    print('SUCCESS: Replaced renderInv card generation')
else:
    print('ERROR: Could not find old renderInv card code')
    # Debug: show what's actually there
    idx = content.find("document.getElementById('inv-list').innerHTML=items.map")
    if idx >= 0:
        print('Found at index', idx)
        print(repr(content[idx:idx+2000]))
    else:
        print('inv-list innerHTML not found at all!')

# === FIX 2: Update toggleCarWorkSel to update the card border + checkbox ===
old_toggle = '''function toggleCarWorkSel(carId){
  const ws=getWorkState(carId);
  ws.selected=!ws.selected;
  const car=S.inventory.find(c=>c.id===carId);
  if(car) car.work=ws;
  saveWorkState(carId);
  const wrap=document.querySelector(`.inv-thumb-wrap[data-carid="${carId}"]`);
  if(wrap){
    wrap.style.borderColor=ws.selected?'#30d158':'transparent';
    wrap.style.boxShadow=ws.selected?'0 0 10px rgba(48,209,88,.5)':'none';
  }
}'''

new_toggle = '''function toggleCarWorkSel(carId){
  const ws=getWorkState(carId);
  ws.selected=!ws.selected;
  const car=S.inventory.find(c=>c.id===carId);
  if(car) car.work=ws;
  saveWorkState(carId);
  renderInv();
}'''

if old_toggle in content:
    content = content.replace(old_toggle, new_toggle)
    print('SUCCESS: Replaced toggleCarWorkSel')
else:
    print('WARNING: Could not find old toggleCarWorkSel - checking...')
    idx = content.find('function toggleCarWorkSel')
    if idx >= 0:
        print(repr(content[idx:idx+400]))

with open('C:/Users/Vlad/Desktop/carfactory/index.html', 'w', encoding='utf-8') as f:
    f.write(content)
print('File written.')
