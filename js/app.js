/* Waterjet Production Manager - first version.
   No-login shared mode requires explicit Supabase policies. See supabase/schema.sql and README. */
const $ = id => document.getElementById(id);
let jobs=[], sessions=[], db=null, calendar=null, activeTimerJob=null, charts={}, parsedOmex=null, editingSessionId=null;
let settings={dailyHours:8,workStart:"07:00"};
const localKey="wjpm_v1_local";
const fmtDate=d=>d?new Date(d).toLocaleDateString():"—";
const fmtDateTime=d=>d?new Date(d).toLocaleString():"—";
const hoursLabel=s=>(Number(s||0)/3600).toFixed(2)+" h";
const money=n=>"$"+Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const num=v=>v===null||v===undefined||v===""?null:Number(v);
const isoLocal=d=>{const x=new Date(d);x.setMinutes(x.getMinutes()-x.getTimezoneOffset());return x.toISOString().slice(0,16)};
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600)}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function localLoad(){try{const x=JSON.parse(localStorage.getItem(localKey)||"{}");jobs=x.jobs||[];sessions=x.sessions||[];settings={...settings,...x.settings}}catch{}}
function localSave(){localStorage.setItem(localKey,JSON.stringify({jobs,sessions,settings}))}
function isCloud(){return !!db}
async function loadData(){
 if(!db){localLoad();renderAll();$("sync-state").textContent="Local browser only";return}
 try{
  const [jr,sr]=await Promise.all([db.from("jobs").select("*").order("created_at",{ascending:false}),db.from("cut_sessions").select("*").order("started_at")]);
  if(jr.error)throw jr.error;if(sr.error)throw sr.error;
  jobs=jr.data.map(normalizeJob);sessions=sr.data;renderAll();$("sync-state").textContent="● Live database connected";
 }catch(e){console.error(e);$("sync-state").textContent="Database error";toast("Database error: "+e.message)}
}
function normalizeJob(j){return {...j,omex_data:j.omex_data||{},scheduled_start:j.scheduled_start||null,scheduled_end:j.scheduled_end||null}}
async function saveJob(job){
 job.updated_at=new Date().toISOString();
 if(db){const {data,error}=await db.from("jobs").upsert(job).select().single();if(error)throw error;const i=jobs.findIndex(x=>x.id===data.id);if(i>=0)jobs[i]=normalizeJob(data);else jobs.unshift(normalizeJob(data))}
 else{const i=jobs.findIndex(x=>x.id===job.id);if(i>=0)jobs[i]=job;else jobs.unshift(job);localSave()}
 renderAll();
}
async function deleteJob(id){if(!confirm("Delete this job and its cutting sessions? Consider keeping completed records for history."))return;
 if(db){const {error}=await db.from("jobs").delete().eq("id",id);if(error)throw error;await db.from("cut_sessions").delete().eq("job_id",id)}
 jobs=jobs.filter(j=>j.id!==id);sessions=sessions.filter(s=>s.job_id!==id);localSave();renderAll();toast("Job deleted")}
async function saveSession(s){
 if(db){const {data,error}=await db.from("cut_sessions").insert(s).select().single();if(error)throw error;sessions.push(data)}
 else{ s.id=crypto.randomUUID();sessions.push(s);localSave()}
 renderAll();
}
async function updateSession(id,patch){if(db){const {error}=await db.from("cut_sessions").update(patch).eq("id",id);if(error)throw error}
 const i=sessions.findIndex(s=>s.id===id);if(i>=0)sessions[i]={...sessions[i],...patch};localSave();renderAll()}
async function deleteSession(id){if(!confirm("Delete this cutting session?"))return;if(db){const {error}=await db.from("cut_sessions").delete().eq("id",id);if(error)throw error}sessions=sessions.filter(s=>s.id!==id);localSave();renderAll();openTimer(activeTimerJob)}
function jobSessions(id){return sessions.filter(s=>s.job_id===id)}
function actualSeconds(id){return jobSessions(id).reduce((a,s)=>a+Math.max(0,(new Date(s.ended_at)-new Date(s.started_at))/1000),0)}
function scheduledJobs(){return jobs.filter(j=>j.scheduled_start&&!["Cancelled"].includes(j.status))}
function currentWeekRange(){const d=new Date();const day=(d.getDay()+6)%7;const start=new Date(d);start.setDate(d.getDate()-day);start.setHours(0,0,0,0);const end=new Date(start);end.setDate(start.getDate()+7);return {start,end}}
function within(d,a,b){const x=new Date(d);return x>=a&&x<b}
function setView(v){document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));$("view-"+v).classList.add("active");document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.view===v));$("page-title").textContent=({dashboard:"Dashboard",schedule:"Weekly Schedule",jobs:"Jobs & History",reports:"Production Reports",settings:"Settings & Data"})[v];if(v==="schedule")setTimeout(()=>calendar?.render(),50);if(v==="reports")runReport()}
function renderAll(){renderDashboard();renderJobs();renderUnscheduled();if(calendar)renderCalendarEvents();if($("view-reports").classList.contains("active"))runReport()}
function renderDashboard(){
 const {start,end}=currentWeekRange(),weekJobs=jobs.filter(j=>j.scheduled_start&&within(j.scheduled_start,start,end)),completed=jobs.filter(j=>j.status==="Completed"&&jobSessions(j.id).some(s=>within(s.ended_at,start,end)));
 $("week-label").textContent=start.toLocaleDateString()+" – "+new Date(end-1).toLocaleDateString();
 $("dash-scheduled").textContent=weekJobs.length;$("dash-completed").textContent=completed.length;
 $("dash-hours").textContent=weekJobs.reduce((a,j)=>a+Number(j.estimated_cut_seconds||0),0)/3600 .toFixed?.(1) || "0.0";
 const hrs=weekJobs.reduce((a,j)=>a+Number(j.estimated_cut_seconds||0),0)/3600;$("dash-hours").textContent=hrs.toFixed(1)+" h";
 $("dash-garnet").textContent=weekJobs.reduce((a,j)=>a+Number(j.estimated_garnet_lb||0),0).toFixed(1)+" lb";
 const up=weekJobs.sort((a,b)=>new Date(a.scheduled_start)-new Date(b.scheduled_start)).slice(0,6);
 $("upcoming-list").innerHTML=up.length?up.map(j=>`<div class="job-row"><div><strong>${esc(j.job_name)}</strong><small>${esc(j.job_number||"No job number")} · ${fmtDateTime(j.scheduled_start)}</small></div><span class="pill ${esc(j.status)}">${esc(j.status)}</span></div>`).join(""):'<p class="muted">No jobs scheduled this week.</p>';
 const dayLabels=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],vals=dayLabels.map((_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return sessions.filter(s=>{const x=new Date(s.started_at);return x.toDateString()===d.toDateString()}).reduce((a,s)=>a+(new Date(s.ended_at)-new Date(s.started_at))/3600000,0)});
 makeChart("dashboard-chart","bar",dayLabels,vals,"Actual cutting hours");
}
function renderJobs(){
 const q=($("job-search")?.value||"").toLowerCase(),st=$("status-filter")?.value||"";
 const list=jobs.filter(j=>(!st||j.status===st)&&[j.job_name,j.job_number,j.material].join(" ").toLowerCase().includes(q));
 $("jobs-table").innerHTML=list.map(j=>`<tr><td><strong>${esc(j.job_name)}</strong><br><small>${esc(j.job_number||"")}</small></td><td>${esc(j.material||"—")}</td><td>${fmtDate(j.scheduled_start)}</td><td>${hoursLabel(j.estimated_cut_seconds)}</td><td>${hoursLabel(actualSeconds(j.id))}</td><td><span class="pill ${esc(j.status)}">${esc(j.status)}</span></td><td><button class="table-action" data-detail="${j.id}">Open</button></td></tr>`).join("")||'<tr><td colspan="7">No matching jobs.</td></tr>';
}
function renderUnscheduled(){
 const list=jobs.filter(j=>!j.scheduled_start&&!["Completed","Cancelled"].includes(j.status));
 $("unscheduled-list").innerHTML=list.map(j=>`<div class="unscheduled-job" draggable="true" data-drag-job="${j.id}"><strong>${esc(j.job_name)}</strong><span>${esc(j.job_number||"No number")} · ${hoursLabel(j.estimated_cut_seconds)}</span></div>`).join("")||'<span class="muted">No unscheduled jobs.</span>';
 document.querySelectorAll("[data-drag-job]").forEach(el=>el.addEventListener("dragstart",e=>e.dataTransfer.setData("text/job-id",el.dataset.dragJob)));
}
function renderCalendarEvents(){if(!calendar)return;calendar.removeAllEvents();scheduledJobs().forEach(j=>calendar.addEvent({id:j.id,title:j.job_name,start:j.scheduled_start,end:j.scheduled_end||undefined,extendedProps:{jobId:j.id,status:j.status}}))}
function initCalendar(){
 const el=$("calendar");calendar=new FullCalendar.Calendar(el,{initialView:"timeGridWeek",firstDay:1,nowIndicator:true,allDaySlot:false,slotMinTime:"05:00:00",slotMaxTime:"17:00:00",height:"auto",editable:true,droppable:true,headerToolbar:{left:"prev,next today",center:"title",right:"timeGridDay,timeGridWeek,dayGridMonth"},eventDrop:async info=>{try{const j=jobs.find(x=>x.id===info.event.id);await saveJob({...j,scheduled_start:info.event.start.toISOString(),scheduled_end:info.event.end?.toISOString()||null,status:j.status==="Unscheduled"?"Scheduled":j.status});toast("Schedule updated on shared record")}catch(e){info.revert();toast(e.message)}},eventResize:async info=>{try{const j=jobs.find(x=>x.id===info.event.id);await saveJob({...j,scheduled_start:info.event.start.toISOString(),scheduled_end:info.event.end?.toISOString()||null});toast("Duration updated")}catch(e){info.revert();toast(e.message)}},eventClick:info=>openDetail(info.event.id),drop:async info=>{const id=info.draggedEl.dataset.dragJob,j=jobs.find(x=>x.id===id);if(!j)return;const start=info.date,end=new Date(start.getTime()+Number(j.estimated_cut_seconds||3600)*1000);try{await saveJob({...j,scheduled_start:start.toISOString(),scheduled_end:end.toISOString(),status:"Scheduled"});toast("Job scheduled")}catch(e){toast(e.message)}},eventDidMount:info=>{info.el.title=info.event.title+" · "+info.event.extendedProps.status}});calendar.render();renderCalendarEvents();
}
function openJob(id=null){
 const j=jobs.find(x=>x.id===id);$("job-form").reset();$("job-id").value=j?.id||"";$("job-dialog-title").textContent=j?"Edit job":"Create job";
 $("job-name").value=j?.job_name||"";$("job-number").value=j?.job_number||"";$("material").value=j?.material||"";$("thickness").value=j?.thickness_in||"";$("quantity").value=j?.quantity??"";$("priority").value=j?.priority||"Normal";$("estimate-hours").value=j?.estimated_cut_seconds?j.estimated_cut_seconds/3600:"";$("estimate-garnet").value=j?.estimated_garnet_lb??"";$("estimate-cost").value=j?.estimated_cost??"";$("job-status").value=j?.status||"Unscheduled";$("scheduled-start").value=j?.scheduled_start?isoLocal(j.scheduled_start):"";$("scheduled-end").value=j?.scheduled_end?isoLocal(j.scheduled_end):"";$("job-notes").value=j?.notes||"";
 $("job-dialog").showModal();
}
$("job-form").addEventListener("submit",async e=>{e.preventDefault();const id=$("job-id").value||crypto.randomUUID(),old=jobs.find(j=>j.id===id)||{};const start=$("scheduled-start").value?new Date($("scheduled-start").value).toISOString():null,end=$("scheduled-end").value?new Date($("scheduled-end").value).toISOString():null;
 const job={...old,id,job_name:$("job-name").value.trim(),job_number:$("job-number").value.trim()||null,material:$("material").value.trim()||null,thickness_in:num($("thickness").value),quantity:num($("quantity").value),priority:$("priority").value,status:$("job-status").value,estimated_cut_seconds:num($("estimate-hours").value)?num($("estimate-hours").value)*3600:null,estimated_garnet_lb:num($("estimate-garnet").value),estimated_cost:num($("estimate-cost").value),scheduled_start:start,scheduled_end:end,notes:$("job-notes").value,omex_data:old.omex_data||{},omex_raw:old.omex_raw||null,created_at:old.created_at||new Date().toISOString()};
 try{await saveJob(job);$("job-dialog").close();toast("Job saved")}catch(err){toast("Save failed: "+err.message)}});
function openDetail(id){const j=jobs.find(x=>x.id===id);if(!j)return;$("detail-title").textContent=j.job_name;$("detail-content").innerHTML=`
 <div class="stat-grid"><article class="stat-card"><span>OMEX estimated time</span><strong>${hoursLabel(j.estimated_cut_seconds)}</strong></article><article class="stat-card"><span>Actual recorded time</span><strong>${hoursLabel(actualSeconds(id))}</strong></article><article class="stat-card"><span>Estimated garnet</span><strong>${Number(j.estimated_garnet_lb||0).toFixed(2)} lb</strong></article><article class="stat-card"><span>Estimated cost</span><strong>${money(j.estimated_cost)}</strong></article></div>
 <div class="content-grid"><div><p><b>Job number:</b> ${esc(j.job_number||"—")}</p><p><b>Material:</b> ${esc(j.material||"—")}</p><p><b>Thickness:</b> ${esc(j.thickness_in??"—")} in</p><p><b>Quantity:</b> ${esc(j.quantity??"—")}</p><p><b>Status:</b> ${esc(j.status)}</p><p><b>Scheduled:</b> ${fmtDateTime(j.scheduled_start)} – ${fmtDateTime(j.scheduled_end)}</p><p><b>Notes:</b> ${esc(j.notes||"—")}</p></div><div><h3>OMEX details</h3><pre class="omex-pre">${esc(JSON.stringify(j.omex_data||{},null,2))}</pre></div></div>
 <div class="toolbar-actions detail-actions"><button class="btn primary" id="detail-timer">Timer / sessions</button><button class="btn" id="detail-import">Import OMEX</button><button class="btn" id="detail-edit">Edit job</button><button class="btn" id="detail-delete">Delete</button></div>`;
 $("detail-dialog").showModal();$("detail-timer").onclick=()=>{ $("detail-dialog").close();openTimer(id)};$("detail-import").onclick=()=>{ $("detail-dialog").close();openImport(id)};$("detail-edit").onclick=()=>{ $("detail-dialog").close();openJob(id)};$("detail-delete").onclick=async()=>{try{await deleteJob(id);$("detail-dialog").close()}catch(e){toast(e.message)}};
}
function openTimer(id){activeTimerJob=id;const j=jobs.find(x=>x.id===id);if(!j)return;$("timer-title").textContent=j.job_name;renderTimer();$("timer-dialog").showModal()}
function renderTimer(){const running=sessions.find(s=>s.job_id===activeTimerJob&&!s.ended_at);$("timer-state").innerHTML=running?`Timer running since <b>${fmtDateTime(running.started_at)}</b><strong>In progress</strong>`:`No active timer.<strong>${hoursLabel(actualSeconds(activeTimerJob))}</strong><span class="muted">Total recorded cutting time</span>`;$("timer-start").disabled=!!running;$("timer-pause").disabled=!running;$("session-list").innerHTML=jobSessions(activeTimerJob).map(s=>`<div class="session-row"><span>${fmtDateTime(s.started_at)} → ${fmtDateTime(s.ended_at||"")} · ${s.ended_at?hoursLabel((new Date(s.ended_at)-new Date(s.started_at))/1000):"Running"}</span><span><button data-edit-session="${s.id}">Edit</button> <button data-del-session="${s.id}">Delete</button></span></div>`).join("")||'<p class="muted">No sessions recorded.</p>';document.querySelectorAll("[data-del-session]").forEach(b=>b.onclick=()=>deleteSession(b.dataset.delSession));document.querySelectorAll("[data-edit-session]").forEach(b=>b.onclick=()=>{const s=sessions.find(x=>x.id===b.dataset.editSession);if(!s)return;editingSessionId=s.id;$("manual-start").value=isoLocal(s.started_at);$("manual-end").value=s.ended_at?isoLocal(s.ended_at):"";toast("Edit the session times, then save manual session")})}
$("timer-start").onclick=async()=>{try{await saveSession({job_id:activeTimerJob,started_at:new Date().toISOString(),ended_at:null,source:"timer"});const j=jobs.find(x=>x.id===activeTimerJob);await saveJob({...j,status:"In Progress"});renderTimer()}catch(e){toast(e.message)}};
$("timer-pause").onclick=async()=>{const s=sessions.find(x=>x.job_id===activeTimerJob&&!x.ended_at);if(!s)return;try{await updateSession(s.id,{ended_at:new Date().toISOString()});const j=jobs.find(x=>x.id===activeTimerJob);await saveJob({...j,status:"Paused"});renderTimer()}catch(e){toast(e.message)}};
$("timer-complete").onclick=async()=>{const s=sessions.find(x=>x.job_id===activeTimerJob&&!x.ended_at);try{if(s)await updateSession(s.id,{ended_at:new Date().toISOString()});const j=jobs.find(x=>x.id===activeTimerJob);await saveJob({...j,status:"Completed"});renderTimer();toast("Job marked completed")}catch(e){toast(e.message)}};
$("add-manual-session").onclick=async()=>{const a=$("manual-start").value,b=$("manual-end").value;if(!a||!b||new Date(b)<=new Date(a)){toast("Enter a valid start and end time");return}try{if(editingSessionId){await updateSession(editingSessionId,{started_at:new Date(a).toISOString(),ended_at:new Date(b).toISOString(),source:"manual"});editingSessionId=null}else{await saveSession({job_id:activeTimerJob,started_at:new Date(a).toISOString(),ended_at:new Date(b).toISOString(),source:"manual"})}$("manual-start").value="";$("manual-end").value="";renderTimer();toast("Manual session saved")}catch(e){toast(e.message)}};
function parseOMEX(raw){
 const get=(re)=>{const m=raw.match(re);return m?m[1].trim():null},n=x=>x===null?null:Number(x.replace(/,/g,""));
 const out={material:get(/Material:\s*(.+)/i),machineability:n(get(/Machineability:\s*([0-9.]+)/i)),thickness_in:n(get(/Thickness:\s*([0-9.]+)/i)),tool_offset_in:n(get(/Tool offset:\s*([-\d.]+)/i)),taper_offset_deg:n(get(/Taper offset:\s*([-\d.]+)/i)),cut_stand_off_in:n(get(/Cut stand off:\s*([-\d.]+)/i)),rotation_deg:n(get(/Rotation:\s*([-\d.]+)/i)),path_time_hours:n(get(/Time for path:\s*([\d.]+)\s*hours/i)),estimated_cost:n(get(/Estimated cost for path:\s*\$?([\d,.]+)/i)),estimated_garnet_lb:n(get(/Estimated abrasive needed:\s*([\d,.]+)\s*Lbs/i)),pierces:n(get(/Pierces:\s*([\d,]+)/i)),path_width_in:n(get(/Width of path:\s*([\d.]+)/i)),path_height_in:n(get(/Height of path:\s*([\d.]+)/i)),tool_path_length:n(get(/Length of tool path:\s*([\d.]+)/i)),cutting_length:n(get(/Length of cutting:\s*([\d.]+)/i)),high_pressure_psi:n(get(/High pressure setting:\s*([\d.]+)/i)),low_pressure_psi:n(get(/Low pressure setting:\s*([\d.]+)/i)),mixing_tube_in:n(get(/Mixing tube diameter:\s*([\d.]+)/i)),jewel_in:n(get(/Jewel diameter:\s*([\d.]+)/i)),abrasive_flow_lb_min:n(get(/Abrasive flow rate:\s*([\d.]+)/i)),abrasive_mesh:n(get(/Abrasive size:\s*([\d.]+)/i)),abrasive_index:n(get(/Abrasive index:\s*([\d.]+)/i)),linear_separation_speed:n(get(/Linear separation speed:\s*([\d.]+)/i)),ideal_quality_1:n(get(/Ideal linear quality of 1 speed:\s*([\d.]+)/i)),ideal_quality_2:n(get(/Ideal linear quality of 2 speed:\s*([\d.]+)/i)),ideal_quality_3:n(get(/Ideal linear quality of 3 speed:\s*([\d.]+)/i)),ideal_quality_4:n(get(/Ideal linear quality of 4 speed:\s*([\d.]+)/i)),ideal_quality_5:n(get(/Ideal linear quality of 5 speed:\s*([\d.]+)/i)),minimum_taper_speed:n(get(/Ideal minimum taper speed:\s*([\d.]+)/i)),dynamic_pierce_speed:n(get(/Ideal dynamic pierce speed:\s*([\d.]+)/i)),dynamic_pierce_length_in:n(get(/Ideal dynamic pierce length:\s*([\d.]+)/i)),dynamic_pierce_seconds:n(get(/Time for ideal dynamic pierce:\s*([\d.]+)\s*sec/i)),stationary_pierce_seconds:n(get(/Dwell time for stationary pierce:\s*([\d.]+)\s*sec/i)),average_speed_entire_part:n(get(/Average speed for entire part:\s*([\d.]+)/i)),fastest_cut_speed:n(get(/Fastest speed when cutting:\s*([\d.]+)/i)),slowest_cut_speed:n(get(/Slowest speed when cutting:\s*([\d.]+)/i)),average_cut_speed:n(get(/Average speed when cutting:\s*([\d.]+)/i)),cutting_minutes:n(get(/Total time spent cutting:\s*([\d.]+)\s*min/i)),traversing_minutes:n(get(/Total time spent traversing:\s*([\d.]+)\s*min/i)),relay_minutes:n(get(/Total time spent cycling relays:\s*([\d.]+)\s*min/i)),piercing_method:get(/Piercing:\s*(.+)/i),cutting_pressure:get(/Cutting:\s*(.+)/i),ajet_active:/Z1 A-Jet is active/i.test(raw)?true:(/Z1 A-Jet is inactive|Z1 A-Jet is not active/i.test(raw)?false:null),tilting_on_path:/Tilting on Path is enabled/i.test(raw)?true:(/Tilting on Path is disabled/i.test(raw)?false:null),cutting_model:n(get(/Cutting model used:\s*([\d]+)/i)),raw_imported_at:new Date().toISOString()};
 out.total_component_minutes=[out.cutting_minutes,out.traversing_minutes,out.relay_minutes].every(x=>x!==null)?out.cutting_minutes+out.traversing_minutes+out.relay_minutes:null;
 return out;
}
function openImport(id=null){
 activeTimerJob=id;parsedOmex=null;const existing=jobs.find(x=>x.id===id);$("omex-job-name").value=existing?.job_name||"";$("omex-job-number").value=existing?.job_number||"";$("omex-text").value="";$("omex-preview").innerHTML='<p class="muted">Paste a report, then choose Analyze with AI.</p>';$("omex-ai-status").textContent="Ready for one report";$("save-import").disabled=true;$("import-dialog").showModal()
}
const omexReviewFields=[
 ["material","Material","text"],["thickness_in","Thickness (in)","number"],["path_time_hours","Estimated path time (hours)","number"],["estimated_cost","Estimated cost ($)","number"],["estimated_garnet_lb","Estimated abrasive (lb)","number"],["pierces","Pierces","number"],["path_width_in","Path width (in)","number"],["path_height_in","Path height (in)","number"],["tool_path_length","Tool path length","number"],["cutting_length","Cutting length","number"],["high_pressure_psi","High pressure (PSI)","number"],["low_pressure_psi","Low pressure (PSI)","number"],["mixing_tube_in","Mixing tube (in)","number"],["jewel_in","Jewel diameter (in)","number"],["abrasive_flow_lb_min","Abrasive flow (lb/min)","number"],["abrasive_mesh","Abrasive size / mesh","number"],["average_speed_entire_part","Average speed (entire part)","number"],["fastest_cut_speed","Fastest cut speed","number"],["slowest_cut_speed","Slowest cut speed","number"],["average_cut_speed","Average cut speed","number"],["cutting_minutes","Cutting minutes","number"],["traversing_minutes","Traversing minutes","number"],["relay_minutes","Relay cycling minutes","number"],["piercing_method","Piercing method","text"],["cutting_pressure","Cutting pressure description","text"],["ajet_active","A-Jet active","boolean"],["tilting_on_path","Tilting on Path","boolean"],["cutting_model","Cutting model","number"]
];
function renderOmexReview(data){
 const html=omexReviewFields.map(([key,label,type])=>{let value=data[key];if(value===undefined||value===null)value="";if(type==="boolean")return `<label class="omex-review-field">${label}<select data-omex-field="${key}"><option value="">Not found</option><option value="true" ${value===true?"selected":""}>Yes</option><option value="false" ${value===false?"selected":""}>No</option></select></label>`;return `<label class="omex-review-field">${label}<input data-omex-field="${key}" type="${type}" ${type==="number"?'step="any"':''} value="${esc(value)}" placeholder="Not found"></label>`}).join("");
 const warnings=Array.isArray(data.ai_warnings)?data.ai_warnings:[];
 $("omex-preview").innerHTML=`<div class="omex-review-heading"><strong>Review extracted values</strong><span class="pill Completed">Review before saving</span></div><div class="omex-review-grid">${html}</div>${warnings.length?`<div class="notice warning"><strong>AI notes</strong><span>${warnings.map(esc).join(" · ")}</span></div>`:""}<p class="hint">Blank fields were not found. Check units and values against the original OMEX report. The original pasted text is retained with this job.</p>`;
 $("save-import").disabled=false;
}
function readOmexReview(){
 const out={...parsedOmex};document.querySelectorAll("[data-omex-field]").forEach(el=>{const k=el.dataset.omexField,v=el.value;if(v==="")out[k]=null;else if(el.tagName==="SELECT")out[k]=v==="true";else if(el.type==="number")out[k]=Number(v);else out[k]=v.trim()});
 out.total_component_minutes=[out.cutting_minutes,out.traversing_minutes,out.relay_minutes].every(x=>x!==null)?out.cutting_minutes+out.traversing_minutes+out.relay_minutes:null;return out;
}
$("parse-omex").onclick=async()=>{
 const raw=$("omex-text").value.trim();if(!raw){toast("Paste OMEX report text first");return}
 if(raw.length>60000){toast("This report is too long. Paste one OMEX report under 60,000 characters.");return}
 const button=$("parse-omex");button.disabled=true;button.textContent="Analyzing…";$("omex-ai-status").textContent="AI is reading the OMEX report…";$("save-import").disabled=true;
 try{
  const local=parseOMEX(raw);
  if(!db)throw new Error("Connect your Supabase project first. The AI parser runs securely through a Supabase Edge Function.");
  const {data,error}=await db.functions.invoke("parse-omex",{body:{raw}});if(error)throw error;if(!data||!data.fields)throw new Error(data?.error||"AI returned an unexpected response.");
  parsedOmex={...local,...data.fields,ai_warnings:data.warnings||[],ai_model:data.model||null,ai_processed_at:new Date().toISOString(),parser_version:"ai-v1"};
  // Keep exact regular-expression matches when the AI leaves a field blank.
  for(const [k,v] of Object.entries(local))if((parsedOmex[k]===null||parsedOmex[k]===undefined||parsedOmex[k]==="")&&v!==null&&v!==undefined)parsedOmex[k]=v;
  renderOmexReview(parsedOmex);$("omex-ai-status").textContent="AI analysis complete — review the fields below.";button.textContent="✦ Analyze with AI";
 }catch(e){console.error(e);$("omex-ai-status").textContent="AI analysis failed";$("omex-preview").innerHTML=`<div class="notice warning"><strong>Could not analyze report</strong><span>${esc(e.message||String(e))}</span></div><p class="hint">No job information has been saved. Check the Supabase Edge Function setup and try again.</p>`;toast("AI analysis failed: "+(e.message||e))}
 finally{button.disabled=false;button.textContent="✦ Analyze with AI"}
};
$("save-import").onclick=async()=>{
 if(!parsedOmex)return;const old=jobs.find(x=>x.id===activeTimerJob)||{};const jobName=$("omex-job-name").value.trim();if(!jobName){toast("Enter a job name before saving");$("omex-job-name").focus();return}
 const reviewed=readOmexReview();try{const id=activeTimerJob||crypto.randomUUID();await saveJob({...old,id,job_name:jobName,job_number:$("omex-job-number").value.trim()||old.job_number||null,material:reviewed.material||old.material||null,thickness_in:reviewed.thickness_in??old.thickness_in??null,estimated_cut_seconds:reviewed.path_time_hours!==null?reviewed.path_time_hours*3600:old.estimated_cut_seconds??null,estimated_cost:reviewed.estimated_cost??old.estimated_cost??null,estimated_garnet_lb:reviewed.estimated_garnet_lb??old.estimated_garnet_lb??null,status:old.status||"Unscheduled",priority:old.priority||"Normal",notes:old.notes||"",created_at:old.created_at||new Date().toISOString(),omex_data:reviewed,omex_raw:$("omex-text").value});activeTimerJob=id;$("import-dialog").close();toast("Reviewed OMEX statistics saved to job")}catch(e){toast("Import save failed: "+e.message)}
};
function makeChart(id,type,labels,data,label){if(!window.Chart)return;const ctx=$(id);if(!ctx)return;if(charts[id])charts[id].destroy();charts[id]=new Chart(ctx,{type,data:{labels,datasets:[{label,data,backgroundColor:"#287b65",borderColor:"#287b65",borderWidth:1,borderRadius:4}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}})}
function runReport(){
 const a=$("report-start").value,b=$("report-end").value;if(!a||!b)return;const start=new Date(a+"T00:00:00"),end=new Date(b+"T23:59:59.999");$("report-range").textContent=fmtDate(start)+" – "+fmtDate(end);
 const ss=sessions.filter(s=>s.ended_at&&new Date(s.started_at)<=end&&new Date(s.ended_at)>=start),ids=[...new Set(ss.map(s=>s.job_id))],list=ids.map(id=>jobs.find(j=>j.id===id)).filter(Boolean);
 const sec=ss.reduce((sum,s)=>sum+Math.max(0,(new Date(s.ended_at)-new Date(s.started_at))/1000),0),garnet=list.reduce((sum,j)=>sum+Number(j.estimated_garnet_lb||0),0),cost=list.reduce((sum,j)=>sum+Number(j.estimated_cost||0),0);
 $("r-jobs").textContent=list.length;$("r-time").textContent=hoursLabel(sec);$("r-garnet").textContent=garnet.toFixed(2)+" lb";$("r-cost").textContent=money(cost);
 const days={},jobCost={};ss.forEach(s=>{const d=new Date(s.started_at).toLocaleDateString();days[d]=(days[d]||0)+(new Date(s.ended_at)-new Date(s.started_at))/3600000});list.forEach(j=>jobCost[j.job_name]=Number(j.estimated_cost||0));
 makeChart("time-chart","bar",Object.keys(days),Object.values(days),"Actual cutting hours");makeChart("cost-chart","bar",Object.keys(jobCost),Object.values(jobCost),"OMEX estimated cost");
 $("report-table").innerHTML=list.map(j=>{const js=ss.filter(s=>s.job_id===j.id);return `<tr><td><b>${esc(j.job_name)}</b><br>${esc(j.job_number||"")}</td><td>${[...new Set(js.map(s=>fmtDate(s.started_at)))].join(", ")}</td><td>${hoursLabel(js.reduce((x,s)=>x+(new Date(s.ended_at)-new Date(s.started_at))/1000,0))}</td><td>${Number(j.estimated_garnet_lb||0).toFixed(2)} lb</td><td>${money(j.estimated_cost)}</td></tr>`}).join("")||'<tr><td colspan="5">No cutting sessions in this date range.</td></tr>';
}
function exportCSV(){const rows=[["Job number","Job name","Material","Status","Scheduled start","Scheduled end","Estimated hours","Actual hours","Estimated garnet lb","Estimated cost"],...jobs.map(j=>[j.job_number,j.job_name,j.material,j.status,j.scheduled_start,j.scheduled_end,(j.estimated_cut_seconds||0)/3600,actualSeconds(j.id)/3600,j.estimated_garnet_lb,j.estimated_cost])];const csv=rows.map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\n");download("waterjet-jobs.csv",csv,"text/csv")}
function download(name,data,type){const a=document.createElement("a"),u=URL.createObjectURL(new Blob([data],{type}));a.href=u;a.download=name;a.click();URL.revokeObjectURL(u)}
function connectRealtime(){if(!db)return;db.channel("wjpm-live").on("postgres_changes",{event:"*",schema:"public",table:"jobs"},()=>loadData()).on("postgres_changes",{event:"*",schema:"public",table:"cut_sessions"},()=>loadData()).subscribe(status=>$("sync-state").textContent=status==="SUBSCRIBED"?"● Live updates active":"Realtime: "+status)}
async function connectDB(){const url=$("supabase-url").value.trim(),key=$("supabase-key").value.trim();if(!url||!key){toast("Enter both Supabase URL and key");return}try{db=window.supabase.createClient(url,key);localStorage.setItem("wjpm_supabase_url",url);localStorage.setItem("wjpm_supabase_key",key);await loadData();connectRealtime();$("connection-help").textContent="Connected. Realtime synchronization is enabled when database policies and publication are configured.";toast("Connected to shared database")}catch(e){db=null;toast("Connection failed: "+e.message)}}
function backup(){download("waterjet-backup-"+new Date().toISOString().slice(0,10)+".json",JSON.stringify({jobs,sessions,settings},null,2),"application/json")}
function restore(file){const r=new FileReader();r.onload=async()=>{try{const x=JSON.parse(r.result);if(!Array.isArray(x.jobs)||!Array.isArray(x.sessions))throw Error("Invalid backup format");if(!confirm("Import backup records? Existing records with matching IDs will be updated."))return;if(db){for(const j of x.jobs){const {error}=await db.from("jobs").upsert(j);if(error)throw error}for(const s of x.sessions){const {error}=await db.from("cut_sessions").upsert(s);if(error)throw error}}jobs=x.jobs;sessions=x.sessions;settings={...settings,...x.settings};localSave();renderAll();toast("Backup imported")}catch(e){toast("Import failed: "+e.message)}};r.readAsText(file)}
function init(){
 localLoad();const now=new Date(),monday=new Date(now);monday.setDate(now.getDate()-((now.getDay()+6)%7));$("report-start").value=monday.toISOString().slice(0,10);const friday=new Date(monday);friday.setDate(friday.getDate()+4);$("report-end").value=friday.toISOString().slice(0,10);
 $("daily-hours").value=settings.dailyHours;$("work-start").value=settings.workStart;
 const u=localStorage.getItem("wjpm_supabase_url"),k=localStorage.getItem("wjpm_supabase_key");if(u)$("supabase-url").value=u;if(k)$("supabase-key").value=k;
 document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>setView(b.dataset.view));document.querySelectorAll("[data-goto]").forEach(b=>b.onclick=()=>setView(b.dataset.goto));
 ["new-job-top","new-job-schedule","new-job-jobs"].forEach(id=>$(id).onclick=()=>openJob());$("dashboard-week").onclick=()=>setView("schedule");$("import-omex-jobs").onclick=()=>openImport(null);
 $("close-job").onclick=$("cancel-job").onclick=()=>$("job-dialog").close();$("close-detail").onclick=()=>$("detail-dialog").close();$("close-import").onclick=$("cancel-import").onclick=()=>$("import-dialog").close();$("close-timer").onclick=()=>$("timer-dialog").close();
 $("job-search").oninput=renderJobs;$("status-filter").onchange=renderJobs;$("print-schedule").onclick=()=>window.print();$("print-report").onclick=()=>window.print();$("run-report").onclick=runReport;$("export-csv").onclick=exportCSV;
 $("save-settings").onclick=()=>{settings.dailyHours=num($("daily-hours").value)||8;settings.workStart=$("work-start").value;localSave();toast("Settings saved")};$("connect-db").onclick=connectDB;$("backup-json").onclick=backup;$("restore-json").onclick=()=>$("restore-file").click();$("restore-file").onchange=e=>e.target.files[0]&&restore(e.target.files[0]);
 initCalendar();renderAll();if(u&&k)connectDB();else $("sync-state").textContent="Local browser only";
}
document.addEventListener("DOMContentLoaded",init);
