import re

with open('C:/Users/Vlad/Desktop/carfactory/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# ── 1. CSS for home grid + back bar ──────────────────────────────────────────
HOME_CSS = """
/* ── MGR HOME GRID ── */
#mgr-home{overflow-y:auto;background:#000;}
.mhome-wrap{padding:24px 18px 60px;display:flex;flex-direction:column;align-items:center;}
.mhome-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;width:100%;max-width:420px;}
.mhome-sq-wrap{position:relative;}
.mhome-sq{
  aspect-ratio:1;border-radius:24px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;cursor:pointer;
  -webkit-tap-highlight-color:transparent;
  transition:transform .13s,box-shadow .13s;
  padding:10px;overflow:hidden;position:relative;
  border-top:1px solid rgba(255,255,255,0.10);
  border-left:1px solid rgba(255,255,255,0.05);
}
.mhome-sq::after{
  content:'';position:absolute;top:0;left:0;right:0;height:45%;
  background:linear-gradient(to bottom,rgba(255,255,255,0.07),transparent);
  border-radius:24px 24px 0 0;pointer-events:none;
}
.mhome-sq:active{transform:scale(0.88);}
.mhome-sq svg{width:36px;height:36px;margin-bottom:7px;position:relative;z-index:1;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.5));}
.mhome-label{
  font-size:10px;font-weight:800;color:#fff;
  font-family:'Barlow Condensed',sans-serif;
  letter-spacing:2px;text-transform:uppercase;text-align:center;
  position:relative;z-index:1;
  text-shadow:0 1px 6px rgba(0,0,0,0.7);
}
.mhome-badge{
  position:absolute;top:7px;right:7px;z-index:10;
  background:#ef4444;color:#fff;border-radius:10px;
  font-size:11px;font-weight:700;padding:1px 7px;
  min-width:20px;text-align:center;line-height:18px;display:none;
  box-shadow:0 2px 10px rgba(239,68,68,0.7);
}
/* ── MGR SECTION BACK BAR ── */
#mgr-back-bar{display:none;position:fixed;top:0;left:0;right:0;z-index:300;background:#000000ee;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid #1a1a1a;height:54px;align-items:center;padding:0 16px;gap:14px;}
#mgr-back-bar-btn{background:none;border:none;color:#fff;font-size:26px;cursor:pointer;padding:0;line-height:1;display:flex;align-items:center;}
#mgr-back-bar-title{font-family:'Barlow Condensed',sans-serif;font-size:24px;font-weight:900;color:#fff;letter-spacing:2px;text-transform:uppercase;}
.mgr-section-pad{padding-top:66px !important;}
"""
html = html.replace('</style>', HOME_CSS + '\n</style>', 1)

# ── 2. Add mgr-home view HTML ──────────────────────────────────────────────
MGR_HOME_HTML = """    <!-- MGR HOME GRID -->
    <div class="view" id="mgr-home">
      <div class="mhome-wrap">
        <div class="mhome-grid">

          <!-- INVENTORY -->
          <div class="mhome-sq-wrap">
            <div class="mhome-sq" style="background:linear-gradient(145deg,#071524,#0d2d55,#1a4a8a);box-shadow:0 6px 28px rgba(59,130,246,0.30),0 10px 40px rgba(0,0,0,0.7);" onclick="mgrGoSection('inventory','Inventory')">
              <svg viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 17H3v-4l2.5-6.5h13L21 13v4h-2"/>
                <circle cx="7.5" cy="17.5" r="2.5"/>
                <circle cx="16.5" cy="17.5" r="2.5"/>
                <path d="M5 13h14"/>
              </svg>
              <div class="mhome-label">Inventory</div>
            </div>
          </div>

          <!-- TASKS -->
          <div class="mhome-sq-wrap">
            <div class="mhome-sq" style="background:linear-gradient(145deg,#041a0e,#0a3d1c,#0f5c2a);box-shadow:0 6px 28px rgba(34,197,94,0.28),0 10px 40px rgba(0,0,0,0.7);" onclick="mgrGoSection('assigned','Tasks')">
              <svg viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 11l3 3 5-5"/>
                <rect x="3" y="5" width="18" height="16" rx="3"/>
                <path d="M8 3v4M16 3v4"/>
              </svg>
              <div class="mhome-label">Tasks</div>
            </div>
            <div class="mhome-badge" id="hbadge-tasks"></div>
          </div>

          <!-- REPAIRS -->
          <div class="mhome-sq-wrap">
            <div class="mhome-sq" style="background:linear-gradient(145deg,#1c0800,#4a1500,#7c2800);box-shadow:0 6px 28px rgba(251,146,60,0.28),0 10px 40px rgba(0,0,0,0.7);" onclick="mgrGoSection('tasks','Repairs')">
              <svg viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
              </svg>
              <div class="mhome-label">Repairs</div>
            </div>
            <div class="mhome-badge" id="hbadge-repair"></div>
          </div>

          <!-- DETAIL -->
          <div class="mhome-sq-wrap">
            <div class="mhome-sq" style="background:linear-gradient(145deg,#0e0620,#251050,#3730a3);box-shadow:0 6px 28px rgba(129,140,248,0.28),0 10px 40px rgba(0,0,0,0.7);" onclick="mgrGoSection('detail','Detail')">
              <svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2l2.2 6.6H21l-5.6 4.1 2.1 6.5L12 15.2l-5.5 3.9 2.1-6.5L3 8.6h6.8z"/>
                <circle cx="5" cy="4" r="1"/>
                <circle cx="19" cy="20" r="1"/>
                <circle cx="19" cy="4" r="1"/>
              </svg>
              <div class="mhome-label">Detail</div>
            </div>
            <div class="mhome-badge" id="hbadge-detail"></div>
          </div>

          <!-- WORKFLOW -->
          <div class="mhome-sq-wrap">
            <div class="mhome-sq" style="background:linear-gradient(145deg,#011a18,#05403c,#086b65);box-shadow:0 6px 28px rgba(20,184,166,0.28),0 10px 40px rgba(0,0,0,0.7);" onclick="mgrGoSection('workflow','Workflow')">
              <svg viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="17 1 21 5 17 9"/>
                <path d="M3 11V9a4 4 0 014-4h14"/>
                <polyline points="7 23 3 19 7 15"/>
                <path d="M21 13v2a4 4 0 01-4 4H3"/>
              </svg>
              <div class="mhome-label">Workflow</div>
            </div>
          </div>

          <!-- PHOTOS -->
          <div class="mhome-sq-wrap">
            <div class="mhome-sq" style="background:linear-gradient(145deg,#1a0325,#420a5a,#6b0f8a);box-shadow:0 6px 28px rgba(192,86,243,0.28),0 10px 40px rgba(0,0,0,0.7);" onclick="mgrGoSection('photos','Photos')">
              <svg viewBox="0 0 24 24" fill="none" stroke="#d946ef" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                <circle cx="12" cy="13" r="4"/>
                <circle cx="18.5" cy="9.5" r="1"/>
              </svg>
              <div class="mhome-label">Photos</div>
            </div>
            <div class="mhome-badge" id="hbadge-photos"></div>
          </div>

          <!-- PARTS -->
          <div class="mhome-sq-wrap">
            <div class="mhome-sq" style="background:linear-gradient(145deg,#1a0a00,#4a2000,#7a3800);box-shadow:0 6px 28px rgba(251,191,36,0.28),0 10px 40px rgba(0,0,0,0.7);" onclick="mgrGoSection('parts','Parts')">
              <svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.07 4.93l-1.41 1.41M5.34 5.34L3.93 6.75M21 12h-2M5 12H3M19.07 19.07l-1.41-1.41M5.34 18.66l-1.41 1.41M12 21v-2M12 5V3"/>
              </svg>
              <div class="mhome-label">Parts</div>
            </div>
            <div class="mhome-badge" id="hbadge-parts"></div>
          </div>

          <!-- CALENDAR -->
          <div class="mhome-sq-wrap">
            <div class="mhome-sq" style="background:linear-gradient(145deg,#001524,#003050,#004d7a);box-shadow:0 6px 28px rgba(56,189,248,0.28),0 10px 40px rgba(0,0,0,0.7);" onclick="mgrGoSection('calendar','Calendar')">
              <svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="3"/>
                <path d="M16 2v4M8 2v4M3 10h18"/>
                <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>
              </svg>
              <div class="mhome-label">Calendar</div>
            </div>
          </div>

        </div>
      </div>
    </div>

    <!-- MGR SECTION BACK BAR -->
    <div id="mgr-back-bar">
      <button id="mgr-back-bar-btn" onclick="goMgrHome()">&#8592;</button>
      <span id="mgr-back-bar-title"></span>
    </div>

"""
html = html.replace('    <div class="view" id="mgr-inventory">', MGR_HOME_HTML + '    <div class="view" id="mgr-inventory">', 1)

# ── 3. Add mgr-workflow view ──────────────────────────────────────────────
WORKFLOW_HTML = """    <div class="view" id="mgr-workflow">
      <div style="padding:14px;" id="mgr-workflow-content">
        <p style="color:#555;font-size:13px;padding:20px 0;">Loading workflow...</p>
      </div>
    </div>
"""
html = html.replace('    <div class="view" id="mgr-parts">', WORKFLOW_HTML + '\n    <div class="view" id="mgr-parts">', 1)

# ── 4. Login: show mgr-home, hide mtabs ──────────────────────────────────────
html = html.replace(
    "document.getElementById('mtabs').style.display='flex';showView('mgr-inventory');renderInv();updateTabBadges();",
    "document.getElementById('mtabs').style.display='none';showView('mgr-home');updateTabBadges();updateHomeBadges();"
)

# ── 5. New JS functions ────────────────────────────────────────────────────
NEW_JS = r"""
/* ── MGR HOME NAVIGATION ── */
function mgrGoSection(id, label){
  showView('mgr-'+id);
  var bar=document.getElementById('mgr-back-bar');
  bar.style.display='flex';
  document.getElementById('mgr-back-bar-title').textContent=label||id;
  var view=document.getElementById('mgr-'+id);
  if(view){var fc=view.querySelector('div');if(fc)fc.classList.add('mgr-section-pad');}
  if(id==='inventory')renderInv();
  else if(id==='assigned')renderAssigned();
  else if(id==='detail')renderMgrDetail();
  else if(id==='photos')renderMgrPhotos();
  else if(id==='parts')renderMgrParts();
  else if(id==='tasks')renderReview();
  else if(id==='employees')renderTeam();
  else if(id==='workflow')renderWorkflow();
  updateTabBadges();
}

function goMgrHome(){
  document.querySelectorAll('.mgr-section-pad').forEach(function(el){el.classList.remove('mgr-section-pad');});
  document.getElementById('mgr-back-bar').style.display='none';
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

function renderWorkflow(){
  var el=document.getElementById('mgr-workflow-content');
  if(!el)return;
  var cars=S.inventory||[];
  if(!cars.length){el.innerHTML='<p style="color:#555;padding:20px 0;font-size:13px;">No vehicles in inventory.</p>';return;}
  var STAGES=[
    {key:'detail',label:'Detail',icon:'&#x2728;'},
    {key:'photos',label:'Photos',icon:'&#x1F4F7;'},
    {key:'parts',label:'Parts',icon:'&#x1F527;'},
    {key:'tasks',label:'Repairs',icon:'&#x1F6E0;'},
  ];
  var out='<div style="display:flex;flex-direction:column;gap:14px;padding-bottom:30px;">';
  for(var i=0;i<cars.length;i++){
    var car=cars[i];
    var ws=getWorkState(car.id);
    var cats=ws.categories||{};
    out+='<div style="background:#111;border-radius:16px;padding:16px;border:1px solid #1e1e1e;">';
    out+='<div style="font-size:15px;font-weight:700;color:#fff;margin-bottom:14px;font-family:\'Barlow Condensed\',sans-serif;letter-spacing:1px;">'+car.name+'</div>';
    out+='<div style="display:flex;gap:8px;">';
    for(var j=0;j<STAGES.length;j++){
      var stage=STAGES[j];
      var s=cats[stage.key];
      var done=s&&s.done;
      var reviewed=s&&s.reviewed;
      var bg=reviewed?'#14532d':done?'#1e3a5f':'#1a1a1a';
      var borderColor=reviewed?'#22c55e':done?'#3b82f6':'#2a2a2a';
      var textColor=reviewed?'#4ade80':done?'#60a5fa':'#444';
      out+='<div style="flex:1;background:'+bg+';border-radius:10px;padding:8px 4px;text-align:center;border:1px solid '+borderColor+';">';
      out+='<div style="font-size:20px;">'+stage.icon+'</div>';
      out+='<div style="font-size:10px;color:'+textColor+';font-weight:700;margin-top:4px;font-family:\'Barlow Condensed\',sans-serif;letter-spacing:0.5px;text-transform:uppercase;">'+stage.label+'</div>';
      if(reviewed) out+='<div style="font-size:9px;color:#4ade80;margin-top:2px;">&#x2713; Done</div>';
      else if(done) out+='<div style="font-size:9px;color:#60a5fa;margin-top:2px;">Review</div>';
      else out+='<div style="font-size:9px;color:#333;margin-top:2px;">Pending</div>';
      out+='</div>';
    }
    out+='</div></div>';
  }
  out+='</div>';
  el.innerHTML=out;
}
"""
html = html.replace('</script>\n</body>', NEW_JS + '\n</script>\n</body>', 1)

with open('C:/Users/Vlad/Desktop/carfactory/index_preview.html', 'w', encoding='utf-8') as f:
    f.write(html)

print("Done: index_preview.html created")
