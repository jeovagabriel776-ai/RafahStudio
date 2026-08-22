'use strict';
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const APP = 'rafahstudio';
const KEYS = { accounts:`${APP}:accounts`, user:`${APP}:user`, theme:`${APP}:theme`, designer:`${APP}:designer`, orders:`${APP}:orders`, clients:`${APP}:clients`, quotes:`${APP}:quotes`, notifications:`${APP}:notifications`, trash:`${APP}:trash`, deletedRemote:`${APP}:deleted-remote` };
const STATUS = ['Novo','Em andamento','Esperando aprovação','Alteração','Entregue','Pago'];
const QUOTE_STATUS = ['Rascunho','Enviado','Aprovado','Recusado'];
const todayISO = () => new Date().toISOString().slice(0,10);
const money = v => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)||0);
const dateLabel = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}) : 'A definir';
const esc = v => String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const initials = v => String(v||'Designer').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase() || 'D';
const uid = p => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;

// Supabase - briefing online
const SUPABASE_URL = 'https://pltnbrjdagjwjuajoquv.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_DS10qQpn9GT3_tKmozhdGw_kRCH_gPc';

// O RafahStudio usa a Publishable Key no navegador. Ela é segura para frontend
// quando o acesso aos dados é protegido pelas funções/RLS do Supabase.
let supabaseClient = null;
function initSupabaseClient(){
  try{
    if(!window.supabase?.createClient){
      console.error('[RafahStudio] Biblioteca Supabase não encontrada.');
      return false;
    }
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    return !!supabaseClient;
  }catch(err){
    console.error('[RafahStudio] Falha ao inicializar Supabase:', err);
    supabaseClient = null;
    return false;
  }
}
initSupabaseClient();
const ownerTokenKey = user => `${APP}:owner-token:${user||'default'}`;
const publicTokenKey = user => `${APP}:public-token:${user||'default'}`;
function randomToken(){return (crypto.randomUUID?.()||uid('tok'))+'-'+Math.random().toString(36).slice(2)+Date.now().toString(36);}
function getOwnerToken(){const u=currentUser?.user||'default';let t=localStorage.getItem(ownerTokenKey(u));if(!t){t=randomToken();localStorage.setItem(ownerTokenKey(u),t);}return t;}
function getPublicToken(){const u=currentUser?.user||'default';let t=localStorage.getItem(publicTokenKey(u));if(!t){t=randomToken();localStorage.setItem(publicTokenKey(u),t);}return t;}
function briefingTokenFromHash(){try{const h=location.hash.slice('#briefing='.length);if(!h)return '';const p=JSON.parse(decodeURIComponent(escape(atob(h))));return p.publicToken||'';}catch{return '';}}
async function uploadBriefingFile(file, publicToken, briefingId, index){
  if(!supabaseClient) throw new Error('Biblioteca do Supabase não carregou.');
  const safeName=(file.name||`arquivo-${index}`).replace(/[^a-zA-Z0-9._-]/g,'_');
  const path=`${publicToken}/${briefingId}/${Date.now()}-${index}-${safeName}`;
  const {error}=await supabaseClient.storage.from('briefing-files').upload(path,file,{upsert:false,contentType:file.type||'application/octet-stream'});
  if(error) throw error;
  const {data}=supabaseClient.storage.from('briefing-files').getPublicUrl(path);
  return {name:file.name,type:file.type,size:file.size,path,url:data.publicUrl};
}
async function ensurePublicLink(){
  if(!supabaseClient){
    initSupabaseClient();
    if(!supabaseClient){
      toast('Não foi possível conectar ao servidor de briefings. Verifique sua internet.','error');
      return false;
    }
  }
  if(!currentUser){
    toast('Entre na sua conta antes de gerar o briefing.','error');
    return false;
  }

  const publicToken=getPublicToken();
  const ownerSecret=getOwnerToken();

  try{
    const {error}=await supabaseClient.rpc('register_briefing_link',{
      p_public_token:publicToken,
      p_owner_secret:ownerSecret
    });

    if(error){
      console.error('[RafahStudio] register_briefing_link:', error);
      const msg=error.message || error.details || 'Erro desconhecido no Supabase.';
      toast(`Supabase: ${msg}`,'error');
      return false;
    }

    return true;
  }catch(err){
    console.error('[RafahStudio] Erro inesperado ao registrar briefing:',err);
    toast(`Não foi possível registrar o briefing: ${err?.message||'erro de conexão'}`,'error');
    return false;
  }
}
let onlineBriefingSyncRunning=false;
function onlineBriefingFingerprint(b){
  return [String(b.client_name||'').trim().toLowerCase(),String(b.project_name||'').trim().toLowerCase(),String(b.created_at||'').slice(0,10)].join('|');
}
function orderFingerprint(o){
  return [String(o.client||'').trim().toLowerCase(),String(o.project||'').trim().toLowerCase(),String(o.created||'').slice(0,10)].join('|');
}
async function syncOnlineBriefings(){
  if(!supabaseClient||!currentUser||onlineBriefingSyncRunning)return;
  onlineBriefingSyncRunning=true;
  try{
    const {data,error}=await supabaseClient.rpc('get_briefings_for_owner',{p_owner_secret:getOwnerToken()});
    if(error) throw error;

    let changed=false;
    const onlineOrders=orders.filter(o=>o.origin==='Briefing online');
    const byRemote=new Map(onlineOrders.filter(o=>o.remoteId).map(o=>[String(o.remoteId),o]));
    const byFingerprint=new Map();
    for(const o of onlineOrders){
      const key=orderFingerprint(o);
      if(!byFingerprint.has(key))byFingerprint.set(key,[]);
      byFingerprint.get(key).push(o);
    }

    const duplicatesToRemove=new Set();

    for(const b of (data||[])){
      const remoteKey=String(b.id);

      // Um pedido excluído pelo designer não pode voltar apenas porque o
      // briefing original ainda existe no Supabase. O ID remoto fica em
      // uma "lista de exclusão" local (tombstone).
      if(deletedRemoteIds.includes(remoteKey)){
        if(byRemote.has(remoteKey)){
          orders=orders.filter(x=>String(x.remoteId)!==remoteKey);
          changed=true;
        }
        continue;
      }

      let o=byRemote.get(remoteKey);

      // Compatibilidade com pedidos antigos que foram criados antes do remoteId
      // ser persistido. Tenta reconhecer o pedido pelo cliente + projeto + data.
      if(!o){
        const candidates=(byFingerprint.get(onlineBriefingFingerprint(b))||[])
          .filter(x=>!x.remoteId && !duplicatesToRemove.has(x.id));
        if(candidates.length){
          o=candidates[0];
          // Se havia mais de um registro local do mesmo briefing, mantém só o primeiro.
          candidates.slice(1).forEach(x=>duplicatesToRemove.add(x.id));
          o.remoteId=b.id;
          changed=true;
        }
      }

      const briefing={
        texts:b.texts||'',
        people:Array.isArray(b.people)?b.people:[],
        refs:b.references_text||'',
        notes:b.notes||'',
        whats:b.whatsapp||''
      };
      const files=Array.isArray(b.files)?b.files:[];

      if(o){
        // Atualiza somente os dados que vêm do formulário. Não sobrescreve
        // valor, status, prioridade ou outras edições feitas pelo designer.
        o.remoteId=b.id;
        o.remoteCreated=b.created_at||o.remoteCreated||'';
        o.origin='Briefing online';
        o.client=b.client_name||o.client||'';
        o.project=b.project_name||o.project||'Sem projeto';
        o.deadline=b.deadline||o.deadline||'';
        o.type=b.service_type||o.type||'Outro';
        o.briefing={...(o.briefing||{}),...briefing};
        o.files=files;
        o.created=o.created||b.created_at?.slice(0,10)||todayISO();
        byRemote.set(remoteKey,o);
        changed=true;
      }else{
        o={
          id:uid('ord'),
          remoteId:b.id,
          remoteCreated:b.created_at||'',
          client:b.client_name||'',
          project:b.project_name||'Sem projeto',
          deadline:b.deadline||'',
          value:0,
          type:b.service_type||'Outro',
          status:'Novo',
          priority:'Normal',
          created:b.created_at?.slice(0,10)||todayISO(),
          paid:false,
          origin:'Briefing online',
          briefing,
          files,
          history:[]
        };
        addHistory(o,'Briefing recebido pelo formulário online');
        orders.unshift(o);
        byRemote.set(remoteKey,o);
        changed=true;
        notifications.unshift({
          id:uid('ntf'),
          title:'Novo briefing recebido',
          body:`${o.project} • ${o.client}`,
          kind:'success',
          created:new Date().toISOString(),
          read:false,
          linkPage:'pedidos',
          linkId:o.id
        });
      }
    }

    if(duplicatesToRemove.size){
      orders=orders.filter(o=>!duplicatesToRemove.has(o.id));
      changed=true;
    }

    // Uma segunda limpeza garante que nunca existam dois pedidos locais
    // apontando para o mesmo briefing do Supabase.
    const seenRemote=new Set();
    orders=orders.filter(o=>{
      if(o.origin!=='Briefing online'||!o.remoteId)return true;
      const key=String(o.remoteId);
      if(seenRemote.has(key)){changed=true;return false;}
      seenRemote.add(key);
      return true;
    });

    if(changed){persist();render();}
  }catch(err){
    console.error('RafahStudio Supabase:',err);
  }finally{
    onlineBriefingSyncRunning=false;
  }
}

const read = (key, fallback) => { try { const v=localStorage.getItem(key); return v===null?fallback:JSON.parse(v); } catch { return fallback; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

let accounts = read(KEYS.accounts, []);
let currentUser = read(KEYS.user, null);
let designer = read(KEYS.designer, null) || {name:'',brand:'RafahStudio',whats:'',email:'',insta:'',portfolio:'',area:'Designer gráfico',bio:'',photo:''};
let orders = read(KEYS.orders, []);
let clients = read(KEYS.clients, []);
let quotes = read(KEYS.quotes, []);
let notifications = read(KEYS.notifications, []);
let trash = read(KEYS.trash, []);
let deletedRemoteIds = read(KEYS.deletedRemote, []);
let orderFilter = 'all', editingOrderId=null, editingClientId=null, editingQuoteId=null;

// Migração do projeto antigo: preserva o que já existe e normaliza os status.
function migrateLegacy(){
  const legacyOrders = read('studioflow_v2_orders', null);
  if(!orders.length && Array.isArray(legacyOrders)) orders = legacyOrders.map(normalizeOrder);
  if(!designer.name){ const old=read('studioflow_designer',null); if(old) designer={...designer,...old}; }
  if(!accounts.length){ const old=read('studioflow_accounts',null); if(Array.isArray(old)) accounts=old; }
  const oldUser=read('studioflow_user',null); if(!currentUser && oldUser) currentUser=oldUser;
  orders = orders.map(normalizeOrder);
  write(KEYS.orders,orders); write(KEYS.designer,designer); write(KEYS.accounts,accounts);
  if(currentUser) write(KEYS.user,currentUser);
}
function normalizeStatus(s){
  if(s==='Aprovação'||s==='Aprovado') return s==='Aprovado'?'Esperando aprovação':'Esperando aprovação';
  if(s==='Pago') return 'Pago';
  return STATUS.includes(s)?s:'Novo';
}
function normalizeOrder(o){ return {id:o.id||uid('ord'),remoteId:o.remoteId||'',remoteCreated:o.remoteCreated||'',client:o.client||'',project:o.project||'Sem projeto',deadline:o.deadline||'',value:Number(o.value)||0,type:o.type||'Outro',status:normalizeStatus(o.status),created:o.created||todayISO(),paid:Boolean(o.paid||o.status==='Pago'),origin:o.origin||'Manual',priority:o.priority||'Normal',briefing:o.briefing||{},files:Array.isArray(o.files)?o.files:[],history:Array.isArray(o.history)?o.history:[]}; }
migrateLegacy();

function scopedKey(base){ return `${base}:${currentUser?.user||'guest'}`; }
function loadScoped(){
  if(!currentUser) return;
  const oldOrders=orders; const oldClients=clients; const oldQuotes=quotes;
  orders=read(scopedKey('rafahstudio:orders'), oldOrders.length?oldOrders:[]).map(normalizeOrder);
  clients=read(scopedKey('rafahstudio:clients'), oldClients);
  quotes=read(scopedKey('rafahstudio:quotes'), oldQuotes);
  notifications=read(scopedKey('rafahstudio:notifications'), notifications);
  trash=read(scopedKey('rafahstudio:trash'), []);
  deletedRemoteIds=read(scopedKey('rafahstudio:deletedRemote'), []);
  const p=read(scopedKey('rafahstudio:designer'), null); if(p) designer={...designer,...p};
}
function persist(){
  if(currentUser){ write(scopedKey('rafahstudio:orders'),orders); write(scopedKey('rafahstudio:clients'),clients); write(scopedKey('rafahstudio:quotes'),quotes); write(scopedKey('rafahstudio:notifications'),notifications); write(scopedKey('rafahstudio:designer'),designer); write(scopedKey('rafahstudio:trash'),trash); write(scopedKey('rafahstudio:deletedRemote'),deletedRemoteIds); }
  write(KEYS.accounts,accounts); write(KEYS.user,currentUser);
}

function toast(message,type='success'){ const el=document.createElement('div'); el.className=`toast ${type}`; el.innerHTML=`<span>${type==='error'?'!':type==='info'?'i':'✓'}</span><div>${esc(message)}</div>`; $('#toastRoot').appendChild(el); setTimeout(()=>el.classList.add('show'),20); setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.remove(),250)},3200); }
function modal(content){
  $('#modalRoot').innerHTML=`<div class="modal-backdrop" aria-hidden="true"><div class="modal" role="dialog" aria-modal="true">${content}</div></div>`;
  const backdrop=$('#modalRoot .modal-backdrop');
  requestAnimationFrame(()=>backdrop.classList.add('is-visible'));
  backdrop.addEventListener('click',e=>{ if(e.target===backdrop) closeModal(); });
  document.body.classList.add('modal-open');
  const first=backdrop.querySelector('input,select,textarea,button');
  if(first) setTimeout(()=>first.focus({preventScroll:true}),80);
}
function closeModal(){
  const root=$('#modalRoot');
  const backdrop=root.querySelector('.modal-backdrop');
  if(!backdrop){root.innerHTML='';document.body.classList.remove('modal-open');return;}
  backdrop.classList.remove('is-visible');
  setTimeout(()=>{root.innerHTML='';document.body.classList.remove('modal-open');},150);
}
function notify(title,body,kind='info',linkPage='pedidos',linkId=null){ notifications.unshift({id:uid('ntf'),title,body,kind,created:new Date().toISOString(),read:false,linkPage,linkId}); notifications=notifications.slice(0,80); persist(); renderNotifications(); }
function formatRelative(iso){const diff=Math.max(0,Date.now()-new Date(iso).getTime());const min=Math.floor(diff/60000);if(min<1)return'agora';if(min<60)return`há ${min} min`;const h=Math.floor(min/60);if(h<24)return`há ${h} h`;const d=Math.floor(h/24);return`há ${d} d`;}
function statusClass(s){return ({'Novo':'status-new','Em andamento':'status-doing','Esperando aprovação':'status-wait','Alteração':'status-change','Entregue':'status-done','Pago':'status-paid'})[s]||'';}
function priorityClass(p){return ({Alta:'priority-high',Urgente:'priority-urgent'})[p]||'';}
function pageMeta(page){return {dashboard:['VISÃO GERAL','Dashboard'],pedidos:['PROJETOS','Pedidos'],clientes:['RELACIONAMENTO','Clientes'],orcamentos:['COMERCIAL','Orçamentos'],financeiro:['FINANCEIRO','Financeiro'],perfil:['SUA CONTA','Meu perfil']}[page]||['','RafahStudio'];}
function go(page){ $$('.page').forEach(p=>p.classList.toggle('active',p.id===page)); $$('.nav-item[data-page]').forEach(n=>n.classList.toggle('active',n.dataset.page===page)); const [ey,t]=pageMeta(page); $('#pageEyebrow').textContent=ey; $('#pageTitle').textContent=t; $('#notificationPanel').classList.remove('open'); $('#sidebar').classList.remove('mobile-open'); window.scrollTo({top:0,behavior:'smooth'}); }

function render(){ if(!currentUser) return; renderIdentity(); renderDashboard(); renderOrders(); renderClients(); renderQuotes(); renderFinance(); renderNotifications(); renderProfile(); }
const renderAll = render;
function renderIdentity(){
 const name=designer.name||currentUser.name||'Designer'; $('#dashName').textContent=name.split(/\s+/)[0]; $('#sideName').textContent=name; $('#topName').textContent=name.split(/\s+/)[0]; $('#sideRole').textContent=designer.area||currentUser.area||'Designer gráfico'; $('#profileUser').textContent=currentUser.user||'—'; $('#todayLabel').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'});
 ['sideAvatar','topAvatar','profileAvatar'].forEach(id=>{const el=$('#'+id); if(!el)return; if(designer.photo){el.innerHTML=`<img src="${designer.photo}" alt="Foto de ${esc(name)}">`}else el.textContent=initials(name);});
}
function renderDashboard(){
 const active=orders.filter(o=>!['Entregue','Pago'].includes(o.status)).length;
 const newBrief=orders.filter(o=>o.origin==='Briefing online'&&o.status==='Novo').length;
 const receive=orders.filter(o=>!o.paid).reduce((a,o)=>a+Number(o.value||0),0);
 const paid=orders.filter(o=>o.paid||o.status==='Pago').reduce((a,o)=>a+Number(o.value||0),0);
 $('#mActive').textContent=active; $('#mActiveSub').textContent=`${orders.filter(o=>o.status==='Em andamento').length} em andamento`; $('#mNew').textContent=newBrief; $('#mReceive').textContent=money(receive); $('#mPaid').textContent=money(paid); $('#navOrders').textContent=orders.length;
 const attention=[];
 orders.filter(o=>o.origin==='Briefing online'&&o.status==='Novo').slice(0,3).forEach(o=>attention.push(`<button class="attention-row" data-open-order="${o.id}"><span class="attention-dot purple"></span><div><b>Novo briefing recebido</b><small>${esc(o.project)} • ${esc(o.client)}</small></div><span>→</span></button>`));
 orders.filter(o=>o.deadline && new Date(`${o.deadline}T23:59:59`) < new Date() && !['Entregue','Pago'].includes(o.status)).slice(0,3).forEach(o=>attention.push(`<button class="attention-row" data-open-order="${o.id}"><span class="attention-dot red"></span><div><b>Prazo vencido</b><small>${esc(o.project)} • ${dateLabel(o.deadline)}</small></div><span>→</span></button>`));
 orders.filter(o=>o.status==='Alteração').slice(0,3).forEach(o=>attention.push(`<button class="attention-row" data-open-order="${o.id}"><span class="attention-dot orange"></span><div><b>Alteração solicitada</b><small>${esc(o.project)} • ${esc(o.client)}</small></div><span>→</span></button>`));
 $('#attentionList').innerHTML=attention.slice(0,5).join('')||`<div class="empty-mini"><span>✓</span><div><b>Tudo em dia.</b><small>Nenhuma ação urgente encontrada.</small></div></div>`;
 $('#recentOrders').innerHTML=[...orders].sort((a,b)=>b.created.localeCompare(a.created)).slice(0,5).map(o=>`<button class="list-row" data-open-order="${o.id}"><div class="list-project"><span class="project-mark">${esc(initials(o.project))}</span><div><b>${esc(o.project)}</b><small>${esc(o.client)} • ${esc(o.type)}</small></div></div><span class="status-pill ${statusClass(o.status)}">${esc(o.status)}</span><span class="list-date">${dateLabel(o.deadline)}</span></button>`).join('')||`<div class="empty-mini"><span>＋</span><div><b>Nenhum pedido ainda.</b><small>Crie seu primeiro projeto.</small></div></div>`;
 const deadlines=[...orders].filter(o=>o.deadline&&!['Entregue','Pago'].includes(o.status)).sort((a,b)=>a.deadline.localeCompare(b.deadline)).slice(0,5);
 $('#deadlines').innerHTML=deadlines.map(o=>`<button class="deadline-row" data-open-order="${o.id}"><div><b>${esc(o.project)}</b><small>${esc(o.client)}</small></div><strong class="deadline ${new Date(o.deadline+'T23:59:59')<new Date()?'overdue':''}">${dateLabel(o.deadline)}</strong></button>`).join('')||`<div class="empty-mini"><span>✓</span><div><b>Sem prazos próximos.</b><small>Você está tranquilo por enquanto.</small></div></div>`;
}

function filteredOrders(){
 let q=($('#orderSearch')?.value||'').toLowerCase().trim(); let list=orderFilter==='all'?[...orders]:orders.filter(o=>o.status===orderFilter);
 if(q) list=list.filter(o=>`${o.project} ${o.client} ${o.type}`.toLowerCase().includes(q));
 const sort=$('#orderSort')?.value||'recent'; list.sort((a,b)=>sort==='deadline'?(a.deadline||'9999').localeCompare(b.deadline||'9999'):sort==='value'?b.value-a.value:sort==='oldest'?a.created.localeCompare(b.created):b.created.localeCompare(a.created)); return list;
}
function renderOrders(){
 const counts={all:orders.length,Novo:0,'Em andamento':0,'Esperando aprovação':0,'Alteração':0,Entregue:0,Pago:0};
 orders.forEach(o=>counts[o.status]=(counts[o.status]||0)+1);
 $('#countAll').textContent=counts.all; $('#countNovo').textContent=counts.Novo; $('#countDoing').textContent=counts['Em andamento']; $('#countApproval').textContent=counts['Esperando aprovação']; $('#countChange').textContent=counts['Alteração']; $('#countDelivered').textContent=counts.Entregue; $('#countPaid').textContent=counts.Pago;
 $$('#orderTabs button').forEach(b=>b.classList.toggle('active',b.dataset.filter===orderFilter));

 const q=($('#orderSearch')?.value||'').toLowerCase().trim();
 const sort=$('#orderSort')?.value||'recent';
 const sortOrders=(arr)=>arr.filter(o=>!q||`${o.project} ${o.client} ${o.type}`.toLowerCase().includes(q)).sort((a,b)=>
   sort==='deadline'?(a.deadline||'9999').localeCompare(b.deadline||'9999'):
   sort==='value'?b.value-a.value:
   sort==='oldest'?a.created.localeCompare(b.created):
   b.created.localeCompare(a.created)
 );

 const statuses=STATUS.slice();
 const visibleStatuses=orderFilter==='all'?statuses:[orderFilter];
 const columns=visibleStatuses.map(status=>{
   const list=sortOrders(orders.filter(o=>o.status===status));
   const cards=list.map(o=>`
     <article class="order-card" data-order-card="${o.id}">
       <div class="order-card-head">
         <div class="project-cell">
           <span class="project-mark">${esc(initials(o.project))}</span>
           <div><b>${esc(o.project)}</b><small>${esc(o.client)}</small></div>
         </div>
         <button class="icon-action" title="Abrir pedido" data-open-order="${o.id}">↗</button>
       </div>
       <div class="order-card-meta">
         <span>${esc(o.type)}</span>
         <span>${dateLabel(o.deadline)}</span>
         <strong>${money(o.value)}</strong>
       </div>
       ${o.priority!=='Normal'?`<small class="priority ${priorityClass(o.priority)}">${esc(o.priority)}</small>`:''}
       ${o.origin==='Briefing online'?`<span class="online-badge">Briefing online</span>`:''}
       <div class="order-card-actions">
         <button class="icon-action" title="Voltar etapa" data-move-status="${o.id}" data-direction="-1" ${STATUS.indexOf(o.status)===0?'disabled':''}>←</button>
         <button class="btn secondary small" data-open-order="${o.id}">Abrir</button>
         <button class="icon-action" title="Avançar etapa" data-move-status="${o.id}" data-direction="1" ${STATUS.indexOf(o.status)===STATUS.length-1?'disabled':''}>→</button>
       </div>
     </article>`).join('');

   return `<section class="order-stage" data-stage="${esc(status)}">
      <header class="order-stage-head">
        <div><span class="status-dot ${statusClass(status)}"></span><b>${esc(status)}</b><em>${list.length}</em></div>
        <small>${status==='Novo'?'Briefings recebidos':status==='Em andamento'?'Produção':status==='Esperando aprovação'?'Aguardando cliente':status==='Alteração'?'Ajustes solicitados':status==='Entregue'?'Finalizados':'Recebidos'}</small>
      </header>
      <div class="order-stage-body">${cards||`<div class="stage-empty">Nenhum pedido nesta etapa.</div>`}</div>
   </section>`;
 }).join('');

 $('#ordersTable').classList.add('orders-board');
 $('#ordersTable').innerHTML=columns||`<div class="empty-state"><span>▤</span><h3>Nenhum pedido encontrado</h3><p>Crie um pedido ou envie seu link de briefing para começar.</p><button class="btn primary" data-action="new-order">+ Novo pedido</button></div>`;
}
function clientStats(name){const os=orders.filter(o=>o.client.toLowerCase()===name.toLowerCase()); return {count:os.length,total:os.reduce((a,o)=>a+o.value,0),paid:os.filter(o=>o.paid||o.status==='Pago').reduce((a,o)=>a+o.value,0)};}
function renderClients(){
 const q=($('#clientSearch')?.value||'').toLowerCase().trim(); let list=[...clients]; orders.forEach(o=>{if(o.client&&!list.some(c=>c.name.toLowerCase()===o.client.toLowerCase())) list.push({id:`virtual_${o.client}`,name:o.client,whats:'',email:'',instagram:'',notes:'',virtual:true});});
 list=list.filter(c=>`${c.name} ${c.company||''} ${c.whats||''} ${c.email||''}`.toLowerCase().includes(q));
 $('#clientsGrid').innerHTML=list.map(c=>{const s=clientStats(c.name);return `<article class="client-card"><div class="client-top"><div class="avatar avatar-md">${esc(initials(c.name))}</div><span class="client-more">${c.virtual?'':'<button class="icon-action" data-edit-client="'+c.id+'">✎</button>'}</span></div><h3>${esc(c.name)}</h3><p>${esc(c.company||c.email||'Cliente')}</p><div class="client-stats"><div><small>Projetos</small><b>${s.count}</b></div><div><small>Total</small><b>${money(s.total)}</b></div><div><small>Recebido</small><b>${money(s.paid)}</b></div></div><div class="client-actions"><button class="btn secondary" data-view-client="${esc(c.name)}">Ver histórico</button>${c.whats?`<button class="icon-action" data-whatsapp="${esc(c.whats)}" title="WhatsApp">◔</button>`:''}</div></article>`}).join('')||`<div class="empty-state"><span>♙</span><h3>Nenhum cliente encontrado</h3><p>Cadastre seu primeiro cliente para começar.</p><button class="btn primary" data-action="new-client">+ Novo cliente</button></div>`;
}
function renderQuotes(){
 const q=($('#quoteSearch')?.value||'').toLowerCase().trim(), f=$('#quoteFilter')?.value||'all'; let list=quotes.filter(x=>(f==='all'||x.status===f)&&(!q||`${x.project} ${x.client}`.toLowerCase().includes(q)));
 $('#quotesTable').innerHTML=list.map(x=>`<div class="table-row quote-row"><div class="project-cell"><span class="project-mark quote">Q</span><div><b>${esc(x.project)}</b><small>${esc(x.description||'Proposta comercial')}</small></div></div><div>${esc(x.client)}</div><div>${dateLabel(x.valid)}</div><div><span class="status-pill quote-${x.status.toLowerCase()}" >${esc(x.status)}</span></div><div><b>${money(x.total)}</b></div><div class="row-actions"><button class="icon-action" title="Abrir" data-edit-quote="${x.id}">↗</button><button class="icon-action" title="PDF" data-quote-pdf="${x.id}">▣</button><button class="icon-action danger" title="Excluir" data-delete-quote="${x.id}">×</button></div></div>`).join('')||`<div class="empty-state"><span>▣</span><h3>Nenhum orçamento</h3><p>Monte uma proposta profissional e envie em PDF.</p><button class="btn primary" data-action="new-quote">+ Novo orçamento</button></div>`;
}
function renderFinance(){
 const s=$('#finStart').value,e=$('#finEnd').value,st=$('#finStatus').value; let list=orders.filter(o=>(!s||o.created>=s)&&(!e||o.created<=e)&&(st==='all'||(st==='paid'?(o.paid||o.status==='Pago'):!o.paid&&!['Pago'].includes(o.status))));
 const total=list.reduce((a,o)=>a+o.value,0),paid=list.filter(o=>o.paid||o.status==='Pago').reduce((a,o)=>a+o.value,0); $('#fTotal').textContent=money(total); $('#fPaid').textContent=money(paid); $('#fPending').textContent=money(total-paid); $('#fAverage').textContent=money(list.length?total/list.length:0);
 $('#financeTable').innerHTML=list.map(o=>`<div class="table-row finance-row"><div class="project-cell"><span class="project-mark">${esc(initials(o.project))}</span><div><b>${esc(o.project)}</b><small>${esc(o.type)}</small></div></div><div>${esc(o.client)}</div><div>${dateLabel(o.created)}</div><div><span class="status-pill ${o.paid||o.status==='Pago'?'status-paid':'status-wait'}">${o.paid||o.status==='Pago'?'Pago':'Pendente'}</span></div><div><b>${money(o.value)}</b></div><div><button class="icon-action" data-open-order="${o.id}">↗</button></div></div>`).join('')||`<div class="empty-state"><span>◒</span><h3>Nenhum lançamento</h3><p>Ajuste os filtros ou crie pedidos com valor.</p></div>`;
}
function renderNotifications(){
 const unread=notifications.filter(n=>!n.read).length; $('#notifyCount').textContent=unread; $('#notifyCount').style.display=unread?'flex':'none';
 $('#notificationsList').innerHTML=notifications.length?notifications.slice(0,30).map(n=>`<button class="notification-row ${n.read?'read':''}" data-notification="${n.id}"><span class="notif-dot ${n.kind}">${n.kind==='success'?'✓':n.kind==='warning'?'!':'i'}</span><div><b>${esc(n.title)}</b><small>${esc(n.body)}</small><time>${formatRelative(n.created)}</time></div>${n.read?'':'<i></i>'}</button>`).join(''):`<div class="empty-mini center"><span>✓</span><div><b>Nenhuma notificação</b><small>Quando algo importante acontecer, aparecerá aqui.</small></div></div>`;
}
function renderProfile(){ $('#dName').value=designer.name||'';$('#dBrand').value=designer.brand||'';$('#dWhats').value=designer.whats||'';$('#dEmail').value=designer.email||'';$('#dInsta').value=designer.insta||'';$('#dPortfolio').value=designer.portfolio||'';$('#dArea').value=designer.area||'';$('#dBio').value=designer.bio||''; }

function showAuth(mode='login'){ $('#authScreen').classList.remove('hidden'); $('#app').classList.add('hidden'); $('#publicPage').classList.add('hidden'); $('#loginForm').classList.toggle('hidden',mode!=='login'); $('#registerForm').classList.toggle('hidden',mode!=='register'); $('#authEyebrow').textContent=mode==='login'?'ACESSAR CONTA':'COMEÇAR AGORA'; $('#authTitle').textContent=mode==='login'?'Bem-vindo de volta':'Crie seu workspace'; $('#authSubtitle').textContent=mode==='login'?'Entre para gerenciar seu estúdio.':'Organize seu trabalho em poucos passos.'; }
function login(user,pass){const acc=accounts.find(a=>a.user.toLowerCase()===user.toLowerCase()&&a.pass===pass);if(!acc){toast('Usuário ou senha inválidos.','error');return;} currentUser={user:acc.user,name:acc.name,area:acc.area,whats:acc.whats};write(KEYS.user,currentUser);loadScoped();showApp();toast('Bem-vindo ao RafahStudio.');}
function register(){const name=$('#regName').value.trim(),user=$('#regUser').value.trim(),pass=$('#regPass').value,whats=$('#regWhats').value.trim(),area=$('#regArea').value;if(!name||!user||!pass){toast('Preencha nome, usuário e senha.','error');return;}if(accounts.some(a=>a.user.toLowerCase()===user.toLowerCase())){toast('Esse usuário já existe.','error');return;}const acc={id:uid('acc'),name,user,pass,whats,area};accounts.push(acc);currentUser={user,name,area,whats};designer={...designer,name,whats,area,brand:'RafahStudio'};write(KEYS.user,currentUser);write(KEYS.accounts,accounts);loadScoped();persist();showApp();toast('Conta criada com sucesso.');}
function logout(){currentUser=null;localStorage.removeItem(KEYS.user);showAuth('login');toast('Você saiu da conta.','info');}
function showApp(){ $('#authScreen').classList.add('hidden');$('#publicPage').classList.add('hidden');$('#app').classList.remove('hidden');go('dashboard');render(); }

function openOrder(order=null){editingOrderId=order?.id||null; const o=order||{client:'',project:'',deadline:'',value:0,type:'Cartaz',status:'Novo',priority:'Normal',briefing:{},files:[]}; modal(`<div class="modal-head"><div><span class="eyebrow">${editingOrderId?'EDITAR PEDIDO':'NOVO PEDIDO'}</span><h2>${editingOrderId?'Editar projeto':'Criar novo projeto'}</h2></div><button class="close-modal" data-close-modal>×</button></div><form id="orderForm"><div class="two-col"><label>Cliente<input id="orderClient" value="${esc(o.client)}" required></label><label>Projeto<input id="orderProject" value="${esc(o.project)}" required></label></div><div class="two-col"><label>Prazo<input id="orderDeadline" type="date" value="${esc(o.deadline)}"></label><label>Valor<input id="orderValue" type="number" min="0" step="0.01" value="${Number(o.value)||0}"></label></div><div class="two-col"><label>Serviço<select id="orderType">${['Cartaz','Cartaz para igreja/evento','Post para Instagram','Identidade visual','Logo','Outro'].map(x=>`<option ${x===o.type?'selected':''}>${x}</option>`).join('')}</select></label><label>Status<select id="orderStatus">${STATUS.map(x=>`<option ${x===o.status?'selected':''}>${x}</option>`).join('')}</select></label></div><label>Prioridade<select id="orderPriority"><option ${o.priority==='Normal'?'selected':''}>Normal</option><option ${o.priority==='Alta'?'selected':''}>Alta</option><option ${o.priority==='Urgente'?'selected':''}>Urgente</option></select></label><label>Observações / briefing interno<textarea id="orderNotes" rows="6">${esc(typeof o.briefing==='string' ? o.briefing : (o.briefing?.notes||o.briefing?.texts||''))}</textarea></label><div class="modal-actions"><button type="button" class="btn secondary" data-close-modal>Cancelar</button><button class="btn primary" type="submit">Salvar pedido</button></div></form>`);
 $('#orderForm').onsubmit=e=>{e.preventDefault();saveOrder(o);}; }
function saveOrder(existing){const was=existing?.status; const data={client:$('#orderClient').value.trim(),project:$('#orderProject').value.trim(),deadline:$('#orderDeadline').value,value:Number($('#orderValue').value)||0,type:$('#orderType').value,status:$('#orderStatus').value,priority:$('#orderPriority').value,briefing:{...(existing?.briefing||{}),notes:$('#orderNotes').value},files:existing?.files||[],origin:existing?.origin||'Manual',paid:existing?.paid||false};if(!data.client||!data.project){toast('Cliente e projeto são obrigatórios.','error');return;}if(existing){Object.assign(existing,data); if(existing.status==='Pago')existing.paid=true; if(was!==existing.status)addHistory(existing,`Status alterado de ${was} para ${existing.status}`);}else{const o={id:uid('ord'),...data,created:todayISO(),history:[]};addHistory(o,'Pedido criado');orders.unshift(o);notify('Novo pedido criado',`${data.project} • ${data.client}`,'success','pedidos',o.id);}persist();closeModal();render();go('pedidos');toast(existing?'Pedido atualizado.':'Pedido criado.');}
function addHistory(o,text){o.history=o.history||[];o.history.unshift({id:uid('hist'),at:new Date().toISOString(),text});}
function openOrderView(id){const o=orders.find(x=>x.id===id);if(!o)return; const b=o.briefing||{}; modal(`<div class="modal-head"><div><span class="eyebrow">DETALHES DO PEDIDO</span><h2>${esc(o.project)}</h2><p class="muted">${esc(o.client)} • ${esc(o.type)}</p></div><button class="close-modal" data-close-modal>×</button></div><div class="detail-top"><span class="status-pill ${statusClass(o.status)}">${esc(o.status)}</span><div class="detail-actions"><button class="btn secondary" data-edit-order="${o.id}">Editar</button><button class="btn secondary" data-order-pdf="${o.id}">PDF</button><button class="btn primary" data-cycle-status="${o.id}">Avançar status</button></div></div><div class="status-flow">${STATUS.map((s,i)=>`<span class="flow-step ${STATUS.indexOf(o.status)>=i?'done':''}"><i>${STATUS.indexOf(o.status)>=i?'✓':i+1}</i>${s}</span>`).join('')}</div><div class="detail-grid"><div class="detail-card"><b>Resumo</b><dl><div><dt>Cliente</dt><dd>${esc(o.client)}</dd></div><div><dt>Prazo</dt><dd>${dateLabel(o.deadline)}</dd></div><div><dt>Valor</dt><dd>${money(o.value)}</dd></div><div><dt>Pagamento</dt><dd>${o.paid||o.status==='Pago'?'Pago':'Pendente'}</dd></div></dl></div><div class="detail-card"><b>Briefing</b><p class="detail-text">${esc(b.texts||b.notes||'Nenhuma informação adicional registrada.')}</p>${b.refs?`<div class="ref-box"><b>Referências</b><p>${esc(b.refs)}</p></div>`:''}</div></div><div class="detail-card full-detail"><div class="detail-card-head"><b>Arquivos enviados pelo cliente</b><small>${(o.files||[]).length} arquivo(s)</small></div><div id="orderFiles" class="file-gallery">${renderFileGallery(o)}</div></div><div class="detail-card full-detail"><div class="detail-card-head"><b>Pessoas e fotos para a arte</b><small>${Array.isArray(b.people)?b.people.length:0} pessoa(s)</small></div><div class="file-gallery">${renderPeopleGallery(o)}</div></div><div class="detail-card full-detail"><div class="detail-card-head"><b>Histórico</b><small>Atividades do pedido</small></div><div class="history">${(o.history||[]).map(h=>`<div><span></span><p><b>${esc(h.text)}</b><small>${new Date(h.at).toLocaleString('pt-BR')}</small></p></div>`).join('')||'<p class="muted">Sem histórico.</p>'}</div></div><div class="modal-actions"><button class="btn danger-btn" data-delete-order="${o.id}">Excluir pedido</button><button class="btn secondary" data-toggle-paid="${o.id}">${o.paid?'Marcar como pendente':'Marcar como pago'}</button></div>`); }
function renderFileGallery(o){
  if(!o.files?.length)return`<div class="empty-mini center"><span>↑</span><div><b>Nenhum arquivo anexado.</b><small>Arquivos enviados pelo cliente aparecerão aqui.</small></div></div>`;
  return o.files.map((f,i)=>{
    const src=f.dataUrl||f.url||'';
    const isImage=f.type?.startsWith('image/');
    return `<div class="file-tile">${isImage&&src?`<img src="${esc(src)}" alt="${esc(f.name)}" data-preview-file="${o.id}:${i}" onerror="this.style.display='none'">`:`<div class="file-generic">${esc((f.type||'arquivo').split('/').pop()?.toUpperCase()||'ARQUIVO')}</div>`}<div><b title="${esc(f.name)}">${esc(f.name)}</b><small>${formatBytes(f.size||0)}</small></div><button class="btn secondary small" data-download-file="${o.id}:${i}">↓ Abrir original</button></div>`;
  }).join('');
}
function renderPeopleGallery(o){
  const people=Array.isArray(o.briefing?.people)?o.briefing.people:[];
  const withPhotos=people.map((p,i)=>({p,i,photo:p?.photo})).filter(x=>x.photo?.url||x.photo?.dataUrl);
  if(!withPhotos.length)return`<div class="empty-mini center"><span>👤</span><div><b>Nenhuma foto de pessoa enviada.</b><small>As fotos adicionadas pelo cliente aparecerão aqui.</small></div></div>`;
  return withPhotos.map(({p,i,photo})=>{
    const src=photo.url||photo.dataUrl;
    return `<div class="file-tile"><img src="${esc(src)}" alt="${esc(p.name||`Pessoa ${i+1}`)}"><div><b>${esc(p.name||`Pessoa ${i+1}`)}</b><small>${esc(p.info||'Foto para a arte')}</small></div><a class="btn secondary small" href="${esc(src)}" target="_blank" rel="noopener">Abrir original</a></div>`;
  }).join('');
}
function formatBytes(n){if(!n)return'arquivo';const u=['B','KB','MB','GB'];let i=0,x=n;while(x>=1024&&i<u.length-1){x/=1024;i++;}return`${x.toFixed(i?1:0)} ${u[i]}`;}
function cycleStatus(id){const o=orders.find(x=>x.id===id);if(!o)return;const i=STATUS.indexOf(o.status);const next=STATUS[Math.min(i+1,STATUS.length-1)];if(next===o.status){toast('O pedido já está no status final.','info');return;}const old=o.status;o.status=next;if(next==='Pago')o.paid=true;addHistory(o,`Status alterado de ${old} para ${next}`);persist();render();closeModal();notify(`Status atualizado: ${next}`,`${o.project} • ${o.client}`,'info','pedidos',o.id);toast(`Pedido movido para ${next}.`);}
function togglePaid(id){const o=orders.find(x=>x.id===id);if(!o)return;o.paid=!o.paid;if(o.paid){o.status='Pago';addHistory(o,'Pagamento recebido');notify('Pagamento recebido',`${o.project} • ${money(o.value)}`,'success','pedidos',o.id);}else{if(o.status==='Pago')o.status='Entregue';addHistory(o,'Pagamento marcado como pendente');}persist();render();toast(o.paid?'Pagamento registrado.':'Pagamento desmarcado.');}
function moveStatus(id,direction){
  const o=orders.find(x=>x.id===id); if(!o)return;
  const i=STATUS.indexOf(o.status);
  const nextIndex=Math.max(0,Math.min(STATUS.length-1,i+direction));
  if(nextIndex===i){toast(direction<0?'O pedido já está na primeira etapa.':'O pedido já está na etapa final.','info');return;}
  const old=o.status, next=STATUS[nextIndex];
  o.status=next;
  if(next==='Pago')o.paid=true;
  if(old==='Pago'&&next!=='Pago')o.paid=false;
  addHistory(o,`Pedido movido de ${old} para ${next}`);
  persist(); render();
  notify(`Pedido movido para ${next}`,`${o.project} • ${o.client}`,'info','pedidos',o.id);
}

function deleteOrder(id){
  const o=orders.find(x=>x.id===id); if(!o)return;
  if(!confirm(`Mover o pedido “${o.project}” para a lixeira?\\n\\nEle vai desaparecer dos pedidos e NÃO será recriado pelo briefing online.`))return;

  orders=orders.filter(x=>x.id!==id);
  const deleted={...o,deletedAt:new Date().toISOString()};
  trash.unshift(deleted);

  if(o.remoteId){
    const key=String(o.remoteId);
    if(!deletedRemoteIds.includes(key))deletedRemoteIds.push(key);
  }

  persist(); closeModal(); render();
  toast('Pedido movido para a lixeira.','info');
}

function openTrash(){
  const rows=trash.map(o=>`
    <div class="trash-row">
      <div><b>${esc(o.project)}</b><small>${esc(o.client)} • excluído em ${new Date(o.deletedAt||Date.now()).toLocaleDateString('pt-BR')}</small></div>
      <span class="status-pill ${statusClass(o.status)}">${esc(o.status)}</span>
      <button class="btn secondary small" data-restore-order="${o.id}">Restaurar</button>
      <button class="icon-action danger" title="Excluir permanentemente" data-purge-trash="${o.id}">×</button>
    </div>`).join('');

  modal(`<div class="modal-head"><div><span class="eyebrow">RECUPERAÇÃO</span><h2>Lixeira de pedidos</h2><p class="muted">Pedidos excluídos ficam aqui e não voltam para o painel automaticamente.</p></div><button class="close-modal" data-close-modal>×</button></div>
  <div class="trash-list">${rows||`<div class="empty-mini center"><span>✓</span><div><b>A lixeira está vazia.</b><small>Pedidos excluídos aparecerão aqui.</small></div></div>`}</div>
  <div class="modal-actions"><button class="btn secondary" data-close-modal>Fechar</button></div>`);
}

function restoreOrder(id){
  const idx=trash.findIndex(x=>x.id===id); if(idx<0)return;
  const o={...trash[idx]}; delete o.deletedAt;
  if(o.remoteId) deletedRemoteIds=deletedRemoteIds.filter(x=>String(x)!==String(o.remoteId));
  trash.splice(idx,1);
  orders.unshift(o);
  addHistory(o,'Pedido restaurado da lixeira');
  persist(); render(); closeModal();
  toast('Pedido restaurado.','success');
  if(o.remoteId)setTimeout(syncOnlineBriefings,100);
}

function purgeTrash(id){
  const idx=trash.findIndex(x=>x.id===id); if(idx<0)return;
  const o=trash[idx];
  if(!confirm(`Excluir permanentemente “${o.project}”?\\n\\nO pedido não poderá mais ser recuperado.`))return;
  if(o.remoteId&&!deletedRemoteIds.includes(String(o.remoteId)))deletedRemoteIds.push(String(o.remoteId));
  trash.splice(idx,1);
  persist(); render(); openTrash();
  toast('Pedido excluído permanentemente.','info');
}

function openClientForm(client=null){editingClientId=client?.id||null;const c=client||{name:'',company:'',whats:'',email:'',instagram:'',notes:''};modal(`<div class="modal-head"><div><span class="eyebrow">CLIENTE</span><h2>${editingClientId?'Editar cliente':'Novo cliente'}</h2></div><button class="close-modal" data-close-modal>×</button></div><form id="clientForm"><div class="two-col"><label>Nome completo<input id="clientName" value="${esc(c.name)}" required></label><label>Empresa<input id="clientCompany" value="${esc(c.company||'')}"></label></div><div class="two-col"><label>WhatsApp<input id="clientWhats" value="${esc(c.whats||'')}" ></label><label>E-mail<input id="clientEmail" type="email" value="${esc(c.email||'')}" ></label></div><label>Instagram<input id="clientInstagram" value="${esc(c.instagram||'')}"></label><label>Observações<textarea id="clientNotes" rows="4">${esc(c.notes||'')}</textarea></label><div class="modal-actions"><button type="button" class="btn secondary" data-close-modal>Cancelar</button><button class="btn primary" type="submit">Salvar cliente</button></div></form>`);
 $('#clientForm').onsubmit=e=>{e.preventDefault();const data={name:$('#clientName').value.trim(),company:$('#clientCompany').value.trim(),whats:$('#clientWhats').value.trim(),email:$('#clientEmail').value.trim(),instagram:$('#clientInstagram').value.trim(),notes:$('#clientNotes').value.trim()};if(!data.name){toast('Informe o nome do cliente.','error');return;}if(editingClientId){Object.assign(clients.find(x=>x.id===editingClientId),data);}else clients.unshift({id:uid('cli'),...data,created:todayISO()});persist();closeModal();render();toast(editingClientId?'Cliente atualizado.':'Cliente cadastrado.');}; }
function viewClient(name){const c=clients.find(x=>x.name.toLowerCase()===name.toLowerCase());const os=orders.filter(o=>o.client.toLowerCase()===name.toLowerCase());const s=clientStats(name);modal(`<div class="modal-head"><div><span class="eyebrow">HISTÓRICO DO CLIENTE</span><h2>${esc(name)}</h2></div><button class="close-modal" data-close-modal>×</button></div><div class="client-detail-top"><div class="avatar avatar-xl">${esc(initials(name))}</div><div><b>${esc(c?.company||'Cliente')}</b><small>${esc(c?.whats||'')}${c?.email?` • ${esc(c.email)}`:''}</small></div></div><div class="client-summary"><div><small>Projetos</small><b>${s.count}</b></div><div><small>Total</small><b>${money(s.total)}</b></div><div><small>Recebido</small><b>${money(s.paid)}</b></div><div><small>Pendente</small><b>${money(s.total-s.paid)}</b></div></div><div class="detail-card full-detail"><b>Projetos</b>${os.map(o=>`<button class="history-project" data-open-order="${o.id}"><div><b>${esc(o.project)}</b><small>${dateLabel(o.created)} • ${esc(o.type)}</small></div><span class="status-pill ${statusClass(o.status)}">${esc(o.status)}</span><strong>${money(o.value)}</strong></button>`).join('')||'<p class="muted">Nenhum pedido registrado.</p>'}</div><div class="modal-actions">${c&&!c.virtual?`<button class="btn secondary" data-edit-client="${c.id}">Editar cliente</button>`:''}${c?.whats?`<button class="btn primary" data-whatsapp="${esc(c.whats)}">Abrir WhatsApp</button>`:''}</div>`);}

function openQuoteForm(q=null){editingQuoteId=q?.id||null;const x=q||{client:'',project:'',valid:'',status:'Rascunho',description:'',items:[{desc:'',qty:1,price:0}],terms:'',discount:0}; modal(`<div class="modal-head"><div><span class="eyebrow">ORÇAMENTO</span><h2>${editingQuoteId?'Editar orçamento':'Novo orçamento'}</h2></div><button class="close-modal" data-close-modal>×</button></div><form id="quoteForm"><div class="two-col"><label>Cliente<input id="quoteClient" value="${esc(x.client)}" required></label><label>Projeto<input id="quoteProject" value="${esc(x.project)}" required></label></div><div class="two-col"><label>Validade<input id="quoteValid" type="date" value="${esc(x.valid)}"></label><label>Status<select id="quoteStatus">${QUOTE_STATUS.map(s=>`<option ${s===x.status?'selected':''}>${s}</option>`).join('')}</select></label></div><label>Descrição curta<input id="quoteDescription" value="${esc(x.description||'')}"></label><div class="items-editor"><div class="section-title"><span>+</span><div><b>Itens do orçamento</b><small>Adicione serviços e valores.</small></div></div><div id="quoteItemsEditor"></div><button type="button" class="btn secondary" id="addQuoteItem">+ Adicionar item</button></div><div class="two-col"><label>Desconto (R$)<input id="quoteDiscount" type="number" min="0" step="0.01" value="${Number(x.discount)||0}"></label><label>Total<input id="quoteTotal" readonly></label></div><label>Condições / observações<textarea id="quoteTerms" rows="4">${esc(x.terms||'')}</textarea></label><div class="modal-actions"><button type="button" class="btn secondary" data-close-modal>Cancelar</button><button class="btn primary" type="submit">Salvar orçamento</button></div></form>`); const editor=$('#quoteItemsEditor');let items=Array.isArray(x.items)&&x.items.length?x.items:[{desc:'',qty:1,price:0}];function paintItems(){editor.innerHTML=items.map((it,i)=>`<div class="quote-item"><input data-item-desc="${i}" placeholder="Descrição" value="${esc(it.desc)}"><input data-item-qty="${i}" type="number" min="1" step="1" value="${it.qty||1}"><input data-item-price="${i}" type="number" min="0" step="0.01" value="${it.price||0}"><button type="button" class="icon-action danger" data-remove-item="${i}">×</button></div>`).join('');recalc();}function recalc(){let subtotal=items.reduce((a,it)=>a+(Number(it.qty)||0)*(Number(it.price)||0),0);let total=Math.max(0,subtotal-(Number($('#quoteDiscount').value)||0));$('#quoteTotal').value=money(total);}editor.addEventListener('input',e=>{const i=e.target.dataset.itemDesc??e.target.dataset.itemQty??e.target.dataset.itemPrice;if(i!==undefined){const n=Number(i);items[n]={...items[n],desc:editor.querySelector(`[data-item-desc="${n}"]`)?.value||'',qty:Number(editor.querySelector(`[data-item-qty="${n}"]`)?.value)||1,price:Number(editor.querySelector(`[data-item-price="${n}"]`)?.value)||0};recalc();}});editor.addEventListener('click',e=>{const b=e.target.closest('[data-remove-item]');if(!b)return;items.splice(Number(b.dataset.removeItem),1);if(!items.length)items.push({desc:'',qty:1,price:0});paintItems();});$('#addQuoteItem').onclick=()=>{items.push({desc:'',qty:1,price:0});paintItems();};$('#quoteDiscount').oninput=recalc;paintItems();$('#quoteForm').onsubmit=e=>{e.preventDefault();const subtotal=items.reduce((a,it)=>a+(Number(it.qty)||0)*(Number(it.price)||0),0),discount=Number($('#quoteDiscount').value)||0,total=Math.max(0,subtotal-discount);const data={client:$('#quoteClient').value.trim(),project:$('#quoteProject').value.trim(),valid:$('#quoteValid').value,status:$('#quoteStatus').value,description:$('#quoteDescription').value.trim(),items,discount,subtotal,total,terms:$('#quoteTerms').value.trim(),updated:todayISO()};if(!data.client||!data.project){toast('Cliente e projeto são obrigatórios.','error');return;}if(editingQuoteId)Object.assign(quotes.find(q=>q.id===editingQuoteId),data);else quotes.unshift({id:uid('quo'),created:todayISO(),...data});persist();closeModal();render();toast(editingQuoteId?'Orçamento atualizado.':'Orçamento criado.');}; }
function deleteQuote(id){const q=quotes.find(x=>x.id===id);if(!q)return;if(!confirm(`Excluir o orçamento “${q.project}”?`))return;quotes=quotes.filter(x=>x.id!==id);persist();render();toast('Orçamento excluído.','info');}
function quoteToOrder(id){const q=quotes.find(x=>x.id===id);if(!q)return;const o={id:uid('ord'),client:q.client,project:q.project,deadline:q.valid,value:q.total,type:'Orçamento convertido',status:'Novo',priority:'Normal',created:todayISO(),paid:false,origin:'Orçamento',briefing:{notes:q.terms},files:[],history:[]};addHistory(o,'Pedido criado a partir do orçamento');orders.unshift(o);q.status='Aprovado';persist();render();closeModal();go('pedidos');notify('Orçamento convertido em pedido',`${q.project} • ${q.client}`,'success','pedidos',o.id);toast('Pedido criado a partir do orçamento.');}

async function generateLink(){
  if(!(await ensurePublicLink())) return '';

  const payload={
    v:5,
    designer:designer.name||'Designer',
    publicToken:getPublicToken()
  };
  const encoded=btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const baseUrl=location.href.split('#')[0];
  const url=`${baseUrl}#briefing=${encoded}`;

  $('#briefingLinkBox').classList.remove('hidden');
  $('#briefingLinkBox').innerHTML=
    `<div><b>Seu link de briefing</b><small>Envie este link ao cliente. O formulário não mostra valores.</small><code>${esc(url)}</code></div>`+
    `<button type="button" class="btn primary" data-copy-text="${esc(url)}">Copiar link</button>`;

  return url;
}
function copyText(text){navigator.clipboard?.writeText(text).then(()=>toast('Link copiado.')).catch(()=>{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();toast('Link copiado.');});}
function openPublic(){ $('#authScreen').classList.add('hidden');$('#app').classList.add('hidden');$('#publicPage').classList.remove('hidden'); }
function handlePublicHash(){const raw=location.hash.startsWith('#briefing=');if(!raw)return false;openPublic();return true;}
async function readFiles(fileList){const arr=[];for(const f of [...fileList]){if(f.size>8*1024*1024){toast(`${f.name} é maior que 8 MB e não foi anexado.`,'error');continue;}const data=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f);});arr.push({id:uid('file'),name:f.name,type:f.type,size:f.size,dataUrl:data,file:f});}return arr;}
function setupPublic(){let people=[];function paintPeople(){ $('#peopleList').innerHTML=people.map((p,i)=>`<div class="person-row"><div class="person-num">${i+1}</div><label>Nome<input data-person-name="${i}" value="${esc(p.name)}" required></label><label>Participação / informação<input data-person-info="${i}" value="${esc(p.info)}"></label><label class="person-photo">Foto<input data-person-photo="${i}" type="file" accept="image/*"><small>${p.photo?.name||'Opcional'}</small></label><button type="button" class="icon-action danger" data-remove-person="${i}">×</button></div>`).join('');}
 $('#addPersonBtn').onclick=()=>{people.push({name:'',info:'',photo:null});paintPeople();}; $('#peopleList').addEventListener('input',e=>{const i=e.target.dataset.personName??e.target.dataset.personInfo;if(i!==undefined){if(e.target.dataset.personName!==undefined)people[i].name=e.target.value;else people[i].info=e.target.value;}});$('#peopleList').addEventListener('change',async e=>{const i=e.target.dataset.personPhoto;if(i!==undefined&&e.target.files[0])people[i].photo=(await readFiles(e.target.files))[0];});$('#peopleList').addEventListener('click',e=>{const b=e.target.closest('[data-remove-person]');if(b){people.splice(Number(b.dataset.removePerson),1);paintPeople();}});$('#pubFiles').addEventListener('change',async e=>{const fs=await readFiles(e.target.files);$('#filePreview').innerHTML=fs.map(f=>`<span>${esc(f.name)} <small>${formatBytes(f.size)}</small></span>`).join('');$('#pubFiles')._files=fs;});
 $('#briefingForm').onsubmit=async e=>{e.preventDefault();
   if(!supabaseClient) initSupabaseClient();
   if(!supabaseClient){$('#publicMessage').textContent='Não foi possível conectar ao servidor. Verifique sua internet e atualize a página.';return;}
   const publicToken=briefingTokenFromHash(); if(!publicToken){$('#publicMessage').textContent='Link de briefing inválido ou expirado. Solicite um novo link ao designer.';return;}
   const files=$('#pubFiles')._files||[];const persons=people.map(p=>({name:p.name,info:p.info,photo:p.photo?{name:p.photo.name,type:p.photo.type,size:p.photo.size}:null}));
   const d={client:$('#pubName').value.trim(),whats:$('#pubWhats').value.trim(),project:$('#pubProject').value.trim(),deadline:$('#pubEvent').value,type:$('#pubType').value,texts:$('#pubTexts').value,people:persons,refs:$('#pubRefs').value,notes:$('#pubNotes').value};
   if(!d.client||!d.project){$('#publicMessage').textContent='Nome e projeto são obrigatórios.';return;}
   const btn=$('#briefingForm button[type="submit"]'); if(btn){btn.disabled=true;btn.textContent='Enviando…';}
   try{
     const briefingId=crypto.randomUUID?.()||uid('brief'); const uploaded=[];
     for(let i=0;i<files.length;i++){if(files[i].file) uploaded.push(await uploadBriefingFile(files[i].file,publicToken,briefingId,i));}
     for(let i=0;i<people.length;i++){if(people[i].photo?.file){const up=await uploadBriefingFile(people[i].photo.file,publicToken,briefingId,`p${i}`);d.people[i].photo=up;}}
     const {error}=await supabaseClient.rpc('submit_briefing',{p_public_token:publicToken,p_briefing_id:briefingId,p_client_name:d.client,p_whatsapp:d.whats,p_project_name:d.project,p_deadline:d.deadline||null,p_service_type:d.type,p_texts:d.texts,p_people:d.people,p_references_text:d.refs,p_notes:d.notes,p_files:uploaded}); if(error)throw error;
     $('#publicFormView').classList.add('hidden');$('#publicSuccess').classList.remove('hidden');$('#successProject').textContent=d.project;
   }catch(err){console.error(err);$('#publicMessage').textContent=`Não foi possível enviar. ${err?.message||'Tente novamente.'}`;if(btn){btn.disabled=false;btn.textContent='Enviar briefing →';}}
 }; $('#closePublicBtn').onclick=()=>{location.hash='';if(currentUser)showApp();else showAuth('login');};paintPeople(); }

function exportBackup(){const payload={version:2,exportedAt:new Date().toISOString(),designer,orders,clients,quotes,notifications};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});downloadBlob(blob,`rafahstudio-backup-${todayISO()}.json`);toast('Backup exportado.');}
function importBackup(file){const r=new FileReader();r.onload=()=>{try{const p=JSON.parse(r.result);if(!p||!Array.isArray(p.orders))throw new Error();orders=p.orders.map(normalizeOrder);clients=Array.isArray(p.clients)?p.clients:[];quotes=Array.isArray(p.quotes)?p.quotes:[];notifications=Array.isArray(p.notifications)?p.notifications:[];designer={...designer,...(p.designer||{})};persist();render();toast('Backup importado com sucesso.');}catch{toast('Arquivo de backup inválido.','error');}};r.readAsText(file);}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function pdfWindow(title,body){const w=window.open('','_blank','noopener,noreferrer');if(!w){toast('Permita pop-ups para gerar o PDF.','error');return;}w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:A4;margin:16mm}body{font:14px Arial;color:#16201e;margin:0}header{border-bottom:2px solid #dfe8e5;padding-bottom:16px;margin-bottom:24px;display:flex;justify-content:space-between}h1{font-size:24px;margin:0 0 6px}h2{font-size:15px;margin:22px 0 10px}small{color:#657773}table{width:100%;border-collapse:collapse}td,th{padding:9px;border-bottom:1px solid #e4ebe9;text-align:left}th{font-size:11px;color:#657773}p{line-height:1.55}.badge{display:inline-block;padding:6px 9px;border-radius:99px;background:#e9f5f1}.total{font-size:22px;font-weight:800}.box{background:#f5f8f7;padding:14px;border-radius:10px;white-space:pre-wrap}footer{margin-top:30px;padding-top:12px;border-top:1px solid #e4ebe9;color:#657773;font-size:11px}</style></head><body>${body}<footer>RafahStudio • Documento gerado em ${new Date().toLocaleString('pt-BR')}</footer><script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);w.document.close();}
function generateOrderPDF(id){const o=orders.find(x=>x.id===id);if(!o)return;const b=o.briefing||{};const people=(b.people||[]).map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.info||'—')}</td></tr>`).join('');const body=`<header><div><h1>RafahStudio</h1><small>${esc(designer.name||'Designer')} ${designer.brand&&designer.brand!=='RafahStudio'?'• '+esc(designer.brand):''}</small></div><div><b>PEDIDO</b><br><small>${esc(o.id)}</small></div></header><p><span class="badge">${esc(o.status)}</span></p><table><tr><th>Cliente</th><td>${esc(o.client)}</td><th>Projeto</th><td>${esc(o.project)}</td></tr><tr><th>Serviço</th><td>${esc(o.type)}</td><th>Prazo</th><td>${dateLabel(o.deadline)}</td></tr><tr><th>Valor</th><td>${money(o.value)}</td><th>Pagamento</th><td>${o.paid||o.status==='Pago'?'Pago':'Pendente'}</td></tr></table><h2>Briefing</h2><div class="box">${esc(b.texts||b.notes||'Sem briefing adicional.')}</div>${b.people?.length?`<h2>Pessoas da arte</h2><table><tr><th>Nome</th><th>Informação</th></tr>${people}</table>`:''}${b.refs?`<h2>Referências</h2><div class="box">${esc(b.refs)}</div>`:''}${b.notes?`<h2>Observações</h2><div class="box">${esc(b.notes)}</div>`:''}`;pdfWindow(`Pedido — ${o.project}`,body);}
function generateQuotePDF(id){const q=quotes.find(x=>x.id===id);if(!q)return;const rows=(q.items||[]).map(i=>`<tr><td>${esc(i.desc||'Serviço')}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money((Number(i.qty)||0)*(Number(i.price)||0))}</td></tr>`).join('');const body=`<header><div><h1>RafahStudio</h1><small>${esc(designer.name||'Designer')} ${designer.whats?'• '+esc(designer.whats):''}</small></div><div><b>ORÇAMENTO</b><br><small>${esc(q.id)}</small></div></header><table><tr><th>Cliente</th><td>${esc(q.client)}</td><th>Projeto</th><td>${esc(q.project)}</td></tr><tr><th>Validade</th><td>${dateLabel(q.valid)}</td><th>Status</th><td>${esc(q.status)}</td></tr></table><h2>Itens</h2><table><tr><th>Descrição</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr>${rows}</table><p><b>Subtotal:</b> ${money(q.subtotal)}<br><b>Desconto:</b> ${money(q.discount)}<br><span class="total">Total: ${money(q.total)}</span></p>${q.terms?`<h2>Condições</h2><div class="box">${esc(q.terms)}</div>`:''}`;pdfWindow(`Orçamento — ${q.project}`,body);}

function setupEvents(){
 $('#loginForm').onsubmit=e=>{e.preventDefault();login($('#loginUser').value.trim(),$('#loginPass').value);};$('#registerForm').onsubmit=e=>{e.preventDefault();register();};$('#showRegisterBtn').onclick=()=>showAuth('register');$('#showLoginBtn').onclick=()=>showAuth('login');
 $$('.nav-item[data-page]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.page))); $('#logoutBtn').onclick=logout;$('#profileQuick').onclick=()=>go('perfil');$('#userTrigger').onclick=()=>go('perfil');$('#themeBtn').onclick=toggleTheme;$('#mobileMenu').onclick=()=>$('#sidebar').classList.toggle('mobile-open');
 $('#notificationBtn').onclick=e=>{e.stopPropagation();$('#notificationPanel').classList.toggle('open');};document.addEventListener('click',e=>{if(!e.target.closest('#notificationPanel')&&!e.target.closest('#notificationBtn'))$('#notificationPanel').classList.remove('open');});$('#markReadBtn').onclick=()=>{notifications=notifications.map(n=>({...n,read:true}));persist();renderNotifications();toast('Notificações marcadas como lidas.','info');};
 $('#globalSearch').oninput=e=>{const q=e.target.value.trim();if(q){go('pedidos');$('#orderSearch').value=q;renderOrders();}};$('#orderSearch').oninput=renderOrders;$('#orderSort').onchange=renderOrders;$('#clientSearch').oninput=renderClients;$('#quoteSearch').oninput=renderQuotes;$('#quoteFilter').onchange=renderQuotes;['finStart','finEnd','finStatus'].forEach(id=>$('#'+id).onchange=renderFinance);$('#clearFinance').onclick=()=>{$('#finStart').value='';$('#finEnd').value='';$('#finStatus').value='all';renderFinance();};$('#copyBriefingBtn').onclick=()=>generateLink();
 $('#saveProfileBtn').onclick=()=>{designer={...designer,name:$('#dName').value.trim()||'Designer',brand:$('#dBrand').value.trim(),whats:$('#dWhats').value.trim(),email:$('#dEmail').value.trim(),insta:$('#dInsta').value.trim(),portfolio:$('#dPortfolio').value.trim(),area:$('#dArea').value.trim(),bio:$('#dBio').value.trim(),photo:designer.photo||''};persist();renderIdentity();toast('Perfil atualizado.');};$('#profilePhoto').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>4*1024*1024){toast('Escolha uma foto de até 4 MB.','error');return;}designer.photo=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f);});renderIdentity();};$('#exportBackupBtn').onclick=exportBackup;$('#importBackup').onchange=e=>{if(e.target.files[0])importBackup(e.target.files[0]);};
 document.addEventListener('click',handleDelegated);document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();$('#notificationPanel').classList.remove('open');}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='n'){e.preventDefault();openOrder();}});
}
function handleDelegated(e){const a=e.target.closest('[data-action]');if(a){const action=a.dataset.action;if(action==='new-order')openOrder();if(action==='new-client')openClientForm();if(action==='new-quote')openQuoteForm();if(action==='copy-briefing')generateLink();}
 const page=e.target.closest('[data-page-link]');if(page)go(page.dataset.pageLink);
 const open=e.target.closest('[data-open-order]');if(open)openOrderView(open.dataset.openOrder);
 const edit=e.target.closest('[data-edit-order]');if(edit){const order=orders.find(o=>o.id===edit.dataset.editOrder);if(order)openOrder(order);}
 const del=e.target.closest('[data-delete-order]');if(del)deleteOrder(del.dataset.deleteOrder);
 const trashBtn=e.target.closest('[data-open-trash]');if(trashBtn)openTrash();
 const restore=e.target.closest('[data-restore-order]');if(restore)restoreOrder(restore.dataset.restoreOrder);
 const purge=e.target.closest('[data-purge-trash]');if(purge)purgeTrash(purge.dataset.purgeTrash);
 const pdf=e.target.closest('[data-order-pdf]');if(pdf)generateOrderPDF(pdf.dataset.orderPdf);
 const paid=e.target.closest('[data-toggle-paid]');if(paid){togglePaid(paid.dataset.togglePaid);if($('#modalRoot').innerHTML)openOrderView(paid.dataset.togglePaid);}
 const move=e.target.closest('[data-move-status]');if(move&&!move.disabled){moveStatus(move.dataset.moveStatus,Number(move.dataset.direction)||1);}
 const cyc=e.target.closest('[data-cycle-status]');if(cyc)cycleStatus(cyc.dataset.cycleStatus);
 const editC=e.target.closest('[data-edit-client]');if(editC){const c=clients.find(x=>x.id===editC.dataset.editClient);if(c){closeModal();openClientForm(c);}}
 const viewC=e.target.closest('[data-view-client]');if(viewC)viewClient(viewC.dataset.viewClient);
 const wa=e.target.closest('[data-whatsapp]');if(wa){const n=String(wa.dataset.whatsapp).replace(/\D/g,'');window.open(`https://wa.me/${n.startsWith('55')?n:'55'+n}`,'_blank','noopener');}
 const editQ=e.target.closest('[data-edit-quote]');if(editQ){const q=quotes.find(x=>x.id===editQ.dataset.editQuote);if(q)openQuoteForm(q);}
 const delQ=e.target.closest('[data-delete-quote]');if(delQ)deleteQuote(delQ.dataset.deleteQuote);
 const pdfQ=e.target.closest('[data-quote-pdf]');if(pdfQ)generateQuotePDF(pdfQ.dataset.quotePdf);
 const copy=e.target.closest('[data-copy-text]');if(copy)copyText(copy.dataset.copyText);
 const notif=e.target.closest('[data-notification]');if(notif){const n=notifications.find(x=>x.id===notif.dataset.notification);if(n){n.read=true;persist();renderNotifications();if(n.linkId)openOrderView(n.linkId);}}
 const dl=e.target.closest('[data-download-file]');if(dl){const [oid,idx]=dl.dataset.downloadFile.split(':');const o=orders.find(x=>x.id===oid),f=o?.files?.[Number(idx)];if(f?.dataUrl){const a=document.createElement('a');a.href=f.dataUrl;a.download=f.name||'arquivo';document.body.appendChild(a);a.click();a.remove();}else if(f?.url){window.open(f.url,'_blank','noopener,noreferrer');}else toast('Arquivo original não possui uma URL disponível.','error');}
 const preview=e.target.closest('[data-preview-file]');if(preview)modal(`<div class="image-modal"><button class="close-modal" data-close-modal>×</button><img src="${preview.src}" alt="Pré-visualização"></div>`);
 const tab=e.target.closest('#orderTabs button');if(tab){orderFilter=tab.dataset.filter;renderOrders();}
  const closeButton=e.target.closest('.close-modal,[data-close-modal]');if(closeButton)closeModal();
}
function toggleTheme(){const dark=document.body.classList.toggle('dark');localStorage.setItem(KEYS.theme,dark?'dark':'light');$('#themeLabel').textContent=dark?'Escuro':'Claro';toast(`Tema ${dark?'escuro':'claro'} ativado.`,'info');}
function togglePublicTheme(){const page=$('#publicPage');if(!page)return;const dark=page.classList.toggle('public-dark');localStorage.setItem('rafahstudio_public_theme',dark?'dark':'light');updatePublicThemeButton();}
function updatePublicThemeButton(){const page=$('#publicPage'),btn=$('#publicThemeBtn'),icon=$('#publicThemeIcon'),label=$('#publicThemeLabel');if(!page||!btn)return;const dark=page.classList.contains('public-dark');if(icon)icon.textContent=dark?'☀':'☾';if(label)label.textContent=dark?'Claro':'Escuro';btn.setAttribute('aria-label',dark?'Ativar tema claro':'Ativar tema escuro');}
function initPublicTheme(){const page=$('#publicPage');if(!page)return;page.classList.toggle('public-dark',localStorage.getItem('rafahstudio_public_theme')==='dark');updatePublicThemeButton();$('#publicThemeBtn')?.addEventListener('click',togglePublicTheme);}


function init(){
 setupEvents();setupPublic();initPublicTheme();
 if(localStorage.getItem(KEYS.theme)==='dark'){document.body.classList.add('dark');$('#themeLabel').textContent='Escuro';}
 if(handlePublicHash())return;
 if(currentUser){loadScoped();showApp();setTimeout(syncOnlineBriefings,400);setInterval(syncOnlineBriefings,30000);}else showAuth('login');
}
init();
