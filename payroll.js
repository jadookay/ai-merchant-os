/* AIBOS Rwanda payroll first slice. Payroll data is tenant-isolated by RLS. */
(function(){
  const host=document.getElementById('payrollAppHost');
  if(!host)return;
  const copy={
    en:{period:'Payroll month',pageTitle:'Payroll',pageSubtitle:'Employee records, payroll estimates and Rwanda statutory compliance.',add:'Add employee',employees:'Employee directory',name:'Full legal name',number:'Employee number',type:'Employment classification',permanent:'Permanent employee',casual:'Casual labourer',secondary:'Secondary employer',title:'Job title',dept:'Department',start:'Start date',salary:'Basic monthly salary (RWF)',transport:'Transport allowance (RWF)',taxid:'RRA tax ID (optional)',rssb:'RSSB member number (optional)',casualDays:'Total casual engagement days in this tax year (1–29 for 15% treatment)',casualConfirm:'I confirm this is unskilled work, uses no special-skill machinery, and the engagement does not exceed 30 days in the tax period.',secondaryConfirm:'I confirm this is not the employee’s primary employer; apply the 30% PAYE rule.',taxableBenefits:'Monthly taxable benefits in kind (RWF)',benefitHelp:'Enter the RRA-valued monthly amount: employer vehicle 10%, accommodation 20%, other benefits at market value.',save:'Save employee',estimate:'Payroll estimate',basic:'Basic monthly pay (RWF)',calc:'Calculate estimate',rules:'Rwanda statutory requirements',notice:'Payroll runs calculate Rwanda statutory estimates and support approval, audited accounting posting and recording actual salary payments. RRA/RSSB declarations and bank or mobile-money transfers remain external; verify statutory details before approval.',empty:'No employees have been added.',loading:'Loading employees…',gross:'Gross pay',paye:'PAYE',empPension:'Employee pension',erPension:'Employer pension',oh:'Employer occupational hazards 2%',net:'Estimated net salary',cost:'Estimated employer cost',status:'Status',class:'Classification',actions:'Action',saved:'Employee saved.',failed:'Could not save employee: ',reminders:'Payroll and statutory reminders',noReminders:'No payroll reminders are currently due.',ruleLoad:'Effective-dated Rwanda payroll rules',source:'Official rule set loaded',verify:'Benefits in kind, special exemptions and the CBHI net-salary interpretation still need employer-specific review before final approval.',maternity:'Maternity leave benefits: 0.6% of gross salary excluding transport (0.3% employee + 0.3% employer).',cbhi:'CBHI: 0.5% of employee net salary, withheld and paid monthly by the employer.',empMaternity:'Employee maternity contribution',erMaternity:'Employer maternity contribution',cbhiDeduct:'CBHI employee deduction',complianceTitle:'Rwanda payroll compliance',payeTitle:'PAYE',pensionTitle:'RSSB Pension',hazardsTitle:'Occupational Hazards',maternityTitle:'Maternity Leave Benefits',cbhiTitle:'CBHI',payeTitleReminder:'PAYE declaration and payment',payeMsg:'Prepare and submit the PAYE declaration and payment to RRA by the 15th.',pensionTitleReminder:'RSSB Pension contribution',pensionMsg:'Declare and pay Pension separately by the 15th.',hazardsTitleReminder:'RSSB Occupational Hazards contribution',hazardsMsg:'Declare and pay Occupational Hazards separately by the 15th.',maternityTitleReminder:'RSSB Maternity Leave Benefits contribution',maternityMsg:'Declare and pay the maternity contribution by the 15th.',cbhiTitleReminder:'CBHI employee contribution',cbhiMsg:'Withhold and pay the employee CBHI contribution by the 15th.',prepareRunTitle:'Prepare payroll run',prepareRunMsg:'Review employee earnings and deductions before approval.',approveRunTitle:'Approve payroll run',approveRunMsg:'Review and approve payroll before the scheduled pay date.',payRunTitle:'Pay salaries for run',payRunMsg:'Record salary payment only after the transfer has actually been made.',editEmployee:'Edit employee',history:'Salary history',compensationHistory:'Compensation history',compensationEffective:'Effective date',compensationReason:'Reason for change',saveChanges:'Save changes',noHistory:'No compensation history found.',active:'Active',onLeave:'On leave',terminated:'Terminated',draft:'Draft',submitted:'Submitted',approvedStatus:'Approved',posted:'Posted',partiallyPaid:'Partially paid',paidStatus:'Paid',voidStatus:'Voided',dismiss:'Dismiss reminder',submittedMsg:'Payroll submitted for approval.',approvedMsg:'Payroll approved.',postedMsg:'Payroll journal posted:',rssbRegistrationTitle:'Register employee with RSSB',rssbRegistrationMsg:'Register this employee for mandatory pension and occupational hazards within the first 8 days of work.',payeSchedule:'PAYE filing schedule',frequency:'Filing frequency',monthly:'Monthly',quarterly:'Quarterly (eligible employers only)',turnover:'Annual turnover (RWF)',quarterlyConfirm:'I have registered/elected quarterly PAYE with RRA and my annual turnover is below RWF 200 million.',saveSettings:'Save PAYE settings',settingsSaved:'PAYE settings saved.',settingsError:'Could not save PAYE settings: ',runs:'Payroll runs',runNumber:'Run number',periodStart:'Period starts',periodEnd:'Period ends',payDate:'Salary payment date',createRun:'Create draft payroll',noRuns:'No payroll runs yet.',submit:'Submit for approval',approve:'Approve payroll',post:'Post to accounting',pay:'Record salary payment',payslips:'View payslips',createdRun:'Draft payroll created.',runFailed:'Payroll action failed: ',amount:'Payment amount (RWF)',method:'Payment method (bank/mobile_money/cash)',reference:'Payment reference (optional)',paid:'Payment recorded.',viewItems:'Payroll details',grossTotal:'Gross total',netTotal:'Net salaries',employerCost:'Employer contributions'},
    rw:{period:'Ukwezi kw’imishahara',pageTitle:'Imishahara',pageSubtitle:'Amakuru y’abakozi, igereranya ry’imishahara n’amategeko y’u Rwanda.',add:'Ongeramo umukozi',employees:'Urutonde rw’abakozi',name:'Amazina yuzuye yemewe',number:'Nimero y’umukozi',type:'Icyiciro cy’umukozi',permanent:'Umukozi uhoraho',casual:'Umukozi w’igihe gito',secondary:'Umukoresha wa kabiri',title:'Umwanya w’akazi',dept:'Ishami',start:'Itariki yatangiriyeho',salary:'Umushahara fatizo wa buri kwezi (RWF)',transport:'Amafaranga y’urugendo (RWF)',taxid:'Nimero y’umusoro ya RRA (si ngombwa)',rssb:'Nimero ya RSSB (si ngombwa)',casualDays:'Iminsi yose y’akazi k’igihe gito muri uyu mwaka w’umusoro (1–29 kugira ngo hakoreshwe 15%)',casualConfirm:'Ndemeza ko ari akazi kadasaba ubumenyi bwihariye cyangwa imashini zihariye, kandi katarenza iminsi 30 mu gihe cy’umusoro.',secondaryConfirm:'Ndemeza ko uyu atari umukoresha wa mbere w’umukozi; koresha umusoro wa 30%.',taxableBenefits:'Agaciro k’inyungu zitangwa mu bintu buri kwezi (RWF)',benefitHelp:'Andika agaciro kabazwe hakurikijwe RRA: imodoka 10%, icumbi 20%, izindi nyungu ku gaciro k’isoko.',save:'Bika umukozi',estimate:'Igereranya ry’umushahara',basic:'Umushahara fatizo wa buri kwezi (RWF)',calc:'Bara igereranya',rules:'Amategeko y’imisoro n’imisanzu mu Rwanda',notice:'Iki cyiciro kibika abakozi, kibara imishahara, cyohereza kwemezwa, kigakora inyandiko z’ibaruramari kandi kikandika ubwishyu bwakozwe. Amatangazo ya RRA/RSSB n’iyoherezwa ry’amafaranga bikorwa hanze y’iyi porogaramu.',empty:'Nta bakozi barongerwamo.',loading:'Turimo kuzana abakozi…',gross:'Umushahara mbumbe',paye:'PAYE',empPension:'Pansiyo y’umukozi',erPension:'Pansiyo y’umukoresha',oh:'Imisanzu y’impanuka ku kazi 2%',net:'Umushahara usigara ugereranyijwe',cost:'Igiciro cyose ku mukoresha',status:'Imiterere',class:'Icyiciro',actions:'Igikorwa',saved:'Umukozi yabitswe.',failed:'Ntibyashobotse kubika umukozi: ',reminders:'Ibibutsa imishahara n’imisoro',noReminders:'Nta kibutsa cy’imishahara kirageze.',ruleLoad:'Amategeko y’imishahara afite amatariki',source:'Amategeko yemewe yafunguwe',verify:'Inyungu zitangirwa mu bintu, ubusonerwe bwihariye n’uburyo bwo kubara umushahara ushingirwaho CBHI bigomba kugenzurwa n’umukoresha mbere yo kwemeza.',maternity:'Ubwishingizi bw’ikiruhuko cyo kubyara: 0.6% by’umushahara utarimo amafaranga y’urugendo (0.3% umukozi + 0.3% umukoresha).',cbhi:'CBHI: 0.5% by’umushahara usigara w’umukozi, umukoresha akayakata kandi akayishyura buri kwezi.',empMaternity:'Umusanzu w’umukozi w’ikiruhuko cyo kubyara',erMaternity:'Umusanzu w’umukoresha w’ikiruhuko cyo kubyara',cbhiDeduct:'Umusanzu wa CBHI ukatwa ku mukozi',complianceTitle:'Amategeko agenga imishahara mu Rwanda',payeTitle:'PAYE',pensionTitle:'Pansiyo ya RSSB',hazardsTitle:'Impanuka zo ku kazi',maternityTitle:'Ubwishingizi bw’ikiruhuko cyo kubyara',cbhiTitle:'CBHI',payeTitleReminder:'Itangazo n’ubwishyu bwa PAYE',payeMsg:'Tegura kandi utange itangazo n’ubwishyu bwa PAYE muri RRA bitarenze tariki ya 15.',pensionTitleReminder:'Umusanzu wa pansiyo ya RSSB',pensionMsg:'Menyesha kandi wishyure umusanzu wa pansiyo bitarenze tariki ya 15.',hazardsTitleReminder:'Umusanzu w’impanuka zo ku kazi',hazardsMsg:'Menyesha kandi wishyure umusanzu w’impanuka zo ku kazi bitarenze tariki ya 15.',maternityTitleReminder:'Umusanzu w’ikiruhuko cyo kubyara',maternityMsg:'Menyesha kandi wishyure umusanzu w’ikiruhuko cyo kubyara bitarenze tariki ya 15.',cbhiTitleReminder:'Umusanzu wa CBHI w’umukozi',cbhiMsg:'Kata kandi wishyure umusanzu wa CBHI w’umukozi bitarenze tariki ya 15.',prepareRunTitle:'Tegura icyiciro cy’imishahara',prepareRunMsg:'Suzuma imishahara n’ibyakatwa mbere yo kwemeza.',approveRunTitle:'Emeza icyiciro cy’imishahara',approveRunMsg:'Suzuma kandi wemeze imishahara mbere y’itariki yo kwishyura.',payRunTitle:'Ishyura imishahara',payRunMsg:'Andika ubwishyu nyuma y’uko amafaranga yoherejwe koko.',editEmployee:'Hindura umukozi',history:'Amateka y’umushahara',compensationHistory:'Amateka y’imihindagurikire y’umushahara',compensationEffective:'Itariki impinduka zitangirira',compensationReason:'Impamvu y’impinduka',saveChanges:'Bika impinduka',noHistory:'Nta mateka y’imishahara aboneka.',active:'Arakora',onLeave:'Ari mu kiruhuko',terminated:'Yahagaritswe',draft:'Agateganyo',submitted:'Yoherejwe',approvedStatus:'Yemejwe',posted:'Yashyizwe mu ibaruramari',partiallyPaid:'Yishyuwe igice',paidStatus:'Yishyuwe',voidStatus:'Yateshejwe agaciro',dismiss:'Hisha iki kibutsa',submittedMsg:'Imishahara yoherejwe kwemezwa.',approvedMsg:'Imishahara yemejwe.',postedMsg:'Inyandiko y’imishahara yashyizwe mu ibaruramari:',rssbRegistrationTitle:'Iyandikishe ry’umukozi muri RSSB',rssbRegistrationMsg:'Andikisha uyu mukozi muri pansiyo n’impanuka zo ku kazi mu minsi 8 ya mbere y’akazi.',payeSchedule:'Gahunda yo gutanga PAYE',frequency:'Inshuro yo gutanga',monthly:'Buri kwezi',quarterly:'Buri mezi atatu (abemerewe gusa)',turnover:'Amafaranga yose yinjijwe mu mwaka (RWF)',quarterlyConfirm:'Niyandikishije cyangwa nemerewe gutanga PAYE buri mezi atatu muri RRA kandi amafaranga ninjiza mu mwaka ari munsi ya miliyoni 200 RWF.',saveSettings:'Bika igenamiterere rya PAYE',settingsSaved:'Igenamiterere rya PAYE ryabitswe.',settingsError:'Ntibyashobotse kubika igenamiterere rya PAYE: ',runs:'Ibyiciro by’imishahara',runNumber:'Nimero y’icyiciro',periodStart:'Igihe gitangira',periodEnd:'Igihe kirangira',payDate:'Itariki yo kwishyura umushahara',createRun:'Kora icyiciro cy’agateganyo',noRuns:'Nta cyiciro cy’imishahara kirakorwa.',submit:'Ohereza kwemezwa',approve:'Emeza imishahara',post:'Ohereza mu ibaruramari',pay:'Andika ubwishyu bw’imishahara',payslips:'Reba inyemezabwishyu',createdRun:'Icyiciro cy’agateganyo cyakozwe.',runFailed:'Igikorwa cy’imishahara cyanze: ',amount:'Amafaranga yishyuwe (RWF)',method:'Uburyo bwo kwishyura (bank/mobile_money/cash)',reference:'Nomero y’ubwishyu (si ngombwa)',paid:'Ubwishyu bwanditswe.',viewItems:'Ibisobanuro by’imishahara',grossTotal:'Umushahara mbumbe wose',netTotal:'Imishahara isigaye yose',employerCost:'Imisanzu y’umukoresha'},
    fr:{period:'Mois de paie',pageTitle:'Paie',pageSubtitle:'Dossiers des employés, estimations de paie et conformité légale au Rwanda.',add:'Ajouter un employé',employees:'Répertoire des employés',name:'Nom légal complet',number:'Numéro d’employé',type:'Classification',permanent:'Employé permanent',casual:'Travailleur occasionnel',secondary:'Employeur secondaire',title:'Poste',dept:'Département',start:'Date de début',salary:'Salaire mensuel de base (RWF)',transport:'Indemnité de transport (RWF)',taxid:'Identifiant fiscal RRA (facultatif)',rssb:'Numéro RSSB (facultatif)',casualDays:'Total des jours de travail occasionnel cette année fiscale (1–29 pour le taux de 15 %)',casualConfirm:'Je confirme qu’il s’agit d’un travail non qualifié, sans équipement nécessitant des compétences particulières, et ne dépassant pas 30 jours dans la période fiscale.',secondaryConfirm:'Je confirme que cet employeur n’est pas l’employeur principal ; appliquer le taux PAYE de 30 %.',taxableBenefits:'Avantages en nature imposables mensuels (RWF)',benefitHelp:'Saisissez le montant mensuel évalué selon la RRA : véhicule 10 %, logement 20 %, autres avantages à la valeur du marché.',save:'Enregistrer',estimate:'Estimation de paie',basic:'Salaire mensuel de base (RWF)',calc:'Calculer',rules:'Obligations légales au Rwanda',notice:'Le module calcule les paies, permet l’approbation, la comptabilisation contrôlée et l’enregistrement des paiements réellement effectués. Les déclarations RRA/RSSB et les virements restent externes.',empty:'Aucun employé ajouté.',loading:'Chargement des employés…',gross:'Salaire brut',paye:'PAYE',empPension:'Pension employé',erPension:'Pension employeur',oh:'Risques professionnels employeur 2%',net:'Salaire net estimé',cost:'Coût employeur estimé',status:'Statut',class:'Classification',actions:'Action',saved:'Employé enregistré.',failed:'Échec de l’enregistrement : ',reminders:'Rappels de paie et obligations',noReminders:'Aucun rappel de paie actuellement dû.',ruleLoad:'Règles de paie du Rwanda par date',source:'Règles officielles chargées',verify:'Les avantages en nature, exemptions particulières et la méthode de calcul du salaire net CBHI doivent être vérifiés par l’employeur avant validation.',maternity:'Prestations de maternité : 0,6 % du salaire brut hors transport (0,3 % salarié + 0,3 % employeur).',cbhi:'CBHI : 0,5 % du salaire net du salarié, retenu et versé chaque mois par l’employeur.',empMaternity:'Cotisation maternité du salarié',erMaternity:'Cotisation maternité de l’employeur',cbhiDeduct:'Retenue CBHI du salarié',complianceTitle:'Conformité de la paie au Rwanda',payeTitle:'PAYE',pensionTitle:'Pension RSSB',hazardsTitle:'Risques professionnels',maternityTitle:'Prestations de maternité',cbhiTitle:'CBHI',payeTitleReminder:'Déclaration et paiement PAYE',payeMsg:'Préparez et déclarez la PAYE à la RRA au plus tard le 15.',pensionTitleReminder:'Cotisation pension RSSB',pensionMsg:'Déclarez et payez la pension au plus tard le 15.',hazardsTitleReminder:'Cotisation risques professionnels RSSB',hazardsMsg:'Déclarez et payez les risques professionnels au plus tard le 15.',maternityTitleReminder:'Cotisation prestations de maternité',maternityMsg:'Déclarez et payez la cotisation maternité au plus tard le 15.',cbhiTitleReminder:'Cotisation CBHI du salarié',cbhiMsg:'Retenez et payez la cotisation CBHI du salarié au plus tard le 15.',prepareRunTitle:'Préparer le cycle de paie',prepareRunMsg:'Vérifiez les rémunérations et retenues avant approbation.',approveRunTitle:'Approuver le cycle de paie',approveRunMsg:'Vérifiez et approuvez la paie avant la date prévue.',payRunTitle:'Payer les salaires',payRunMsg:'Enregistrez le paiement uniquement après le transfert réel.',editEmployee:'Modifier l’employé',history:'Historique salarial',compensationHistory:'Historique de rémunération',compensationEffective:'Date d’effet',compensationReason:'Motif du changement',saveChanges:'Enregistrer les modifications',noHistory:'Aucun historique de rémunération trouvé.',active:'Actif',onLeave:'En congé',terminated:'Terminé',draft:'Brouillon',submitted:'Soumis',approvedStatus:'Approuvé',posted:'Comptabilisé',partiallyPaid:'Partiellement payé',paidStatus:'Payé',voidStatus:'Annulé',dismiss:'Masquer ce rappel',submittedMsg:'Paie soumise pour approbation.',approvedMsg:'Paie approuvée.',postedMsg:'Écriture de paie comptabilisée :',rssbRegistrationTitle:'Inscription du salarié à la RSSB',rssbRegistrationMsg:'Inscrivez cet employé aux régimes de pension et risques professionnels dans les 8 premiers jours de travail.',payeSchedule:'Calendrier de déclaration PAYE',frequency:'Fréquence de déclaration',monthly:'Mensuelle',quarterly:'Trimestrielle (employeurs éligibles uniquement)',turnover:'Chiffre d’affaires annuel (RWF)',quarterlyConfirm:'J’ai enregistré/choisi la déclaration trimestrielle auprès de la RRA et mon chiffre d’affaires annuel est inférieur à 200 millions RWF.',saveSettings:'Enregistrer les paramètres PAYE',settingsSaved:'Paramètres PAYE enregistrés.',settingsError:'Impossible d’enregistrer les paramètres PAYE : ',runs:'Cycles de paie',runNumber:'Numéro du cycle',periodStart:'Début de période',periodEnd:'Fin de période',payDate:'Date de paiement des salaires',createRun:'Créer un brouillon de paie',noRuns:'Aucun cycle de paie pour le moment.',submit:'Soumettre pour approbation',approve:'Approuver la paie',post:'Comptabiliser',pay:'Enregistrer le paiement des salaires',payslips:'Voir les bulletins',createdRun:'Brouillon de paie créé.',runFailed:'Échec de l’opération de paie : ',amount:'Montant payé (RWF)',method:'Mode de paiement (bank/mobile_money/cash)',reference:'Référence de paiement (facultatif)',paid:'Paiement enregistré.',viewItems:'Détails de la paie',grossTotal:'Total brut',netTotal:'Salaires nets',employerCost:'Cotisations employeur'}
  };
  function lang(){const el=document.getElementById('aibosLanguageSelect')||document.querySelector('#aibosLanguageSwitcher select');const v=String(el&&el.value||document.documentElement.lang||'en').toLowerCase();return v.startsWith('rw')||v.startsWith('ki')?'rw':v.startsWith('fr')?'fr':'en'}
  function t(k){return (copy[lang()]||copy.en)[k]||copy.en[k]||k}
  function translateHeader(){const d=copy[lang()]||copy.en;const title=document.querySelector('#payroll .top h1');const subtitle=document.querySelector('#payroll .top .sub');if(title)title.textContent=d.pageTitle;if(subtitle)subtitle.textContent=d.pageSubtitle;const nav=document.querySelector('#aibosCommandSubnav button[onclick*=\"payroll\"]');if(nav)nav.textContent=lang()==='rw'?'Imishahara':lang()==='fr'?'Paie':'Payroll'}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function money(n){return Math.round(Number(n)||0).toLocaleString('en-RW')+' RWF'}
  function today(){return new Date().toISOString().slice(0,10)}
  function tax(g,type){
    g=Math.max(0,Number(g)||0);
    if(type==='secondary_employer')return Math.round(g*.30);
    if(type==='casual')return Math.round(g*.15);
    return Math.round(Math.max(0,Math.min(g,100000)-60000)*.10+Math.max(0,Math.min(g,200000)-100000)*.20+Math.max(0,g-200000)*.30);
  }
  host.innerHTML=`
    <div class="card" style="border-left:4px solid #d6ad45"><strong>${t('complianceTitle')}</strong><div class="sub">${t('notice')}</div></div>
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
        <div><label>${t('taxableBenefits')}</label><input id="payrollBenefits" type="number" min="0" step="1" value="0"><div class="sub">${t('benefitHelp')}</div></div>
        <div><label>${t('taxid')}</label><input id="payrollTaxId"></div>
        <div><label>${t('rssb')}</label><input id="payrollRssb"></div>
        <div><label>${t('casualDays')}</label><input id="payrollCasualDays" type="number" min="1" max="29" placeholder="1–29"></div>
        <div style="display:flex;align-items:center;gap:8px"><input id="payrollCasualConfirm" type="checkbox"><label for="payrollCasualConfirm">${t('casualConfirm')}</label></div>
        <div style="display:flex;align-items:center;gap:8px"><input id="payrollSecondaryConfirm" type="checkbox"><label for="payrollSecondaryConfirm">${t('secondaryConfirm')}</label></div>
      </div><div class="actions" style="margin-top:12px"><button class="btn" id="payrollSave">${t('save')}</button></div><div id="payrollSaveStatus" class="sub" role="status"></div></div>
      <div class="card"><h2>${t('employees')}</h2><div id="payrollEmployees" class="sub">${t('loading')}</div></div>
    </div>
    <div class="card" style="margin-top:14px"><h2>${t('estimate')}</h2><div class="formgrid">
      <div><label>${t('type')}</label><select id="payrollCalcType"><option value="permanent">${t('permanent')}</option><option value="casual">${t('casual')}</option><option value="secondary_employer">${t('secondary')}</option></select></div>
      <div><label>${t('period')}</label><input id="payrollCalcPeriod" type="month" value="${new Date().toISOString().slice(0,7)}"></div>
      <div><label>${t('basic')}</label><input id="payrollCalcBasic" type="number" min="0" value="300000"></div>
      <div><label>${t('transport')}</label><input id="payrollCalcTransport" type="number" min="0" value="0"></div>
      <div><label>${t('taxableBenefits')}</label><input id="payrollCalcBenefits" type="number" min="0" value="0"><div class="sub">${t('benefitHelp')}</div></div>
      <div style="display:flex;align-items:end"><button class="btn" id="payrollCalculate">${t('calc')}</button></div>
    </div><div id="payrollCalcResult" style="margin-top:14px"></div></div>
    <div class="card" style="margin-top:14px"><h2>${t('payeSchedule')}</h2>
      <div class="formgrid">
        <div><label>${t('frequency')}</label><select id="payrollPayeFrequency"><option value="monthly">${t('monthly')}</option><option value="quarterly">${t('quarterly')}</option></select></div>
        <div><label>${t('turnover')}</label><input id="payrollAnnualTurnover" type="number" min="0" step="1" placeholder="200000000"></div>
        <div style="display:flex;align-items:center;gap:8px"><input id="payrollQuarterlyConfirm" type="checkbox"><label for="payrollQuarterlyConfirm">${t('quarterlyConfirm')}</label></div>
        <div style="display:flex;align-items:end"><button class="btn" id="payrollSaveSettings">${t('saveSettings')}</button></div>
      </div>
      <div id="payrollSettingsStatus" class="sub" role="status" style="margin-top:8px"></div>
    </div>
    <div class="card" style="margin-top:14px"><h2>${t('runs')}</h2>
      <div class="formgrid">
        <div><label>${t('runNumber')}</label><input id="payrollRunNumber" value="PAY-${new Date().toISOString().slice(0,7).replace('-','')}-01"></div>
        <div><label>${t('periodStart')}</label><input id="payrollRunStart" type="date" value="${new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().slice(0,10)}"></div>
        <div><label>${t('periodEnd')}</label><input id="payrollRunEnd" type="date" value="${new Date(new Date().getFullYear(),new Date().getMonth()+1,0).toISOString().slice(0,10)}"></div>
        <div><label>${t('payDate')}</label><input id="payrollRunPayDate" type="date" value="${new Date(new Date().getFullYear(),new Date().getMonth()+1,0).toISOString().slice(0,10)}"></div>
        <div style="display:flex;align-items:end"><button class="btn" id="payrollCreateRun">${t('createRun')}</button></div>
      </div>
      <div id="payrollRunStatus" class="sub" role="status" style="margin-top:8px"></div>
      <div id="payrollRunsList" style="margin-top:12px">${t('loading')}</div>
      <div id="payrollRunDetails" style="margin-top:12px"></div>
    </div>
    <div class="card" style="margin-top:14px"><h2>${t('rules')}</h2><div class="grid3" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
      <div class="card"><strong>${t('payeTitle')}</strong><div class="sub">0% / 10% / 20% / 30% progressive bands. Due by the 15th of the following month. Eligible small taxpayers may elect quarterly PAYE; RSSB remains monthly.</div></div>
      <div class="card"><strong>${t('pensionTitle')}</strong><div class="sub">12% total in 2026 (6% employee + 6% employer); 14% from Jan 2027, 16% from 2028, 18% from 2029 and 20% from 2030. Base includes transport allowance.</div></div>
      <div class="card"><strong>${t('hazardsTitle')}</strong><div class="sub">2% employer contribution. Separate declaration and payment required from November 2026.</div></div>
      <div class="card"><strong>${t('maternityTitle')}</strong><div class="sub">${t('maternity')}</div></div>
      <div class="card"><strong>${t('cbhiTitle')}</strong><div class="sub">${t('cbhi')}</div></div>
    </div><div id="payrollRuleStatus" class="sub" style="margin-top:10px"></div><div class="sub" style="margin-top:8px">${t('verify')}</div></div>
  `;
  host.dataset.lang=lang();
  const saveBtn=document.getElementById('payrollSave');
  saveBtn.addEventListener('click',saveEmployee);
  document.getElementById('payrollCalculate').addEventListener('click',calculate);
  document.getElementById('payrollCreateRun').addEventListener('click',createPayrollRun);
  document.getElementById('payrollSaveSettings').addEventListener('click',saveEmployerSettings);
  async function loadRuns(){
    const el=document.getElementById('payrollRunsList');if(!el||!sb||!state.merchant)return;
    el.textContent=t('loading');
    try{
      const {data,error}=await sb.from('payroll_pay_runs').select('id,run_number,period_start,period_end,pay_date,status,employee_count,gross_total,employee_deductions_total,employer_contributions_total,net_pay_total,amount_paid_total').eq('merchant_id',state.merchant.id).order('created_at',{ascending:false}).limit(20);
      if(error)throw error;
      if(!data||!data.length){el.textContent=t('noRuns');return}
      el.innerHTML='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>'+t('runNumber')+'</th><th>'+t('period')+'</th><th>'+t('status')+'</th><th>'+t('grossTotal')+'</th><th>'+t('netTotal')+'</th><th>'+t('actions')+'</th></tr></thead><tbody>'+data.map(r=>{
        let action='';
        if(r.status==='draft')action='<button class="btn" onclick="aibosPayrollRunAction(\''+r.id+'\',\'submit\')">'+t('submit')+'</button>';
        if(r.status==='submitted')action='<button class="btn" onclick="aibosPayrollRunAction(\''+r.id+'\',\'approve\')">'+t('approve')+'</button>';
        if(r.status==='approved')action='<button class="btn" onclick="aibosPayrollRunAction(\''+r.id+'\',\'post\')">'+t('post')+'</button>';
        if(['posted','partially_paid'].includes(r.status))action='<button class="btn" onclick="aibosPayrollPayRun(\''+r.id+'\',\''+r.net_pay_total+'\',\''+r.amount_paid_total+'\')">'+t('pay')+'</button>';
        const runStatus=({draft:t('draft'),submitted:t('submitted'),approved:t('approvedStatus'),posted:t('posted'),partially_paid:t('partiallyPaid'),paid:t('paidStatus'),void:t('voidStatus')}[r.status]||r.status);return '<tr><td><strong>'+esc(r.run_number)+'</strong><div class="sub">'+esc(r.pay_date)+'</div></td><td>'+esc(r.period_start)+' – '+esc(r.period_end)+'</td><td>'+esc(runStatus)+'</td><td>'+money(r.gross_total)+'</td><td>'+money(r.net_pay_total)+'</td><td>'+action+' <button class="btn secondary" onclick="aibosPayrollPayslips(\''+r.id+'\')">'+t('payslips')+'</button></td></tr>';
      }).join('')+'</tbody></table></div>';
    }catch(e){el.textContent='Payroll runs unavailable: '+(e.message||String(e))}
  }
  async function createPayrollRun(){
    const status=document.getElementById('payrollRunStatus');status.textContent='';
    try{
      if(!sb||!state.merchant)throw new Error('Open a merchant account first.');
      const args={p_merchant_id:state.merchant.id,p_run_number:document.getElementById('payrollRunNumber').value.trim(),p_period_start:document.getElementById('payrollRunStart').value,p_period_end:document.getElementById('payrollRunEnd').value,p_pay_date:document.getElementById('payrollRunPayDate').value};
      if(!args.p_run_number||!args.p_period_start||!args.p_period_end||!args.p_pay_date)throw new Error('Complete the payroll run number and dates.');
      const {data,error}=await sb.rpc('shericeri_create_payroll_run',args);if(error)throw error;
      status.textContent=t('createdRun')+' '+String(data||'');
      await loadRuns();
    }catch(e){status.textContent=t('runFailed')+(e.message||String(e))}
  }
  window.aibosPayrollRunAction=async function(id,action){
    const map={submit:'shericeri_submit_payroll_run',approve:'shericeri_approve_payroll_run',post:'shericeri_post_payroll_run'};
    try{
      const fn=map[action];if(!fn)throw new Error('Unsupported payroll action.');
      const {data,error}=await sb.rpc(fn,{p_merchant_id:state.merchant.id,p_run_id:id});if(error)throw error;
      await loadRuns();await loadDashboardReminders();
      const status=document.getElementById('payrollRunStatus');if(status)status.textContent=action==='submit'?t('submittedMsg'):action==='approve'?t('approvedMsg'):t('postedMsg')+' '+String(data);
    }catch(e){const status=document.getElementById('payrollRunStatus');if(status)status.textContent=t('runFailed')+(e.message||String(e))}
  };
  window.aibosPayrollPayRun=async function(id,total,paid){
    try{
      const outstanding=Math.max(0,Number(total)-Number(paid));
      if(!outstanding)throw new Error('No outstanding salary balance remains.');
      const amountText=prompt(t('amount')+' (outstanding '+money(outstanding)+')',String(outstanding));
      if(amountText===null)return;
      const amount=Number(amountText);if(!Number.isFinite(amount)||amount<=0||amount>outstanding)throw new Error('Enter a positive amount not exceeding the outstanding balance.');
      const methodInput=prompt(t('method'),'bank');if(methodInput===null)return;const method=methodInput.trim().toLowerCase();
      if(!['bank','mobile_money','cash'].includes(method))throw new Error('Choose bank, mobile_money or cash.');
      const reference=prompt(t('reference'),'')||'';
      const storageKey='aibos-payroll-payment-'+id;let key=sessionStorage.getItem(storageKey);if(!key){key=(crypto.randomUUID?crypto.randomUUID():'PAYROLL-'+id+'-'+Date.now()+'-'+Math.random().toString(36).slice(2));sessionStorage.setItem(storageKey,key)}
      const {data,error}=await sb.rpc('shericeri_record_payroll_payment',{p_merchant_id:state.merchant.id,p_run_id:id,p_payment_date:today(),p_amount:amount,p_payment_method:method,p_reference:reference,p_idempotency_key:key});
      if(error)throw error;
      sessionStorage.removeItem(storageKey);
      const status=document.getElementById('payrollRunStatus');if(status)status.textContent=t('paid')+' '+String(data);
      await loadRuns();await loadDashboardReminders();
    }catch(e){const status=document.getElementById('payrollRunStatus');if(status)status.textContent=t('runFailed')+(e.message||String(e))}
  };
  window.aibosPayrollPayslips=async function(id){
    const panel=document.getElementById('payrollRunDetails');if(!panel)return;
    panel.textContent=t('loading');
    try{
      const {data,error}=await sb.from('payroll_pay_items').select('id,payslip_number,gross_pay,taxable_income,paye,pension_employee,pension_employer,occupational_hazards_employer,maternity_employee,maternity_employer,cbhi_employee,taxable_benefits_in_kind,net_pay,employer_cost,payroll_employees(legal_name,employee_number)').eq('merchant_id',state.merchant.id).eq('pay_run_id',id).order('created_at');
      if(error)throw error;
      panel.innerHTML='<strong>'+t('viewItems')+'</strong><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>'+t('name')+'</th><th>'+t('gross')+'</th><th>'+t('taxableBenefits')+'</th><th>'+t('paye')+'</th><th>'+t('empPension')+'</th><th>'+t('empMaternity')+'</th><th>'+t('cbhiDeduct')+'</th><th>'+t('net')+'</th></tr></thead><tbody>'+(data||[]).map(x=>'<tr><td><strong>'+esc(x.payroll_employees?.legal_name||'')+'</strong><div class="sub">'+esc(x.payslip_number||'')+'</div></td><td>'+money(x.gross_pay)+'</td><td>'+money(x.paye)+'</td><td>'+money(x.pension_employee)+'</td><td><strong>'+money(x.net_pay)+'</strong></td></tr>').join('')+'</tbody></table></div>';
      panel.scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(e){panel.textContent='Payslips unavailable: '+(e.message||String(e))}
  };
  async function loadEmployees(){
    const el=document.getElementById('payrollEmployees');if(!el)return;
    el.textContent=t('loading');
    try{
      if(!sb||!state.merchant)throw new Error('Open a merchant account first.');
      const {data,error}=await sb.from('payroll_employees').select('id,employee_number,legal_name,employment_type,job_title,base_salary,transport_allowance,casual_days_in_tax_year,casual_criteria_confirmed,compensation_effective_from,status').eq('merchant_id',state.merchant.id).order('legal_name');
      if(error)throw error;
      if(!data||!data.length){el.textContent=t('empty');return}
      el.innerHTML='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>'+t('name')+'</th><th>'+t('class')+'</th><th>'+t('salary')+'</th><th>'+t('status')+'</th><th>'+t('actions')+'</th></tr></thead><tbody>'+data.map(e=>'<tr><td><strong>'+esc(e.legal_name)+'</strong><div class="sub">'+esc(e.employee_number)+' · '+esc(e.job_title||'')+'</div></td><td>'+esc(e.employment_type==='permanent'?t('permanent'):e.employment_type==='casual'?t('casual'):t('secondary'))+'</td><td>'+money(e.base_salary)+'</td><td>'+esc(({active:t('active'),on_leave:t('onLeave'),terminated:t('terminated')}[e.status]||e.status))+'</td><td><button class="btn secondary" data-payroll-edit="'+e.id+'">'+t('editEmployee')+'</button> <button class="btn secondary" data-payroll-history="'+e.id+'">'+t('history')+'</button></td></tr>').join('')+'</tbody></table></div>';
      el.querySelectorAll('[data-payroll-edit]').forEach(b=>b.addEventListener('click',()=>window.aibosPayrollEditEmployee(b.dataset.payrollEdit)));
      el.querySelectorAll('[data-payroll-history]').forEach(b=>b.addEventListener('click',()=>window.aibosPayrollCompensationHistory(b.dataset.payrollHistory)));
    }catch(e){el.textContent='Payroll records unavailable: '+(e.message||String(e))}
  }
  window.aibosPayrollEditEmployee=async function(id){
    try{
      const {data:e,error}=await sb.from('payroll_employees').select('id,employment_type,base_salary,transport_allowance,taxable_benefits_in_kind,casual_days_in_tax_year,casual_criteria_confirmed,secondary_employer_confirmed,compensation_effective_from,rssb_member_number').eq('id',id).eq('merchant_id',state.merchant.id).single();
      if(error)throw error;
      const salaryText=prompt(t('salary'),String(e.base_salary));if(salaryText===null)return;
      const transportText=prompt(t('transport'),String(e.transport_allowance));if(transportText===null)return;
      const benefitsText=prompt(t('taxableBenefits'),String(e.taxable_benefits_in_kind||0));if(benefitsText===null)return;
      const salary=Number(salaryText),transport=Number(transportText),benefits=Number(benefitsText);
      if(!Number.isFinite(salary)||salary<0||!Number.isFinite(transport)||transport<0||!Number.isFinite(benefits)||benefits<0)throw new Error('Enter valid non-negative salary, transport and benefit amounts.');
      let casualDays=e.casual_days_in_tax_year,casualConfirmed=!!e.casual_criteria_confirmed;
      if(e.employment_type==='casual'){
        const daysText=prompt(t('casualDays'),String(casualDays||''));if(daysText===null)return;
        casualDays=Number(daysText);if(!Number.isInteger(casualDays)||casualDays<1||casualDays>=30)throw new Error('Casual engagement must be fewer than 30 days for the 15% rate.');
        casualConfirmed=confirm(t('casualConfirm'));if(!casualConfirmed)throw new Error('RRA casual-labour eligibility must be confirmed.');
      }
      let secondaryConfirmed=!!e.secondary_employer_confirmed;if(e.employment_type==='secondary_employer'){secondaryConfirmed=confirm(t('secondaryConfirm'));if(!secondaryConfirmed)throw new Error('Secondary-employer status must be confirmed.');}
      const rssbNumber=prompt(t('rssb'),e.rssb_member_number||'');if(rssbNumber===null)return;
      const effective=prompt(t('compensationEffective'),e.compensation_effective_from||today());if(effective===null)return;
      const reason=prompt(t('compensationReason'),'Salary or allowance adjustment');if(reason===null)return;
      const {data:userData,error:userError}=await sb.auth.getUser();if(userError)throw userError;if(!userData?.user)throw new Error('Please sign in again.');
      const row={base_salary:salary,transport_allowance:transport,taxable_benefits_in_kind:benefits,rssb_member_number:rssbNumber.trim()||null,secondary_employer_confirmed:secondaryConfirmed,compensation_effective_from:effective,compensation_change_reason:reason,casual_days_in_tax_year:e.employment_type==='casual'?casualDays:null,casual_criteria_confirmed:e.employment_type==='casual'&&casualConfirmed,updated_by:userData.user.id,updated_at:new Date().toISOString()};
      const {error:updateError}=await sb.from('payroll_employees').update(row).eq('id',id).eq('merchant_id',state.merchant.id);if(updateError)throw updateError;
      await loadEmployees();
      const status=document.getElementById('payrollSaveStatus');if(status)status.textContent=t('saved');
    }catch(e){const status=document.getElementById('payrollSaveStatus');if(status)status.textContent=t('failed')+(e.message||String(e))}
  };
  window.aibosPayrollCompensationHistory=async function(id){
    const panel=document.getElementById('payrollRunDetails');if(!panel)return;
    panel.textContent=t('loading');
    try{
      const {data,error}=await sb.from('payroll_employee_compensation_history').select('effective_from,base_salary,transport_allowance,taxable_benefits_in_kind,change_reason,changed_at').eq('merchant_id',state.merchant.id).eq('employee_id',id).order('effective_from',{ascending:false});
      if(error)throw error;
      panel.innerHTML='<strong>'+t('compensationHistory')+'</strong><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>'+t('compensationEffective')+'</th><th>'+t('salary')+'</th><th>'+t('transport')+'</th><th>'+t('taxableBenefits')+'</th><th>'+t('compensationReason')+'</th></tr></thead><tbody>'+((data||[]).map(x=>'<tr><td>'+esc(x.effective_from)+'</td><td>'+money(x.base_salary)+'</td><td>'+money(x.transport_allowance)+'</td><td>'+esc(x.change_reason||'')+'</td></tr>').join('')||'<tr><td colspan="5">'+t('noHistory')+'</td></tr>')+'</tbody></table></div>';
      panel.scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(e){panel.textContent='History unavailable: '+(e.message||String(e))}
  };
  async function saveEmployee(){
    const status=document.getElementById('payrollSaveStatus');status.textContent='';
    try{
      if(!sb||!state.merchant)throw new Error('Open a merchant account first.');
      const val=id=>document.getElementById(id).value.trim();
      const legal=val('payrollName'),number=val('payrollNumber'),salary=Number(val('payrollSalary')),transport=Number(val('payrollTransport')),benefits=Number(val('payrollBenefits'));
      if(!legal||!number||!val('payrollStart')||!Number.isFinite(salary)||salary<0||!Number.isFinite(transport)||transport<0||!Number.isFinite(benefits)||benefits<0)throw new Error('Full legal name, employee number, start date and valid salary/benefit amounts are required.');
      const employmentType=val('payrollType'),casualDays=Number(val('payrollCasualDays'));
      if(employmentType==='casual'&&(!Number.isInteger(casualDays)||casualDays<1||casualDays>=30||!document.getElementById('payrollCasualConfirm').checked))throw new Error('Casual employees require confirmed RRA eligibility and fewer than 30 engagement days in the tax year.');
      const secondaryConfirmed=document.getElementById('payrollSecondaryConfirm').checked;
      if(employmentType==='secondary_employer'&&!secondaryConfirmed)throw new Error('Confirm that this is not the employee’s primary employer before applying the 30% PAYE rate.');
      const row={merchant_id:state.merchant.id,employee_number:number,legal_name:legal,employment_type:employmentType,job_title:val('payrollTitle')||null,department:val('payrollDept')||null,hire_date:val('payrollStart'),base_salary:salary,transport_allowance:transport,taxable_benefits_in_kind:benefits,tax_identifier:val('payrollTaxId')||null,rssb_member_number:val('payrollRssb')||null,compensation_effective_from:val('payrollStart'),compensation_change_reason:'Initial compensation',casual_days_in_tax_year:employmentType==='casual'?casualDays:null,casual_criteria_confirmed:employmentType==='casual'&&document.getElementById('payrollCasualConfirm').checked,secondary_employer_confirmed:employmentType==='secondary_employer'&&secondaryConfirmed,status:'active'};
      const {error}=await sb.from('payroll_employees').insert(row);if(error)throw error;
      status.textContent=t('saved');
      ['payrollName','payrollNumber','payrollTitle','payrollDept','payrollSalary','payrollTaxId','payrollRssb','payrollCasualDays'].forEach(id=>document.getElementById(id).value='');
      document.getElementById('payrollTransport').value='0';document.getElementById('payrollBenefits').value='0';document.getElementById('payrollCasualConfirm').checked=false;document.getElementById('payrollSecondaryConfirm').checked=false;await loadEmployees();
    }catch(e){status.textContent=t('failed')+(e.message||String(e))}
  }
  function calculate(){
    const type=document.getElementById('payrollCalcType').value,period=document.getElementById('payrollCalcPeriod').value,basic=Number(document.getElementById('payrollCalcBasic').value),transport=Number(document.getElementById('payrollCalcTransport').value),benefits=Number(document.getElementById('payrollCalcBenefits').value),el=document.getElementById('payrollCalcResult');
    if(!period||!Number.isFinite(basic)||!Number.isFinite(transport)||!Number.isFinite(benefits)||basic<0||transport<0||benefits<0){el.textContent='Enter a payroll month and valid non-negative amounts.';return}
    const gross=basic+transport,taxableIncome=gross+benefits,paye=tax(taxableIncome,type),pensionTotalRate=period>='2030-01' ? 0.20 : period>='2029-01' ? 0.18 : period>='2028-01' ? 0.16 : period>='2027-01' ? 0.14 : 0.12,pensionEmployeeRate=pensionTotalRate/2,employeePension=Math.round(taxableIncome*pensionEmployeeRate),employerPension=Math.round(taxableIncome*pensionEmployeeRate),hazards=Math.round((basic+benefits)*.02),maternityEmployee=Math.round((basic+benefits)*.003),maternityEmployer=Math.round((basic+benefits)*.003),cbhi=Math.round(Math.max(0,taxableIncome-paye-employeePension-employerPension-hazards-maternityEmployee-maternityEmployer)*.005),net=gross-paye-employeePension-maternityEmployee-cbhi,cost=gross+employerPension+hazards+maternityEmployer;
    const rows=[[t('gross'),gross],[t('taxableBenefits'),benefits],[t('paye'),paye],[t('empPension'),employeePension],[t('erPension'),employerPension],[t('empMaternity'),maternityEmployee],[t('erMaternity'),maternityEmployer],[t('cbhiDeduct'),cbhi],[t('oh'),hazards],[t('net'),net],[t('cost'),cost]];
    el.innerHTML='<div class="sub">Pension rate for '+esc(period)+': '+Math.round(pensionTotalRate*100)+'% total ('+Math.round(pensionEmployeeRate*100)+'% employee / '+Math.round(pensionEmployeeRate*100)+'% employer).</div><div class="grid3" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">'+rows.map(x=>'<div class="card"><div class="sub">'+esc(x[0])+'</div><strong>'+money(x[1])+'</strong></div>').join('')+'</div><div class="sub" style="margin-top:8px">Estimate only. PAYE is based on RRA bands. Pension includes transport. Occupational Hazards is estimated on basic salary excluding transport; confirm the employee-specific contribution base with RSSB. Other deductions and taxable benefits are not included.</div>';
  }
  async function loadRules(){
    const el=document.getElementById('payrollRuleStatus');if(!el)return;
    try{
      const {data,error}=await sb.from('payroll_rule_sets').select('rule_code,effective_from,verification_status').eq('jurisdiction','RW').order('effective_from',{ascending:false});if(error)throw error;
      el.textContent=t('source')+': '+(data||[]).filter(x=>x.verification_status==='verified').map(x=>x.rule_code+' '+x.effective_from).join(' · ');
      const {data:settings,error:settingsError}=await sb.from('payroll_employer_settings').select('paye_frequency,annual_turnover,quarterly_election_confirmed').eq('merchant_id',state.merchant.id).maybeSingle();
      if(settingsError)throw settingsError;
      if(settings){document.getElementById('payrollPayeFrequency').value=settings.paye_frequency||'monthly';document.getElementById('payrollAnnualTurnover').value=settings.annual_turnover??'';document.getElementById('payrollQuarterlyConfirm').checked=!!settings.quarterly_election_confirmed}
    }catch(e){el.textContent='Statutory rules/settings will load after the payroll database migration is deployed.'}
  }
  async function saveEmployerSettings(){
    const status=document.getElementById('payrollSettingsStatus');status.textContent='';
    try{
      const frequency=document.getElementById('payrollPayeFrequency').value;
      const turnoverRaw=document.getElementById('payrollAnnualTurnover').value;
      const turnover=turnoverRaw===''?null:Number(turnoverRaw);
      const confirmed=document.getElementById('payrollQuarterlyConfirm').checked;
      if(turnover!==null&&(!Number.isFinite(turnover)||turnover<0))throw new Error('Enter a valid annual turnover.');
      if(frequency==='quarterly'&&(turnover===null||turnover>=200000000||!confirmed))throw new Error('Quarterly PAYE is only available to eligible employers below RWF 200 million annual turnover who have elected/registered with RRA.');
      const {data:userData,error:userError}=await sb.auth.getUser();if(userError)throw userError;if(!userData?.user)throw new Error('Please sign in again.');
      const {error}=await sb.from('payroll_employer_settings').upsert({merchant_id:state.merchant.id,paye_frequency:frequency,annual_turnover:turnover,quarterly_election_confirmed:frequency==='quarterly'&&confirmed,updated_by:userData.user.id,updated_at:new Date().toISOString()},{onConflict:'merchant_id'});
      if(error)throw error;
      status.textContent=t('settingsSaved');
      await loadDashboardReminders();
    }catch(e){status.textContent=t('settingsError')+(e.message||String(e))}
  }
  async function ensureStatutoryReminders(){
    if(!state.merchant||!sb)return;
    const {data:settings,error:settingsError}=await sb.from('payroll_employer_settings').select('paye_frequency,annual_turnover,quarterly_election_confirmed').eq('merchant_id',state.merchant.id).maybeSingle();
    if(settingsError)throw settingsError;
    const now=new Date(),todayKey=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
    const fmt=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const candidates=[];
    for(let y=now.getFullYear()-1;y<=now.getFullYear()+1;y++){
      candidates.push({due:new Date(y,2,15),period:(y-1)+'-12 to '+y+'-02'});
      candidates.push({due:new Date(y,5,15),period:y+'-03 to '+y+'-05'});
      candidates.push({due:new Date(y,8,15),period:y+'-06 to '+y+'-08'});
      candidates.push({due:new Date(y,11,15),period:y+'-09 to '+y+'-11'});
    }
    candidates.sort((a,b)=>a.due-b.due);
    const monthlyDue=[];
    for(let offset=-1;offset<=1;offset++)monthlyDue.push(new Date(now.getFullYear(),now.getMonth()+offset,15));
    const monthlyRelevant=[monthlyDue.filter(d=>fmt(d)<=todayKey).pop(),monthlyDue.find(d=>fmt(d)>todayKey)].filter(Boolean);
    const quarterlyRelevant=[candidates.filter(x=>fmt(x.due)<=todayKey).pop(),candidates.find(x=>fmt(x.due)>todayKey)].filter(Boolean);
    const makeRow=(type,title,message,key,due)=>{const remind=new Date(due);remind.setDate(remind.getDate()-5);return {merchant_id:state.merchant.id,reminder_type:type,title,message,due_on:fmt(due),remind_on:fmt(remind),status:'open',idempotency_key:key}};
    const rows=[];
    const {data:employees,error:employeesError}=await sb.from('payroll_employees').select('id,legal_name,employee_number,hire_date,rssb_member_number,status').eq('merchant_id',state.merchant.id).eq('status','active');
    if(employeesError)throw employeesError;
    for(const employee of employees||[]){
      const registrationKey='rssb-registration-'+employee.id;
      if(employee.rssb_member_number){
        const {error:completeError}=await sb.from('payroll_reminders').update({status:'completed',completed_at:new Date().toISOString()}).eq('merchant_id',state.merchant.id).eq('idempotency_key',registrationKey).eq('status','open');
        if(completeError)throw completeError;
      }else{
        const start=new Date(employee.hire_date+'T00:00:00'),due=new Date(start);due.setDate(due.getDate()+7);
        const remind=start;
        rows.push({merchant_id:state.merchant.id,reminder_type:'rssb_registration_due',title:t('rssbRegistrationTitle')+': '+employee.legal_name,message:t('rssbRegistrationMsg')+' '+employee.employee_number,due_on:fmt(due),remind_on:fmt(remind),status:'open',idempotency_key:registrationKey});
      }
    }
    const quarterly=settings?.paye_frequency==='quarterly'&&Number(settings?.annual_turnover)<200000000&&settings?.quarterly_election_confirmed===true;
    const payeDates=quarterly?quarterlyRelevant:monthlyRelevant;
    for(const item of payeDates){
      if(quarterly){
        const match=candidates.find(x=>fmt(x.due)===fmt(item.due));
        rows.push(makeRow('paye_due',t('payeTitleReminder'),t('payeMsg')+' '+match.period,'paye-quarterly-'+match.period, item.due));
      }else{
        const period=new Date(item.getFullYear(),item.getMonth()-1,1);
        const key=period.getFullYear()+'-'+String(period.getMonth()+1).padStart(2,'0');
        rows.push(makeRow('paye_due',t('payeTitleReminder'),t('payeMsg')+' '+key,'paye-monthly-'+key,item));
      }
    }
    for(const item of monthlyRelevant){
      const period=new Date(item.getFullYear(),item.getMonth()-1,1);
      const key=period.getFullYear()+'-'+String(period.getMonth()+1).padStart(2,'0');
      rows.push(makeRow('pension_due',t('pensionTitleReminder'),t('pensionMsg')+' '+key,'pension-'+key,item));
      rows.push(makeRow('occupational_hazards_due',t('hazardsTitleReminder'),t('hazardsMsg')+' '+key,'occupational-hazards-'+key,item));
      rows.push(makeRow('maternity_due',t('maternityTitleReminder'),t('maternityMsg')+' '+key,'maternity-'+key,item));
      rows.push(makeRow('cbhi_due',t('cbhiTitleReminder'),t('cbhiMsg')+' '+key,'cbhi-'+key,item));
    }
    const {error}=await sb.from('payroll_reminders').upsert(rows,{onConflict:'merchant_id,idempotency_key',ignoreDuplicates:true});
    if(error)throw error;
  }
  async function ensureRunReminders(){
    if(!state.merchant||!sb)return;
    const {data:runs,error}=await sb.from('payroll_pay_runs').select('id,run_number,pay_date,status,net_pay_total,amount_paid_total').eq('merchant_id',state.merchant.id).in('status',['draft','submitted','approved','posted','partially_paid','paid']);
    if(error)throw error;
    const reminders=[];
    const closeOpen=async(runId,type=null)=>{let q=sb.from('payroll_reminders').update({status:'completed',completed_at:new Date().toISOString()}).eq('merchant_id',state.merchant.id).eq('pay_run_id',runId).eq('status','open');if(type)q=q.eq('reminder_type',type);const {error:closeError}=await q;if(closeError)throw closeError};
    for(const run of runs||[]){
      const payDate=new Date(run.pay_date+'T00:00:00');
      const makeDate=days=>{const d=new Date(payDate);d.setDate(d.getDate()-days);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
      if(run.status==='paid'){
        await closeOpen(run.id);
        continue;
      }
      if(run.status!=='draft')await closeOpen(run.id,'prepare_payroll');
      if(!['draft','submitted'].includes(run.status))await closeOpen(run.id,'approve_payroll');
      if(run.status==='draft')reminders.push({merchant_id:state.merchant.id,pay_run_id:run.id,reminder_type:'prepare_payroll',title:t('prepareRunTitle')+' '+run.run_number,message:t('prepareRunMsg'),due_on:run.pay_date,remind_on:makeDate(5),status:'open',idempotency_key:'prepare-'+run.id});
      if(run.status==='submitted')reminders.push({merchant_id:state.merchant.id,pay_run_id:run.id,reminder_type:'approve_payroll',title:t('approveRunTitle')+' '+run.run_number,message:t('approveRunMsg'),due_on:run.pay_date,remind_on:makeDate(3),status:'open',idempotency_key:'approve-'+run.id});
      if(['approved','posted','partially_paid'].includes(run.status)){
        const payKey='pay-salaries-'+run.id+'-'+Number(run.amount_paid_total||0).toFixed(2);
        const {error:staleError}=await sb.from('payroll_reminders').update({status:'completed',completed_at:new Date().toISOString()}).eq('merchant_id',state.merchant.id).eq('pay_run_id',run.id).eq('reminder_type','pay_salaries').eq('status','open').neq('idempotency_key',payKey);
        if(staleError)throw staleError;
        const outstanding=Math.max(0,Number(run.net_pay_total)-Number(run.amount_paid_total||0));
        reminders.push({merchant_id:state.merchant.id,pay_run_id:run.id,reminder_type:'pay_salaries',title:t('payRunTitle')+' '+run.run_number,message:t('payRunMsg')+' '+money(outstanding)+' · '+run.pay_date,due_on:run.pay_date,remind_on:run.pay_date,status:'open',idempotency_key:payKey});
      }
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
      panel.innerHTML='<strong>'+t('reminders')+'</strong><div class="sub">'+(data&&data.length?data.map(x=>'<div style="padding:8px 0;border-bottom:1px solid #ddd"><b>'+esc(x.title)+'</b> · '+esc(x.due_on)+'<div>'+esc(x.message)+'</div><button class="btn secondary" style="margin-top:5px" onclick="dismissPayrollReminder(\''+esc(x.id)+'\')">'+t('dismiss')+'</button></div>').join(''):t('noReminders'))+'</div>';
    }catch(e){panel.style.display='none'}
  }
  const oldShow=window.show;
  if(typeof oldShow==='function')window.show=function(view,...args){oldShow(view,...args);if(view==='payroll'){if(host.dataset.lang!==lang()){location.reload();return}loadEmployees();loadRules();loadRuns()}if(view==='dashboard')loadDashboardReminders()};
  const languageControl=document.getElementById('aibosLanguageSelect')||document.querySelector('#aibosLanguageSwitcher select');
  const refreshLanguage=()=>{translateHeader();if(document.getElementById('payroll')?.classList.contains('active'))location.reload()};
  window.addEventListener('aibos:languagechange',refreshLanguage);
  window.aibosPayrollRefresh=()=>{loadEmployees();loadRules();loadRuns();loadDashboardReminders()};
  translateHeader();
  if(document.getElementById('payroll')?.classList.contains('active')){loadEmployees();loadRules();loadRuns()}
})();
