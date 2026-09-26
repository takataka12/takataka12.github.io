function qs(s){return document.querySelector(s)}
function initBetaForm(){
  const form=qs("#betaForm");
  if(!form)return;

  form.addEventListener("submit",async(e)=>{
    e.preventDefault();
    const button=form.querySelector('button[type="submit"]');
    const status=qs("#formStatus");
    const data=Object.fromEntries(new FormData(form).entries());

    // iOS/Safari-safe email normalization.
    // Strip invisible Unicode characters that can enter via copy/paste,
    // normalize full-width ASCII, then validate the normalized value ourselves.
    const emailInput=form.querySelector('input[name="email"]');
    const normalizeEmail=(value)=>String(value||"")
      .normalize("NFKC")
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g,"")
      .replace(/\s+/g,"")
      .trim()
      .toLowerCase();
    data.email=normalizeEmail(data.email);
    if(emailInput) emailInput.value=data.email;

    const emailOK=/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email);
    if(!emailOK){
      if(emailInput) emailInput.focus();
      const status=qs("#formStatus");
      status.textContent="メールアドレスを確認してください。";
      return;
    }
    const cfg=window.ZASU_MASTER_CONFIG||{};

    if(!cfg.betaEndpoint||!cfg.betaAnonKey){
      status.textContent="現在は準備中です。";
      return;
    }

    button.disabled=true;
    button.textContent="送信中...";
    status.textContent="";

    try{
      const res=await fetch(cfg.betaEndpoint,{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "apikey":cfg.betaAnonKey,
          "Authorization":"Bearer "+cfg.betaAnonKey
        },
        body:JSON.stringify(data)
      });

      let body={};
      try{body=await res.json()}catch(_){}

      if(!res.ok){
        if(res.status===429) throw new Error("短時間に複数回送信されています。少し時間を置いてください。");
        if(body.error==="invalid_email") throw new Error("メールアドレスを確認してください。");
        throw new Error("送信に失敗しました。時間を置いてもう一度お試しください。");
      }

      if(body.status==="accepted"){
        localStorage.setItem("zasu_beta_email", String(data.email||"").trim().toLowerCase());
        localStorage.setItem("zasu_beta_application_no", String(body.application_no));
        status.innerHTML='OPEN BETA受付完了。受付番号 #'+body.application_no+'<br><strong>無料で1曲アップロードできます。アップロード画面へ移動します...</strong>';
        setTimeout(()=>{ location.href="https://zasumaster.com/upload.html"; },700);
      }else if(body.status==="waitlisted"){
        localStorage.setItem("zasu_beta_email", String(data.email||"").trim().toLowerCase());
        localStorage.setItem("zasu_beta_application_no", String(body.application_no));
        status.textContent="応募完了。現在は定員のためWaiting Listへ登録しました。受付番号 #"+body.application_no;
      }else{
        status.textContent="応募を受け付けました。ありがとうございます。";
      }
      form.reset();
    }catch(err){
      status.textContent=err?.message||"送信に失敗しました。";
    }finally{
      button.disabled=false;
      button.textContent="無料OPEN BETAを始める";
    }
  });
}
document.addEventListener("DOMContentLoaded",initBetaForm);