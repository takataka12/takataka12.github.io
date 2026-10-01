const cfg=window.ZASU_ADMIN_CONFIG||{};
const q=s=>document.querySelector(s);
let adminKey=sessionStorage.getItem("zasu_admin_key")||sessionStorage.getItem("zasu_dev_admin_key")||"";
let hours=24;
let refreshTimer=null;

function fmtInt(v){return new Intl.NumberFormat("ja-JP").format(Number(v||0))}
function fmtYen(v){return "¥"+fmtInt(v)}
function fmtBytes(v){
  let n=Number(v||0);const units=["B","KB","MB","GB","TB"];let i=0;
  while(n>=1024&&i<units.length-1){n/=1024;i++}
  return (i<2?n.toFixed(0):n.toFixed(n>=10?1:2))+" "+units[i];
}
function fmtSecs(v){
  if(v==null||!Number.isFinite(Number(v)))return "—";
  const n=Math.round(Number(v));if(n<60)return n+"s";
  const m=Math.floor(n/60),s=n%60;return m+"m "+s+"s";
}
function success(s){
  const done=Number(s.completed||0)+Number(s.failed||0);
  return done?Math.round(Number(s.completed||0)/done*100):0;
}
function age(iso){
  if(!iso)return "—";const ms=Date.now()-new Date(iso).getTime();
  const min=Math.max(0,Math.floor(ms/60000));return min<60?min+"m":Math.floor(min/60)+"h "+(min%60)+"m";
}
function dt(iso){
  if(!iso)return "—";return new Date(iso).toLocaleString("ja-JP",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
}
function setText(id,value){q(id).textContent=value}
function td(text,strong=false){
  const x=document.createElement("td");if(strong){const s=document.createElement("strong");s.textContent=String(text??"—");x.appendChild(s)}else{x.textContent=String(text??"—")}return x;
}
function showLocked(message=""){
  q("#dashboard").hidden=true;q("#loginPanel").hidden=false;
  q("#healthText").textContent="LOCKED";q(".health").classList.remove("online");
  q("#loginStatus").textContent=message;
}
function showOpen(){
  q("#loginPanel").hidden=true;q("#dashboard").hidden=false;
  q("#healthText").textContent="ONLINE";q(".health").classList.add("online");
}
async function fetchStats(){
  if(!adminKey){showLocked();return}
  setText("#healthText","SYNCING");
  try{
    const r=await fetch(cfg.endpoint,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "apikey":cfg.publishableKey,
        "Authorization":"Bearer "+cfg.anonKey,
        "x-zasu-admin-key":adminKey
      },
      body:JSON.stringify({hours})
    });
    const body=await r.json().catch(()=>({}));
    if(r.status===401){
      sessionStorage.removeItem("zasu_admin_key");
      adminKey="";
      showLocked("管理者キーを確認してください。");
      return;
    }
    if(!r.ok)throw new Error(body.error||"admin_stats_failed");
    render(body);showOpen();
  }catch(e){
    setText("#healthText","ERROR");q(".health").classList.remove("online");
    if(!q("#dashboard").hidden)q("#generatedAt").textContent="取得エラー — "+(e?.message||"unknown");
    else showLocked("統計を取得できませんでした。");
  }
}
function render(body){
  setText("#generatedAt","UPDATED "+dt(body.generated_at));
  renderHealth(body.health||{});
  renderAlerts(body.alerts||{});
  renderCostGuard(body.cost_guard||{},body.alerts||{});
  renderAbuse(body.abuse||{});
  const mix=body.mix||{},master=body.master||{},convert=body.convert||{},orders=body.orders||{};
  setText("#mixTotal",fmtInt(mix.total));setText("#mixMeta","SUCCESS "+success(mix)+"% / FAILED "+fmtInt(mix.failed));
  setText("#masterTotal",fmtInt(master.total));setText("#masterMeta","SUCCESS "+success(master)+"% / FAILED "+fmtInt(master.failed));
  setText("#convertTotal",fmtInt(convert.total));setText("#convertMeta","SUCCESS "+success(convert)+"% / FAILED "+fmtInt(convert.failed));
  setText("#revenue",fmtYen(orders.revenue_jpy));setText("#revenueMeta",fmtInt(orders.paid)+" PAID / "+fmtInt(orders.total)+" ORDERS");
  setText("#mixAvg",fmtSecs(mix.avg_seconds));setText("#masterAvg",fmtSecs(master.avg_seconds));setText("#convertAvg",fmtSecs(convert.avg_seconds));

  const jobs=Array.isArray(body.current_jobs)?body.current_jobs:[];
  setText("#queueCount",fmtInt(jobs.length));
  setText("#reviewCount",fmtInt(jobs.filter(x=>x.status==="awaiting_review").length));
  renderServiceQueue(jobs,"MIX","#mixQueueState","#mixQueueDetail");
  renderServiceQueue(jobs,"MASTER","#masterQueueState","#masterQueueDetail");
  renderServiceQueue(jobs,"CONVERT","#convertQueueState","#convertQueueDetail");
  renderJobs(jobs);

  const pf=body.preflight||{};
  setText("#preflightChecked",fmtInt(pf.checked));
  setText("#preflightWarning",fmtInt(pf.warning));
  setText("#preflightOverride",fmtInt(pf.overridden));
  const rate=pf.checked?Math.round((Number(pf.warning||0)+Number(pf.overridden||0))/Number(pf.checked)*100):0;
  setText("#preflightNote","要確認率 "+rate+"% — 警告が多すぎる場合はPreflight閾値を見直す目安になります。");

  renderBars("#mixStyles",body.mix_styles||{});
  renderBars("#masterProfiles",body.master_profiles||{});
  renderBars("#masterModes",body.master_modes||{});
  renderBars("#paidPlans",orders.plans||{});

  const fb=body.feedback||{};
  setText("#feedbackRate",fmtInt(fb.positive_rate)+"%");
  setText("#feedbackTotal",fmtInt(fb.total));
  setText("#feedbackPositive",fmtInt(fb.positive));
  setText("#feedbackNegative",fmtInt(fb.negative));
  const mixFb=fb.by_service?.mix||{};
  const masterFb=fb.by_service?.master||{};
  const mixRate=mixFb.total?Math.round(Number(mixFb.positive||0)/Number(mixFb.total)*100):0;
  const masterRate=masterFb.total?Math.round(Number(masterFb.positive||0)/Number(masterFb.total)*100):0;
  setText("#feedbackMix",fmtInt(mixFb.total||0)+" / 👍 "+mixRate+"%");
  setText("#feedbackMaster",fmtInt(masterFb.total||0)+" / 👍 "+masterRate+"%");
  renderBars("#feedbackTags",fb.tags||{});
  renderFeedback(Array.isArray(fb.recent)?fb.recent:[]);

  const storage=body.storage||{};
  setText("#storageTotal",fmtBytes(storage.total_bytes));
  setText("#storageOld",fmtBytes(storage.total_bytes_older_24h));
  renderStorage(storage.buckets||{});

  const clean=body.cleanup||{};
  const ok=clean.active===true&&(clean.last_status==="succeeded"||clean.last_status==="success"||clean.last_status==null);
  q(".cleanup-state").classList.toggle("ok",ok);
  setText("#cleanupStatus",clean.last_status?String(clean.last_status).toUpperCase():(clean.active?"ACTIVE":"NO RUN YET"));
  setText("#cleanupSchedule",clean.schedule||"—");
  setText("#cleanupLast",dt(clean.last_end||clean.last_start));
  setText("#cleanupActive",clean.active===true?"YES":"NO");

  renderErrors(Array.isArray(body.recent_errors)?body.recent_errors:[]);
  setText("#healthText","ONLINE");q(".health").classList.add("online");
}
async function costGuardAction(action){
  if(!adminKey)return;
  const pause=action==="cost_guard_pause";
  const message=pause
    ?"新規MIX / MASTER / CONVERTの受付を一時停止します。進行中ジョブは継続します。実行しますか？"
    :"COST GUARDの緊急停止を解除します。実行しますか？";
  if(!window.confirm(message))return;
  const pauseBtn=q("#costGuardPauseButton"),resumeBtn=q("#costGuardResumeButton");
  pauseBtn.disabled=true;resumeBtn.disabled=true;
  try{
    const r=await fetch(cfg.endpoint,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "apikey":cfg.publishableKey,
        "Authorization":"Bearer "+cfg.anonKey,
        "x-zasu-admin-key":adminKey
      },
      body:JSON.stringify({action})
    });
    const body=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(body.error||"cost_guard_action_failed");
    await fetchStats();
  }catch(e){
    window.alert("COST GUARD操作に失敗しました: "+(e?.message||"unknown"));
    pauseBtn.disabled=false;resumeBtn.disabled=false;
  }
}
function renderCostGuard(costGuard,alerts){
  const state=costGuard?.state||{};
  const paused=state.emergency_paused===true;
  const root=q("#costGuardBrake");
  root.classList.toggle("paused",paused);
  setText("#costGuardState",paused?"PAUSED":"READY");
  setText("#costGuardReason",paused
    ?String(state.pause_reason||"processing paused")
    :"新規処理の受付は通常稼働中です。");
  setText("#costGuardAuto",state.auto_enabled===false?"OFF":"ON");
  const delivery=alerts?.delivery||{};
  const notifyReady=delivery.domain_verified===true&&delivery.transport_enabled===true&&delivery.api_key_configured===true&&delivery.recipient_configured===true;
  const notifyPending=delivery.api_key_configured===true&&delivery.recipient_configured===true&&!notifyReady;
  setText("#costGuardNotify",notifyReady?"ACTIVE":notifyPending?"DNS PENDING":"OFF");
  setText("#costGuardChecked",dt(state.last_evaluated_at));
  const m=state.last_metrics||{};
  const growth=Number(m.storage_growth_bytes_15m||0);
  const metrics=[
    "10m accepted "+fmtInt(m.accepted_requests_10m||0),
    "blocked "+fmtInt(m.blocked_requests_10m||0),
    "queued "+fmtInt(m.queued_jobs_total||0),
    "storage Δ15m "+fmtBytes(growth)
  ];
  setText("#costGuardMetrics",metrics.join(" / "));
  const pauseBtn=q("#costGuardPauseButton"),resumeBtn=q("#costGuardResumeButton");
  pauseBtn.disabled=paused;
  resumeBtn.disabled=!paused;
}

function renderAbuse(abuse){
  setText("#abuseAttempts",fmtInt(abuse.attempts||0));
  setText("#abuseBlocked",fmtInt(abuse.blocked||0));
  setText("#abuseRate",fmtInt(abuse.block_rate||0)+"%");

  const root=q("#abuseScopes");
  root.innerHTML="";
  const entries=Object.entries(abuse.scopes||{}).sort((a,b)=>Number(b[1]?.attempts||0)-Number(a[1]?.attempts||0));
  if(!entries.length){
    const div=document.createElement("div");
    const span=document.createElement("span");span.textContent="STATUS";
    const strong=document.createElement("strong");strong.textContent="NO DATA";
    const small=document.createElement("small");small.textContent="新規ジョブ作成時に記録されます。";
    div.append(span,strong,small);root.appendChild(div);
  }else{
    for(const [scope,v] of entries){
      const div=document.createElement("div");
      const span=document.createElement("span");span.textContent=String(scope).toUpperCase();
      const strong=document.createElement("strong");strong.textContent=fmtInt(v.attempts||0);
      const small=document.createElement("small");small.textContent="blocked "+fmtInt(v.blocked||0);
      div.append(span,strong,small);root.appendChild(div);
    }
  }

  const tbody=q("#abuseBody");
  tbody.innerHTML="";
  const rows=Array.isArray(abuse.recent_blocked)?abuse.recent_blocked:[];
  if(!rows.length){
    const tr=document.createElement("tr");
    const cell=td("Rate Limitによるブロックはありません。");
    cell.colSpan=3;cell.className="empty";tr.appendChild(cell);tbody.appendChild(tr);
    return;
  }
  for(const x of rows){
    const tr=document.createElement("tr");
    tr.append(td(String(x.scope||"").toUpperCase(),true),td(String(x.reason||"rate_limit")),td(dt(x.created_at)));
    tbody.appendChild(tr);
  }
}

function renderAlerts(alerts){
  const delivery=alerts?.delivery||{};
  const state=alerts?.state||{};
  const events=Array.isArray(alerts?.recent)?alerts.recent:[];

  const ready=delivery.domain_verified===true&&delivery.transport_enabled===true&&delivery.api_key_configured===true&&delivery.recipient_configured===true;
  const statusEl=q("#alertTransportStatus");
  statusEl.classList.remove("pending","active","degraded");
  if(ready){
    statusEl.textContent="ACTIVE";
    statusEl.classList.add("active");
    setText("#alertTransportDetail","Critical incident / recovery mail is enabled.");
  }else{
    statusEl.textContent="SETUP PENDING";
    statusEl.classList.add("pending");
    const missing=[];
    if(delivery.domain_verified!==true)missing.push("DNS");
    if(delivery.api_key_configured!==true)missing.push("API KEY");
    if(delivery.transport_enabled!==true)missing.push("ENABLE");
    setText("#alertTransportDetail","Waiting: "+(missing.join(" / ")||"configuration"));
  }

  const incidentEl=q("#alertIncidentState");
  incidentEl.classList.remove("pending","active","degraded");
  if(state.active===true){
    incidentEl.textContent="ACTIVE";
    incidentEl.classList.add("degraded");
    setText("#alertIncidentSince",state.active_since?"since "+dt(state.active_since):"critical condition active");
  }else{
    incidentEl.textContent="NONE";
    incidentEl.classList.add("active");
    setText("#alertIncidentSince","No active critical incident.");
  }

  setText("#alertProvider",String(delivery.provider||"resend").toUpperCase());
  setText("#alertDomain",delivery.sending_domain||"—");
  setText("#alertLastEvent",state.last_event_type?String(state.last_event_type).toUpperCase()+" / "+dt(state.last_event_at):"—");

  const tbody=q("#alertEventsBody");
  tbody.innerHTML="";
  if(!events.length){
    const tr=document.createElement("tr");
    const cell=td("Critical incident / recovery event はまだありません。");
    cell.colSpan=4;cell.className="empty";tr.appendChild(cell);tbody.appendChild(tr);
    return;
  }
  for(const x of events){
    const tr=document.createElement("tr");
    tr.append(
      td(String(x.event_type||"").toUpperCase(),true),
      td(String(x.subject||"—").slice(0,120)),
      td(String(x.delivery_status||"—").toUpperCase()),
      td(dt(x.created_at))
    );
    tbody.appendChild(tr);
  }
}

function renderServiceQueue(rows,service,stateSel,detailSel){
  const list=rows.filter(x=>x.service===service);
  const processing=list.filter(x=>x.status==="processing").length;
  const waiting=list.filter(x=>x.status==="queued").length;
  const review=list.filter(x=>x.status==="awaiting_review").length;
  let state="READY";
  if(processing>0)state="PROCESSING";
  else if(waiting>0)state="WAITING";
  else if(review>0)state="REVIEW";
  setText(stateSel,state);
  const parts=[];
  if(processing)parts.push("processing "+processing);
  if(waiting)parts.push("waiting "+waiting);
  if(review)parts.push("review "+review);
  setText(detailSel,parts.length?parts.join(" / "):"no wait");
}
function renderHealth(health){
  const latest=health?.latest||null;
  const root=q("#systemHealth");
  const issuesRoot=q("#healthIssues");
  root.classList.remove("operational","attention","degraded");
  issuesRoot.innerHTML="";

  if(!latest){
    root.classList.add("attention");
    setText("#healthHeadline","NO HEALTH DATA");
    setText("#healthSubline","Health Watchの初回チェックを待っています。");
    setText("#healthCheckedAt","—");
    for(const id of ["#healthMix","#healthMaster","#healthConvert"])setText(id,"—");
    for(const id of ["#healthMixDetail","#healthMasterDetail","#healthConvertDetail"])setText(id,"—");
    return;
  }

  const checkedMs=new Date(latest.checked_at).getTime();
  const stale=!Number.isFinite(checkedMs)||Date.now()-checkedMs>15*60*1000;
  const status=stale?"attention":String(latest.overall_status||"attention");
  root.classList.add(status);
  const issues=Array.isArray(latest.issues)?latest.issues:[];
  const headline=stale
    ?"HEALTH WATCH STALE"
    :status==="operational"
      ?"ALL SYSTEMS OPERATIONAL"
      :status==="degraded"
        ?"SERVICE DEGRADED"
        :"SYSTEM ATTENTION";
  setText("#healthHeadline",headline);
  setText("#healthSubline",stale
    ?"15分以上新しいHealth snapshotがありません。"
    :status==="operational"
      ?"MIX / MASTER / CONVERT / Storage / Cleanupに異常はありません。"
      :issues.length+"件の確認項目があります。Core serviceの状態も下で確認できます。");
  setText("#healthCheckedAt","CHECKED "+dt(latest.checked_at));

  renderHealthService(latest.services?.mix,"#healthMix","#healthMixDetail");
  renderHealthService(latest.services?.master,"#healthMaster","#healthMasterDetail");
  renderHealthService(latest.services?.convert,"#healthConvert","#healthConvertDetail");

  if(stale){
    const box=document.createElement("div");box.className="health-issue";
    const strong=document.createElement("strong");strong.textContent="HEALTH WATCH CHECK DELAYED";
    const span=document.createElement("span");span.textContent="自動点検CronまたはHealth Functionを確認してください。";
    box.append(strong,span);issuesRoot.appendChild(box);
  }
  for(const issue of issues){
    const box=document.createElement("div");
    box.className="health-issue "+(issue.severity==="critical"?"critical":"warning");
    const strong=document.createElement("strong");strong.textContent=String(issue.title||issue.code||"HEALTH ISSUE");
    const span=document.createElement("span");span.textContent=String(issue.detail||"確認が必要です。");
    box.append(strong,span);issuesRoot.appendChild(box);
  }
  if(!stale&&!issues.length){
    const ok=document.createElement("div");ok.className="health-ok";ok.textContent="No active health warnings.";issuesRoot.appendChild(ok);
  }
}
function renderHealthService(service,stateSel,detailSel){
  if(!service){setText(stateSel,"—");setText(detailSel,"—");return}
  const up=String(service.health||"down")==="up";
  setText(stateSel,up?"UP":"DOWN");
  const qv=service.queue||{};
  const parts=[];
  if(Number.isFinite(Number(service.latency_ms)))parts.push(Math.round(Number(service.latency_ms))+"ms");
  if(Number(qv.processing||0)>0)parts.push("processing "+Number(qv.processing||0));
  if(Number(qv.queued||0)>0)parts.push("waiting "+Number(qv.queued||0));
  if(Number(qv.stalled||0)>0)parts.push("stalled "+Number(qv.stalled||0));
  setText(detailSel,parts.length?parts.join(" / "):(up?"ready":"health check failed"));
}
function renderJobs(rows){
  const tbody=q("#currentJobsBody");tbody.innerHTML="";
  if(!rows.length){const tr=document.createElement("tr");const cell=td("現在、待機・処理中のジョブはありません。");cell.colSpan=4;cell.className="empty";tr.appendChild(cell);tbody.appendChild(tr);return}
  for(const x of rows){const tr=document.createElement("tr");tr.append(td(x.service,true),td(x.status),td(x.stage),td(age(x.created_at)));tbody.appendChild(tr)}
}
function renderFeedback(rows){
  const tbody=q("#feedbackBody");tbody.innerHTML="";
  if(!rows.length){
    const tr=document.createElement("tr");
    const cell=td("まだFeedback v1の回答はありません。");
    cell.colSpan=5;cell.className="empty";tr.appendChild(cell);tbody.appendChild(tr);return;
  }
  for(const x of rows){
    const tr=document.createElement("tr");
    const vote=Number(x.sentiment)===1?"👍":"👎";
    const tags=(Array.isArray(x.tags)?x.tags:[]).join(", ")||"—";
    const comment=String(x.comment||"—").slice(0,180);
    tr.append(td(String(x.service||"").toUpperCase(),true),td(vote),td(tags),td(comment),td(dt(x.created_at)));
    tbody.appendChild(tr);
  }
}
function renderErrors(rows){
  const tbody=q("#errorsBody");tbody.innerHTML="";
  if(!rows.length){const tr=document.createElement("tr");const cell=td("直近エラーはありません。");cell.colSpan=4;cell.className="empty";tr.appendChild(cell);tbody.appendChild(tr);return}
  for(const x of rows){
    const tr=document.createElement("tr");
    const message=x.user_message||x.last_error||"—";
    tr.append(td(x.service,true),td(x.error_code||"—"),td(String(message).slice(0,160)),td(dt(x.created_at)));tbody.appendChild(tr);
  }
}
function renderBars(selector,obj){
  const root=q(selector);root.innerHTML="";
  const entries=Object.entries(obj).sort((a,b)=>Number(b[1])-Number(a[1]));
  if(!entries.length){const p=document.createElement("div");p.className="note";p.textContent="データなし";root.appendChild(p);return}
  const max=Math.max(...entries.map(x=>Number(x[1])||0),1);
  for(const [name,count] of entries){
    const row=document.createElement("div");row.className="bar-row";
    const label=document.createElement("label");label.textContent=String(name).toUpperCase();
    const track=document.createElement("div");track.className="bar-track";const bar=document.createElement("i");bar.style.width=Math.max(3,Number(count)/max*100)+"%";track.appendChild(bar);
    const n=document.createElement("b");n.textContent=fmtInt(count);row.append(label,track,n);root.appendChild(row);
  }
}
function renderStorage(obj){
  const root=q("#storageRows");root.innerHTML="";
  const entries=Object.entries(obj).sort((a,b)=>Number(b[1]?.bytes||0)-Number(a[1]?.bytes||0));
  for(const [name,v] of entries){
    const row=document.createElement("div");row.className="storage-row";
    const left=document.createElement("div");const strong=document.createElement("strong");strong.textContent=name;const sub=document.createElement("span");sub.textContent=fmtInt(v.objects)+" objects / >24h "+fmtInt(v.older_24h);left.append(strong,sub);
    const size=document.createElement("span");size.textContent=fmtBytes(v.bytes);row.append(left,size);root.appendChild(row);
  }
}
q("#loginForm").addEventListener("submit",e=>{
  e.preventDefault();const key=q("#adminKey").value.trim();if(!key)return;
  adminKey=key;sessionStorage.setItem("zasu_admin_key",key);sessionStorage.setItem("zasu_dev_admin_key",key);q("#adminKey").value="";fetchStats();
});
q("#costGuardPauseButton").addEventListener("click",()=>costGuardAction("cost_guard_pause"));
q("#costGuardResumeButton").addEventListener("click",()=>costGuardAction("cost_guard_resume"));
q("#refreshButton").addEventListener("click",fetchStats);
q("#lockButton").addEventListener("click",()=>{sessionStorage.removeItem("zasu_admin_key");adminKey="";showLocked("ロックしました。")});
document.querySelectorAll(".range").forEach(btn=>btn.addEventListener("click",()=>{
  hours=Number(btn.dataset.hours||24);document.querySelectorAll(".range").forEach(x=>x.classList.toggle("active",x===btn));fetchStats();
}));
if(adminKey)fetchStats();else showLocked();
refreshTimer=setInterval(()=>{if(adminKey&&!document.hidden)fetchStats()},60000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&adminKey)fetchStats()});
