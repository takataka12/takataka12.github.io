const cfg=window.ZASU_MASTER_CONFIG||{};
const q=s=>document.querySelector(s);
const codeInput=q("#supporterCode");
const loginButton=q("#supporterLoginButton");
const statusEl=q("#supporterStatus");
const loginBox=q("#supporterLogin");
const wallet=q("#supporterWallet");

function headers(){return{"Content-Type":"application/json","apikey":cfg.betaAnonKey,"Authorization":"Bearer "+cfg.betaAnonKey}}
function normalize(v){return String(v||"").trim().toUpperCase().replace(/\s+/g,"")}
function planLabel(y){return "¥"+Number(y||0).toLocaleString("ja-JP")+" 支援者"}
async function api(code){
  const res=await fetch(cfg.supporterPortalEndpoint,{method:"POST",headers:headers(),body:JSON.stringify({action:"status",code})});
  const body=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(body.error==="supporter_expired"?"この支援者コードの有効期限は終了しています。":"支援者コードを確認できませんでした。");
  return body.supporter;
}
function render(s){
  q("#supporterPlan").textContent=planLabel(s.plan_yen);
  q("#ticketRemaining").textContent=Number(s.ticket_remaining||0);
  q("#ticketTotal").textContent=Number(s.ticket_total||0);
  q("#currentApps").textContent=Number(s.current_app_slots||0)+" APP"+(Number(s.current_app_slots||0)===1?"":"S");
  q("#futureApps").textContent=Number(s.future_app_slots||0)+" APP"+(Number(s.future_app_slots||0)===1?"":"S");
  q("#reportAccess").textContent=s.report_access?"利用可能":"—";
  loginBox.hidden=true;wallet.hidden=false;
}
async function login(){
  const code=normalize(codeInput.value);
  if(!code){statusEl.textContent="支援者コードを入力してください。";return}
  if(!cfg.supporterPortalEndpoint){statusEl.textContent="支援者ページを準備できませんでした。少し待ってから再度お試しください。";return}
  loginButton.disabled=true;statusEl.textContent="確認中…";
  try{
    const s=await api(code);
    sessionStorage.setItem("zasu_supporter_code",code);
    render(s);statusEl.textContent="";
  }catch(e){statusEl.textContent=window.ZASU_I18N.error(e,"master")}
  finally{loginButton.disabled=false}
}
loginButton.addEventListener("click",login);
codeInput.addEventListener("keydown",e=>{if(e.key==="Enter")login()});
q("#supporterRefresh").addEventListener("click",async()=>{
  const code=sessionStorage.getItem("zasu_supporter_code")||"";
  if(!code)return;
  q("#supporterRefresh").disabled=true;
  try{render(await api(code))}catch(_){sessionStorage.removeItem("zasu_supporter_code");wallet.hidden=true;loginBox.hidden=false;statusEl.textContent="もう一度コードを入力してください。"}
  finally{q("#supporterRefresh").disabled=false}
});
q("#supporterLogout").addEventListener("click",()=>{
  sessionStorage.removeItem("zasu_supporter_code");
  wallet.hidden=true;loginBox.hidden=false;codeInput.value="";statusEl.textContent="";
});
const saved=sessionStorage.getItem("zasu_supporter_code");
if(saved){codeInput.value=saved;api(saved).then(render).catch(()=>sessionStorage.removeItem("zasu_supporter_code"))}
