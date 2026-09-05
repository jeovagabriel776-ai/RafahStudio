'use strict';
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const APP = 'rafahstudio';
const KEYS = { user:`${APP}:user`, theme:`${APP}:theme`, designer:`${APP}:designer`, orders:`${APP}:orders`, clients:`${APP}:clients`, quotes:`${APP}:quotes`, catalog:`${APP}:catalog`, notifications:`${APP}:notifications`, trash:`${APP}:trash`, deletedRemote:`${APP}:deleted-remote`, deletedRemoteFingerprints:`${APP}:deleted-remote-fingerprints` };
const STATUS = ['Novo','Em andamento','Esperando aprovação','Alteração','Entregue','Pago','Finalizado'];
const QUOTE_STATUS = ['Rascunho','Enviado','Aprovado','Recusado'];
const todayISO = () => new Date().toISOString().slice(0,10);
const money = v => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)||0);
const dateLabel = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}) : 'A definir';
const esc = v => String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const initials = v => String(v||'Designer').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase() || 'D';
const uid = p => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
function deadlineMeta(deadline){
  if(!deadline)return {label:'Prazo não definido',tone:'muted',days:null};
  const base=new Date(); base.setHours(0,0,0,0);
  const d=new Date(`${deadline}T00:00:00`);
  const days=Math.round((d-base)/86400000);
  if(days<0)return {label:'Atrasado',tone:'danger',days};
  if(days===0)return {label:'Entrega hoje',tone:'danger',days};
  if(days===1)return {label:'Amanhã',tone:'urgent',days};
  if(days<=3)return {label:'Urgente',tone:'urgent',days};
  if(days<=7)return {label:'Próximo',tone:'soon',days};
  return {label:'Prazo normal',tone:'normal',days};
}
function deadlineTag(deadline){const m=deadlineMeta(deadline);return `<span class="deadline-tag ${m.tone}"><i></i>${esc(m.label)}</span>`;}

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
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'rafahstudio-auth' }
    });
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
function accountScopeId(){return currentUser?.id||currentUser?.user||currentUser?.email||currentUser?.username||'default';}
function getOwnerToken(){const u=accountScopeId();let t=localStorage.getItem(ownerTokenKey(u));if(!t){t=randomToken();localStorage.setItem(ownerTokenKey(u),t);}return t;}
function getPublicToken(){const u=accountScopeId();let t=localStorage.getItem(publicTokenKey(u));if(!t){t=randomToken();localStorage.setItem(publicTokenKey(u),t);}return t;}
function briefingTokenFromHash(){
  try{
    if(!location.hash.startsWith('#briefing='))return '';
    const raw=decodeURIComponent(location.hash.slice('#briefing='.length));
    if(raw.startsWith('{')){const p=JSON.parse(raw);return p.publicToken||'';}
    try{
      const decoded=decodeURIComponent(escape(atob(raw)));
      if(decoded.trim().startsWith('{'))return JSON.parse(decoded).publicToken||'';
    }catch(e){}
    return raw;
  }catch{return '';}
}
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
const TRACKING_STATUS_INFO={
  'Novo':{title:'Pedido recebido',desc:'Seu pedido chegou e está aguardando o início da produção.'},
  'Em andamento':{title:'Em produção',desc:'O designer já está trabalhando na sua arte.'},
  'Esperando aprovação':{title:'Aguardando sua aprovação',desc:'A arte está em uma etapa de revisão e aprovação.'},
  'Alteração':{title:'Ajustes em andamento',desc:'O designer está realizando os ajustes solicitados.'},
  'Entregue':{title:'Arte entregue',desc:'A arte foi concluída e está pronta para você.'},
  'Pago':{title:'Pagamento confirmado',desc:'Pagamento recebido. O projeto está na etapa final.'},
  'Finalizado':{title:'Projeto finalizado',desc:'Tudo certo! Este projeto foi concluído.'}
};
function trackingProgress(status){const i=Math.max(0,STATUS.indexOf(status));return Math.round((i/(STATUS.length-1))*100);}
async function ensureOrderTracking(o){
  if(!supabaseClient||!o||!currentUser)return '';
  const hadToken=!!o.trackingToken;
  if(!o.trackingToken)o.trackingToken=randomToken();
  try{
    if(!(await ensurePublicLink())) return o.trackingToken||'';
    await syncPublicProfileLink(getPublicToken());
    const {error}=await supabaseClient.rpc('upsert_order_tracking',{
      p_tracking_token:o.trackingToken,p_owner_secret:getOwnerToken(),p_order_id:String(o.id),p_public_token:getPublicToken(),
      p_client_name:o.client||'',p_project_name:o.project||'Sem projeto',p_service_type:o.type||'Outro',
      p_deadline:o.deadline||null,p_status:o.status||'Novo',p_value:Number(o.value)||0
    });
    if(error)throw error;
    if(!hadToken)persist();
    return o.trackingToken;
  }catch(e){console.warn('[RafahStudio] acompanhamento:',e);return o.trackingToken||'';}
}
function trackingUrlForOrder(o){
  if(!o?.trackingToken)return '';
  const base=location.href.split('#')[0];
  return `${base}#pedido=${encodeURIComponent(o.trackingToken)}`;
}
async function syncOrderTracking(o){if(!o)return '';const token=await ensureOrderTracking(o);return token?trackingUrlForOrder(o):'';}


async function fetchTrackingEvents(token){
  if(!supabaseClient||!token)return [];
  try{
    const {data,error}=await supabaseClient.rpc('get_order_tracking_events',{p_tracking_token:token});
    if(error)throw error;
    return Array.isArray(data)?data:[];
  }catch(e){console.warn('[RafahStudio] Eventos do acompanhamento:',e);return [];}
}
function renderTrackingEventCards(events=[]){
  if(!events.length)return '<div class="tracking-feed-empty"><span>✦</span><div><b>Ainda não há atualizações visuais.</b><small>As artes e mensagens do designer aparecerão aqui.</small></div></div>';
  return events.map(ev=>{
    const img=ev.image_url?`<button type="button" class="tracking-art-preview" data-public-art="${esc(ev.image_url)}"><img src="${esc(ev.image_url)}" alt="Atualização da arte"><span>Ampliar arte ↗</span></button>`:'';
    const label=ev.kind==='art'?'Nova versão da arte':ev.kind==='alteration'?'Alteração solicitada':ev.kind==='approval'?'Arte aprovada':'Atualização';
    return `<article class="tracking-feed-item ${esc(ev.kind||'update')}"><div class="tracking-feed-marker">${ev.kind==='approval'?'✓':ev.kind==='alteration'?'↻':'✦'}</div><div class="tracking-feed-body"><div class="tracking-feed-meta"><b>${esc(label)}</b><small>${new Date(ev.created_at).toLocaleString('pt-BR')}</small></div>${ev.message?`<p>${esc(ev.message)}</p>`:''}${img}</div></article>`;
  }).join('');
}
async function submitPublicAlteration(){
  const token=decodeURIComponent(location.hash.slice('#pedido='.length));
  const text=($('#trackingChangeText')?.value||'').trim();
  if(text.length<3){alert('Descreva a alteração que você precisa.');return;}
  const btn=$('#trackingChangeBtn');if(btn){btn.disabled=true;btn.textContent='Enviando…';}
  try{
    const {error}=await supabaseClient.rpc('submit_order_alteration',{p_tracking_token:token,p_message:text});
    if(error)throw error;
    $('#trackingChangeText').value='';
    $('#trackingActionMessage').textContent='Alteração enviada. O designer já poderá ver sua solicitação.';
    await loadPublicTracking();
  }catch(e){$('#trackingActionMessage').textContent=e?.message||'Não foi possível enviar a alteração.';}
  finally{if(btn){btn.disabled=false;btn.textContent='↻ Solicitar alteração';}}
}
async function submitPublicApproval(){
  if(!confirm('Confirmar que esta arte está aprovada?'))return;
  const token=decodeURIComponent(location.hash.slice('#pedido='.length));
  const btn=$('#trackingApproveBtn');if(btn){btn.disabled=true;btn.textContent='Confirmando…';}
  try{
    const {error}=await supabaseClient.rpc('submit_order_approval',{p_tracking_token:token,p_message:'Arte aprovada pelo cliente.'});
    if(error)throw error;
    $('#trackingActionMessage').textContent='Arte aprovada com sucesso. Obrigado!';
    await loadPublicTracking();
  }catch(e){$('#trackingActionMessage').textContent=e?.message||'Não foi possível confirmar a aprovação.';}
  finally{if(btn){btn.disabled=false;btn.textContent='✓ Aprovar arte';}}
}
async function sendTrackingArtUpdate(orderId){
  const o=orders.find(x=>String(x.id)===String(orderId));if(!o)return;
  await ensureOrderTracking(o);
  modal(`<div class="modal-head"><div><span class="eyebrow">ACOMPANHAMENTO DO CLIENTE</span><h2>Enviar arte para aprovação</h2><p class="muted">A imagem aparecerá na página privada do pedido.</p></div><button class="close-modal" data-close-modal>×</button></div><form id="trackingUpdateForm"><label>Mensagem para o cliente<textarea id="trackingUpdateMessage" rows="4" placeholder="Ex.: Primeira versão pronta. Confira os detalhes e me diga se deseja algum ajuste."></textarea></label><label class="upload-zone"><input id="trackingUpdateFile" type="file" accept="image/*" required><span class="upload-icon">↑</span><b>Selecionar imagem da arte</b><small>PNG, JPG ou WEBP</small></label><div class="modal-actions"><button type="button" class="btn secondary" data-close-modal>Cancelar</button><button class="btn primary" type="submit">Enviar para o cliente</button></div></form>`);
  $('#trackingUpdateForm').onsubmit=async e=>{
    e.preventDefault();
    const file=$('#trackingUpdateFile').files[0],msg=$('#trackingUpdateMessage').value.trim();
    if(!file)return;
    const btn=$('#trackingUpdateForm button[type="submit"]');btn.disabled=true;btn.textContent='Enviando…';
    try{
      showUploadProgress('Enviando atualização…','Publicando a nova versão para o cliente.');
      const asset=await uploadOrderAsset(file,o.id,'tracking-art');
      const {error}=await supabaseClient.rpc('add_order_tracking_event',{p_owner_secret:getOwnerToken(),p_tracking_token:o.trackingToken,p_kind:'art',p_message:msg||'Nova versão da arte disponível para aprovação.',p_image_url:asset.url});
      if(error)throw error;
      const old=o.status;o.status='Esperando aprovação';
      if(old!==o.status)addHistory(o,'Nova arte enviada ao cliente para aprovação');
      persist();await syncOrderTracking(o);hideUploadProgress(true);closeModal();render();notify('Arte enviada para aprovação',`${o.project} • ${o.client}`,'info','pedidos',o.id);toast('A atualização já está disponível para o cliente.');
    }catch(err){hideUploadProgress(false);toast(err?.message||'Não foi possível enviar a atualização.','error');btn.disabled=false;btn.textContent='Enviar para o cliente';}
  };
}
function renderDesignerTrackingEvents(o){
  const events=Array.isArray(o.trackingEvents)?o.trackingEvents:[];
  if(!events.length)return '<div class="empty-mini center"><span>✦</span><div><b>Nenhuma interação ainda.</b><small>Envie uma arte para aprovação ou aguarde o cliente solicitar alterações.</small></div></div>';
  return events.slice(0,12).map(ev=>`<div class="designer-track-event ${esc(ev.kind||'update')}"><span>${ev.kind==='approval'?'✓':ev.kind==='alteration'?'↻':'✦'}</span><div><b>${esc(ev.kind==='approval'?'Arte aprovada':ev.kind==='alteration'?'Alteração do cliente':ev.kind==='art'?'Arte enviada':'Atualização')}</b><p>${esc(ev.message||'')}</p><small>${new Date(ev.created_at).toLocaleString('pt-BR')}</small>${ev.image_url?`<a href="${esc(ev.image_url)}" target="_blank" rel="noopener">Abrir imagem ↗</a>`:''}</div></div>`).join('');
}
async function syncTrackingEventsForOwner(){
  if(!supabaseClient||!currentUser)return;
  try{
    const {data,error}=await supabaseClient.rpc('get_order_tracking_events_for_owner',{p_owner_secret:getOwnerToken()});
    if(error)throw error;
    let changed=false;
    for(const o of orders){
      const evs=(data||[]).filter(ev=>String(ev.order_id)===String(o.id)||String(ev.tracking_token)===String(o.trackingToken));
      if(!evs.length)continue;
      const known=new Set((o.trackingEvents||[]).map(x=>String(x.id)));
      for(const ev of evs){
        if(known.has(String(ev.id)))continue;
        o.trackingEvents=o.trackingEvents||[];o.trackingEvents.unshift(ev);changed=true;
        if(ev.author==='client'&&ev.kind==='alteration'){
          const old=o.status;o.status='Alteração';if(old!==o.status)addHistory(o,'Cliente solicitou alteração pelo acompanhamento');
          notify('Alteração solicitada',`${o.project} • ${o.client}`,'warning','pedidos',o.id);
        }else if(ev.author==='client'&&ev.kind==='approval'){
          const old=o.status;o.status='Entregue';if(old!==o.status)addHistory(o,'Cliente aprovou a arte pelo acompanhamento');
          notify('Arte aprovada',`${o.project} • ${o.client}`,'success','pedidos',o.id);
        }
      }
    }
    if(changed){persist();renderSoon();for(const o of orders.filter(x=>x.trackingToken))syncOrderTracking(o);}
  }catch(e){console.warn('[RafahStudio] Interações do cliente:',e);}
}

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
      const remoteFingerprint=onlineBriefingFingerprint(b);
      if(deletedRemoteIds.includes(remoteKey) || deletedRemoteFingerprints.includes(remoteFingerprint)){
        // O briefing original pode continuar no Supabase, mas uma exclusão
        // feita pelo designer é definitiva para o painel até que ele restaure
        // o item pela Lixeira.
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
        const before=JSON.stringify({remoteId:o.remoteId,remoteCreated:o.remoteCreated,origin:o.origin,client:o.client,project:o.project,deadline:o.deadline,type:o.type,briefing:o.briefing,files:o.files,created:o.created});
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
        changed=changed || before!==JSON.stringify({remoteId:o.remoteId,remoteCreated:o.remoteCreated,origin:o.origin,client:o.client,project:o.project,deadline:o.deadline,type:o.type,briefing:o.briefing,files:o.files,created:o.created});
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
        // O cliente recebido pelo briefing entra como um cliente real do workspace.
        // Depois disso ele pode ser editado ou removido normalmente; a sincronização
        // não recria clientes para pedidos que já existem.
        if(o.client && !clients.some(c=>String(c.name||'').trim().toLowerCase()===String(o.client).trim().toLowerCase())){
          clients.unshift({id:uid('cli'),name:o.client,company:'',whats:b.whatsapp||'',email:'',instagram:'',notes:'Cliente cadastrado pelo briefing online',created:todayISO(),origin:'Briefing online'});
        }
        byRemote.set(remoteKey,o);
        changed=true;
        const newBriefingNotification={
          id:uid('ntf'),
          title:'Novo briefing recebido',
          body:`${o.project} • ${o.client}`,
          kind:'success',
          created:new Date().toISOString(),
          read:false,
          linkPage:'pedidos',
          linkId:o.id
        };
        notifications.unshift(newBriefingNotification);
        // O briefing novo também precisa disparar a notificação do sistema.
        // Antes da otimização ele era apenas salvo no painel interno.
        showDesktopNotification(
          'Novo briefing recebido',
          `${o.project} • ${o.client}`,
          'rafahstudio-briefing-'+String(o.id)
        );
        window.dispatchEvent(new CustomEvent('rafah:new-briefing',{detail:{
          project_name:o.project,client_name:o.client,orderId:o.id
        }}));
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

    if(changed){persist();renderSoon();}
  }catch(err){
    console.error('RafahStudio Supabase:',err);
  }finally{
    onlineBriefingSyncRunning=false;
  }
}

const read = (key, fallback) => { try { const v=localStorage.getItem(key); return v===null?fallback:JSON.parse(v); } catch { return fallback; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

const DEFAULT_DESIGNER = {name:'',brand:'RafahStudio',whats:'',email:'',insta:'',portfolio:'',area:'Designer gráfico',bio:'',photo:'',banner:''};
let accounts = [];
let currentUser = read(KEYS.user, null);
let designer = {...DEFAULT_DESIGNER};
let orders = read(KEYS.orders, []);
let clients = read(KEYS.clients, []);
let quotes = read(KEYS.quotes, []);
let catalog = read(KEYS.catalog, []);
let notifications = read(KEYS.notifications, []);
let trash = read(KEYS.trash, []);
let deletedRemoteIds = read(KEYS.deletedRemote, []);
let deletedRemoteFingerprints = read(KEYS.deletedRemoteFingerprints, []);
let orderFilter = 'all', editingOrderId=null, editingClientId=null, editingQuoteId=null;
let currentPage = 'dashboard';
let renderFramePending = false;
let liveSyncTimers = [];
let trackingPublicRefreshTimer = null;

// Migração do projeto antigo: preserva o que já existe e normaliza os status.
function migrateLegacy(){
  const legacyOrders = read('studioflow_v2_orders', null);
  if(!orders.length && Array.isArray(legacyOrders)) orders = legacyOrders.map(normalizeOrder);
  if(!designer.name){ const old=read('studioflow_designer',null); if(old) designer={...designer,...old}; }
  const oldUser=read('studioflow_user',null); if(!currentUser && oldUser) currentUser=oldUser;
  orders = orders.map(normalizeOrder);
  // Contas e credenciais não são mais armazenadas no navegador. O login oficial é feito pelo Supabase Auth.
  if(currentUser) write(KEYS.user,currentUser);
}
function normalizeStatus(s){
  if(s==='Aprovação'||s==='Aprovado') return s==='Aprovado'?'Esperando aprovação':'Esperando aprovação';
  if(s==='Pago') return 'Pago';
  if(s==='Finalizado'||s==='Finalizada') return 'Finalizado';
  return STATUS.includes(s)?s:'Novo';
}
function normalizeOrder(o){ return {id:o.id||uid('ord'),remoteId:o.remoteId||'',remoteCreated:o.remoteCreated||'',client:o.client||'',project:o.project||'Sem projeto',deadline:o.deadline||'',value:Number(o.value)||0,type:o.type||'Outro',status:normalizeStatus(o.status),created:o.created||todayISO(),paid:Boolean(o.paid||o.status==='Pago'||o.status==='Finalizado'),origin:o.origin||'Manual',priority:o.priority||'Normal',briefing:o.briefing||{},files:Array.isArray(o.files)?o.files:[],people:Array.isArray(o.people)?o.people:[],readyArt:o.readyArt||null,trackingToken:o.trackingToken||'',trackingEvents:Array.isArray(o.trackingEvents)?o.trackingEvents:[],history:Array.isArray(o.history)?o.history:[]}; }
migrateLegacy();

function scopedKey(base){ return `${base}:${currentUser?.id||currentUser?.user||currentUser?.email||'guest'}`; }
function loadScoped(){
  if(!currentUser) return;
  // Cada conta começa com um workspace próprio. Nunca reutilizamos o estado global
  // de outra conta para preencher uma conta nova.
  const key=String(currentUser.id||currentUser.user||currentUser.email||'guest');
  const oldScope=currentUser._scopeKey;
  if(oldScope && oldScope!==key){ /* apenas uma troca de sessão */ }
  currentUser._scopeKey=key;
  const sk=base=>`${base}:${key}`;
  orders=read(sk('rafahstudio:orders'),[]).map(normalizeOrder);
  clients=read(sk('rafahstudio:clients'),[]);
  quotes=read(sk('rafahstudio:quotes'),[]);
  catalog=read(sk('rafahstudio:catalog'),[]);
  notifications=read(sk('rafahstudio:notifications'),[]);
  trash=read(sk('rafahstudio:trash'),[]);
  deletedRemoteIds=read(sk('rafahstudio:deletedRemote'),[]);
  deletedRemoteFingerprints=read(sk('rafahstudio:deletedRemoteFingerprints'),[]);
  designer={...DEFAULT_DESIGNER,...(read(sk('rafahstudio:designer'),{})||{})};
}

let workspaceRemoteReady=false, workspaceSaveTimer=null, workspaceLastRemoteAt='';
function workspaceSnapshot(){return {version:3,ownerToken:getOwnerToken(),publicToken:getPublicToken(),orders,clients,quotes,catalog,notifications,trash,deletedRemoteIds,deletedRemoteFingerprints};}
function workspaceHasData(state){return !!(state&&([state.orders,state.clients,state.quotes,state.catalog].some(x=>Array.isArray(x)&&x.length)));}
function applyWorkspaceState(state){
  if(!state||typeof state!=='object')return;
  if(state.ownerToken)localStorage.setItem(ownerTokenKey(accountScopeId()),String(state.ownerToken));
  if(state.publicToken)localStorage.setItem(publicTokenKey(accountScopeId()),String(state.publicToken));
  if(Array.isArray(state.orders))orders=state.orders.map(normalizeOrder);
  if(Array.isArray(state.clients))clients=state.clients;
  if(Array.isArray(state.quotes))quotes=state.quotes;
  if(Array.isArray(state.catalog))catalog=state.catalog;
  if(Array.isArray(state.notifications))notifications=state.notifications;
  if(Array.isArray(state.trash))trash=state.trash;
  if(Array.isArray(state.deletedRemoteIds))deletedRemoteIds=state.deletedRemoteIds;
  if(Array.isArray(state.deletedRemoteFingerprints))deletedRemoteFingerprints=state.deletedRemoteFingerprints;
}
async function saveWorkspaceRemote(){
  if(!workspaceRemoteReady||!supabaseClient||!currentUser?.id)return false;
  try{
    const {data,error}=await supabaseClient.from('rafah_workspace_state').upsert({
      user_id:currentUser.id,state:workspaceSnapshot(),updated_at:new Date().toISOString()
    },{onConflict:'user_id'}).select('updated_at').single();
    if(error)throw error;
    workspaceLastRemoteAt=data?.updated_at||workspaceLastRemoteAt;
    return true;
  }catch(e){console.warn('[RafahStudio] Sincronização do workspace:',e);return false;}
}
function scheduleWorkspaceSave(){
  if(!workspaceRemoteReady)return;
  clearTimeout(workspaceSaveTimer);
  workspaceSaveTimer=setTimeout(saveWorkspaceRemote,700);
}
async function loadRemoteWorkspace(){
  if(!supabaseClient||!currentUser?.id)return false;
  try{
    const {data,error}=await supabaseClient.from('rafah_workspace_state').select('state,updated_at').eq('user_id',currentUser.id).maybeSingle();
    if(error)throw error;
    if(data?.state){
      const localState=workspaceSnapshot();
      if(!workspaceHasData(data.state)&&workspaceHasData(localState)){
        workspaceRemoteReady=true;
        await saveWorkspaceRemote();
        workspaceRemoteReady=false;
        return false;
      }
      applyWorkspaceState(data.state);
      workspaceLastRemoteAt=data.updated_at||'';
      return true;
    }
    workspaceRemoteReady=true;
    await saveWorkspaceRemote();
    workspaceRemoteReady=false;
    return false;
  }catch(e){console.warn('[RafahStudio] Não foi possível carregar o workspace online:',e);return false;}
}
async function refreshWorkspaceFromRemote(){
  if(!workspaceRemoteReady||!supabaseClient||!currentUser?.id)return;
  try{
    const {data,error}=await supabaseClient.from('rafah_workspace_state').select('state,updated_at').eq('user_id',currentUser.id).maybeSingle();
    if(error||!data?.state)return;
    if(data.updated_at&&data.updated_at!==workspaceLastRemoteAt){
      applyWorkspaceState(data.state);
      workspaceLastRemoteAt=data.updated_at;
      const key=String(currentUser.id||currentUser.user||currentUser.email||'guest'),sk=base=>`${base}:${key}`;
      write(sk('rafahstudio:orders'),orders);write(sk('rafahstudio:clients'),clients);write(sk('rafahstudio:quotes'),quotes);write(sk('rafahstudio:catalog'),catalog);write(sk('rafahstudio:notifications'),notifications);write(sk('rafahstudio:trash'),trash);
      render();
    }
  }catch(e){console.warn('[RafahStudio] Atualização entre dispositivos:',e);}
}
function persist(){
  if(!currentUser) return;
  const key=String(currentUser.id||currentUser.user||currentUser.email||'guest');
  const sk=base=>`${base}:${key}`;
  write(sk('rafahstudio:orders'),orders); write(sk('rafahstudio:clients'),clients); write(sk('rafahstudio:quotes'),quotes); write(sk('rafahstudio:catalog'),catalog); write(sk('rafahstudio:notifications'),notifications); write(sk('rafahstudio:designer'),designer); write(sk('rafahstudio:trash'),trash); write(sk('rafahstudio:deletedRemote'),deletedRemoteIds); write(sk('rafahstudio:deletedRemoteFingerprints'),deletedRemoteFingerprints);
  write(KEYS.user,currentUser);
  scheduleWorkspaceSave();
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
function getNotificationPrefs(){const key=`${APP}:notification-prefs:${accountScopeId()}`;try{return {...{mode:'sound',sound:'suave'},...JSON.parse(localStorage.getItem(key)||'{}')}}catch{return {mode:'sound',sound:'suave'}}}
function saveNotificationPrefs(v){localStorage.setItem(`${APP}:notification-prefs:${accountScopeId()}`,JSON.stringify(v));}
let notificationAudioCtx=null;
function unlockNotificationAudio(){
  try{
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC)return false;
    notificationAudioCtx=notificationAudioCtx||new AC();
    if(notificationAudioCtx.state==='suspended')notificationAudioCtx.resume().catch(()=>{});
    return true;
  }catch(e){return false;}
}
function playNotificationSound(force=false){
  const prefs=getNotificationPrefs(),mode=prefs.mode;
  if(!force&&mode!=='sound'&&mode!=='sound_voice')return;
  try{
    if(!unlockNotificationAudio())return;
    const ctx=notificationAudioCtx,t=ctx.currentTime;
    const patterns={
      suave:[[520,0,.12],[740,.15,.14],[880,.30,.12]],
      digital:[[620,0,.07],[920,.09,.07],[620,.18,.07],[920,.27,.09]],
      sino:[[660,0,.18],[880,.18,.24],[660,.48,.18]]
    };
    (patterns[prefs.sound]||patterns.suave).forEach(([freq,d,dur])=>{
      const o=ctx.createOscillator(),g=ctx.createGain();
      o.type=prefs.sound==='digital'?'square':'sine';
      o.frequency.setValueAtTime(freq,t+d);
      g.gain.setValueAtTime(.0001,t+d);
      g.gain.exponentialRampToValueAtTime(prefs.sound==='digital'?.045:.09,t+d+.012);
      g.gain.exponentialRampToValueAtTime(.0001,t+d+dur);
      o.connect(g);g.connect(ctx.destination);o.start(t+d);o.stop(t+d+dur+.01);
    });
  }catch(e){console.warn('Áudio de notificação:',e);}
}
function requestDesktopNotifications(){
  if(!('Notification' in window))return;
  if(Notification.permission==='default')Notification.requestPermission().catch(()=>{});
}
async function showDesktopNotification(title,body,tag='rafahstudio'){
  if(!('Notification' in window)||Notification.permission!=='granted')return;
  try{
    if('serviceWorker' in navigator){
      const reg=await navigator.serviceWorker.ready;
      await reg.showNotification(title,{body,icon:'assets/icon-192.png',badge:'assets/icon-192.png',tag,renotify:true,data:{url:location.href.split('#')[0]}});
      return;
    }
    const n=new Notification(title,{body,icon:'assets/icon-192.png',tag});
    n.onclick=()=>{window.focus();n.close();go('pedidos');};
  }catch(e){console.warn('Notificação do sistema:',e);}
}
function speakNotification(text){const mode=getNotificationPrefs().mode;if((mode!=='voice'&&mode!=='sound_voice')||!('speechSynthesis'in window))return;try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='pt-BR';u.rate=.96;u.pitch=1;u.volume=.85;speechSynthesis.speak(u);}catch(e){}}
function showNotificationPopup(title,body){document.querySelectorAll('.rs-notification-popup').forEach(x=>x.remove());const el=document.createElement('div');el.className='rs-notification-popup';el.innerHTML='<div class="rs-popup-icon">✓</div><div class="rs-popup-body"><b></b><span></span></div><button type="button" aria-label="Fechar">×</button>';el.querySelector('b').textContent=title;el.querySelector('span').textContent=body;el.querySelector('button').onclick=()=>el.remove();document.body.appendChild(el);setTimeout(()=>{if(el.isConnected){el.classList.add('out');setTimeout(()=>el.remove(),260)}},6500);}
function notify(title,body,kind='info',linkPage='pedidos',linkId=null){notifications.unshift({id:uid('ntf'),title,body,kind,created:new Date().toISOString(),read:false,linkPage,linkId});notifications=notifications.slice(0,80);persist();renderNotifications();showNotificationPopup(title,body);playNotificationSound();speakNotification(`${title}. ${body}`);if(['Novo briefing recebido','Alteração solicitada','Arte aprovada'].some(x=>title.includes(x)))showDesktopNotification(title,body,'rafahstudio-'+kind);}
function formatRelative(iso){const diff=Math.max(0,Date.now()-new Date(iso).getTime());const min=Math.floor(diff/60000);if(min<1)return'agora';if(min<60)return`há ${min} min`;const h=Math.floor(min/60);if(h<24)return`há ${h} h`;const d=Math.floor(h/24);return`há ${d} d`;}
function statusClass(s){return ({'Novo':'status-new','Em andamento':'status-doing','Esperando aprovação':'status-wait','Alteração':'status-change','Entregue':'status-done','Pago':'status-paid','Finalizado':'status-finalized'})[s]||'';}
function priorityClass(p){return ({Alta:'priority-high',Urgente:'priority-urgent'})[p]||'';}
function pageMeta(page){return {dashboard:['VISÃO GERAL','Dashboard'],pedidos:['PROJETOS','Pedidos'],clientes:['RELACIONAMENTO','Clientes'],catalogo:['PORTFÓLIO','Catálogo'],orcamentos:['COMERCIAL','Orçamentos'],financeiro:['FINANCEIRO','Financeiro'],perfil:['SUA CONTA','Meu perfil']}[page]||['','RafahStudio'];}
function go(page){ currentPage=page; $$('.page').forEach(p=>p.classList.toggle('active',p.id===page)); $$('.nav-item[data-page]').forEach(n=>n.classList.toggle('active',n.dataset.page===page)); const [ey,t]=pageMeta(page); $('#pageEyebrow').textContent=ey; $('#pageTitle').textContent=t; $('#notificationPanel').classList.remove('open'); $('#sidebar').classList.remove('mobile-open'); render(); window.scrollTo({top:0,behavior:'smooth'}); }

function render(){
  if(!currentUser) return;
  // Renderiza somente a tela visível. Antes, cada alteração reconstruía todas as abas
  // (pedidos, clientes, catálogo, orçamento, financeiro e perfil), o que ficava caro
  // principalmente no celular.
  renderIdentity();
  switch(currentPage){
    case 'pedidos': renderOrders(); break;
    case 'clientes': renderClients(); break;
    case 'catalogo': renderCatalog(); break;
    case 'orcamentos': renderQuotes(); break;
    case 'financeiro': renderFinance(); break;
    case 'perfil': renderProfile(); break;
    case 'dashboard':
    default: renderDashboard(); break;
  }
  requestAnimationFrame(()=>{$$('img', $('#'+currentPage)||document).forEach(img=>{img.loading='lazy';img.decoding='async';});});
}
const renderAll = render;
function renderSoon(){
  if(renderFramePending)return;
  renderFramePending=true;
  const cb=()=>{renderFramePending=false;render();};
  if('requestAnimationFrame' in window)requestAnimationFrame(cb);else setTimeout(cb,0);
}

function renderIdentity(){
 const name=designer.name||currentUser.name||'Designer'; $('#dashName').textContent=name.split(/\s+/)[0]; $('#sideName').textContent=name; $('#sideRole').textContent=designer.area||currentUser.area||'Designer gráfico'; $('#sideUsername').textContent='@'+(currentUser.username||currentUser.user||'usuario'); $('#profileUser').textContent=currentUser.username||currentUser.user||currentUser.email||'—'; $('#todayLabel').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'});
 ['sideAvatar','topAvatar','profileAvatar'].forEach(id=>{const el=$('#'+id); if(!el)return; if(designer.photo){el.innerHTML=`<img src="${designer.photo}" alt="Foto de ${esc(name)}">`}else el.textContent=initials(name);});
}
function renderDashboard(){
 const active=orders.filter(o=>!['Entregue','Pago','Finalizado'].includes(o.status)).length;
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
 const deadlines=[...orders].filter(o=>o.deadline&&!['Entregue','Pago','Finalizado'].includes(o.status)).sort((a,b)=>a.deadline.localeCompare(b.deadline)).slice(0,5);
 $('#deadlines').innerHTML=deadlines.map(o=>`<button class="deadline-row" data-open-order="${o.id}"><div><b>${esc(o.project)}</b><small>${esc(o.client)}</small></div><div class="deadline-row-right">${deadlineTag(o.deadline)}<strong class="deadline ${new Date(o.deadline+'T23:59:59')<new Date()?'overdue':''}">${dateLabel(o.deadline)}</strong></div></button>`).join('')||`<div class="empty-mini"><span>✓</span><div><b>Sem prazos próximos.</b><small>Você está tranquilo por enquanto.</small></div></div>`;
}

function filteredOrders(){
 let q=($('#orderSearch')?.value||'').toLowerCase().trim(); let list=orderFilter==='all'?[...orders]:orders.filter(o=>o.status===orderFilter);
 if(q) list=list.filter(o=>`${o.project} ${o.client} ${o.type}`.toLowerCase().includes(q));
 const sort=$('#orderSort')?.value||'recent'; list.sort((a,b)=>sort==='deadline'?(a.deadline||'9999').localeCompare(b.deadline||'9999'):sort==='value'?b.value-a.value:sort==='oldest'?a.created.localeCompare(b.created):b.created.localeCompare(a.created)); return list;
}
function renderOrders(){
 const counts={all:orders.length,Novo:0,'Em andamento':0,'Esperando aprovação':0,'Alteração':0,Entregue:0,Pago:0,Finalizado:0};
 orders.forEach(o=>counts[o.status]=(counts[o.status]||0)+1);
 $('#countAll').textContent=counts.all; $('#countNovo').textContent=counts.Novo; $('#countDoing').textContent=counts['Em andamento']; $('#countApproval').textContent=counts['Esperando aprovação']; $('#countChange').textContent=counts['Alteração']; $('#countDelivered').textContent=counts.Entregue; $('#countPaid').textContent=counts.Pago; $('#countFinalized').textContent=counts.Finalizado;
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
     <article class="order-card" draggable="true" data-order-card="${o.id}" data-drag-order="${o.id}" title="Segure e arraste para mover este pedido">
       <div class="order-card-head">
         <div class="project-cell">
           <span class="project-mark">${esc(initials(o.project))}</span>
           <div><b>${esc(o.project)}</b><small>${esc(o.client)}</small></div>
         </div>
         <span class="drag-handle" title="Arraste para mover">⋮⋮</span><button class="icon-action" title="Abrir pedido" data-open-order="${o.id}">↗</button>
       </div>
       <div class="order-card-meta">
         <span>${esc(o.type)}</span>
         <span>${dateLabel(o.deadline)}</span>
         <strong>${money(o.value)}</strong>
       </div>
       <div class="order-card-tags">${deadlineTag(o.deadline)}${o.trackingToken?'<span class="tracking-mini">↗ Acompanhamento</span>':''}</div>
       ${o.priority!=='Normal'?`<small class="priority ${priorityClass(o.priority)}">${esc(o.priority)}</small>`:''}
       ${o.origin==='Briefing online'?`<span class="online-badge">Briefing online</span>`:''}
       ${(o.readyArt?.url||o.readyArt?.dataUrl)?`<div class="order-card-art"><img src="${esc(o.readyArt.url||o.readyArt.dataUrl)}" alt="Arte pronta"><span>Arte pronta</span></div>`:''}
       ${Array.isArray(o.people)&&o.people.length?`<div class="order-card-people">👤 ${o.people.length} pessoa(s)</div>`:''}
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
let catalogRemoteFingerprint='';
async function refreshCatalogFromSupabase(){
  if(!supabaseClient||!currentUser||document.hidden)return;
  try{
    const {data,error}=await supabaseClient.rpc('get_catalog_for_owner',{p_owner_secret:getOwnerToken()});
    if(!error&&Array.isArray(data)){
      const next=data.map(x=>({...x,created:x.created_at||x.created||todayISO()}));
      const fp=JSON.stringify(next.map(x=>[x.id,x.updated_at||x.created_at||x.created,x.image_url]));
      if(fp===catalogRemoteFingerprint)return;
      catalogRemoteFingerprint=fp;
      catalog=next;persist();if(currentPage==='catalogo')renderCatalog();
    }
  }catch(e){console.warn('Catálogo online:',e);}
}
function renderCatalog(){const q=($('#catalogSearch')?.value||'').toLowerCase().trim();const list=catalog.filter(x=>`${x.title||''} ${x.description||''}`.toLowerCase().includes(q));$('#catalogGrid')?.replaceChildren(...[]);const el=$('#catalogGrid');if(!el)return;el.innerHTML=list.map(x=>`<article class="catalog-card"><div class="catalog-cover">${x.image_url?`<img src="${esc(x.image_url)}" alt="${esc(x.title)}">`:'<span>▧</span>'}</div><div class="catalog-body"><h3>${esc(x.title)}</h3><p>${esc(x.description||'Referência do portfólio')}</p><div class="catalog-actions"><button class="btn secondary small" data-edit-catalog="${x.id}">Editar</button><button class="btn secondary small" data-delete-catalog="${x.id}">Remover</button></div></div></article>`).join('')||`<div class="empty-state"><span>▧</span><h3>Seu catálogo está vazio</h3><p>Adicione uma arte aprovada e paga para disponibilizá-la como referência.</p></div>`;}
async function uploadCatalogImage(file){if(!supabaseClient)throw new Error('Supabase não está disponível.');const safe=(file.name||'catalogo').replace(/[^a-zA-Z0-9._-]/g,'_');const path=`catalog/${getOwnerToken()}/${Date.now()}-${safe}`;const {error}=await supabaseClient.storage.from('briefing-files').upload(path,file,{upsert:false,contentType:file.type||'image/jpeg'});if(error)throw error;return supabaseClient.storage.from('briefing-files').getPublicUrl(path).data.publicUrl;}
function openCatalogForm(item=null,order=null){const x=item||{title:order?.project||'',description:order?`Referência de ${order.type||'projeto'}`:'',image_url:''};modal(`<div class="modal-head"><div><span class="eyebrow">CATÁLOGO</span><h2>${item?'Editar item':'Adicionar ao catálogo'}</h2></div><button class="close-modal" data-close-modal>×</button></div><form id="catalogForm"><label>Nome da arte<input id="catalogTitle" value="${esc(x.title)}" required></label><label>Descrição curta<textarea id="catalogDescription" rows="3">${esc(x.description||'')}</textarea></label><label class="upload-zone"><input id="catalogImage" type="file" accept="image/*"><span class="upload-icon">↑</span><b>Selecionar imagem da arte</b><small>Use uma imagem final, de preferência em boa resolução.</small></label><div id="catalogImagePreview" class="catalog-modal-preview">${x.image_url?`<img src="${esc(x.image_url)}" alt="Prévia">`:''}</div><div class="modal-actions"><button type="button" class="btn secondary" data-close-modal>Cancelar</button><button class="btn primary" type="submit">Salvar no catálogo</button></div></form>`);let selected=null;$('#catalogImage').onchange=e=>{selected=e.target.files[0]||null;if(selected){const r=new FileReader();r.onload=()=>$('#catalogImagePreview').innerHTML=`<img src="${r.result}" alt="Prévia">`;r.readAsDataURL(selected);}};$('#catalogForm').onsubmit=async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;btn.textContent='Salvando…';try{let url=x.image_url||'';if(selected)url=await uploadCatalogImage(selected);if(!url)throw new Error('Escolha uma imagem para o item do catálogo.');const title=$('#catalogTitle').value.trim();const description=$('#catalogDescription').value.trim();if(!title)throw new Error('Informe o nome da arte.');if(item){const {error}=await supabaseClient.rpc('update_catalog_item',{p_owner_secret:getOwnerToken(),p_id:item.id,p_title:title,p_description:description,p_image_url:url});if(error)throw error;catalog=catalog.map(c=>c.id===item.id?{...c,title,description,image_url:url}:c);}else{const {data,error}=await supabaseClient.rpc('create_catalog_item',{p_owner_secret:getOwnerToken(),p_title:title,p_description:description,p_image_url:url});if(error)throw error;catalog.unshift({id:data,title,description,image_url:url,created:todayISO()});}persist();closeModal();renderCatalog();toast(item?'Item atualizado no catálogo.':'Arte adicionada ao catálogo.');}catch(err){toast(err?.message||'Não foi possível salvar o item.','error');btn.disabled=false;btn.textContent='Salvar no catálogo';}};}
async function deleteCatalogItem(id){const item=catalog.find(x=>x.id===id);if(!item)return;if(!confirm(`Remover “${item.title}” do catálogo?`))return;const {error}=await supabaseClient.rpc('delete_catalog_item',{p_owner_secret:getOwnerToken(),p_id:id});if(error){toast(error.message||'Não foi possível remover.','error');return;}catalog=catalog.filter(x=>x.id!==id);persist();renderCatalog();toast('Item removido do catálogo.','info');}
function renderClients(){
 const q=($('#clientSearch')?.value||'').toLowerCase().trim(); let list=[...clients];
 list=list.filter(c=>`${c.name} ${c.company||''} ${c.whats||''} ${c.email||''}`.toLowerCase().includes(q));
 $('#clientsGrid').innerHTML=list.map(c=>{const s=clientStats(c.name);return `<article class="client-card"><div class="client-top"><div class="avatar avatar-md">${esc(initials(c.name))}</div><span class="client-more"><button class="icon-action" title="Editar" data-edit-client="${c.id}">✎</button><button class="icon-action danger" title="Remover cliente" data-delete-client="${c.id}">×</button></span></div><h3>${esc(c.name)}</h3><p>${esc(c.company||c.email||'Cliente')}</p><div class="client-stats"><div><small>Projetos</small><b>${s.count}</b></div><div><small>Total</small><b>${money(s.total)}</b></div><div><small>Recebido</small><b>${money(s.paid)}</b></div></div><div class="client-actions"><button class="btn secondary" data-view-client="${esc(c.name)}">Ver histórico</button>${c.whats?`<button class="icon-action" data-whatsapp="${esc(c.whats)}" title="WhatsApp">◔</button>`:''}</div></article>`}).join('')||`<div class="empty-state"><span>♙</span><h3>Nenhum cliente encontrado</h3><p>Cadastre seu primeiro cliente para começar.</p><button class="btn primary" data-action="new-client">+ Novo cliente</button></div>`;
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
 $('#notificationsList').innerHTML=notifications.length?notifications.slice(0,30).map(n=>`<div class="notification-row ${n.read?'read':''}" data-notification="${esc(n.id)}"><button class="notification-main" type="button" data-open-notification="${esc(n.id)}"><span class="notif-dot ${n.kind}">${n.kind==='success'?'✓':n.kind==='warning'?'!':'i'}</span><span><b>${esc(n.title)}</b><small>${esc(n.body)}</small><time>${formatRelative(n.created)}</time></span></button><button class="notification-delete" type="button" data-delete-notification="${esc(n.id)}" title="Excluir">×</button></div>`).join(''):`<div class="empty-mini center"><span>✓</span><div><b>Nenhuma notificação</b><small>Quando algo importante acontecer, aparecerá aqui.</small></div></div>`;
}
function renderProfile(){ $('#dName').value=designer.name||'';$('#dBrand').value=designer.brand||'';$('#dWhats').value=designer.whats||'';$('#dEmail').value=designer.email||'';$('#dInsta').value=designer.insta||'';$('#dPortfolio').value=designer.portfolio||'';$('#dArea').value=designer.area||'';$('#dBio').value=designer.bio||''; const cover=$('#profileCover'); if(cover){cover.style.backgroundImage=designer.banner?`url(\"${designer.banner}\")`:'';cover.classList.toggle('has-image',!!designer.banner);} }

function showAuth(mode='login'){ $('#authScreen').classList.remove('hidden'); $('#app').classList.add('hidden'); $('#publicPage').classList.add('hidden'); $('#loginForm').classList.toggle('hidden',mode!=='login'); $('#registerForm').classList.toggle('hidden',mode!=='register'); $('#authEyebrow').textContent=mode==='login'?'ACESSAR CONTA':'COMEÇAR AGORA'; $('#authTitle').textContent=mode==='login'?'Bem-vindo de volta':'Crie seu workspace'; $('#authSubtitle').textContent=mode==='login'?'Entre com seu e-mail e senha.':'Sua conta fica salva no servidor e pode ser acessada de outro dispositivo.'; if(mode==='login')setTimeout(()=>$('#loginUser')?.focus(),80); }
async function login(email,pass){
  if(!supabaseClient) initSupabaseClient();
  if(!supabaseClient){toast('Não foi possível conectar ao serviço de contas.','error');return;}
  if(!email||!pass){toast('Informe e-mail e senha.','error');return;}
  try{
    const {data,error}=await supabaseClient.auth.signInWithPassword({email:email.trim().toLowerCase(),password:pass});
    if(error) throw error;
    await establishAuthenticatedUser(data.user);
      showApp();startLiveSync();toast('Bem-vindo de volta.');
  }catch(err){console.error(err);toast(err?.message||'E-mail ou senha inválidos.','error');}
}
async function register(){
  const name=$('#regName').value.trim(),email=$('#regEmail').value.trim().toLowerCase(),user=$('#regUser').value.trim(),pass=$('#regPass').value,whats=$('#regWhats').value.trim(),area=$('#regArea').value;
  if(!name||!email||!user||!pass){toast('Preencha nome, e-mail, usuário e senha.','error');return;}
  if(pass.length<6){toast('A senha precisa ter pelo menos 6 caracteres.','error');return;}
  if(!supabaseClient) initSupabaseClient();
  if(!supabaseClient){toast('Não foi possível conectar ao serviço de contas.','error');return;}
  try{
    const {data,error}=await supabaseClient.auth.signUp({email,password:pass,options:{data:{name,username:user,whatsapp:whats,area}}});
    if(error) throw error;
    if(!data.user) throw new Error('Não foi possível criar a conta.');
    if(!data.session){toast('Conta criada. Confirme o e-mail para liberar o primeiro acesso.','info');showAuth('login');return;}
    await establishAuthenticatedUser(data.user,{name,username:user,whatsapp:whats,area});
    showApp();startLiveSync();toast('Conta criada com sucesso.');
  }catch(err){console.error(err);toast(err?.message||'Não foi possível criar a conta.','error');}
}
async function establishAuthenticatedUser(user,override={}){
  const meta=user?.user_metadata||{};
  currentUser={id:user.id,email:user.email,name:override.name||meta.name||user.email,username:override.username||meta.username||user.email,area:override.area||meta.area||'Designer gráfico',whats:override.whatsapp||meta.whatsapp||''};
  write(KEYS.user,currentUser);
  loadScoped();

  // A autenticação e o perfil remoto são a fonte oficial da conta.
  // O navegador guarda apenas um cache por UUID para acelerar a interface.
  const loaded=await loadRemoteProfile();
  if(!loaded){
    designer={...DEFAULT_DESIGNER,name:currentUser.name,whats:currentUser.whats,area:currentUser.area,email:currentUser.email};
    await saveRemoteProfile();
  }
  workspaceRemoteReady=false;
  await loadRemoteWorkspace();
  workspaceRemoteReady=true;
  persist();
}
async function logout(){
  try{if(supabaseClient)await supabaseClient.auth.signOut();}catch(e){console.warn(e);}
  currentUser=null;localStorage.removeItem(KEYS.user);showAuth('login');toast('Você saiu da conta.','info');
}

async function saveRemoteProfile(){
  if(!supabaseClient||!currentUser?.id)return false;
  try{
    const {error}=await supabaseClient.from('rafah_profiles').upsert({
      id:currentUser.id,
      username:currentUser.username||'',
      name:designer.name||currentUser.name||'',
      brand:designer.brand||'RafahStudio',
      whatsapp:designer.whats||currentUser.whats||'',
      email:designer.email||currentUser.email||'',
      instagram:designer.insta||'',
      portfolio:designer.portfolio||'',
      area:designer.area||'Designer gráfico',
      bio:designer.bio||'',
      photo:designer.photo||'',
      banner:designer.banner||''
    },{onConflict:'id'});
    if(error)throw error;
    return true;
  }catch(e){console.warn('[RafahStudio] Perfil remoto:',e);return false;}
}
async function loadRemoteProfile(){
  if(!supabaseClient||!currentUser?.id)return false;
  try{
    const {data,error}=await supabaseClient.from('rafah_profiles').select('*').eq('id',currentUser.id).maybeSingle();
    if(error)throw error;
    if(!data)return false;
    designer={...DEFAULT_DESIGNER,...designer,...{
      name:data.name||designer.name||currentUser.name,
      brand:data.brand||designer.brand,
      whats:data.whatsapp||designer.whats||currentUser.whats,
      email:data.email||designer.email||currentUser.email,
      insta:data.instagram||designer.insta,
      portfolio:data.portfolio||designer.portfolio,
      area:data.area||designer.area||currentUser.area,
      bio:data.bio||designer.bio,
      photo:data.photo||designer.photo,
      banner:data.banner||designer.banner
    }};
    persist();
    return true;
  }catch(e){console.warn('[RafahStudio] Não foi possível carregar o perfil remoto:',e);return false;}
}
function showApp(){ $('#authScreen').classList.add('hidden');$('#publicPage').classList.add('hidden');$('#app').classList.remove('hidden');go('dashboard');render(); }

function openOrder(order=null){
  editingOrderId=order?.id||null;
  const o=order||{client:'',project:'',deadline:'',value:0,type:'Cartaz',status:'Novo',priority:'Normal',briefing:{},files:[],people:[],readyArt:null};
  const people=Array.isArray(o.people)?JSON.parse(JSON.stringify(o.people)):[];
  let readyArt=o.readyArt||null;
  modal(`<div class="modal-head"><div><span class="eyebrow">${editingOrderId?'EDITAR PEDIDO':'NOVO PEDIDO'}</span><h2>${editingOrderId?'Editar projeto':'Criar novo projeto'}</h2><p class="muted">Organize o projeto completo, incluindo pessoas, referências e arte final.</p></div><button class="close-modal" data-close-modal>×</button></div>
  <form id="orderForm">
    <div class="two-col"><label>Cliente<input id="orderClient" value="${esc(o.client)}" required></label><label>Projeto<input id="orderProject" value="${esc(o.project)}" required></label></div>
    <div class="two-col"><label>Prazo<input id="orderDeadline" type="date" value="${esc(o.deadline)}"></label><label>Valor do serviço<input id="orderValue" type="number" min="0" step="0.01" value="${Number(o.value)||0}" placeholder="0,00"></label></div>
    <div class="two-col"><label>Serviço<select id="orderType">${['Cartaz','Cartaz para igreja/evento','Post para Instagram','Identidade visual','Logo','Social Media','Outro'].map(x=>`<option ${x===o.type?'selected':''}>${x}</option>`).join('')}</select></label><label>Status<select id="orderStatus">${STATUS.map(x=>`<option ${x===o.status?'selected':''}>${x}</option>`).join('')}</select></label></div>
    <label>Prioridade<select id="orderPriority"><option ${o.priority==='Normal'?'selected':''}>Normal</option><option ${o.priority==='Alta'?'selected':''}>Alta</option><option ${o.priority==='Urgente'?'selected':''}>Urgente</option></select></label>
    <label>Observações / briefing interno<textarea id="orderNotes" rows="5">${esc(typeof o.briefing==='string' ? o.briefing : (o.briefing?.notes||o.briefing?.texts||''))}</textarea></label>
    <div class="order-editor-section"><div class="order-editor-head"><div><b>Pessoas da arte</b><small>Adicione nomes e fotos que precisam aparecer no projeto.</small></div><button type="button" class="btn secondary small" id="manualAddPerson">+ Pessoa</button></div><div id="manualPeopleList" class="manual-people-list"></div></div>
    <div class="order-editor-section"><div class="order-editor-head"><div><b>Arte pronta / arquivo final</b><small>Você pode anexar a arte pronta para visualizar no pedido e depois colocar no catálogo.</small></div></div><label class="upload-zone"><input id="manualReadyArt" type="file" accept="image/*,.pdf"><span class="upload-icon">↑</span><b>Adicionar arte pronta</b><small>${readyArt?.name?`Atual: ${esc(readyArt.name)}`:'Imagem ou PDF da arte final'}</small></label><div id="manualReadyPreview" class="ready-art-preview">${readyArt?.url||readyArt?.dataUrl?`<img src="${esc(readyArt.url||readyArt.dataUrl)}" alt="Arte pronta">`:''}</div></div>
    <div class="modal-actions"><button type="button" class="btn secondary" data-close-modal>Cancelar</button><button class="btn primary" type="submit">Salvar pedido</button></div>
  </form>`);
  const paint=()=>{$('#manualPeopleList').innerHTML=people.map((p,i)=>{const photoSrc=p.photo?.previewUrl||p.photo?.dataUrl||p.photo?.url||'';return `<div class="manual-person-row"><span class="person-num">${i+1}</span>${photoSrc?`<img class="manual-person-preview" src="${esc(photoSrc)}" alt="Foto de ${esc(p.name||`Pessoa ${i+1}`)}">`:`<span class="manual-person-preview empty">👤</span>`}<input data-mp-name="${i}" value="${esc(p.name||'')}" placeholder="Nome da pessoa"><input data-mp-info="${i}" value="${esc(p.info||'')}" placeholder="Função / observação"><label class="mini-upload">Foto<input data-mp-photo="${i}" type="file" accept="image/*"></label><button type="button" class="icon-action danger" data-mp-remove="${i}">×</button></div>`;}).join('')||'<div class="stage-empty">Nenhuma pessoa adicionada.</div>';};
  paint();
  $('#manualAddPerson').onclick=()=>{people.push({name:'',info:'',photo:null});paint();};
  $('#manualPeopleList').oninput=e=>{const i=e.target.dataset.mpName??e.target.dataset.mpInfo;if(i!==undefined){if(e.target.dataset.mpName!==undefined)people[i].name=e.target.value;else people[i].info=e.target.value;}};
  $('#manualPeopleList').onchange=async e=>{const i=e.target.dataset.mpPhoto;if(i!==undefined&&e.target.files[0]){const file=e.target.files[0];const dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});people[i].photo={name:file.name,type:file.type,size:file.size,file,previewUrl:URL.createObjectURL(file)};paint();}};
  $('#manualPeopleList').onclick=e=>{const b=e.target.closest('[data-mp-remove]');if(b){people.splice(Number(b.dataset.mpRemove),1);paint();}};
  $('#manualReadyArt').onchange=e=>{const f=e.target.files[0];if(!f)return;readyArt={name:f.name,type:f.type,size:f.size,file:f};const p=$('#manualReadyPreview');if(f.type.startsWith('image/')){p.innerHTML=`<img loading="lazy" decoding="async" src="${URL.createObjectURL(f)}" alt="Arte pronta">`;}else p.innerHTML=`<div class="file-generic">${esc(f.name)}</div>`;};
  $('#orderForm').onsubmit=async e=>{e.preventDefault();await saveOrder(order,people,readyArt);};
}
async function uploadOrderAsset(file,orderId,label){
  if(!supabaseClient)throw new Error('Supabase não está disponível para enviar arquivos.');
  const safe=(file.name||label).replace(/[^a-zA-Z0-9._-]/g,'_');
  const path=`orders/${getOwnerToken()}/${orderId}/${Date.now()}-${label}-${safe}`;
  const {error}=await supabaseClient.storage.from('briefing-files').upload(path,file,{upsert:false,contentType:file.type||'application/octet-stream'});
  if(error)throw error;
  return {name:file.name,type:file.type,size:file.size,path,url:supabaseClient.storage.from('briefing-files').getPublicUrl(path).data.publicUrl};
}
async function saveOrder(existing,peopleDraft=[],readyArtDraft=null){
  const was=existing?.status;
  const data={client:$('#orderClient').value.trim(),project:$('#orderProject').value.trim(),deadline:$('#orderDeadline').value,value:Number($('#orderValue').value)||0,type:$('#orderType').value,status:$('#orderStatus').value,priority:$('#orderPriority').value,briefing:{...(existing?.briefing||{}),notes:$('#orderNotes').value},files:existing?.files||[],people:existing?.people||[],readyArt:existing?.readyArt||null,origin:existing?.origin||'Manual',paid:existing?.paid||false,trackingToken:existing?.trackingToken||''};
  if(!data.client||!data.project){toast('Cliente e projeto são obrigatórios.','error');return;}
  const btn=$('#orderForm button[type="submit"]');if(btn){btn.disabled=true;btn.textContent='Salvando…';}
  try{
    const orderId=existing?.id||uid('ord');
    const hasUploads=peopleDraft.some(p=>p.photo?.file)||(readyArtDraft?.file);
    if(hasUploads)showUploadProgress('Atualizando pedido…','Enviando pessoas e arte pronta.');
    data.people=[];
    for(let i=0;i<peopleDraft.length;i++){
      const p={name:String(peopleDraft[i].name||'').trim(),info:String(peopleDraft[i].info||'').trim(),photo:null};
      if(peopleDraft[i].photo?.file)p.photo=await uploadOrderAsset(peopleDraft[i].photo.file,orderId,`person-${i}`);
      else if(peopleDraft[i].photo?.url||peopleDraft[i].photo?.dataUrl)p.photo=peopleDraft[i].photo;
      data.people.push(p);
    }
    if(readyArtDraft?.file)data.readyArt=await uploadOrderAsset(readyArtDraft.file,orderId,'arte-final');
    else if(readyArtDraft)data.readyArt=readyArtDraft;
    if(hasUploads)updateUploadProgress(92,'Salvando o pedido…');
    if(existing){
      Object.assign(existing,data);
      if(existing.status==='Pago'||existing.status==='Finalizado')existing.paid=true;
      if(was!==existing.status)addHistory(existing,`Status alterado de ${was} para ${existing.status}`);
    }else{
      const o={id:orderId,...data,created:todayISO(),history:[]};
      addHistory(o,'Pedido criado');
      orders.unshift(o);
      notify('Novo pedido criado',`${data.project} • ${data.client}`,'success','pedidos',o.id);
    }
    if(data.client&&!clients.some(c=>String(c.name||'').trim().toLowerCase()===data.client.toLowerCase())){
      clients.unshift({id:uid('cli'),name:data.client,company:'',whats:'',email:'',instagram:'',notes:'Cliente cadastrado pelo pedido',created:todayISO(),origin:'Manual'});
    }
    persist();closeModal();render();go('pedidos');if(hasUploads)hideUploadProgress(true);syncOrderTracking(existing||orders[0]);toast(existing?'Pedido atualizado.':'Pedido criado.');
  }catch(err){if(hasUploads)hideUploadProgress(false);console.error('[RafahStudio] Falha ao salvar pedido:',err);toast(err?.message||'Não foi possível salvar o pedido. Tente novamente.','error');}
  finally{if(btn){btn.disabled=false;btn.textContent='Salvar pedido';}}
}
function addHistory(o,text){o.history=o.history||[];o.history.unshift({id:uid('hist'),at:new Date().toISOString(),text});}
function openOrderView(id){const o=orders.find(x=>x.id===id);if(!o)return; const b=o.briefing||{}; modal(`<div class="modal-head"><div><span class="eyebrow">DETALHES DO PEDIDO</span><h2>${esc(o.project)}</h2><p class="muted">${esc(o.client)} • ${esc(o.type)}</p></div><button class="close-modal" data-close-modal>×</button></div><div class="detail-top"><span class="status-pill ${statusClass(o.status)}">${esc(o.status)}</span><div class="detail-actions"><button class="btn secondary" data-share-tracking="${o.id}">↗ Acompanhar pedido</button><button class="btn secondary" data-edit-order="${o.id}">Editar pedido</button><button class="btn secondary" data-edit-order-client="${o.id}">Editar cliente</button><button class="btn secondary" data-order-pdf="${o.id}">PDF</button>${(o.paid||o.status==='Pago'||o.status==='Finalizado')?`<button class="btn secondary" data-add-catalog-order="${o.id}">▧ Catálogo</button>`:''}<button class="btn primary" data-cycle-status="${o.id}">Avançar status</button></div></div><div class="status-flow">${STATUS.map((s,i)=>`<span class="flow-step ${STATUS.indexOf(o.status)>=i?'done':''}"><i>${STATUS.indexOf(o.status)>=i?'✓':i+1}</i>${s}</span>`).join('')}</div><div class="detail-deadline-banner">${deadlineTag(o.deadline)}<span>Prazo: <b>${dateLabel(o.deadline)}</b></span></div><div class="detail-grid"><div class="detail-card"><b>Resumo</b><dl><div><dt>Cliente</dt><dd>${esc(o.client)}</dd></div><div><dt>Prazo</dt><dd>${dateLabel(o.deadline)}</dd></div><div><dt>Valor</dt><dd>${money(o.value)}</dd></div><div><dt>Pagamento</dt><dd>${o.paid||o.status==='Pago'?'Pago':'Pendente'}</dd></div></dl></div><div class="detail-card"><b>Briefing</b><p class="detail-text">${esc(b.texts||b.notes||'Nenhuma informação adicional registrada.')}</p>${b.refs?`<div class="ref-box"><b>Referências</b><p>${esc(b.refs)}</p></div>`:''}</div></div><div class="detail-card full-detail"><div class="detail-card-head"><b>Arquivos enviados pelo cliente</b><small>${(o.files||[]).length} arquivo(s)</small></div><div id="orderFiles" class="file-gallery">${renderFileGallery(o)}</div></div><div class="detail-card full-detail"><div class="detail-card-head"><b>Pessoas e fotos para a arte</b><small>${(Array.isArray(b.people)?b.people.length:0)+(Array.isArray(o.people)?o.people.length:0)} pessoa(s)</small></div><div class="file-gallery">${renderPeopleGallery(o)}</div></div>
<div class="detail-card full-detail"><div class="detail-card-head"><b>Arte pronta / final</b><small>${o.readyArt?.name?'Arquivo anexado':'Ainda não anexada'}</small></div>${o.readyArt?.url||o.readyArt?.dataUrl?`<div class="ready-art-detail"><img src="${esc(o.readyArt.url||o.readyArt.dataUrl)}" alt="Arte final"><a class="btn secondary small" href="${esc(o.readyArt.url||o.readyArt.dataUrl)}" target="_blank" rel="noopener">Abrir arte original</a></div>`:`<div class="empty-mini center"><span>▧</span><div><b>Nenhuma arte pronta.</b><small>Edite o pedido para adicionar a arte final.</small></div></div>`}</div><div class="detail-card full-detail client-tracking-admin"><div class="detail-card-head"><div><b>Acompanhamento do cliente</b><small>Envie versões da arte e receba aprovações ou pedidos de alteração.</small></div><button class="btn primary small" data-send-tracking-art="${o.id}">+ Enviar arte para aprovação</button></div><div class="designer-track-events">${renderDesignerTrackingEvents(o)}</div></div><div class="detail-card full-detail"><div class="detail-card-head"><b>Histórico</b><small>Atividades do pedido</small></div><div class="history">${(o.history||[]).map(h=>`<div><span></span><p><b>${esc(h.text)}</b><small>${new Date(h.at).toLocaleString('pt-BR')}</small></p></div>`).join('')||'<p class="muted">Sem histórico.</p>'}</div></div><div class="modal-actions"><button class="btn danger-btn" data-delete-order="${o.id}">Excluir pedido</button><button class="btn secondary" data-toggle-paid="${o.id}">${o.paid?'Marcar como pendente':'Marcar como pago'}</button></div>`); }
function renderFileGallery(o){
  if(!o.files?.length)return`<div class="empty-mini center"><span>↑</span><div><b>Nenhum arquivo anexado.</b><small>Arquivos enviados pelo cliente aparecerão aqui.</small></div></div>`;
  return o.files.map((f,i)=>{
    const src=f.dataUrl||f.url||'';
    const isImage=f.type?.startsWith('image/');
    return `<div class="file-tile">${isImage&&src?`<img src="${esc(src)}" alt="${esc(f.name)}" data-preview-file="${o.id}:${i}" onerror="this.style.display='none'">`:`<div class="file-generic">${esc((f.type||'arquivo').split('/').pop()?.toUpperCase()||'ARQUIVO')}</div>`}<div><b title="${esc(f.name)}">${esc(f.name)}</b><small>${formatBytes(f.size||0)}</small></div><button class="btn secondary small" data-download-file="${o.id}:${i}">↓ Abrir original</button></div>`;
  }).join('');
}
function renderPeopleGallery(o){
  const remote=Array.isArray(o.briefing?.people)?o.briefing.people:[];
  const manual=Array.isArray(o.people)?o.people:[];
  const people=[...remote,...manual];
  const withPhotos=people.map((p,i)=>({p,i,photo:p?.photo})).filter(x=>x.photo?.url||x.photo?.dataUrl||x.photo?.previewUrl);
  if(!withPhotos.length)return`<div class="empty-mini center"><span>👤</span><div><b>Nenhuma foto de pessoa enviada.</b><small>As fotos adicionadas pelo cliente ou pelo designer aparecerão aqui.</small></div></div>`;
  return withPhotos.map(({p,i,photo})=>{const src=photo.url||photo.previewUrl||photo.dataUrl;return `<div class="file-tile"><img src="${esc(src)}" alt="${esc(p.name||`Pessoa ${i+1}`)}"><div><b>${esc(p.name||`Pessoa ${i+1}`)}</b><small>${esc(p.info||'Foto para a arte')}</small></div><a class="btn secondary small" href="${esc(src)}" target="_blank" rel="noopener">Abrir original</a></div>`;}).join('');
}
function formatBytes(n){if(!n)return'arquivo';const u=['B','KB','MB','GB'];let i=0,x=n;while(x>=1024&&i<u.length-1){x/=1024;i++;}return`${x.toFixed(i?1:0)} ${u[i]}`;}
function cycleStatus(id){const o=orders.find(x=>x.id===id);if(!o)return;const i=STATUS.indexOf(o.status);const next=STATUS[Math.min(i+1,STATUS.length-1)];if(next===o.status){toast('O pedido já está no status final.','info');return;}const old=o.status;o.status=next;if(next==='Pago'||next==='Finalizado')o.paid=true;addHistory(o,`Status alterado de ${old} para ${next}`);persist();render();closeModal();syncOrderTracking(o);notify(`Status atualizado: ${next}`,`${o.project} • ${o.client}`,'info','pedidos',o.id);toast(`Pedido movido para ${next}.`);}
function togglePaid(id){const o=orders.find(x=>x.id===id);if(!o)return;o.paid=!o.paid;if(o.paid){o.status='Pago';addHistory(o,'Pagamento recebido');notify('Pagamento recebido',`${o.project} • ${money(o.value)}`,'success','pedidos',o.id);}else{if(o.status==='Pago'||o.status==='Finalizado')o.status='Entregue';addHistory(o,'Pagamento marcado como pendente');}persist();render();syncOrderTracking(o);toast(o.paid?'Pagamento registrado.':'Pagamento desmarcado.');}
function moveStatus(id,direction){
  const o=orders.find(x=>x.id===id); if(!o)return;
  const i=STATUS.indexOf(o.status);
  const nextIndex=Math.max(0,Math.min(STATUS.length-1,i+direction));
  if(nextIndex===i){toast(direction<0?'O pedido já está na primeira etapa.':'O pedido já está na etapa final.','info');return;}
  const old=o.status, next=STATUS[nextIndex];
  o.status=next;
  if(next==='Pago'||next==='Finalizado')o.paid=true;
  if(old==='Pago'&&next!=='Pago'&&next!=='Finalizado')o.paid=false;
  addHistory(o,`Pedido movido de ${old} para ${next}`);
  persist(); render(); syncOrderTracking(o);
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
  if(o.origin==='Briefing online'){
    const fp=orderFingerprint(o);
    if(fp && !deletedRemoteFingerprints.includes(fp))deletedRemoteFingerprints.push(fp);
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
  if(o.origin==='Briefing online'){const fp=orderFingerprint(o);deletedRemoteFingerprints=deletedRemoteFingerprints.filter(x=>x!==fp);}
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
  if(o.origin==='Briefing online'){const fp=orderFingerprint(o);if(fp&&!deletedRemoteFingerprints.includes(fp))deletedRemoteFingerprints.push(fp);}
  trash.splice(idx,1);
  persist(); render(); openTrash();
  toast('Pedido excluído permanentemente.','info');
}

async function shareOrderTracking(id){
  const o=orders.find(x=>x.id===id);if(!o)return;
  const btn=document.querySelector(`[data-share-tracking="${CSS.escape(String(id))}"]`);
  if(btn){btn.disabled=true;btn.textContent='Gerando…';}
  try{
    const url=await syncOrderTracking(o);
    if(!url)throw new Error('Não foi possível criar o acompanhamento.');
    copyText(url);
    modal(`<div class="modal-head"><div><span class="eyebrow">ACOMPANHAMENTO</span><h2>Link pronto para ${esc(o.client)}</h2><p class="muted">Envie este link. O cliente verá somente este pedido.</p></div><button class="close-modal" data-close-modal>×</button></div><div class="tracking-share"><div class="tracking-share-icon">✓</div><b>${esc(o.project)}</b><span>O link já foi copiado para a área de transferência.</span><code>${esc(url)}</code><div class="tracking-share-note">O cliente verá o andamento, prazo e histórico de etapas, sem acessar seu painel.</div></div><div class="modal-actions"><button class="btn secondary" data-close-modal>Fechar</button><button class="btn primary" data-copy-text="${esc(url)}">Copiar novamente</button></div>`);
  }catch(e){toast(e?.message||'Não foi possível gerar o link.','error');}
  finally{if(btn){btn.disabled=false;btn.textContent='↗ Acompanhar pedido';}}
}
function openClientForm(client=null){editingClientId=client?.id||null;const c=client||{name:'',company:'',whats:'',email:'',instagram:'',notes:''};const oldName=c.name||'';modal(`<div class="modal-head"><div><span class="eyebrow">CLIENTE</span><h2>${editingClientId?'Editar cliente':'Novo cliente'}</h2></div><button class="close-modal" data-close-modal>×</button></div><form id="clientForm"><div class="two-col"><label>Nome completo<input id="clientName" value="${esc(c.name)}" required></label><label>Empresa<input id="clientCompany" value="${esc(c.company||'')}"></label></div><div class="two-col"><label>WhatsApp<input id="clientWhats" value="${esc(c.whats||'')}" ></label><label>E-mail<input id="clientEmail" type="email" value="${esc(c.email||'')}" ></label></div><label>Instagram<input id="clientInstagram" value="${esc(c.instagram||'')}"></label><label>Observações<textarea id="clientNotes" rows="4">${esc(c.notes||'')}</textarea></label><div class="modal-actions"><button type="button" class="btn secondary" data-close-modal>Cancelar</button><button class="btn primary" type="submit">Salvar cliente</button></div></form>`);
 $('#clientForm').onsubmit=e=>{e.preventDefault();const data={name:$('#clientName').value.trim(),company:$('#clientCompany').value.trim(),whats:$('#clientWhats').value.trim(),email:$('#clientEmail').value.trim(),instagram:$('#clientInstagram').value.trim(),notes:$('#clientNotes').value.trim()};if(!data.name){toast('Informe o nome do cliente.','error');return;}if(editingClientId){const target=clients.find(x=>x.id===editingClientId);if(target)Object.assign(target,data);if(oldName&&oldName.toLowerCase()!==data.name.toLowerCase()){orders.forEach(o=>{if(String(o.client||'').toLowerCase()===oldName.toLowerCase())o.client=data.name;});}}else clients.unshift({id:uid('cli'),...data,created:todayISO()});persist();closeModal();render();toast(editingClientId?'Cliente atualizado.':'Cliente cadastrado.');}; }
function deleteClient(id){const c=clients.find(x=>x.id===id);if(!c)return;if(!confirm(`Remover o cliente “${c.name}”?\n\nOs pedidos e o histórico não serão apagados.`))return;clients=clients.filter(x=>x.id!==id);persist();closeModal();render();toast('Cliente removido.','info');}
function viewClient(name){const c=clients.find(x=>x.name.toLowerCase()===name.toLowerCase());const os=orders.filter(o=>o.client.toLowerCase()===name.toLowerCase());const s=clientStats(name);modal(`<div class="modal-head"><div><span class="eyebrow">HISTÓRICO DO CLIENTE</span><h2>${esc(name)}</h2></div><button class="close-modal" data-close-modal>×</button></div><div class="client-detail-top"><div class="avatar avatar-xl">${esc(initials(name))}</div><div><b>${esc(c?.company||'Cliente')}</b><small>${esc(c?.whats||'')}${c?.email?` • ${esc(c.email)}`:''}</small></div></div><div class="client-summary"><div><small>Projetos</small><b>${s.count}</b></div><div><small>Total</small><b>${money(s.total)}</b></div><div><small>Recebido</small><b>${money(s.paid)}</b></div><div><small>Pendente</small><b>${money(s.total-s.paid)}</b></div></div><div class="detail-card full-detail"><b>Projetos</b>${os.map(o=>`<button class="history-project" data-open-order="${o.id}"><div><b>${esc(o.project)}</b><small>${dateLabel(o.created)} • ${esc(o.type)}</small></div><span class="status-pill ${statusClass(o.status)}">${esc(o.status)}</span><strong>${money(o.value)}</strong></button>`).join('')||'<p class="muted">Nenhum pedido registrado.</p>'}</div><div class="modal-actions">${c?`<button class="btn secondary" data-edit-client="${c.id}">Editar cliente</button><button class="btn danger-btn" data-delete-client="${c.id}">Remover cliente</button>`:''}${c?.whats?`<button class="btn primary" data-whatsapp="${esc(c.whats)}">Abrir WhatsApp</button>`:''}</div>`);}

function openQuoteForm(q=null){editingQuoteId=q?.id||null;const x=q||{client:'',project:'',valid:'',status:'Rascunho',description:'',items:[{desc:'',qty:1,price:0}],terms:'',discount:0}; modal(`<div class="modal-head"><div><span class="eyebrow">ORÇAMENTO</span><h2>${editingQuoteId?'Editar orçamento':'Novo orçamento'}</h2></div><button class="close-modal" data-close-modal>×</button></div><form id="quoteForm"><div class="two-col"><label>Cliente<input id="quoteClient" value="${esc(x.client)}" required></label><label>Projeto<input id="quoteProject" value="${esc(x.project)}" required></label></div><div class="two-col"><label>Validade<input id="quoteValid" type="date" value="${esc(x.valid)}"></label><label>Status<select id="quoteStatus">${QUOTE_STATUS.map(s=>`<option ${s===x.status?'selected':''}>${s}</option>`).join('')}</select></label></div><label>Descrição curta<input id="quoteDescription" value="${esc(x.description||'')}"></label><div class="items-editor"><div class="section-title"><span>+</span><div><b>Itens do orçamento</b><small>Adicione serviços e valores.</small></div></div><div id="quoteItemsEditor"></div><button type="button" class="btn secondary" id="addQuoteItem">+ Adicionar item</button></div><div class="two-col"><label>Desconto (R$)<input id="quoteDiscount" type="number" min="0" step="0.01" value="${Number(x.discount)||0}"></label><label>Total<input id="quoteTotal" readonly></label></div><label>Condições / observações<textarea id="quoteTerms" rows="4">${esc(x.terms||'')}</textarea></label><div class="modal-actions"><button type="button" class="btn secondary" data-close-modal>Cancelar</button><button class="btn primary" type="submit">Salvar orçamento</button></div></form>`); const editor=$('#quoteItemsEditor');let items=Array.isArray(x.items)&&x.items.length?x.items:[{desc:'',qty:1,price:0}];function paintItems(){editor.innerHTML=items.map((it,i)=>`<div class="quote-item"><input data-item-desc="${i}" placeholder="Descrição" value="${esc(it.desc)}"><input data-item-qty="${i}" type="number" min="1" step="1" value="${it.qty||1}"><input data-item-price="${i}" type="number" min="0" step="0.01" value="${it.price||0}"><button type="button" class="icon-action danger" data-remove-item="${i}">×</button></div>`).join('');recalc();}function recalc(){let subtotal=items.reduce((a,it)=>a+(Number(it.qty)||0)*(Number(it.price)||0),0);let total=Math.max(0,subtotal-(Number($('#quoteDiscount').value)||0));$('#quoteTotal').value=money(total);}editor.addEventListener('input',e=>{const i=e.target.dataset.itemDesc??e.target.dataset.itemQty??e.target.dataset.itemPrice;if(i!==undefined){const n=Number(i);items[n]={...items[n],desc:editor.querySelector(`[data-item-desc="${n}"]`)?.value||'',qty:Number(editor.querySelector(`[data-item-qty="${n}"]`)?.value)||1,price:Number(editor.querySelector(`[data-item-price="${n}"]`)?.value)||0};recalc();}});editor.addEventListener('click',e=>{const b=e.target.closest('[data-remove-item]');if(!b)return;items.splice(Number(b.dataset.removeItem),1);if(!items.length)items.push({desc:'',qty:1,price:0});paintItems();});$('#addQuoteItem').onclick=()=>{items.push({desc:'',qty:1,price:0});paintItems();};$('#quoteDiscount').oninput=recalc;paintItems();$('#quoteForm').onsubmit=e=>{e.preventDefault();const subtotal=items.reduce((a,it)=>a+(Number(it.qty)||0)*(Number(it.price)||0),0),discount=Number($('#quoteDiscount').value)||0,total=Math.max(0,subtotal-discount);const data={client:$('#quoteClient').value.trim(),project:$('#quoteProject').value.trim(),valid:$('#quoteValid').value,status:$('#quoteStatus').value,description:$('#quoteDescription').value.trim(),items,discount,subtotal,total,terms:$('#quoteTerms').value.trim(),updated:todayISO()};if(!data.client||!data.project){toast('Cliente e projeto são obrigatórios.','error');return;}if(editingQuoteId)Object.assign(quotes.find(q=>q.id===editingQuoteId),data);else quotes.unshift({id:uid('quo'),created:todayISO(),...data});persist();closeModal();render();toast(editingQuoteId?'Orçamento atualizado.':'Orçamento criado.');}; }
function deleteQuote(id){const q=quotes.find(x=>x.id===id);if(!q)return;if(!confirm(`Excluir o orçamento “${q.project}”?`))return;quotes=quotes.filter(x=>x.id!==id);persist();render();toast('Orçamento excluído.','info');}
function quoteToOrder(id){const q=quotes.find(x=>x.id===id);if(!q)return;const o={id:uid('ord'),client:q.client,project:q.project,deadline:q.valid,value:q.total,type:'Orçamento convertido',status:'Novo',priority:'Normal',created:todayISO(),paid:false,origin:'Orçamento',briefing:{notes:q.terms},files:[],history:[]};addHistory(o,'Pedido criado a partir do orçamento');orders.unshift(o);q.status='Aprovado';persist();render();closeModal();go('pedidos');syncOrderTracking(o);notify('Orçamento convertido em pedido',`${q.project} • ${q.client}`,'success','pedidos',o.id);toast('Pedido criado a partir do orçamento.');}

async function generateLink(){
  if(!(await ensurePublicLink())) return '';
  const publicToken=getPublicToken();
  await syncPublicProfileLink(publicToken);
  const baseUrl=location.href.split('#')[0];
  const url=`${baseUrl}#briefing=${encodeURIComponent(publicToken)}`;
  $('#briefingLinkBox').classList.remove('hidden');
  $('#briefingLinkBox').innerHTML=
    `<div><b>Seu link de briefing</b><small>Envie este link ao cliente. O formulário não mostra valores.</small><code>${esc(url)}</code></div>`+
    `<button type="button" class="btn primary" data-copy-text="${esc(url)}">Copiar link</button>`;
  return url;
}
async function syncPublicProfileLink(token=getPublicToken()){
  if(!supabaseClient||!currentUser||!token)return false;
  try{
    const {error}=await supabaseClient.rpc('save_public_profile_link',{
      p_public_token:token,
      p_owner_secret:getOwnerToken(),
      p_name:designer.name||'Designer',
      p_whatsapp:designer.whats||'',
      p_instagram:designer.insta||'',
      p_portfolio:designer.portfolio||'',
      p_email:designer.email||'',
      p_banner:designer.banner||''
    });
    if(error)throw error;
    return true;
  }catch(e){console.warn('[RafahStudio] Perfil público:',e);return false;}
}
function copyText(text){navigator.clipboard?.writeText(text).then(()=>toast('Link copiado.')).catch(()=>{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();toast('Link copiado.');});}
function openPublic(){ $('#authScreen').classList.add('hidden');$('#app').classList.add('hidden');$('#publicPage').classList.remove('hidden'); }
function handlePublicHash(){const isBriefing=location.hash.startsWith('#briefing=');const isTracking=location.hash.startsWith('#pedido=');if(!isBriefing&&!isTracking)return false;if(isTracking){$('#authScreen').classList.add('hidden');$('#app').classList.add('hidden');$('#publicPage').classList.add('hidden');$('#trackingPage').classList.remove('hidden');return true;}openPublic();return true;}
async function readFiles(fileList){const arr=[];for(const f of [...fileList]){if(f.size>8*1024*1024){toast(`${f.name} é maior que 8 MB e não foi anexado.`,'error');continue;}arr.push({id:uid('file'),name:f.name,type:f.type,size:f.size,previewUrl:URL.createObjectURL(f),file:f});}return arr;}
let publicProfileCache={};
function publicProfileFromHash(){
  if(publicProfileCache&&Object.keys(publicProfileCache).length)return publicProfileCache;
  try{
    const raw=decodeURIComponent(location.hash.slice('#briefing='.length));
    const decoded=raw.startsWith('{')?raw:decodeURIComponent(escape(atob(raw)));
    const p=JSON.parse(decoded);
    return p.profile||{};
  }catch{return {};}
}
async function fetchPublicProfile(){
  const token=briefingTokenFromHash();
  if(!token||!supabaseClient)return {};
  try{
    const {data,error}=await supabaseClient.rpc('get_public_profile_for_token',{p_public_token:token});
    if(error)throw error;
    publicProfileCache=Array.isArray(data)?(data[0]||{}):(data||{});
  }catch(e){console.warn('Perfil público:',e);}
  return publicProfileCache||{};
}
function socialUrl(kind,value){
  const v=String(value||'').trim();
  if(!v)return '';
  if(/^https?:\/\//i.test(v))return v;
  if(kind==='instagram')return `https://instagram.com/${v.replace(/^@/,'')}`;
  if(kind==='whatsapp'){const n=v.replace(/\D/g,'');return n?`https://wa.me/${n.startsWith('55')?n:'55'+n}`:'';}
  if(kind==='email')return `mailto:${v}`;
  return v.startsWith('www.')?`https://${v}`:`https://${v}`;
}
function socialIcon(kind){
  const common='viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  if(kind==='whatsapp')return `<svg ${common}><path d="M20 11.5a8.5 8.5 0 0 1-12.9 7.3L4 20l1.3-3.1A8.5 8.5 0 1 1 20 11.5Z"/><path d="M8.2 8.1c.3-.4.7-.4 1-.1l1 .9c.3.3.3.6.1.9l-.5.7c.6 1.2 1.5 2 2.7 2.6l.7-.5c.3-.2.7-.2.9.1l.9 1c.3.3.2.8-.1 1-.6.5-1.4.7-2.1.5-3.5-.9-5.7-3.2-6.7-6.7-.2-.8 0-1.6.5-2.1Z"/></svg>`;
  if(kind==='instagram')return `<svg ${common}><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.7" r=".7" fill="currentColor" stroke="none"/></svg>`;
  if(kind==='portfolio')return `<svg ${common}><path d="M4 5.5h16v13H4z"/><path d="M8 5.5V4h8v1.5M8 12h8M8 15h5"/></svg>`;
  return `<svg ${common}><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4.5 6.5 7.5 6 7.5-6"/></svg>`;
}
function renderPublicSocials(profile=publicProfileFromHash()){
  const p=profile||{};
  const dock=$('#publicSocialDock');
  const success=$('#successSocials');
  const items=[
    {key:'whatsapp',label:'WhatsApp',icon:socialIcon('whatsapp'),value:p.whatsapp||p.whats,href:socialUrl('whatsapp',p.whatsapp||p.whats)},
    {key:'instagram',label:'Instagram',icon:socialIcon('instagram'),value:p.instagram||p.insta,href:socialUrl('instagram',p.instagram||p.insta)},
    {key:'portfolio',label:'Portfólio',icon:socialIcon('portfolio'),value:p.portfolio,href:socialUrl('portfolio',p.portfolio)},
    {key:'email',label:'E-mail',icon:socialIcon('email'),value:p.email,href:socialUrl('email',p.email)}
  ].filter(x=>x.value&&x.href);
  const html=items.map(x=>`<a class="public-social" href="${esc(x.href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(x.label)}" title="${esc(x.label)}"><span>${x.icon}</span><small>${esc(x.label)}</small></a>`).join('');
  if(dock)dock.innerHTML=html;
  if(success){
    success.innerHTML=items.length?`<div class="success-social-head"><span class="eyebrow">FIQUE À VONTADE</span><h3>Conheça o trabalho do designer</h3><p>Se quiser acompanhar, falar com o designer ou conhecer outros trabalhos, acesse:</p></div><div class="success-social-grid">${items.map(x=>`<a class="success-social-card" href="${esc(x.href)}" target="_blank" rel="noopener noreferrer"><span>${x.icon}</span><div><b>${esc(x.label)}</b><small>${x.key==='whatsapp'?'Falar pelo WhatsApp':x.key==='instagram'?'Ver Instagram':x.key==='portfolio'?'Conhecer o portfólio':'Enviar e-mail'}</small></div><strong>↗</strong></a>`).join('')}</div>`:'';
  }
}
async function loadPublicProfile(){
  const p=await fetchPublicProfile();
  const cover=$('#publicProfileBanner');
  if(cover){cover.style.backgroundImage=p.banner?`url("${p.banner}")`:'';cover.classList.toggle('has-image',!!p.banner);}
  const name=$('#publicDesignerName');if(name)name.textContent=p.name||'Designer';
  renderPublicSocials(p);
}
async function loadPublicTracking(){
  const token=(()=>{try{return decodeURIComponent(location.hash.slice('#pedido='.length));}catch{return ''}})();
  const root=$('#trackingPage');if(!root||!token||!supabaseClient)return;
  const loading=$('#trackingLoading'),content=$('#trackingContent'),errorBox=$('#trackingError');
  loading?.classList.remove('hidden');content?.classList.add('hidden');errorBox?.classList.add('hidden');
  try{
    const {data,error}=await supabaseClient.rpc('get_order_tracking',{p_tracking_token:token});
    if(error)throw error;
    const o=Array.isArray(data)?data[0]:data;
    if(!o)throw new Error('Este link de acompanhamento não existe ou foi desativado.');
    const profile=o.public_token?await (async()=>{try{const {data}=await supabaseClient.rpc('get_public_profile_for_token',{p_public_token:o.public_token});return Array.isArray(data)?(data[0]||{}):(data||{});}catch{return {}}})():{};
    const status=o.status||'Novo', info=TRACKING_STATUS_INFO[status]||TRACKING_STATUS_INFO.Novo, progress=trackingProgress(status);
    $('#trackingBrandName').textContent=profile.name||'RafahStudio';
    $('#trackingProject').textContent=o.project_name||'Seu pedido';
    $('#trackingClient').textContent=o.client_name||'Cliente';
    $('#trackingService').textContent=o.service_type||'Projeto';
    $('#trackingDeadline').textContent=dateLabel(o.deadline);
    $('#trackingStatus').textContent=info.title;
    $('#trackingStatusDesc').textContent=info.desc;
    $('#trackingProgress').style.width=`${progress}%`;
    $('#trackingProgressValue').textContent=`${progress}%`;
    $('#trackingDeadlineTag').innerHTML=deadlineTag(o.deadline);
    $('#trackingSteps').innerHTML=STATUS.map((s,i)=>{const done=STATUS.indexOf(status)>=i;const active=s===status;return `<div class="tracking-step ${done?'done':''} ${active?'active':''}"><span>${done?'✓':i+1}</span><div><b>${esc(s)}</b><small>${esc(TRACKING_STATUS_INFO[s]?.desc||'')}</small></div></div>`}).join('');
    const socials=[
      {k:'whatsapp',label:'WhatsApp',v:profile.whatsapp||profile.whats},
      {k:'instagram',label:'Instagram',v:profile.instagram||profile.insta},
      {k:'portfolio',label:'Portfólio',v:profile.portfolio}
    ].filter(x=>x.v).map(x=>`<a href="${esc(socialUrl(x.k,x.v))}" target="_blank" rel="noopener">${socialIcon(x.k)}<span>${esc(x.label)}</span></a>`).join('');
    $('#trackingSocials').innerHTML=socials;
    const events=await fetchTrackingEvents(token);
    $('#trackingFeed').innerHTML=renderTrackingEventCards(events);
    const hasArt=events.some(x=>x.kind==='art'&&x.image_url);
    $('#trackingApproveBtn').disabled=!hasArt||['Entregue','Pago','Finalizado'].includes(status);
    $('#trackingChangeBtn').disabled=['Pago','Finalizado'].includes(status);
    content?.classList.remove('hidden');
  }catch(e){console.warn('Acompanhamento público:',e);errorBox?.classList.remove('hidden');$('#trackingErrorText').textContent=e?.message||'Não foi possível carregar este pedido.';}
  finally{loading?.classList.add('hidden');}
}
function setupTracking(){
  loadPublicTracking();
  $('#trackingChangeBtn')?.addEventListener('click',submitPublicAlteration);
  $('#trackingApproveBtn')?.addEventListener('click',submitPublicApproval);
  $('#trackingFeed')?.addEventListener('click',e=>{const b=e.target.closest('[data-public-art]');if(b)modal(`<div class="image-modal"><button class="close-modal" data-close-modal>×</button><img src="${esc(b.dataset.publicArt)}" alt="Pré-visualização da arte"></div>`);});
  if(!trackingPublicRefreshTimer){ trackingPublicRefreshTimer=setInterval(()=>{if(!document.hidden&&location.hash.startsWith('#pedido='))loadPublicTracking();},18000); }
}
function setupPublic(){
  let people=[];let publicCatalog=[];let selectedCatalog=[];
  $('#publicCatalogToggle')?.addEventListener('click',()=>{const d=$('#publicCatalogDrawer');if(!d)return;d.classList.toggle('hidden');const b=$('#publicCatalogToggle');b.classList.toggle('open',!d.classList.contains('hidden'));});
  $('#publicFormView')?.classList.remove('hidden');
  $('#publicSuccess')?.classList.add('hidden');
  async function loadPublicCatalog(){const token=briefingTokenFromHash();if(!token||!supabaseClient)return;try{const {data,error}=await supabaseClient.rpc('get_catalog_for_public',{p_public_token:token});if(error)throw error;publicCatalog=Array.isArray(data)?data:[];const sec=$('#publicCatalogSection'),grid=$('#publicCatalogGrid');if(!publicCatalog.length){sec?.classList.add('hidden');return;}sec?.classList.remove('hidden');const drawer=$('#publicCatalogDrawer');if(drawer)drawer.classList.add('hidden');grid.innerHTML=publicCatalog.map(x=>`<button type="button" class="public-catalog-item" data-catalog-id="${x.id}"><span class="public-catalog-image"><img src="${esc(x.image_url)}" alt="${esc(x.title)}"></span><span><b>${esc(x.title)}</b><small>${esc(x.description||'')}</small></span><i>✓</i><em>Ver arte</em></button>`).join('');
grid.querySelectorAll('[data-catalog-id]').forEach(btn=>btn.onclick=()=>{
  const id=btn.dataset.catalogId;
  const found=publicCatalog.find(x=>String(x.id)===String(id));
  if(!found)return;
  openPublicCatalogPreview(found);
});
function applyCatalogSelection(found){
  const id=String(found.id);
  const exists=selectedCatalog.some(x=>String(x.id)===id);
  if(exists) selectedCatalog=selectedCatalog.filter(x=>String(x.id)!==id);
  else selectedCatalog.push(found);
  const btn=grid.querySelector(`[data-catalog-id="${CSS.escape(id)}"]`);
  btn?.classList.toggle('selected',!exists);
  $('#catalogSelectionNote').textContent=selectedCatalog.length?`Selecionadas: ${selectedCatalog.map(x=>x.title).join(', ')}`:'Nenhuma arte selecionada.';
}
function openPublicCatalogPreview(found){
  let modal=$('#publicCatalogPreviewModal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='publicCatalogPreviewModal';
    modal.className='public-catalog-preview-modal hidden';
    document.body.appendChild(modal);
  }
  const selected=selectedCatalog.some(x=>String(x.id)===String(found.id));
  modal.innerHTML=`<div class="public-catalog-preview-backdrop" data-catalog-preview-close></div>
    <div class="public-catalog-preview-card" role="dialog" aria-modal="true" aria-label="Visualização da arte">
      <button type="button" class="public-catalog-preview-close" data-catalog-preview-close aria-label="Fechar">×</button>
      <div class="public-catalog-preview-image"><img src="${esc(found.image_url)}" alt="${esc(found.title)}"></div>
      <div class="public-catalog-preview-info"><span>REFERÊNCIA DO CATÁLOGO</span><h3>${esc(found.title)}</h3>${found.description?`<p>${esc(found.description)}</p>`:''}</div>
      <button type="button" class="btn primary public-catalog-choose" data-catalog-preview-choose>${selected?'✓ Arte escolhida':'Escolher esta arte'}</button>
    </div>`;
  modal.classList.remove('hidden');
  const close=()=>modal.classList.add('hidden');
  modal.querySelectorAll('[data-catalog-preview-close]').forEach(x=>x.onclick=close);
  modal.querySelector('[data-catalog-preview-choose]').onclick=()=>{
    applyCatalogSelection(found);
    const nowSelected=selectedCatalog.some(x=>String(x.id)===String(found.id));
    modal.querySelector('[data-catalog-preview-choose]').textContent=nowSelected?'✓ Arte escolhida':'Escolher esta arte';
    toast(nowSelected?'Arte adicionada às referências.':'Arte removida das referências.','info');
  };
}}catch(e){console.warn('Catálogo público:',e);}}
  function paintPeople(){ $('#peopleList').innerHTML=people.map((p,i)=>`<div class="person-row"><div class="person-num">${i+1}</div><label>Nome<input data-person-name="${i}" value="${esc(p.name)}" required></label><label>Participação / informação<input data-person-info="${i}" value="${esc(p.info)}"></label><label class="person-photo">Foto<input data-person-photo="${i}" type="file" accept="image/*"><small>${p.photo?.name||'Opcional'}</small></label><button type="button" class="icon-action danger" data-remove-person="${i}">×</button></div>`).join('');}
  $('#addPersonBtn').onclick=()=>{people.push({name:'',info:'',photo:null});paintPeople();};
  $('#peopleList').addEventListener('input',e=>{const i=e.target.dataset.personName??e.target.dataset.personInfo;if(i!==undefined){if(e.target.dataset.personName!==undefined)people[i].name=e.target.value;else people[i].info=e.target.value;}});
  $('#peopleList').addEventListener('change',async e=>{const i=e.target.dataset.personPhoto;if(i!==undefined&&e.target.files[0])people[i].photo=(await readFiles(e.target.files))[0];});
  $('#peopleList').addEventListener('click',e=>{const b=e.target.closest('[data-remove-person]');if(b){people.splice(Number(b.dataset.removePerson),1);paintPeople();}});
  $('#pubFiles').addEventListener('change',async e=>{const fs=await readFiles(e.target.files);$('#filePreview').innerHTML=fs.map(f=>`<span>${esc(f.name)} <small>${formatBytes(f.size)}</small></span>`).join('');$('#pubFiles')._files=fs;});
  $('#briefingForm').onsubmit=async e=>{e.preventDefault();if(!supabaseClient)initSupabaseClient();if(!supabaseClient){$('#publicMessage').textContent='Não foi possível conectar ao servidor. Verifique sua internet e atualize a página.';return;}const publicToken=briefingTokenFromHash();if(!publicToken){$('#publicMessage').textContent='Link de briefing inválido ou expirado. Solicite um novo link ao designer.';return;}const files=$('#pubFiles')._files||[];const persons=people.map(p=>({name:p.name,info:p.info,photo:p.photo?{name:p.photo.name,type:p.photo.type,size:p.photo.size}:null}));const catalogText=selectedCatalog.length?`Referências do catálogo: ${selectedCatalog.map(x=>x.title).join(', ')}`:'';const refsBase=$('#pubRefs').value.trim();const combinedRefs=[catalogText,refsBase].filter(Boolean).join('\n\n');const d={client:$('#pubName').value.trim(),whats:$('#pubWhats').value.trim(),project:$('#pubProject').value.trim(),deadline:$('#pubEvent').value,type:$('#pubType').value,texts:$('#pubTexts').value,people:persons,refs:combinedRefs,notes:$('#pubNotes').value};if(!d.client||!d.project){$('#publicMessage').textContent='Nome e projeto são obrigatórios.';return;}const btn=$('#briefingForm button[type="submit"]');if(btn){btn.disabled=true;btn.textContent='Enviando…';}try{const briefingId=crypto.randomUUID?.()||uid('brief');const uploaded=[];for(let i=0;i<files.length;i++){if(files[i].file)uploaded.push(await uploadBriefingFile(files[i].file,publicToken,briefingId,i));}for(let i=0;i<people.length;i++){if(people[i].photo?.file){const up=await uploadBriefingFile(people[i].photo.file,publicToken,briefingId,`p${i}`);d.people[i].photo=up;}}const {error}=await supabaseClient.rpc('submit_briefing',{p_public_token:publicToken,p_briefing_id:briefingId,p_client_name:d.client,p_whatsapp:d.whats,p_project_name:d.project,p_deadline:d.deadline||null,p_service_type:d.type,p_texts:d.texts,p_people:d.people,p_references_text:d.refs,p_notes:d.notes,p_files:uploaded});if(error)throw error;$('#publicFormView').classList.add('hidden');$('#publicSuccess').classList.remove('hidden');$('#successProject').textContent=d.project;loadPublicProfile();window.scrollTo({top:0,behavior:'smooth'});}catch(err){console.error(err);$('#publicMessage').textContent=`Não foi possível enviar. ${err?.message||'Tente novamente.'}`;if(btn){btn.disabled=false;btn.textContent='Enviar briefing →';}}};
  $('#newPublicOrderBtn').onclick=()=>{ $('#publicSuccess').classList.add('hidden');$('#publicFormView').classList.remove('hidden');$('#briefingForm').reset();people=[];selectedCatalog=[];paintPeople();$('#filePreview').innerHTML='';$('#pubFiles')._files=[];$('#publicMessage').textContent='';const btn=$('#briefingForm button[type="submit"]');if(btn){btn.disabled=false;btn.textContent='Enviar briefing →';}loadPublicProfile();window.scrollTo({top:0,behavior:'smooth'});};
  paintPeople();loadPublicCatalog();loadPublicProfile();
}
function exportBackup(){const payload={version:2,exportedAt:new Date().toISOString(),designer,orders,clients,quotes,notifications};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});downloadBlob(blob,`rafahstudio-backup-${todayISO()}.json`);toast('Backup exportado.');}
function importBackup(file){const r=new FileReader();r.onload=()=>{try{const p=JSON.parse(r.result);if(!p||!Array.isArray(p.orders))throw new Error();orders=p.orders.map(normalizeOrder);clients=Array.isArray(p.clients)?p.clients:[];quotes=Array.isArray(p.quotes)?p.quotes:[];notifications=Array.isArray(p.notifications)?p.notifications:[];designer={...designer,...(p.designer||{})};persist();render();toast('Backup importado com sucesso.');}catch{toast('Arquivo de backup inválido.','error');}};r.readAsText(file);}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function pdfWindow(title,body){const w=window.open('','_blank','noopener,noreferrer');if(!w){toast('Permita pop-ups para gerar o PDF.','error');return;}w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:A4;margin:16mm}body{font:14px Arial;color:#16201e;margin:0}header{border-bottom:2px solid #dfe8e5;padding-bottom:16px;margin-bottom:24px;display:flex;justify-content:space-between}h1{font-size:24px;margin:0 0 6px}h2{font-size:15px;margin:22px 0 10px}small{color:#657773}table{width:100%;border-collapse:collapse}td,th{padding:9px;border-bottom:1px solid #e4ebe9;text-align:left}th{font-size:11px;color:#657773}p{line-height:1.55}.badge{display:inline-block;padding:6px 9px;border-radius:99px;background:#e9f5f1}.total{font-size:22px;font-weight:800}.box{background:#f5f8f7;padding:14px;border-radius:10px;white-space:pre-wrap}footer{margin-top:30px;padding-top:12px;border-top:1px solid #e4ebe9;color:#657773;font-size:11px}</style></head><body>${body}<footer>RafahStudio • Documento gerado em ${new Date().toLocaleString('pt-BR')}</footer><script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);w.document.close();}
function generateOrderPDF(id){const o=orders.find(x=>x.id===id);if(!o)return;const b=o.briefing||{};const people=(b.people||[]).map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.info||'—')}</td></tr>`).join('');const body=`<header><div><h1>RafahStudio</h1><small>${esc(designer.name||'Designer')} ${designer.brand&&designer.brand!=='RafahStudio'?'• '+esc(designer.brand):''}</small></div><div><b>PEDIDO</b><br><small>${esc(o.id)}</small></div></header><p><span class="badge">${esc(o.status)}</span></p><table><tr><th>Cliente</th><td>${esc(o.client)}</td><th>Projeto</th><td>${esc(o.project)}</td></tr><tr><th>Serviço</th><td>${esc(o.type)}</td><th>Prazo</th><td>${dateLabel(o.deadline)}</td></tr><tr><th>Valor</th><td>${money(o.value)}</td><th>Pagamento</th><td>${o.paid||o.status==='Pago'?'Pago':'Pendente'}</td></tr></table><h2>Briefing</h2><div class="box">${esc(b.texts||b.notes||'Sem briefing adicional.')}</div>${b.people?.length?`<h2>Pessoas da arte</h2><table><tr><th>Nome</th><th>Informação</th></tr>${people}</table>`:''}${b.refs?`<h2>Referências</h2><div class="box">${esc(b.refs)}</div>`:''}${b.notes?`<h2>Observações</h2><div class="box">${esc(b.notes)}</div>`:''}`;pdfWindow(`Pedido — ${o.project}`,body);}
function generateQuotePDF(id){const q=quotes.find(x=>x.id===id);if(!q)return;const rows=(q.items||[]).map(i=>`<tr><td>${esc(i.desc||'Serviço')}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money((Number(i.qty)||0)*(Number(i.price)||0))}</td></tr>`).join('');const body=`<header><div><h1>RafahStudio</h1><small>${esc(designer.name||'Designer')} ${designer.whats?'• '+esc(designer.whats):''}</small></div><div><b>ORÇAMENTO</b><br><small>${esc(q.id)}</small></div></header><table><tr><th>Cliente</th><td>${esc(q.client)}</td><th>Projeto</th><td>${esc(q.project)}</td></tr><tr><th>Validade</th><td>${dateLabel(q.valid)}</td><th>Status</th><td>${esc(q.status)}</td></tr></table><h2>Itens</h2><table><tr><th>Descrição</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr>${rows}</table><p><b>Subtotal:</b> ${money(q.subtotal)}<br><b>Desconto:</b> ${money(q.discount)}<br><span class="total">Total: ${money(q.total)}</span></p>${q.terms?`<h2>Condições</h2><div class="box">${esc(q.terms)}</div>`:''}`;pdfWindow(`Orçamento — ${q.project}`,body);}

function showUploadProgress(title='Enviando arquivo…', text='Aguarde enquanto atualizamos sua imagem.'){
  const root=$('#uploadProgress'); if(!root)return;
  root.classList.remove('hidden');
  $('#uploadProgressTitle').textContent=title;
  $('#uploadProgressText').textContent=text;
  $('#uploadProgressBar').style.width='8%';
  $('#uploadProgressPercent').textContent='8%';
}
function updateUploadProgress(percent,text){
  const root=$('#uploadProgress'); if(!root)return;
  const p=Math.max(0,Math.min(100,Math.round(percent)));
  $('#uploadProgressBar').style.width=p+'%';
  $('#uploadProgressPercent').textContent=p+'%';
  if(text)$('#uploadProgressText').textContent=text;
}
function hideUploadProgress(success=false){
  const root=$('#uploadProgress'); if(!root)return;
  if(success){updateUploadProgress(100,'Imagem atualizada com sucesso.');setTimeout(()=>root.classList.add('hidden'),650);}
  else root.classList.add('hidden');
}

function setupEvents(){
 document.addEventListener('pointerdown',()=>{unlockNotificationAudio();},{once:true});
 $('#loginForm').onsubmit=e=>{e.preventDefault();login($('#loginUser').value.trim(),$('#loginPass').value);};$('#registerForm').onsubmit=e=>{e.preventDefault();register();};$('#showRegisterBtn').onclick=()=>showAuth('register');$('#showLoginBtn').onclick=()=>showAuth('login');
 $$('.nav-item[data-page]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.page))); $('#logoutBtn').onclick=logout;$('#profileQuick').onclick=()=>go('perfil');$('#mobileMenu').onclick=()=>$('#sidebar').classList.toggle('mobile-open');
 $('#notificationBtn').onclick=e=>{e.stopPropagation();requestDesktopNotifications();$('#notificationPanel').classList.toggle('open');};document.addEventListener('click',e=>{if(!e.target.closest('#notificationPanel')&&!e.target.closest('#notificationBtn'))$('#notificationPanel').classList.remove('open');});$('#markReadBtn').onclick=()=>{notifications=notifications.map(n=>({...n,read:true}));persist();renderNotifications();toast('Notificações marcadas como lidas.','info');};
 $('#deleteAllNotificationsBtn').onclick=()=>{notifications=[];persist();renderNotifications();};
 $('#deleteReadBtn').onclick=()=>{notifications=notifications.filter(n=>!n.read);persist();renderNotifications();};
 $('#notificationsList').addEventListener('click',e=>{const d=e.target.closest('[data-delete-notification]');if(d){e.preventDefault();e.stopPropagation();notifications=notifications.filter(n=>n.id!==d.dataset.deleteNotification);persist();renderNotifications();return;}const o=e.target.closest('[data-open-notification]');if(o){const n=notifications.find(x=>x.id===o.dataset.openNotification);if(n){n.read=true;persist();renderNotifications();if(n.linkPage)go(n.linkPage);}}});
 const nm=$('#notificationMode'),ns=$('#notificationSound'); if(nm){nm.value=getNotificationPrefs().mode;nm.onchange=()=>{const p=getNotificationPrefs();p.mode=nm.value;saveNotificationPrefs(p);unlockNotificationAudio();requestDesktopNotifications();};} if(ns){ns.value=getNotificationPrefs().sound;ns.onchange=()=>{const p=getNotificationPrefs();p.sound=ns.value;saveNotificationPrefs(p);unlockNotificationAudio();playNotificationSound(true);};}
 $('#testNotificationBtn')?.addEventListener('click',()=>{unlockNotificationAudio();playNotificationSound(true);speakNotification('Teste de notificação. Este aviso não será salvo.');showNotificationPopup('Teste de notificação','Este teste aparece somente como popup e não é salvo no histórico.');requestDesktopNotifications();});

 $('#globalSearch').oninput=e=>{const q=e.target.value.trim();if(q){go('pedidos');$('#orderSearch').value=q;renderOrders();}};$('#orderSearch').oninput=renderOrders;$('#orderSort').onchange=renderOrders;$('#clientSearch').oninput=renderClients;$('#catalogSearch').oninput=renderCatalog;$('#quoteSearch').oninput=renderQuotes;$('#quoteFilter').onchange=renderQuotes;['finStart','finEnd','finStatus'].forEach(id=>$('#'+id).onchange=renderFinance);$('#clearFinance').onclick=()=>{$('#finStart').value='';$('#finEnd').value='';$('#finStatus').value='all';renderFinance();};$('#copyBriefingBtn').onclick=()=>generateLink();
 $('#saveProfileBtn').onclick=async()=>{const btn=$('#saveProfileBtn');btn.disabled=true;try{designer={...designer,name:$('#dName').value.trim()||'Designer',brand:$('#dBrand').value.trim(),whats:$('#dWhats').value.trim(),email:$('#dEmail').value.trim(),insta:$('#dInsta').value.trim(),portfolio:$('#dPortfolio').value.trim(),area:$('#dArea').value.trim(),bio:$('#dBio').value.trim(),photo:designer.photo||'',banner:designer.banner||''};const file=$('#profileBanner')?.files?.[0];if(file){if(file.size>8*1024*1024)throw new Error('O banner deve ter no máximo 8 MB.');if(!supabaseClient)initSupabaseClient();if(!supabaseClient)throw new Error('Não foi possível conectar ao armazenamento.');showUploadProgress('Enviando banner…','Atualizando o banner do seu perfil.');const safe=(file.name||'banner').replace(/[^a-zA-Z0-9._-]/g,'_');const path=`profile/${getOwnerToken()}/${Date.now()}-${safe}`;const {error}=await supabaseClient.storage.from('briefing-files').upload(path,file,{upsert:false,contentType:file.type||'image/jpeg'});if(error)throw error;designer.banner=supabaseClient.storage.from('briefing-files').getPublicUrl(path).data.publicUrl;updateUploadProgress(100,'Banner atualizado com sucesso.');}persist();await saveRemoteProfile();await syncPublicProfileLink(getPublicToken());renderIdentity();renderProfile();renderDashboard();if(file)hideUploadProgress(true);toast('Perfil atualizado e pronto para aparecer nos briefings.');}catch(err){hideUploadProgress(false);toast(err?.message||'Não foi possível salvar o perfil.','error');}finally{btn.disabled=false;}};$('#profilePhoto').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>4*1024*1024){toast('Escolha uma foto de até 4 MB.','error');e.target.value='';return;}showUploadProgress('Atualizando foto…','Carregando a foto do seu perfil.');try{designer.photo=await new Promise((res,rej)=>{const r=new FileReader();r.onprogress=ev=>{if(ev.lengthComputable)updateUploadProgress(Math.max(10,(ev.loaded/ev.total)*90),'Carregando a foto do perfil…');};r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f);});updateUploadProgress(100,'Foto atualizada com sucesso.');persist();await saveRemoteProfile();renderIdentity();renderProfile();hideUploadProgress(true);}catch(err){hideUploadProgress(false);toast('Não foi possível atualizar a foto.','error');}finally{e.target.value='';}};$('#exportBackupBtn').onclick=exportBackup;$('#importBackup').onchange=e=>{if(e.target.files[0])importBackup(e.target.files[0]);};
 let draggedOrderId=null;
 $('#ordersTable').addEventListener('dragstart',e=>{const card=e.target.closest('[data-drag-order]');if(!card)return;draggedOrderId=card.dataset.dragOrder;card.classList.add('is-dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedOrderId);});
 $('#ordersTable').addEventListener('dragend',e=>{const card=e.target.closest('[data-drag-order]');card?.classList.remove('is-dragging');$$('.order-stage.is-drop-target').forEach(x=>x.classList.remove('is-drop-target'));draggedOrderId=null;});
 $('#ordersTable').addEventListener('dragover',e=>{const stage=e.target.closest('[data-stage]');if(!stage)return;e.preventDefault();e.dataTransfer.dropEffect='move';$$('.order-stage.is-drop-target').forEach(x=>x.classList.remove('is-drop-target'));stage.classList.add('is-drop-target');});
 $('#ordersTable').addEventListener('dragleave',e=>{const stage=e.target.closest('[data-stage]');if(stage&&!stage.contains(e.relatedTarget))stage.classList.remove('is-drop-target');});
 $('#ordersTable').addEventListener('drop',e=>{const stage=e.target.closest('[data-stage]');if(!stage)return;e.preventDefault();stage.classList.remove('is-drop-target');const id=draggedOrderId||e.dataTransfer.getData('text/plain');if(!id)return;const o=orders.find(x=>String(x.id)===String(id));if(!o)return;const next=stage.dataset.stage;if(o.status===next){toast('O pedido já está nesta etapa.','info');return;}const old=o.status;o.status=next;if(next==='Pago'||next==='Finalizado')o.paid=true;if(old==='Pago'&&next!=='Pago'&&next!=='Finalizado')o.paid=false;addHistory(o,`Pedido movido de ${old} para ${next}`);persist();render();syncOrderTracking(o);notify(`Pedido movido para ${next}`,`${o.project} • ${o.client}`,'info','pedidos',o.id);toast(`Pedido movido para ${next}.`);});
 document.addEventListener('click',handleDelegated);document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();$('#notificationPanel').classList.remove('open');}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='n'){e.preventDefault();openOrder();}});
}
function handleDelegated(e){const a=e.target.closest('[data-action]');if(a){const action=a.dataset.action;if(action==='new-order')openOrder();if(action==='new-client')openClientForm();if(action==='new-quote')openQuoteForm();if(action==='new-catalog')openCatalogForm();if(action==='copy-briefing')generateLink();}
 const page=e.target.closest('[data-page-link]');if(page)go(page.dataset.pageLink);
 const open=e.target.closest('[data-open-order]');if(open)openOrderView(open.dataset.openOrder);
 const edit=e.target.closest('[data-edit-order]');if(edit){const order=orders.find(o=>o.id===edit.dataset.editOrder);if(order)openOrder(order);}
 const editOrderClient=e.target.closest('[data-edit-order-client]');if(editOrderClient){const order=orders.find(o=>o.id===editOrderClient.dataset.editOrderClient);if(order){const c=clients.find(x=>String(x.name).toLowerCase()===String(order.client).toLowerCase());closeModal();openClientForm(c||{name:order.client});}}
 const del=e.target.closest('[data-delete-order]');if(del)deleteOrder(del.dataset.deleteOrder);
 const trashBtn=e.target.closest('[data-open-trash]');if(trashBtn)openTrash();
 const restore=e.target.closest('[data-restore-order]');if(restore)restoreOrder(restore.dataset.restoreOrder);
 const purge=e.target.closest('[data-purge-trash]');if(purge)purgeTrash(purge.dataset.purgeTrash);
 const pdf=e.target.closest('[data-order-pdf]');if(pdf)generateOrderPDF(pdf.dataset.orderPdf);
 const paid=e.target.closest('[data-toggle-paid]');if(paid){togglePaid(paid.dataset.togglePaid);if($('#modalRoot').innerHTML)openOrderView(paid.dataset.togglePaid);}
 const share=e.target.closest('[data-share-tracking]');if(share){shareOrderTracking(share.dataset.shareTracking);return;}
 const sendArt=e.target.closest('[data-send-tracking-art]');if(sendArt){sendTrackingArtUpdate(sendArt.dataset.sendTrackingArt);return;}
 const move=e.target.closest('[data-move-status]');if(move&&!move.disabled){moveStatus(move.dataset.moveStatus,Number(move.dataset.direction)||1);}
 const cyc=e.target.closest('[data-cycle-status]');if(cyc)cycleStatus(cyc.dataset.cycleStatus);
 const delC=e.target.closest('[data-delete-client]');if(delC){deleteClient(delC.dataset.deleteClient);return;}
 const editCat=e.target.closest('[data-edit-catalog]');if(editCat){const item=catalog.find(x=>String(x.id)===String(editCat.dataset.editCatalog));if(item)openCatalogForm(item);return;}
 const delCat=e.target.closest('[data-delete-catalog]');if(delCat){deleteCatalogItem(delCat.dataset.deleteCatalog);return;}
 const addCat=e.target.closest('[data-add-catalog-order]');if(addCat){const order=orders.find(x=>x.id===addCat.dataset.addCatalogOrder);if(order)openCatalogForm(null,order);return;}
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


let liveSyncStarted=false;
async function runLiveSyncCycle(kind){
  if(document.hidden||!navigator.onLine)return;
  try{
    if(kind==='briefings')await syncOnlineBriefings();
    else if(kind==='tracking')await syncTrackingEventsForOwner();
    else if(kind==='workspace')await refreshWorkspaceFromRemote();
  }catch(e){console.warn('[RafahStudio] sincronização:',e);}
}
function scheduleLiveSync(kind,ms){
  const timer=setTimeout(async function tick(){
    await runLiveSyncCycle(kind);
    const next=setTimeout(tick,ms);
    liveSyncTimers.push(next);
  },ms);
  liveSyncTimers.push(timer);
}
function startLiveSync(){
  if(liveSyncStarted)return;liveSyncStarted=true;
  setTimeout(()=>{
    if(document.hidden||!navigator.onLine)return;
    runLiveSyncCycle('briefings');runLiveSyncCycle('tracking');runLiveSyncCycle('workspace');
  },400);
  scheduleLiveSync('briefings',45000);
  scheduleLiveSync('tracking',20000);
  scheduleLiveSync('workspace',30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){runLiveSyncCycle('briefings');runLiveSyncCycle('tracking');runLiveSyncCycle('workspace');}}, {passive:true});
  window.addEventListener('online',()=>{runLiveSyncCycle('briefings');runLiveSyncCycle('tracking');runLiveSyncCycle('workspace');},{passive:true});
}
async function registerServiceWorker(){
  if(!('serviceWorker' in navigator)||location.protocol==='file:')return;
  try{await navigator.serviceWorker.register('./sw.js');}catch(e){console.warn('Service Worker:',e);}
}
async function init(){
  setupEvents();setupPublic();setupTracking();registerServiceWorker();document.body.classList.add('dark');
  if(handlePublicHash())return;
  if(!supabaseClient){initSupabaseClient();}
  try{
    const {data}=await supabaseClient.auth.getSession();
    if(data?.session?.user){
      await establishAuthenticatedUser(data.session.user);
      showApp();
      startLiveSync();
      return;
    }
  }catch(e){console.warn('[RafahStudio] Sessão:',e);}
  currentUser=null;
  localStorage.removeItem(KEYS.user);
  showAuth('login');
}

init();

/* RAFAHSTUDIO DEADLINE TAGS */

/* RAFAHSTUDIO DEADLINE TAGS */
(function(){
  function getDate(o){
    const v=o?.deadline||o?.due_date||o?.prazo||o?.date;
    if(!v)return null;
    const d=new Date(v+'T23:59:59');
    return isNaN(d)?null:d;
  }
  window.rafahDeadlineTag=function(o){
    const d=getDate(o);
    if(!d)return {key:'none',label:'Sem prazo',days:null};
    const now=new Date();
    const a=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    const b=new Date(d.getFullYear(),d.getMonth(),d.getDate());
    const days=Math.ceil((b-a)/86400000);
    if(days<0)return {key:'late',label:'Atrasado',days};
    if(days===0)return {key:'today',label:'Entrega hoje',days};
    if(days===1)return {key:'tomorrow',label:'Amanhã',days};
    if(days<=3)return {key:'urgent',label:`${days} dias`,days};
    if(days<=7)return {key:'soon',label:`${days} dias`,days};
    return {key:'normal',label:`${days} dias`,days};
  };
  window.rafahDeadlineTagHtml=function(o){
    const t=window.rafahDeadlineTag(o);
    if(t.key==='none')return '';
    return `<span class="deadline-tag deadline-${t.key}" title="Prazo: ${t.label}">${t.label}</span>`;
  };
  // Expose a safe decorator for existing order cards. It looks for common order-card containers.
  window.refreshRafahDeadlineTags=function(){
    document.querySelectorAll('[data-order-id], .order-card, .pedido-card, .kanban-card, .stage-card').forEach(el=>{
      if(el.querySelector('.deadline-tag'))return;
      const id=el.dataset.orderId||el.dataset.id;
      let obj=null;
      try{
        const source=window.orders||window.pedidos||[];
        obj=source.find(x=>String(x.id)===String(id));
      }catch(e){}
      if(!obj)return;
      const html=window.rafahDeadlineTagHtml(obj);
      if(!html)return;
      const host=el.querySelector('.order-card-top,.card-top,.stage-card-head,.order-head')||el.firstElementChild||el;
      host.insertAdjacentHTML('beforeend',html);
    });
  };
  window.addEventListener('load',()=>setTimeout(refreshRafahDeadlineTags,700));
  document.addEventListener('rafah:orders-rendered',()=>setTimeout(refreshRafahDeadlineTags,0));
})();
