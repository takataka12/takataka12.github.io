function qs(s){return document.querySelector(s)}
function initBetaForm(){
  const form=qs("#betaForm"); if(!form)return;
  form.addEventListener("submit",async(e)=>{
    e.preventDefault(); const data=Object.fromEntries(new FormData(form).entries()); const cfg=window.ZASU_MASTER_CONFIG||{};
    if(cfg.betaEndpoint){
      const res=await fetch(cfg.betaEndpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
      if(!res.ok) throw new Error("送信に失敗しました");
      qs("#formStatus").textContent="応募を受け付けました。ありがとうございます。"; form.reset(); return;
    }
    if(cfg.betaEmail){
      const subject=encodeURIComponent("ZASU MASTER β参加希望");
      const body=encodeURIComponent(\`名前: \${data.name||""}\nメール: \${data.email||""}\nジャンル: \${data.genre||""}\nDAW: \${data.daw||""}\nコメント:\n\${data.message||""}\`);
      location.href=\`mailto:\${cfg.betaEmail}?subject=\${subject}&body=\${body}\`; return;
    }
    qs("#formStatus").textContent="現在は準備中です。β募集開始時に送信先を接続します。";
  });
}
document.addEventListener("DOMContentLoaded",initBetaForm);