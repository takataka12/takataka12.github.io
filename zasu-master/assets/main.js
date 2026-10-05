function qs(s){return document.querySelector(s)}
async function startZasu(button,status){
  const cfg=window.ZASU_MASTER_CONFIG||{},originalText=button.textContent;
  button.disabled=true;button.textContent="準備中…";if(status)status.textContent="";
  try{
    let visitorId=localStorage.getItem("zasu_visitor_id");
    if(!visitorId){visitorId=crypto.randomUUID();localStorage.setItem("zasu_visitor_id",visitorId)}
    const sessionId=crypto.randomUUID();sessionStorage.setItem("zasu_session_id",sessionId);
    const headers={"Content-Type":"application/json","apikey":cfg.betaAnonKey,"Authorization":"Bearer "+cfg.betaAnonKey};
    const admin=sessionStorage.getItem("zasu_admin_key")||sessionStorage.getItem("zasu_dev_admin_key");
    if(admin)headers["x-zasu-admin-key"]=admin;
    const res=await fetch(cfg.betaEndpoint,{method:"POST",headers,body:JSON.stringify({website:"",visitor_id:visitorId,session_id:sessionId})});
    const body=await res.json().catch(()=>({}));
    if(!res.ok){
      if(res.status===429||body.error==="rate_limited"){
        const sec=Math.max(1,Number(body.retry_after_seconds||60));
        throw new Error("短時間にアクセスが集中しています。約"+Math.ceil(sec/60)+"分後にもう一度お試しください。");
      }
      throw new Error(body.user_message||"START FAILED");
    }
    if(body.status==="accepted"){
      localStorage.removeItem("zasu_beta_email");
      localStorage.setItem("zasu_beta_application_no",String(body.application_no));
      localStorage.setItem("zasu_beta_access_token",String(body.access_token||""));
      localStorage.setItem("zasu_visitor_id",String(body.visitor_id||visitorId));
      sessionStorage.setItem("zasu_session_id",String(body.session_id||sessionId));
      window.location.assign("upload.html");
    }else if(status){status.textContent="無料プレビュー受付を開始できませんでした。"}
  }catch(err){if(status)status.textContent=window.ZASU_I18N.error(err,"master")}
  finally{button.disabled=false;button.textContent=originalText}
}
function bindStartForm(formId,statusId){
  const form=qs(formId);if(!form)return;
  form.addEventListener("submit",e=>{e.preventDefault();startZasu(form.querySelector('button[type="submit"]'),qs(statusId))});
}
document.addEventListener("DOMContentLoaded",()=>{bindStartForm("#betaForm","#formStatus");bindStartForm("#videoBetaForm","#videoFormStatus")});
