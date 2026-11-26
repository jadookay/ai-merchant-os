/* AIBOS isolated POS payment-method controls and sales breakdown. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const copy={
    en:{method:'Payment method',cash:'Cash',momo:'MoMo',credit:'On credit',note:'Receipt note (optional)',customer:'Customer name',phone:'Customer phone',due:'Payment due date',amountDue:'Amount due',summary:'Sales by payment method',period:'Period',daily:'Daily',weekly:'Weekly',monthly:'Monthly',custom:'Selected dates',from:'From',to:'To',apply:'Apply',methodCol:'Payment method',transactions:'Transactions',total:'Total',allTotal:'Total sales',outstanding:'Outstanding credit',empty:'No sales recorded for this period.',cashHelp:'Paid in cash',momoHelp:'Paid through Mobile Money',creditHelp:'Sold on credit'},
    fr:{method:'Mode de paiement',cash:'Espèces',momo:'MoMo',credit:'À crédit',note:'Note du reçu (facultatif)',customer:'Nom du client',phone:'Téléphone du client',due:'Date limite de paiement',amountDue:'Montant dû',summary:'Ventes par mode de paiement',period:'Période',daily:'Quotidien',weekly:'Hebdomadaire',monthly:'Mensuel',custom:'Dates sélectionnées',from:'Du',to:'Au',apply:'Appliquer',methodCol:'Mode de paiement',transactions:'Transactions',total:'Total',allTotal:'Total des ventes',outstanding:'Crédit restant',empty:'Aucune vente pour cette période.',cashHelp:'Payé en espèces',momoHelp:'Payé par Mobile Money',creditHelp:'Vendu à crédit'},
    rw:{method:'Uburyo bwo kwishyura',cash:'Amafaranga mu ntoki',momo:'MoMo',credit:'Ku ideni',note:'Icyitonderwa ku nyemezabuguzi (si ngombwa)',customer:'Amazina y’umukiriya',phone:'Telefoni y’umukiriya',due:'Itariki ntarengwa yo kwishyura',amountDue:'Amafaranga agomba kwishyurwa',summary:'Ibyagurishijwe hakurikijwe uburyo bwo kwishyura',period:'Igihe',daily:'Buri munsi',weekly:'Buri cyumweru',monthly:'Buri kwezi',custom:'Itariki wahisemo',from:'Kuva',to:'Kugeza',apply:'Shyira mu bikorwa',methodCol:'Uburyo bwo kwishyura',transactions:'Ibikorwa',total:'Igiteranyo',allTotal:'Igiteranyo cy’ibyagurishijwe',outstanding:'Ideni risigaye',empty:'Nta byagurishijwe muri iki gihe.',cashHelp:'Byishyuwe mu ntoki',momoHelp:'Byishyuwe hakoreshejwe Mobile Money',creditHelp:'Byagurishijwe ku ideni'}
  };
  const lang=()=>typeof sheriLanguageKey==='function'?sheriLanguageKey():'en';
  const tr=k=>(copy[lang()]||copy.en)[k]||copy.en[k]||k;
  const today=()=>typeof sheriLocalDateKey==='function'?sheriLocalDateKey(new Date()):new Date().toISOString().slice(0,10);
  const dateOf=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'':(typeof sheriLocalDateKey==='function'?sheriLocalDateKey(d):d.toISOString().slice(0,10));};
  const fmt=n=>typeof money==='function'?money(n):'RWF '+Number(n||0).toLocaleString();
  function ensureControls(){
    const sales=$('sales');
    const form=sales?.querySelector('.card > .formgrid')||sales?.querySelector('.card .formgrid');
    if(form&&!$('salePaymentMethod')){
      const block=document.createElement('div');
      block.id='aibosPosPaymentControls';
      block.className='formgrid section';
      block.style.marginTop='12px';
      block.innerHTML='<div><label for="salePaymentMethod">'+tr('method')+'</label><select id="salePaymentMethod"><option value="cash">'+tr('cash')+'</option><option value="momo">'+tr('momo')+'</option><option value="credit">'+tr('credit')+'</option></select></div><div><label for="saleReceiptNote">'+tr('note')+'</label><input id="saleReceiptNote" maxlength="180"></div><div id="saleCreditFields" style="display:none;grid-column:1/-1"><div class="formgrid"><div><label for="saleCreditName">'+tr('customer')+'</label><input id="saleCreditName"></div><div><label for="saleCreditPhone">'+tr('phone')+'</label><input id="saleCreditPhone" type="tel" placeholder="+250..."></div><div><label for="saleCreditDue">'+tr('due')+'</label><input id="saleCreditDue" type="date"></div><div><label for="saleCreditAmount">'+tr('amountDue')+'</label><input id="saleCreditAmount" readonly></div></div></div>';
      form.insertAdjacentElement('afterend',block);
    }
    if($('salePaymentMethod')){
      const sel=$('salePaymentMethod');
      const label=sel.closest('div')?.querySelector('label');
      if(label)label.textContent=tr('method');
      const options=Array.from(sel.options);
      if(options.length>=3){options[0].textContent=tr('cash');options[1].textContent=tr('momo');options[2].textContent=tr('credit');}
      sel.onchange=toggleCredit;
      if($('saleReceiptNote')?.previousElementSibling)$('saleReceiptNote').previousElementSibling.textContent=tr('note');
      const credit=$('saleCreditFields');
      if(credit){
        const labels=credit.querySelectorAll('label');
        ['customer','phone','due','amountDue'].forEach((k,i)=>{if(labels[i])labels[i].textContent=tr(k);});
      }
      toggleCredit();
    }
    const history=sales?.querySelector('#salesTable')?.parentElement;
    if(history&&!$('aibosPaymentSummary'))history.insertAdjacentHTML('afterend','<div class="card section" id="aibosPaymentSummary"><div class="top"><div><h2>'+tr('summary')+'</h2><div class="sub">'+tr('cashHelp')+' · '+tr('momoHelp')+' · '+tr('creditHelp')+'</div></div></div><div class="formgrid"><div><label for="aibosPayPeriod">'+tr('period')+'</label><select id="aibosPayPeriod"><option value="daily">'+tr('daily')+'</option><option value="weekly">'+tr('weekly')+'</option><option value="monthly">'+tr('monthly')+'</option><option value="custom">'+tr('custom')+'</option></select></div><div><label for="aibosPayFrom">'+tr('from')+'</label><input id="aibosPayFrom" type="date"></div><div><label for="aibosPayTo">'+tr('to')+'</label><input id="aibosPayTo" type="date"></div><div style="align-self:end"><button type="button" class="btn small" id="aibosPayApply">'+tr('apply')+'</button></div></div><div id="aibosPaymentSummaryTable" style="overflow-x:auto;margin-top:12px"></div></div>');
    if($('aibosPayPeriod')&&!$('aibosPayPeriod').dataset.bound){
      $('aibosPayPeriod').dataset.bound='1';
      $('aibosPayPeriod').onchange=applyPeriod;
      $('aibosPayApply').onclick=renderSummary;
      $('aibosPayFrom').onchange=()=>{$('aibosPayPeriod').value='custom';};
      $('aibosPayTo').onchange=()=>{$('aibosPayPeriod').value='custom';};
      applyPeriod();
    }
  }
  function toggleCredit(){
    const on=$('salePaymentMethod')?.value==='credit';
    if($('saleCreditFields'))$('saleCreditFields').style.display=on?'block':'none';
    if(on&&$('saleCreditDue')&&!$('saleCreditDue').value){const d=new Date();d.setDate(d.getDate()+7);$('saleCreditDue').value=typeof sheriLocalDateKey==='function'?sheriLocalDateKey(d):d.toISOString().slice(0,10);}
    updateAmount();
  }
  function updateAmount(){
    const cart=Array.isArray(saleCart)?saleCart:[];
    const total=cart.reduce((a,x)=>a+Number(x.qty||0)*Number(x.price||0),0)||(Number($('saleQty')?.value||0)*Number($('salePrice')?.value||0));
    if($('saleCreditAmount'))$('saleCreditAmount').value=total.toFixed(2);
  }
  function applyPeriod(){
    const mode=$('aibosPayPeriod')?.value||'daily',d=new Date(),t=today();
    let from=t,to=t;
    if(mode==='weekly'){
      const day=(d.getDay()+6)%7;const start=new Date(d);start.setDate(d.getDate()-day);const end=new Date(start);end.setDate(start.getDate()+6);
      from=typeof sheriLocalDateKey==='function'?sheriLocalDateKey(start):start.toISOString().slice(0,10);to=typeof sheriLocalDateKey==='function'?sheriLocalDateKey(end):end.toISOString().slice(0,10);
    }else if(mode==='monthly'){
      const start=new Date(d.getFullYear(),d.getMonth(),1),end=new Date(d.getFullYear(),d.getMonth()+1,0);
      from=typeof sheriLocalDateKey==='function'?sheriLocalDateKey(start):start.toISOString().slice(0,10);to=typeof sheriLocalDateKey==='function'?sheriLocalDateKey(end):end.toISOString().slice(0,10);
    }
    if(mode!=='custom'){$('aibosPayFrom').value=from;$('aibosPayTo').value=to;}
    renderSummary();
  }
  function renderSummary(){
    const host=$('aibosPaymentSummaryTable');if(!host)return;
    const from=$('aibosPayFrom')?.value||today(),to=$('aibosPayTo')?.value||today();
    if(from>to){host.textContent='The start date must not be after the end date.';return;}
    const grouped=new Map();
    for(const s of (state?.sales||[])){
      if(s.voided||s.voided_at)continue;
      const date=dateOf(s.created_at);if(!date||date<from||date>to)continue;
      const method=['cash','momo','credit'].includes(s.payment_method)?s.payment_method:'cash';
      const id=s.transaction_id||s.id;let row=grouped.get(id);
      if(!row){row={method,total:0,date};grouped.set(id,row);}
      row.total+=Number(s.qty||0)*Number(s.price||0);
    }
    const methods=['cash','momo','credit'].map(k=>({key:k,count:0,total:0}));
    for(const row of grouped.values()){const item=methods.find(x=>x.key===row.method);item.count++;item.total+=row.total;}
    const allCount=grouped.size,allTotal=methods.reduce((n,x)=>n+x.total,0);
    const credit=new Map();for(const s of (state?.sales||[])){if(s.voided||s.voided_at||s.payment_method!=='credit')continue;const id=s.transaction_id||s.id;credit.set(id,(credit.get(id)||0)+Number(s.qty||0)*Number(s.price||0));}const outstanding=[...credit.entries()].reduce((n,[id,total])=>n+Math.max(0,total-(state?.payments||[]).filter(p=>p.direction==='receipt'&&p.source_type==='sale_invoice'&&p.source_id===id).reduce((a,p)=>a+Number(p.amount||0),0)),0);
    host.innerHTML='<table class="table"><thead><tr><th>'+tr('methodCol')+'</th><th>'+tr('transactions')+'</th><th>'+tr('total')+'</th></tr></thead><tbody>'+methods.map(x=>'<tr><td><b>'+tr(x.key)+'</b></td><td>'+x.count+'</td><td>'+fmt(x.total)+'</td></tr>').join('')+'<tr><th>'+tr('allTotal')+'</th><th>'+allCount+'</th><th>'+fmt(allTotal)+'</th></tr></tbody></table>'+(outstanding===null?'':'<div class="sub" style="margin-top:8px">'+tr('outstanding')+': <b>'+fmt(outstanding)+'</b></div>')+'<div class="sub" style="margin-top:6px">'+from+' — '+to+'</div>';
    if(!allCount)host.insertAdjacentHTML('beforeend','<div class="sub" style="margin-top:8px">'+tr('empty')+'</div>');
  }
  const init=()=>{
    ensureControls();
    if(typeof render==='function'&&!render.__aibosPaymentSummaryWrapped){
      const original=render;
      const wrapped=function(){const result=original.apply(this,arguments);ensureControls();renderSummary();updateAmount();return result;};
      wrapped.__aibosPaymentSummaryWrapped=true;render=wrapped;
    }
    renderSummary();
    document.addEventListener('input',e=>{if(['saleQty','salePrice'].includes(e.target?.id))updateAmount();});
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
