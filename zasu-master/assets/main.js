function qs(s){return document.querySelector(s)}
function initBetaForm(){
  const form=qs("#betaForm");
  if(!form)return;

  form.addEventListener("submit",async(e)=>{
    e.preventDefault();
    const button=form.querySelector('button[type="submit"]');
    const status=qs("#formStatus");
    const data=Object.fromEntries(new FormData(form).entries());
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

      status.textContent="応募を受け付けました。ありがとうございます。";
      form.reset();
    }catch(err){
      status.textContent=err?.message||"送信に失敗しました。";
    }finally{
      button.disabled=false;
      button.textContent="β参加希望を送る";
    }
  });
}
document.addEventListener("DOMContentLoaded",initBetaForm);