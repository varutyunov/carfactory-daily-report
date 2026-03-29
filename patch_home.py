with open('C:/Users/Vlad/Desktop/carfactory/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# ── 1. Calendar CSS ───────────────────────────────────────────────────────────
CAL_CSS = """
/* ── CALENDAR ── */
#mgr-calendar{overflow-y:auto;background:#000;}
.cal-wrap{padding:14px 14px 80px;}
.cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}
.cal-month{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:900;color:#fff;letter-spacing:2px;text-transform:uppercase;}
.cal-nav-btn{background:none;border:1px solid #222;color:#fff;border-radius:10px;width:36px;height:36px;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:16px;}
.cal-dow{font-size:10px;color:#444;text-align:center;padding:4px 0;font-family:'Barlow Condensed',sans-serif;letter-spacing:1px;text-transform:uppercase;font-weight:700;}
.cal-day{aspect-ratio:1;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;position:relative;transition:background .12s;border:1px solid transparent;}
.cal-day.empty{cursor:default;}
.cal-day-num{font-size:13px;font-weight:600;color:#555;line-height:1;}
.cal-day.today{background:#111;border-color:#333;}
.cal-day.today .cal-day-num{color:#fff;font-weight:900;}
.cal-day.has-events{background:#071a07;}
.cal-day.has-events .cal-day-num{color:#4ade80;}
.cal-day.selected{background:#0f2a0f;border-color:#4ade80 !important;}
.cal-dots{display:flex;gap:2px;margin-top:3px;}
.cal-dot{width:4px;height:4px;border-radius:50%;background:#4ade80;}
.cal-detail{background:#111;border-radius:14px;padding:14px;border:1px solid #1a1a1a;}
.cal-detail-title{font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;color:#fff;letter-spacing:1px;margin-bottom:10px;text-transform:uppercase;}
.cal-event{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #1a1a1a;}
.cal-event:last-child{border-bottom:none;}
.cal-event-dot{width:7px;height:7px;border-radius:50%;background:#4ade80;flex-shrink:0;}
.cal-event-text{font-size:13px;color:#bbb;font-weight:500;}
"""
html = html.replace('</style>', CAL_CSS + '\n</style>', 1)

# ── 2. Add mgr-calendar view HTML ─────────────────────────────────────────────
CAL_HTML = """    <div class="view" id="mgr-calendar">
      <div id="mgr-calendar-content" style="padding:14px;"></div>
    </div>

"""
html = html.replace('    <div class="view" id="mgr-workflow">', CAL_HTML + '    <div class="view" id="mgr-workflow">', 1)

# ── 3. Add all home JS functions before </script>\n</body> ────────────────────
HOME_JS = r"""
/* ── MGR HOME NAVIGATION ── */
function mgrGoSection(id, label){
  showView('mgr-'+id);
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
  updateTabBadges();
}

function goMgrHome(){
  document.querySelectorAll('.mgr-section-pad').forEach(function(el){el.classList.remove('mgr-section-pad');});
  var bar=document.getElementById('mgr-back-bar');
  if(bar) bar.style.display='none';
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

/* ── CALENDAR VIEW ── */
var _calDate=new Date();
function renderCalendar(){
  var el=document.getElementById('mgr-calendar-content');
  if(!el)return;
  var today=new Date();
  var year=_calDate.getFullYear();
  var month=_calDate.getMonth();
  var eventMap={};
  (S.inventory||[]).forEach(function(car){
    if(!car.created_at)return;
    var d=new Date(car.created_at);
    var key=d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
    if(!eventMap[key])eventMap[key]=[];
    eventMap[key].push(car.name);
  });
  var MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
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
    var evts=eventMap[key]||[];
    var isToday=today.getFullYear()===year&&today.getMonth()===month&&today.getDate()===d;
    var cls='cal-day'+(isToday?' today':'')+(evts.length?' has-events':'');
    var dots=evts.length?'<div class="cal-dots">'+'<div class="cal-dot"></div>'.repeat(Math.min(evts.length,3))+'</div>':'';
    out+='<div class="'+cls+'" onclick="calSelectDay('+d+')"><div class="cal-day-num">'+d+'</div>'+dots+'</div>';
  }
  out+='</div>';
  var initKey=today.getFullYear()+'-'+(today.getMonth()+1)+'-'+today.getDate();
  var initEvts=(year===today.getFullYear()&&month===today.getMonth())?eventMap[initKey]||[]:[];
  out+='<div class="cal-detail" id="cal-detail-panel">';
  if(year===today.getFullYear()&&month===today.getMonth()){
    out+='<div class="cal-detail-title">Today — '+MON[today.getMonth()]+' '+today.getDate()+'</div>';
    if(initEvts.length){
      out+=initEvts.map(function(n){return'<div class="cal-event"><div class="cal-event-dot"></div><div class="cal-event-text">'+n+' received</div></div>';}).join('');
    } else {
      out+='<div style="color:#444;font-size:13px;padding:4px 0;">No vehicles received today</div>';
    }
  } else {
    out+='<div style="color:#444;font-size:13px;padding:4px 0;">Tap a day to see details</div>';
  }
  out+='</div></div>';
  el.innerHTML=out;
}
function calPrev(){_calDate.setMonth(_calDate.getMonth()-1);renderCalendar();}
function calNext(){_calDate.setMonth(_calDate.getMonth()+1);renderCalendar();}
function calSelectDay(d){
  var year=_calDate.getFullYear(),month=_calDate.getMonth();
  var key=year+'-'+(month+1)+'-'+d;
  var MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.querySelectorAll('.cal-day.selected').forEach(function(el){el.classList.remove('selected');});
  var days=document.querySelectorAll('#mgr-calendar-content .cal-day:not(.empty)');
  if(days[d-1])days[d-1].classList.add('selected');
  var cars=(S.inventory||[]).filter(function(car){
    if(!car.created_at)return false;
    var cd=new Date(car.created_at);
    return cd.getFullYear()===year&&cd.getMonth()===month&&cd.getDate()===d;
  });
  var panel=document.getElementById('cal-detail-panel');
  if(!panel)return;
  panel.innerHTML='<div class="cal-detail-title">'+MON[month]+' '+d+', '+year+'</div>';
  if(cars.length){
    panel.innerHTML+=cars.map(function(c){return'<div class="cal-event"><div class="cal-event-dot"></div><div class="cal-event-text">'+c.name+' received</div></div>';}).join('');
  } else {
    panel.innerHTML+='<div style="color:#444;font-size:13px;padding:4px 0;">No vehicles received</div>';
  }
}
"""

# Find the last </script> before </body>
import re
# Replace last occurrence of </script> followed by stuff ending in </body>
last_script = html.rfind('\n</script>')
if last_script != -1:
    html = html[:last_script] + HOME_JS + html[last_script:]
    print('Injected JS OK at position', last_script)
else:
    print('ERROR: could not find </script>')

with open('C:/Users/Vlad/Desktop/carfactory/index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print('Done')
