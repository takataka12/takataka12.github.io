function qs(s){return document.querySelector(s)}
async function startZasu(button,status){
  const cfg=window.ZASU_MASTER_CONFIG||{},originalText=button.textContent;
  button.disabled=true;button.textContent="STARTING...";if(status)status.textContent="";
  try{
    let visitorId=localStorage.getItem("zasu_visitor_id");
    if(!visitorId){visitorId=crypto.randomUUID();localStorage.setItem("zasu_visitor_id",visitorId)}
    const sessionId=crypto.randomUUID();sessionStorage.setItem("zasu_session_id",sessionId);
    const res=await fetch(cfg.betaEndpoint,{method:"POST",headers:{"Content-Type":"application/json","apikey":cfg.betaAnonKey,"Authorization":"Bearer "+cfg.betaAnonKey},body:JSON.stringify({website:"",visitor_id:visitorId,session_id:sessionId})});
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error("START FAILED");
    if(body.status==="accepted"){
      localStorage.removeItem("zasu_beta_email");
      localStorage.setItem("zasu_beta_application_no",String(body.application_no));
      localStorage.setItem("zasu_beta_access_token",String(body.access_token||""));
      localStorage.setItem("zasu_visitor_id",String(body.visitor_id||visitorId));
      sessionStorage.setItem("zasu_session_id",String(body.session_id||sessionId));
      window.location.assign("https://takataka12.github.io/zasu-master/upload.html");
    }else if(status){status.textContent="今月の無料枠は終了しました。"}
  }catch(err){if(status)status.textContent=err?.message||"受付に失敗しました."}
  finally{button.disabled=false;button.textContent=originalText}
}
function bindStartForm(formId,statusId){
  const form=qs(formId);if(!form)return;
  form.addEventListener("submit",e=>{e.preventDefault();startZasu(form.querySelector('button[type="submit"]'),qs(statusId))});
}
document.addEventListener("DOMContentLoaded",()=>{bindStartForm("#betaForm","#formStatus");bindStartForm("#videoBetaForm","#videoFormStatus")});
