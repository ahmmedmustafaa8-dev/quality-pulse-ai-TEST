const COLUMN_ALIASES={agent:['agent name','agent','full name','user name','agent name (full name)'],score:['score','score %','attribute score','qa score','total score','overall score','total compliance'],section:['section','section name','category','attribute category'],attribute:['attribute name','attribute'],severity:['severity'],reason:['error reason','reason','error reason name'],comment:['error reason comment','comment','reason comment'],monitoringId:['monitoring id','evaluation id','interaction id','call id','id'],transactionType:['transaction type','type','direction','call type']};
const $=id=>document.getElementById(id),normalise=v=>String(v??'').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' '),cleanText=(v,fallback='Not specified')=>String(v??'').trim()||fallback;
function findColumn(row,key){return Object.keys(row||{}).find(header=>COLUMN_ALIASES[key].includes(normalise(header)));}function value(row,key){const column=findColumn(row,key);return column?row[column]:'';}function parseScore(v){const n=parseFloat(String(v).replace('%',''));return Number.isFinite(n)?(n<=1?n*100:n):null;}function group(rows,key){return rows.reduce((m,row)=>{const label=cleanText(key(row));m.set(label,(m.get(label)||0)+1);return m;},new Map());}function fmtScore(n){return n===null||Number.isNaN(n)?'--':`${n.toFixed(2)}%`;}function showStatus(text,isError=false){$('status').textContent=text;$('status').style.color=isError?'#d94b5b':'#69758a';}
function html(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}function csv(v){const text=String(v??'');return /^[=+\-@]/.test(text)?`'${text}`:text;}

function category(row){const text=`${value(row,'section')} ${value(row,'severity')}`.toLowerCase();if(text.includes('business critical'))return'Business Critical';if(text.includes('end user critical')||text.includes('end-user critical'))return'End User Critical';if(text.includes('soft'))return'Soft Skills';if(text.includes('compliance'))return'Compliance';return'Other';}
async function readFile(file){if(!file)return[];const workbook=XLSX.read(await file.arrayBuffer(),{type:'array'});return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{defval:''});}

function getUniqueErrors(rows) {
    const seen = new Set();
    return rows.filter(row => {
        const reason = normalise(value(row, 'reason'));
        const comment = normalise(value(row, 'comment'));
        const key = `${reason}::${comment}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function calculateSoftSkillsScore(errorCount) {
    if (errorCount === 1) return 97.22;
    if (errorCount === 2) return 94.44;
    if (errorCount === 3) return 88.80;
    if (errorCount === 4) return 83.33;
    if (errorCount > 4) return Math.max(0, 100 - (errorCount * 4.16));
    return 100;
}

function analyseCalls(failedRows, allSummaryRows = []) {
    const map = new Map();
    const summaryTypeMap = new Map();
    
    allSummaryRows.forEach(row => {
        const id = cleanText(value(row, 'monitoringId'));
        const tType = cleanText(value(row, 'transactionType'));
        if (id && tType) summaryTypeMap.set(normalise(id), tType);
    });
    
    const callsGrouped = new Map();
    failedRows.forEach(row => {
        const id = cleanText(value(row, 'monitoringId'), 'Unknown ID');
        const agent = cleanText(value(row, 'agent'), 'Unknown agent');
        const key = `${agent}::${id}`;
        if (!callsGrouped.has(key)) callsGrouped.set(key, []);
        callsGrouped.get(key).push(row);
    });

    callsGrouped.forEach((rows, key) => {
        const [agent, id] = key.split('::');
        const tType = summaryTypeMap.get(normalise(id)) || 'Inbound';
        const uniqueRows = getUniqueErrors(rows);
        
        let softErrors = 0, businessErrors = 0, endUserErrors = 0, complianceErrors = 0;

        uniqueRows.forEach(row => {
            const type = category(row);
            if (type === 'Soft Skills') softErrors++;
            if (type === 'Business Critical') businessErrors++;
            if (type === 'End User Critical') endUserErrors++;
            if (type === 'Compliance') complianceErrors++;
        });

        const scores = {
            compliance: complianceErrors > 0 ? 0 : 100,
            endUser: endUserErrors > 0 ? 0 : 100,
            business: businessErrors > 0 ? 0 : 100,
            soft: calculateSoftSkillsScore(softErrors)
        };

        const isFailed = scores.compliance < 99 || scores.soft < 90 || scores.business < 90 || scores.endUser < 90;
        
        let failReason = 'Passed';
        if (scores.compliance < 99) failReason = 'Compliance Failure';
        else if (scores.business < 90) failReason = 'Business Critical Zero';
        else if (scores.endUser < 90) failReason = 'End User Critical Zero';
        else if (scores.soft < 90) failReason = `Soft Skills Drop (${scores.soft}%)`;

        map.set(key, { id, agent, type: tType, soft: softErrors, business: businessErrors, endUser: endUserErrors, compliance: complianceErrors, failed: isFailed, failReason, categoryScores: scores });
    });

    allSummaryRows.forEach(row => {
        const agent = cleanText(value(row, 'agent'), 'Unknown agent');
        const id = cleanText(value(row, 'monitoringId'), '');
        const tType = cleanText(value(row, 'transactionType'), 'Inbound');
        if (id) {
            const key = `${agent}::${id}`;
            if (!map.has(key)) {
                map.set(key, { 
                    id, agent, type: tType, soft: 0, business: 0, endUser: 0, compliance: 0, 
                    failed: false, failReason: 'Passed', 
                    categoryScores: { compliance: 100, endUser: 100, business: 100, soft: 100 } 
                });
            }
        }
    });

    return [...map.values()];
}

function agentStats(summary, failedRows, calls) {
    const map = new Map();
    const add = name => {
        if (!map.has(name)) map.set(name, { name, scores: [], mistakes: 0, failedCalls: 0, compScores: [], softScores: [], bizScores: [], euScores: [] });
        return map.get(name);
    };

    summary.forEach(row => {
        const a = add(cleanText(value(row, 'agent'), 'Unknown agent'));
        const score = parseScore(value(row, 'score'));
        if (score !== null) a.scores.push(score);
    });

    calls.forEach(c => {
        const a = add(c.agent);
        if (c.failed) a.failedCalls++;
        a.compScores.push(c.categoryScores.compliance);
        a.softScores.push(c.categoryScores.soft);
        a.bizScores.push(c.categoryScores.business);
        a.euScores.push(c.categoryScores.endUser);
    });

    failedRows.forEach(row => add(cleanText(value(row, 'agent'), 'Unknown agent')).mistakes++);

    return [...map.values()].map(a => {
        const calcAvg = arr => arr.length ? arr.reduce((x, y) => x + y, 0) / arr.
