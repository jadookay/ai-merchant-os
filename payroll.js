/* AIBOS Rwanda payroll first slice. Payroll data is tenant-isolated by RLS. */
(function(){
  const host=document.getElementById('payrollAppHost');
  if(!host)return;
  const copy={
    en:{period:'Payroll month',pageTitle:'Payroll',pageSubtitle:'Employee records, payroll estimates and Rwanda statutory compliance.',add:'Add employee',employees:'Employee directory',name:'Full legal name',number:'Employee number',type:'Employment classification',permanent:'Permanent employee',casual:'Casual labourer',secondary:'Secondary employer',title:'Job title',dept:'Department',start:'Start date',salary:'Basic monthly salary (RWF)',transport:'Transport allowance (RWF)',taxid:'RRA tax ID (optional)',rssb:'RSSB member number (optional)',save:'Save employee',estimate:'Payroll estimate',basic:'Basic monthly pay (RWF)',calc:'Calculate estimate',rules:'Rwanda statutory requirements',notice:'This first release supports employee records and non-posting estimates. It does not submit declarations, pay salaries, approve payroll or post accounting journals.',empty:'No employees have been added.',loading:'Loading employees…',gross:'Gross pay',paye:'PAYE',empPension:'Employee pension',erPension:'Employer pension',oh:'Employer occupational hazards 2%',net:'Estimated net salary',cost:'Estimated employer cost',status:'Status',class:'Classification',actions:'Action',saved:'Employee saved.',failed:'Could not save employee: ',reminders:'Payroll and statutory reminders',noReminders:'No payroll reminders are currently due.',ruleLoad:'Effective-dated Rwanda payroll rules',source:'Official rule set loaded',verify:'Other statutory components (maternity, CBHI, benefits in kind and special exemptions) require further verification before final payroll approval.'},
    rw:{period:'Ukwezi kw’imishahara',pageTitle:'Imishahara',pageSubtitle:'Amakuru y’abakozi, igereranya ry’imishahara n’amategeko y’u Rwanda.',add:'Ongeramo umukozi',employees:'Urutonde rw’abakozi',name:'Amazina yuzuye yemewe',number:'Nimero y’umukozi',type:'Icyiciro cy’umukozi',permanent:'Umukozi uhoraho',casual:'Umukozi w’igihe gito',secondary:'Umukoresha wa kabiri',title:'Umwanya w’akazi',dept:'Ishami',start:'Itariki yatangiriyeho',salary:'Umushahara fatizo wa buri kwezi (RWF)',transport:'Amafaranga y’urugendo (RWF)',taxid:'Nimero y’umusoro ya RRA (si ngombwa)',rssb:'Nimero ya RSSB (si ngombwa)',save:'Bika umukozi',estimate:'Igereranya ry’umushahara',basic:'Umushahara fatizo wa buri kwezi (RWF)',calc:'Bara igereranya',rules:'Amategeko y’imisoro n’imisanzu mu Rwanda',notice:'Iki cyiciro kibika amakuru y’abakozi kandi kigatanga igereranya gusa. Ntiratangaza imisoro, ngo cyishyure imishahara cyangwa ngo gikore inyandiko z’ibaruramari.',empty:'Nta bakozi barongerwamo.',loading:'Turimo kuzana abakozi…',gross:'Umushahara mbumbe',paye:'PAYE',empPension:'Pansiyo y’umukozi',erPension:'Pansiyo y’umukoresha',oh:'Imisanzu y’impanuka ku kazi 2%',net:'Umushahara usigara ugereranyijwe',cost:'Igiciro cyose ku mukoresha',status:'Imiterere',class:'Icyiciro',actions:'Igikorwa',saved:'Umukozi yabitswe.',failed:'Ntibyashobotse kubika umukozi: ',reminders:'Ibibutsa imishahara n’imisoro',noReminders:'Nta kibutsa cy’imishahara kirageze.',ruleLoad:'Amategeko y’imishahara afite amatariki',source:'Amategeko yemewe yafunguwe',verify:'Indi misanzu (ubwishingizi bw’ababyeyi, CBHI, inyungu zitangirwa mu bintu n’ibindi byihariye) igomba kugenzurwa mbere yo kwemeza imishahara.'},
    fr:{period:'Mois de paie',pageTitle:'Paie',pageSubtitle:'Dossiers des employés, estimations de paie et conformité légale au Rwanda.',add:'Ajouter un employé',employees:'Répertoire des employés',name:'Nom légal complet',number:'Numéro d’employé',type:'Classification',permanent:'Employé permanent',casual:'Travailleur occasionnel',secondary:'Employeur secondaire',title:'Poste',dept:'Département',start:'Date de début',salary:'Salaire mensuel de base (RWF)',transport:'Indemnité de transport (RWF)',taxid:'Identifiant fiscal RRA (facultatif)',rssb:'Numéro RSSB (facultatif)',save:'Enregistrer',estimate:'Estimation de paie',basic:'Salaire mensuel de base (RWF)',calc:'Calculer',rules:'Obligations légales au Rwanda',notice:'Cette première version gère les dossiers et les estimations sans comptabilisation. Elle ne déclare pas les impôts, ne paie pas les salaires et ne comptabilise pas d’écritures.',empty:'Aucun employé ajouté.',loading:'Chargement des employés…',gross:'Salaire brut',paye:'PAYE',empPension:'Pension employé',erPension:'Pension employeur',oh:'Risques professionnels employeur 2%',net:'Salaire net estimé',cost:'Coût employeur estimé',status:'Statut',class:'Classification',actions:'Action',saved:'Employé enregistré.',failed:'Échec de l’enregistrement : ',reminders:'Rappels de paie et obligations',noReminders:'Aucun rappel de paie actuellement dû.',ruleLoad:'Règles de paie du Rwanda par date',source:'Règles officielles chargées',verify:'Les autres éléments (maternité, CBHI, avantages en nature et exemptions) doivent être vérifiés avant validation finale.'}
  };
  function lang(){const el=document.getElementById('aibosLanguageSelect')||document.querySelector('#aibosLanguageSwitcher select');const v=String(el&&el.value||document.documentElement.lang||'en').toLowerCase();return v.startsWith('rw')||v.startsWith('ki')?'rw':v.startsWith('fr')?'fr':'en'}
  function t(k){return (copy[lang()]||copy.en)[k]||copy.en[k]||k}
  function translateHeader(){const d=copy[lang()]||copy.en;const title=document.querySelector('#payroll .top h1');const subtitle=document.querySelector('#payroll .top .sub');if(title)title.textContent=d.pageTitle;if(subtitle)subtitle.textContent=d.pageSubtitle;const nav=document.querySelector('#aibosCommandSubnav button[onclick*=\"payroll\"]');if(nav)nav.textContent=lang()==='rw'?'Imishahara':lang()==='fr'?'Paie':'Payroll'}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function money(n){return Math.round(Number(n)||0).toLocaleString('en-RW')+' RWF'}
  function today(){return new Date().toISOString().slice(0,10)}
  function tax(g,type){
    g=Math.max(0,Number(g)||0);
    if(type==='secondary_employer')return Math.ceil(g*.30);
    if(type==='casual')return Math.ceil(Math.max(0,g-60000)*.15);
    return Math.ceil(Math.max(0,Math.min(g,100000)-60000)*.10+Math.max(0,Math.min(g,200000)-100000)*.20+Math.max(0,g-200000)*.30);
  }
  host.innerHTML=`
    <div class="card" style="border-left:4px solid #d6ad45"><strong>Rwanda payroll compliance</strong><div class="sub">${t('notice')}</div></div>
    <div class="grid2" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:14px">
      <div class="card"><h2>${t('add')}</h2><div class="formgrid">
        <div><label>${t('name')}</label><input id="payrollName" autocomplete="name"></div>
        <div><label>${t('number')}</label><input id="payrollNumber"></div>
        <div><label>${t('type')}</label><select id="payrollType"><option value="permanent">${t('permanent')}</option><option value="casual">${t('casual')}</option><option value="secondary_employer">${t('secondary')}</option></select></div>
        <div><label>${t('title')}</label><input id="payrollTitle"></div>
        <div><label>${t('dept')}</label><input id="payrollDept"></div>
        <div><label>${t('start')}</label><input id="payrollStart" type="date" value="${today()}"></div>
        <div><label>${t('salary')}</label><input id="payrollSalary" type="number" min="0" step="1"></div>
        <div><label>${t('transport')}</label><input id="payrollTransport" type="number" min="0" step="1" value="0"></div>
        <div><label>${t('taxid')}</label><input id="payrollTaxId"></div>
        <div><label>${t('rssb')}</label><input id="payrollRssb"></div>
      </div><div class="actions" style="margin-top:12px"><button class="btn" id="payrollSave">${t('save')}</button></div><div id="payrollSaveStatus" class="sub" role="status"></div></div>
      <div class="card"><h2>${t('employees')}</h2><div id="payrollEmployees" class="sub">${t('loading')}</div></div>
    </div>
    <div class="card" style="margin-top:14px"><h2>${t('estimate')}</h2><div class="formgrid">
      <div><label>${t('type')}</label><select id="payrollCalcType"><option value="permanent">${t('permanent')}</option><option value="casual">${t('casual')}</option><option value="secondary_employer">${t('secondary')}</option></select></div>
      <div><label>${t('period')}</label><input id="payrollCalcPeriod" type="month" value="${new Date().toISOString().slice(0,7)}"></div>
      <div><label>${t('basic')}</label><input id="payrollCalcBasic" type="number" min="0" value="300000"></div>
      <div><label>${t('transport')}</label><input id="payrollCalcTransport" type="number" min="0" value="0"></div>
      <div style="display:flex;align-items:end"><button class="btn" id="payrollCalculate">${t('calc')}</button></div>
    </div><div id="payrollCalcResult" style="margin-top:14px"></div></div>
    <div class="card" style="margin-top:14px"><h2>${t('rules')}</h2><div class="grid3" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
      <div class="card"><strong>PAYE</strong><div class="sub">0% / 10% / 20% / 30% progressive bands. Due by the 15th of the following month. Eligible small taxpayers may elect quarterly PAYE; RSSB remains monthly.</div></div>
      <div class="card"><strong>RSSB Pension</strong><div class="sub">12% total in 2026 (6% employee + 6% employer); 14% from Jan 2027, 16% from 2028, 18% from 2029 and 20% from 2030. Base includes transport allowance.</div></div>
      <div class="card"><strong>Occupational Hazards</strong><div class="sub">2% employer contribution. Separate declaration and payment required from November 2026.</div></div>
    </div><div id="payrollRuleStatus" class="sub" style="margin-top:10px"></div><div class="sub" style="margin-top:8px">${t('verify')}</div></div>
  `;
  const saveBtn=document.getElementById('payrollSave');
  saveBtn.addEventListener('click',saveEmployee);
  document.getElementById('payrollCalculate').addEventListener('click',calculate);
  async function loadEmployees(){
    const el=document.getElementById('payrollEmployees');if(!el)return;
    el.textContent=t('loading');
    try{
      if(!sb||!state.merchant)throw new Error('Open a merchant account first.');
      const {data,error}=await sb.from('payroll_employees').select('id,employee_number,legal_name,employment_type,job_title,base_salary,status').eq('merchant_id',state.merchant.id).order('legal_name');
      if(error)throw error;
      if(!data||!data.length){el.textContent=t('empty');return}
      el.innerHTML='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>'+t('name')+'</th><th>'+t('class')+'</th><th>'+t('salary')+'</th><th>'+t('status')+'</th></tr></thead><tbody>'+data.map(e=>'<tr><td><strong>'+esc(e.legal_name)+'</strong><div class="sub">'+esc(e.employee_number)+' · '+esc(e.job_title||'')+'</div></td><td>'+esc(e.employment_type.replaceAll('_',' '))+'</td><td>'+money(e.base_salary)+'</td><td>'+esc(e.status)+'</td></tr>').join('')+'</tbody></table></div>';
    }catch(e){el.textContent='Payroll records unavailable: '+(e.message||String(e))}
  }
  async function saveEmployee(){
    const status=document.getElementById('payrollSaveStatus');status.textContent='';
    try{
      if(!sb||!state.merchant)throw new Error('Open a merchant account first.');
      const val=id=>document.getElementById(id).value.trim();
      const legal=val('payrollName'),number=val('payrollNumber'),salary=Number(val('payrollSalary')),transport=Number(val('payrollTransport'));
      if(!legal||!number||!val('payrollStart')||!Number.isFinite(salary)||salary<0||!Number.isFinite(transport)||transport<0)throw new Error('Full legal name, employee number, start date and valid salary amounts are required.');
      const row={merchant_id:state.merchant.id,employee_number:number,legal_name:legal,employment_type:val('payrollType'),job_title:val('payrollTitle')||null,department:val('payrollDept')||null,hire_date:val('payrollStart'),base_salary:salary,transport_allowance:transport,tax_identifier:val('payrollTaxId')||null,rssb_member_number:val('payrollRssb')||null,status:'active'};
      const {error}=await sb.from('payroll_employees').insert(row);if(error)throw error;
      status.textContent=t('saved');
      ['payrollName','payrollNumber','payrollTitle','payrollDept','payrollSalary','payrollTaxId','payrollRssb'].forEach(id=>document.getElementById(id).value='');
      document.getElementById('payrollTransport').value='0';await loadEmployees();
    }catch(e){status.textContent=t('failed')+(e.message||String(e))}
  }
  function calculate(){
    const type=document.getElementById('payrollCalcType').value,period=document.getElementById('payrollCalcPeriod').value,basic=Number(document.getElementById('payrollCalcBasic').value),transport=Number(document.getElementById('payrollCalcTransport').value),el=document.getElementById('payrollCalcResult');
    if(!period||!Number.isFinite(basic)||!Number.isFinite(transport)||basic<0||transport<0){el.textContent='Enter a payroll month and valid non-negative amounts.';return}
    const gross=basic+transport,paye=tax(gross,type),pensionTotalRate=period>='2030-01' ? 0.20 : period>='2029-01' ? 0.18 : period>='2028-01' ? 0.16 : period>='2027-01' ? 0.14 : 0.12,pensionEmployeeRate=pensionTotalRate/2,employeePension=Math.round(gross*pensionEmployeeRate),employerPension=Math.round(gross*pensionEmployeeRate),hazards=Math.round(basic*.02),net=gross-paye-employeePension,cost=gross+employerPension+hazards;
    const rows=[[t('gross'),gross],[t('paye'),paye],[t('empPension'),employeePension],[t('erPension'),employerPension],[t('oh'),hazards],[t('net'),net],[t('cost'),cost]];
    el.innerHTML='<div class="sub">Pension rate for '+esc(period)+': '+Math.round(pensionTotalRate*100)+'% total ('+Math.round(pensionEmployeeRate*100)+'% employee / '+Math.round(pensionEmployeeRate*100)+'% employer).</div><div class="grid3" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">'+rows.map(x=>'<div class="card"><div class="sub">'+esc(x[0])+'</div><strong>'+money(x[1])+'</strong></div>').join('')+'</div><div class="sub" style="margin-top:8px">Estimate only. PAYE is based on RRA bands. Pension includes transport. Occupational Hazards is estimated on basic salary excluding transport; confirm the employee-specific contribution base with RSSB. Other deductions and taxable benefits are not included.</div>';
  }
  async function loadRules(){
    const el=document.getElementById('payrollRuleStatus');if(!el)return;
    try{const {data,error}=await sb.from('payroll_rule_sets').select('rule_code,effective_from,verification_status').eq('jurisdiction','RW').order('effective_from',{ascending:false});if(error)throw error;el.textContent=t('source')+': '+(data||[]).filter(x=>x.verification_status==='verified').map(x=>x.rule_code+' '+x.effective_from).join(' · ')}catch(e){el.textContent='Statutory rules will load after the payroll database migration is deployed.'}
  }
  async function ensureStatutoryReminders(){
    if(!state.merchant||!sb)return;
    const now=new Date(),due=new Date(now.getFullYear(),now.getMonth()+(now.getDate()>15?1:0),15);
    const dueOn=due.getFullYear()+'-'+String(due.getMonth()+1).padStart(2,'0')+'-15';
    const remind=new Date(due);remind.setDate(remind.getDate()-5);
    const remindOn=remind.getFullYear()+'-'+String(remind.getMonth()+1).padStart(2,'0')+'-'+String(remind.getDate()).padStart(2,'0');
    const period=due.getFullYear()+'-'+String(due.getMonth()+1).padStart(2,'0');
    const rows=[
      ['paye_due','PAYE declaration and payment','Prepare and submit the PAYE declaration and payment to RRA by the 15th.','paye'],
      ['pension_due','RSSB Pension contribution','Declare and pay Pension (12%) separately by the 15th.','pension'],
      ['occupational_hazards_due','RSSB Occupational Hazards contribution','Declare and pay Occupational Hazards (2%) separately by the 15th.','occupational-hazards']
    ].map(x=>({merchant_id:state.merchant.id,reminder_type:x[0],title:x[1],message:x[2],due_on:dueOn,remind_on:remindOn,status:'open',idempotency_key:x[3]+'-'+period}));
    const {error}=await sb.from('payroll_reminders').upsert(rows,{onConflict:'merchant_id,idempotency_key',ignoreDuplicates:true});
    if(error)throw error;
  }
  async function ensureRunReminders(){
    if(!state.merchant||!sb)return;
    const {data:runs,error}=await sb.from('payroll_pay_runs').select('id,run_number,pay_date,status,net_pay_total').eq('merchant_id',state.merchant.id).in('status',['draft','submitted','approved','posted','partially_paid','paid']);
    if(error)throw error;
    const reminders=[];
    for(const run of runs||[]){
      const payDate=new Date(run.pay_date+'T00:00:00');
      const makeDate=days=>{const d=new Date(payDate);d.setDate(d.getDate()-days);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
      if(run.status==='paid'){
        await sb.from('payroll_reminders').update({status:'completed',completed_at:new Date().toISOString()}).eq('merchant_id',state.merchant.id).eq('pay_run_id',run.id).eq('status','open');
        continue;
      }
      if(run.status!=='draft')await sb.from('payroll_reminders').update({status:'completed',completed_at:new Date().toISOString()}).eq('merchant_id',state.merchant.id).eq('pay_run_id',run.id).eq('reminder_type','prepare_payroll').eq('status','open');
      if(!['draft','submitted'].includes(run.status))await sb.from('payroll_reminders').update({status:'completed',completed_at:new Date().toISOString()}).eq('merchant_id',state.merchant.id).eq('pay_run_id',run.id).eq('reminder_type','approve_payroll').eq('status','open');
      if(run.status==='draft')reminders.push({merchant_id:state.merchant.id,pay_run_id:run.id,reminder_type:'prepare_payroll',title:'Prepare payroll run '+run.run_number,message:'Review employee earnings and deductions before the payroll approval stage.',due_on:run.pay_date,remind_on:makeDate(5),status:'open',idempotency_key:'prepare-'+run.id});
      if(run.status==='submitted')reminders.push({merchant_id:state.merchant.id,pay_run_id:run.id,reminder_type:'approve_payroll',title:'Approve payroll run '+run.run_number,message:'Review and approve the payroll before its scheduled pay date.',due_on:run.pay_date,remind_on:makeDate(3),status:'open',idempotency_key:'approve-'+run.id});
      if(['approved','posted','partially_paid'].includes(run.status))reminders.push({merchant_id:state.merchant.id,pay_run_id:run.id,reminder_type:'pay_salaries',title:'Pay salaries for run '+run.run_number,message:'Salary payments totaling '+money(run.net_pay_total)+' are due on '+run.pay_date+'. Record payment only after it has actually been made.',due_on:run.pay_date,remind_on:run.pay_date,status:'open',idempotency_key:'pay-salaries-'+run.id});
    }
    if(reminders.length){const {error:writeError}=await sb.from('payroll_reminders').upsert(reminders,{onConflict:'merchant_id,idempotency_key',ignoreDuplicates:true});if(writeError)throw writeError}
  }
  window.dismissPayrollReminder=async function(id){
    try{const {error}=await sb.from('payroll_reminders').update({status:'dismissed'}).eq('id',id).eq('merchant_id',state.merchant.id);if(error)throw error;loadDashboardReminders()}catch(e){alert('Could not dismiss reminder: '+(e.message||String(e)))}
  };
  async function loadDashboardReminders(){
    const dashboard=document.getElementById('dashboard');if(!dashboard||!state.merchant||!sb)return;
    let panel=document.getElementById('payrollDashboardReminders');
    if(!panel){panel=document.createElement('div');panel.id='payrollDashboardReminders';panel.className='card';const top=dashboard.querySelector('.top');if(top)top.insertAdjacentElement('afterend',panel);else dashboard.prepend(panel)}
    try{
      await ensureStatutoryReminders();
      await ensureRunReminders();
      const visibleUntil=new Date();visibleUntil.setDate(visibleUntil.getDate()+30);
      const horizon=visibleUntil.getFullYear()+'-'+String(visibleUntil.getMonth()+1).padStart(2,'0')+'-'+String(visibleUntil.getDate()).padStart(2,'0');
      const {data,error}=await sb.from('payroll_reminders').select('id,title,message,due_on,remind_on,status').eq('merchant_id',state.merchant.id).eq('status','open').lte('remind_on',horizon).order('due_on').limit(10);
      if(error)throw error;
      panel.innerHTML='<strong>'+t('reminders')+'</strong><div class="sub">'+(data&&data.length?data.map(x=>'<div style="padding:8px 0;border-bottom:1px solid #ddd"><b>'+esc(x.title)+'</b> · '+esc(x.due_on)+'<div>'+esc(x.message)+'</div><button class="btn secondary" style="margin-top:5px" onclick="dismissPayrollReminder(\''+esc(x.id)+'\')">Dismiss reminder</button></div>').join(''):t('noReminders'))+'</div>';
    }catch(e){panel.style.display='none'}
  }
  const oldShow=window.show;
  if(typeof oldShow==='function')window.show=function(view,...args){oldShow(view,...args);if(view==='payroll'){loadEmployees();loadRules()}if(view==='dashboard')loadDashboardReminders()};
  const languageControl=document.getElementById('aibosLanguageSelect')||document.querySelector('#aibosLanguageSwitcher select');
  const refreshLanguage=()=>{translateHeader();if(document.getElementById('payroll')?.classList.contains('active'))location.reload()};
  if(languageControl)languageControl.addEventListener('change',refreshLanguage);
  window.addEventListener('aibos:languagechange',refreshLanguage);
  window.aibosPayrollRefresh=()=>{loadEmployees();loadRules();loadDashboardReminders()};
  translateHeader();
  if(document.getElementById('payroll')?.classList.contains('active')){loadEmployees();loadRules()}
})();
