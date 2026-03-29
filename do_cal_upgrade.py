import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('C:/Users/Vlad/Desktop/carfactory/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

NEW_CSS = """/* -- CALENDAR -- */
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
.cal-day.has-custom{background:#0a071a;}
.cal-day.has-custom .cal-day-num{color:#a78bfa;}
.cal-day.has-events.has-custom{background:#071114;}
.cal-day.selected{background:#0f2a0f;border-color:#4ade80 !important;}
.cal-day.has-custom.selected{background:#110f2a;border-color:#a78bfa !important;}
.cal-dots{display:flex;gap:2px;margin-top:3px;}
.cal-dot{width:4px;height:4px;border-radius:50%;background:#4ade80;flex-shrink:0;}
.cal-dot-ev{width:4px;height:4px;border-radius:50%;background:#a78bfa;flex-shrink:0;}
.cal-detail{background:#111;border-radius:14px;padding:14px;border:1px solid #1a1a1a;margin-bottom:20px;}
.cal-detail-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.cal-detail-title{font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;color:#fff;letter-spacing:1px;text-transform:uppercase;}
.cal-add-btn{background:#1a1a2e;border:1px solid #2a2a4a;color:#a78bfa;font-size:13px;font-weight:600;padding:6px 12px;border-radius:8px;cursor:pointer;}
.cal-event{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #1a1a1a;}
.cal-event:last-child{border-bottom:none;}
.cal-event-dot{width:7px;height:7px;border-radius:50%;background:#4ade80;flex-shrink:0;margin-top:4px;}
.cal-event-dot-custom{width:7px;height:7px;border-radius:50%;background:#a78bfa;flex-shrink:0;margin-top:4px;}
.cal-event-body{flex:1;}
.cal-event-text{font-size:13px;color:#bbb;font-weight:500;}
.cal-event-meta{font-size:11px;color:#444;margin-top:2px;}
.cal-event-notif{font-size:11px;color:#30d158;margin-top:1px;}
.cal-event-del{background:none;border:none;color:#333;font-size:16px;cursor:pointer;padding:2px 4px;margin-left:auto;flex-shrink:0;}
.cal-event-del:active{color:#ff453a;}
.cal-modal{position:fixed;inset:0;z-index:800;display:none;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.75);}
.cal-modal.open{display:flex;}
.cal-form{background:#111;border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:24px 20px 32px;border:1px solid #222;border-bottom:none;max-height:90vh;overflow-y:auto;}
.cal-form-title{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:18px;color:#fff;}
.cal-input{width:100%;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:12px 14px;color:#fff;font-size:15px;margin-bottom:10px;display:block;}
.cal-input:focus{outline:none;border-color:#555;}
.cal-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.cal-toggle-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid #1a1a1a;margin-top:4px;}
.cal-toggle-label{font-size:14px;color:#aaa;}
.cal-notif-toggle{width:44px;height:26px;background:#333;border-radius:13px;border:none;cursor:pointer;position:relative;transition:background 0.2s;flex-shrink:0;}
.cal-notif-toggle.on{background:#30d158;}
.cal-notif-toggle::after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;background:#fff;border-radius:50%;transition:transform 0.2s;}
.cal-notif-toggle.on::after{transform:translateX(18px);}
.cal-save-btn{width:100%;padding:14px;background:#fff;color:#000;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;margin-top:16px;letter-spacing:0.5px;}
.cal-save-btn:active{opacity:0.85;}
.cal-cancel-link{display:block;text-align:center;color:#555;font-size:15px;cursor:pointer;margin-top:14px;padding:4px;}
.upcoming-section{margin-top:4px;}
.upcoming-hdr{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;color:#555;margin-bottom:14px;}
.upcoming-empty{font-size:13px;color:#333;padding:12px 0;}
.upcoming-item{display:flex;align-items:flex-start;gap:14px;padding:14px 0;border-bottom:1px solid #111;}
.upcoming-item:last-child{border-bottom:none;}
.upcoming-date-col{min-width:42px;text-align:center;background:#111;border-radius:10px;padding:6px 4px;}
.upcoming-day-num{font-size:24px;font-weight:900;color:#fff;line-height:1;}
.upcoming-mon{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1px;margin-top:1px;}
.upcoming-body{flex:1;min-width:0;}
.upcoming-title-text{font-size:15px;font-weight:600;color:#fff;}
.upcoming-time{font-size:12px;color:#a78bfa;margin-top:3px;}
.upcoming-notes-text{font-size:12px;color:#444;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.upcoming-notif-badge{display:inline-block;font-size:10px;color:#30d158;background:rgba(48,209,88,0.1);border:1px solid rgba(48,209,88,0.2);border-radius:4px;padding:2px 5px;margin-top:4px;}
.upcoming-del{background:none;border:none;color:#2a2a2a;font-size:18px;cursor:pointer;padding:4px;flex-shrink:0;margin-top:2px;}
.upcoming-del:active{color:#ff453a;}"""

NEW_JS = (
    "function renderCalendar(){\n"
    "  var el=document.getElementById('mgr-calendar-content');\n"
    "  if(!el) return;\n"
    "  var today=new Date();\n"
    "  var year=_calDate.getFullYear(), month=_calDate.getMonth();\n"
    "  var MON=['January','February','March','April','May','June','July','August','September','October','November','December'];\n"
    "  var MON3=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];\n"
    "  var arrivalMap={}, customMap={};\n"
    "  (S.inventory||[]).forEach(function(car){\n"
    "    if(!car.created_at) return;\n"
    "    var d=new Date(car.created_at);\n"
    "    var key=d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();\n"
    "    if(!arrivalMap[key]) arrivalMap[key]=[];\n"
    "    arrivalMap[key].push(car.name);\n"
    "  });\n"
    "  (S.calendarEvents||[]).forEach(function(ev){\n"
    "    if(!ev.event_date) return;\n"
    "    var p=ev.event_date.split('-');\n"
    "    var key=parseInt(p[0])+'-'+parseInt(p[1])+'-'+parseInt(p[2]);\n"
    "    if(!customMap[key]) customMap[key]=[];\n"
    "    customMap[key].push(ev);\n"
    "  });\n"
    "  var daysInMonth=new Date(year,month+1,0).getDate();\n"
    "  var firstDay=new Date(year,month,1).getDay();\n"
    "  var out='<div class=\"cal-wrap\">';\n"
    "  out+='<div class=\"cal-nav\"><button class=\"cal-nav-btn\" onclick=\"calPrev()\">&#8249;</button>';\n"
    "  out+='<div class=\"cal-month\">'+MON[month]+' '+year+'</div>';\n"
    "  out+='<button class=\"cal-nav-btn\" onclick=\"calNext()\">&#8250;</button></div>';\n"
    "  out+='<div class=\"cal-grid\">';\n"
    "  ['SUN','MON','TUE','WED','THU','FRI','SAT'].forEach(function(d){out+='<div class=\"cal-dow\">'+d+'</div>';});\n"
    "  for(var i=0;i<firstDay;i++) out+='<div class=\"cal-day empty\"></div>';\n"
    "  for(var d=1;d<=daysInMonth;d++){\n"
    "    var key=year+'-'+(month+1)+'-'+d;\n"
    "    var ar=arrivalMap[key]||[], cu=customMap[key]||[];\n"
    "    var isToday=today.getFullYear()===year&&today.getMonth()===month&&today.getDate()===d;\n"
    "    var cls='cal-day'+(isToday?' today':'')+(ar.length?' has-events':'')+(cu.length?' has-custom':'');\n"
    "    var dots='';\n"
    "    if(ar.length||cu.length){\n"
    "      dots='<div class=\"cal-dots\">';\n"
    "      for(var j=0;j<Math.min(ar.length,2);j++) dots+='<div class=\"cal-dot\"></div>';\n"
    "      for(var k=0;k<Math.min(cu.length,2);k++) dots+='<div class=\"cal-dot-ev\"></div>';\n"
    "      dots+='</div>';\n"
    "    }\n"
    "    out+='<div class=\"'+cls+'\" onclick=\"calSelectDay('+d+')\"><div class=\"cal-day-num\">'+d+'</div>'+dots+'</div>';\n"
    "  }\n"
    "  out+='</div>';\n"
    "  out+='<div class=\"cal-detail\" id=\"cal-detail-panel\">';\n"
    "  if(year===today.getFullYear()&&month===today.getMonth()){\n"
    "    out+=_calDayHTML(today.getDate(),year,month,arrivalMap,customMap,MON,MON3);\n"
    "  } else {\n"
    "    out+='<div class=\"cal-detail-hdr\"><div class=\"cal-detail-title\">'+MON[month]+'</div>';\n"
    "    out+='<button class=\"cal-add-btn\" onclick=\"calAddEvent(null)\">+ Add Event</button></div>';\n"
    "    out+='<div style=\"color:#333;font-size:13px;\">Tap a day to see events</div>';\n"
    "  }\n"
    "  out+='</div>';\n"
    "  out+=_calUpcomingHTML(today,MON3);\n"
    "  out+='</div>';\n"
    "  el.innerHTML=out;\n"
    "}\n"
    "function _calDayHTML(d,year,month,arrivalMap,customMap,MON,MON3){\n"
    "  var key=year+'-'+(month+1)+'-'+d;\n"
    "  var ar=arrivalMap[key]||[], cu=customMap[key]||[];\n"
    "  var m2=(month+1)<10?'0'+(month+1):''+(month+1);\n"
    "  var d2=d<10?'0'+d:''+d;\n"
    "  var dateStr=year+'-'+m2+'-'+d2;\n"
    "  var out='<div class=\"cal-detail-hdr\"><div class=\"cal-detail-title\">'+MON[month]+' '+d+'</div>';\n"
    "  out+='<button class=\"cal-add-btn\" onclick=\"calAddEvent(\\''+dateStr+'\\')\">'+'+ Add</button></div>';\n"
    "  if(!ar.length&&!cu.length){\n"
    "    out+='<div style=\"color:#333;font-size:13px;padding:4px 0;\">No events</div>';\n"
    "    return out;\n"
    "  }\n"
    "  ar.forEach(function(name){\n"
    "    out+='<div class=\"cal-event\"><div class=\"cal-event-dot\"></div><div class=\"cal-event-body\"><div class=\"cal-event-text\">'+_esc(name)+'</div><div class=\"cal-event-meta\">Vehicle received</div></div></div>';\n"
    "  });\n"
    "  cu.forEach(function(ev){\n"
    "    out+='<div class=\"cal-event\"><div class=\"cal-event-dot-custom\"></div><div class=\"cal-event-body\">';\n"
    "    out+='<div class=\"cal-event-text\">'+_esc(ev.title)+'</div>';\n"
    "    if(ev.event_time) out+='<div class=\"cal-event-meta\">'+_fmtTime(ev.event_time)+'</div>';\n"
    "    if(ev.notes) out+='<div class=\"cal-event-meta\">'+_esc(ev.notes)+'</div>';\n"
    "    if(ev.notify) out+='<div class=\"cal-event-notif\">&#128276; Notification set</div>';\n"
    "    out+='</div><button class=\"cal-event-del\" onclick=\"calDeleteEvent(\\''+ev.id+'\\')\">&#x2715;</button></div>';\n"
    "  });\n"
    "  return out;\n"
    "}\n"
    "function _calUpcomingHTML(today,MON3){\n"
    "  var now=new Date(today.getFullYear(),today.getMonth(),today.getDate());\n"
    "  var upcoming=(S.calendarEvents||[]).filter(function(ev){\n"
    "    if(!ev.event_date) return false;\n"
    "    var p=ev.event_date.split('-');\n"
    "    return new Date(parseInt(p[0]),parseInt(p[1])-1,parseInt(p[2]))>=now;\n"
    "  }).slice(0,20);\n"
    "  var out='<div class=\"upcoming-section\"><div class=\"upcoming-hdr\">Upcoming Events</div>';\n"
    "  if(!upcoming.length){\n"
    "    out+='<div class=\"upcoming-empty\">No upcoming events. Tap a day to add one.</div>';\n"
    "  } else {\n"
    "    upcoming.forEach(function(ev){\n"
    "      var p=ev.event_date.split('-');\n"
    "      var dn=parseInt(p[2]), mo=parseInt(p[1])-1;\n"
    "      out+='<div class=\"upcoming-item\">';\n"
    "      out+='<div class=\"upcoming-date-col\"><div class=\"upcoming-day-num\">'+dn+'</div><div class=\"upcoming-mon\">'+MON3[mo]+'</div></div>';\n"
    "      out+='<div class=\"upcoming-body\"><div class=\"upcoming-title-text\">'+_esc(ev.title)+'</div>';\n"
    "      if(ev.event_time) out+='<div class=\"upcoming-time\">'+_fmtTime(ev.event_time)+'</div>';\n"
    "      if(ev.notes) out+='<div class=\"upcoming-notes-text\">'+_esc(ev.notes)+'</div>';\n"
    "      if(ev.notify) out+='<span class=\"upcoming-notif-badge\">&#128276; notified</span>';\n"
    "      out+='</div><button class=\"upcoming-del\" onclick=\"calDeleteEvent(\\''+ev.id+'\\')\">\u2715</button></div>';\n"
    "    });\n"
    "  }\n"
    "  return out+'</div>';\n"
    "}\n"
    "function _fmtTime(t){\n"
    "  if(!t) return '';\n"
    "  var p=t.split(':'), h=parseInt(p[0]), m=parseInt(p[1]||0);\n"
    "  var ap=h>=12?'PM':'AM'; h=h%12||12;\n"
    "  return h+':'+(m<10?'0':'')+m+' '+ap;\n"
    "}\n"
    "function _esc(s){\n"
    "  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');\n"
    "}\n"
    "function calPrev(){_calDate.setMonth(_calDate.getMonth()-1);renderCalendar();}\n"
    "function calNext(){_calDate.setMonth(_calDate.getMonth()+1);renderCalendar();}\n"
    "function calSelectDay(d){\n"
    "  var year=_calDate.getFullYear(), month=_calDate.getMonth();\n"
    "  var MON=['January','February','March','April','May','June','July','August','September','October','November','December'];\n"
    "  var MON3=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];\n"
    "  document.querySelectorAll('.cal-day.selected').forEach(function(el){el.classList.remove('selected');});\n"
    "  var days=document.querySelectorAll('#mgr-calendar-content .cal-day:not(.empty)');\n"
    "  if(days[d-1]) days[d-1].classList.add('selected');\n"
    "  var arrivalMap={}, customMap={};\n"
    "  (S.inventory||[]).forEach(function(car){\n"
    "    if(!car.created_at) return;\n"
    "    var cd=new Date(car.created_at);\n"
    "    var key=cd.getFullYear()+'-'+(cd.getMonth()+1)+'-'+cd.getDate();\n"
    "    if(!arrivalMap[key]) arrivalMap[key]=[];\n"
    "    arrivalMap[key].push(car.name);\n"
    "  });\n"
    "  (S.calendarEvents||[]).forEach(function(ev){\n"
    "    if(!ev.event_date) return;\n"
    "    var p=ev.event_date.split('-');\n"
    "    var key=parseInt(p[0])+'-'+parseInt(p[1])+'-'+parseInt(p[2]);\n"
    "    if(!customMap[key]) customMap[key]=[];\n"
    "    customMap[key].push(ev);\n"
    "  });\n"
    "  var panel=document.getElementById('cal-detail-panel');\n"
    "  if(panel) panel.innerHTML=_calDayHTML(d,year,month,arrivalMap,customMap,MON,MON3);\n"
    "}\n"
    "function calAddEvent(dateStr){\n"
    "  var modal=document.getElementById('cal-add-modal');\n"
    "  if(!modal) return;\n"
    "  document.getElementById('cal-ev-title').value='';\n"
    "  document.getElementById('cal-ev-notes').value='';\n"
    "  document.getElementById('cal-ev-time').value='';\n"
    "  var nb=document.getElementById('cal-notif-toggle');\n"
    "  if(nb) nb.classList.remove('on');\n"
    "  if(!dateStr){\n"
    "    var now=new Date();\n"
    "    var m2=(now.getMonth()+1)<10?'0'+(now.getMonth()+1):''+(now.getMonth()+1);\n"
    "    var d2=now.getDate()<10?'0'+now.getDate():''+now.getDate();\n"
    "    dateStr=now.getFullYear()+'-'+m2+'-'+d2;\n"
    "  }\n"
    "  document.getElementById('cal-ev-date').value=dateStr;\n"
    "  modal.classList.add('open');\n"
    "  setTimeout(function(){document.getElementById('cal-ev-title').focus();},200);\n"
    "}\n"
    "function calCloseModal(){\n"
    "  var modal=document.getElementById('cal-add-modal');\n"
    "  if(modal) modal.classList.remove('open');\n"
    "}\n"
    "async function calSaveEvent(){\n"
    "  var title=document.getElementById('cal-ev-title').value.trim();\n"
    "  var date=document.getElementById('cal-ev-date').value;\n"
    "  var time=document.getElementById('cal-ev-time').value||null;\n"
    "  var notes=document.getElementById('cal-ev-notes').value.trim()||null;\n"
    "  var notify=document.getElementById('cal-notif-toggle').classList.contains('on');\n"
    "  if(!title){alert('Please enter an event title.');return;}\n"
    "  if(!date){alert('Please select a date.');return;}\n"
    "  var btn=document.querySelector('.cal-save-btn');\n"
    "  if(btn){btn.textContent='Saving...';btn.disabled=true;}\n"
    "  var evObj={title:title,event_date:date,event_time:time,notes:notes,notify:notify,created_by:me?me.name:''};\n"
    "  var saved=null;\n"
    "  try{\n"
    "    var res=await sbPost('calendar_events',evObj);\n"
    "    saved=Array.isArray(res)?res[0]:res;\n"
    "    if(!saved||!saved.id) throw new Error('no id');\n"
    "    if(!S.calendarEvents) S.calendarEvents=[];\n"
    "    S.calendarEvents.push(saved);\n"
    "    S.calendarEvents.sort(function(a,b){return (a.event_date||'').localeCompare(b.event_date||'');});\n"
    "  } catch(e){\n"
    "    evObj.id='local_'+Date.now();\n"
    "    if(!S.calendarEvents) S.calendarEvents=[];\n"
    "    S.calendarEvents.push(evObj);\n"
    "    S.calendarEvents.sort(function(a,b){return (a.event_date||'').localeCompare(b.event_date||'');});\n"
    "    try{localStorage.setItem('cf_cal_ev',JSON.stringify(S.calendarEvents));}catch(e2){}\n"
    "    saved=evObj;\n"
    "  }\n"
    "  if(notify&&saved) calScheduleNotification(saved);\n"
    "  calCloseModal();\n"
    "  if(btn){btn.textContent='Save Event';btn.disabled=false;}\n"
    "  var p=date.split('-');\n"
    "  _calDate=new Date(parseInt(p[0]),parseInt(p[1])-1,1);\n"
    "  renderCalendar();\n"
    "  setTimeout(function(){calSelectDay(parseInt(p[2]));},50);\n"
    "}\n"
    "async function calDeleteEvent(id){\n"
    "  if(!id) return;\n"
    "  if(!confirm('Delete this event?')) return;\n"
    "  S.calendarEvents=(S.calendarEvents||[]).filter(function(e){return e.id!==id;});\n"
    "  if(!String(id).startsWith('local_')){\n"
    "    try{await sbDelete('calendar_events',id);}catch(e){}\n"
    "  } else {\n"
    "    try{localStorage.setItem('cf_cal_ev',JSON.stringify(S.calendarEvents));}catch(e){}\n"
    "  }\n"
    "  renderCalendar();\n"
    "}\n"
    "async function calScheduleNotification(ev){\n"
    "  try{\n"
    "    var MON3=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];\n"
    "    var p=ev.event_date.split('-');\n"
    "    var dateLabel=MON3[parseInt(p[1])-1]+' '+parseInt(p[2]);\n"
    "    var bodyTxt=dateLabel+(ev.event_time?' at '+_fmtTime(ev.event_time):'')+(ev.notes?' \u2014 '+ev.notes:'');\n"
    "    var payload={app_id:OS_APP_ID,headings:{en:'Event Reminder: '+ev.title},contents:{en:bodyTxt},included_segments:['All']};\n"
    "    if(ev.event_date&&ev.event_time){\n"
    "      var sendAt=new Date(ev.event_date+'T'+ev.event_time);\n"
    "      if(sendAt>new Date()) payload.send_after=sendAt.toUTCString();\n"
    "    }\n"
    "    await fetch('https://onesignal.com/api/v1/notifications',{\n"
    "      method:'POST',\n"
    "      headers:{'Content-Type':'application/json','Authorization':'Key '+OS_API_KEY},\n"
    "      body:JSON.stringify(payload)\n"
    "    });\n"
    "  }catch(e){console.warn('Notification error',e);}\n"
    "}"
)

MODAL_HTML = (
    "\n<!-- CALENDAR ADD EVENT MODAL -->\n"
    "<div id=\"cal-add-modal\" class=\"cal-modal\" onclick=\"if(event.target===this)calCloseModal()\">\n"
    "  <div class=\"cal-form\">\n"
    "    <div class=\"cal-form-title\">Add Event</div>\n"
    "    <input id=\"cal-ev-title\" class=\"cal-input\" placeholder=\"Event title *\" />\n"
    "    <div class=\"cal-row2\">\n"
    "      <input id=\"cal-ev-date\" class=\"cal-input\" type=\"date\" style=\"margin-bottom:0;\" />\n"
    "      <input id=\"cal-ev-time\" class=\"cal-input\" type=\"time\" style=\"margin-bottom:0;\" />\n"
    "    </div>\n"
    "    <textarea id=\"cal-ev-notes\" class=\"cal-input\" placeholder=\"Notes (optional)\" rows=\"3\" style=\"resize:none;margin-top:10px;\"></textarea>\n"
    "    <div class=\"cal-toggle-row\">\n"
    "      <span class=\"cal-toggle-label\">&#128276; Send push notification</span>\n"
    "      <button id=\"cal-notif-toggle\" class=\"cal-notif-toggle\" onclick=\"this.classList.toggle('on')\"></button>\n"
    "    </div>\n"
    "    <button class=\"cal-save-btn\" onclick=\"calSaveEvent()\">Save Event</button>\n"
    "    <span class=\"cal-cancel-link\" onclick=\"calCloseModal()\">Cancel</span>\n"
    "  </div>\n"
    "</div>\n"
)

# 1. Replace calendar CSS
css_start = html.find('/* \u2500\u2500 CALENDAR \u2500\u2500')
css_end = html.find('\n</style>\n<script>', css_start)
if css_start != -1 and css_end != -1:
    html = html[:css_start] + NEW_CSS + html[css_end:]
    print('CSS replaced OK')
else:
    print('ERROR CSS not found', css_start, css_end)

# 2. Update S state
OLD_S = 'let S={employees:[],inventory:[],assignments:[],notifications:[]};'
NEW_S = 'let S={employees:[],inventory:[],assignments:[],notifications:[],calendarEvents:[]};'
if OLD_S in html:
    html = html.replace(OLD_S, NEW_S, 1)
    print('S state OK')
else:
    print('WARN S state not found (may already have calendarEvents)')

# 3. Sync fetch update
OLD_SYNC = "const [emps, inv, asgn] = await Promise.all([\n      sbGet('employees', 'order=name&limit=500'),\n      sbGet('inventory', 'order=name&limit=500&select=*'),\n      sbGet('assignments', 'select=*&order=assigned_at.desc&limit=500')\n    ]);"
NEW_SYNC = "const [emps, inv, asgn, calEvRaw] = await Promise.all([\n      sbGet('employees', 'order=name&limit=500'),\n      sbGet('inventory', 'order=name&limit=500&select=*'),\n      sbGet('assignments', 'select=*&order=assigned_at.desc&limit=500'),\n      sbGet('calendar_events', 'order=event_date.asc&limit=500').catch(()=>[])\n    ]);\n    S.calendarEvents = Array.isArray(calEvRaw) ? calEvRaw : [];"
if OLD_SYNC in html:
    html = html.replace(OLD_SYNC, NEW_SYNC, 1)
    print('Sync OK')
else:
    print('WARN sync not found')

# 4. Replace JS functions
js_start = html.find('function renderCalendar(){')
js_end = html.rfind('}\n\n</script>')
if js_start != -1 and js_end != -1:
    html = html[:js_start] + NEW_JS + '\n\n' + html[js_end+1:]
    print('Calendar JS replaced OK')
else:
    print('ERROR JS not found', js_start, js_end)

# 5. Inject modal
if '</body>' in html:
    html = html.replace('</body>', MODAL_HTML + '</body>', 1)
    print('Modal injected OK')
else:
    print('ERROR no </body>')

with open('C:/Users/Vlad/Desktop/carfactory/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('File written OK')
