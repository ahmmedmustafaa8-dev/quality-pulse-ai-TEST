// تعريف الدالة على الـ window لتلافي خطأ ReferenceError في الملفات الأخرى
window.$ = id => document.getElementById(id);

const COLUMN_ALIASES = {
    agent: ['agent name','agent','full name','user name','agent name (full name)','الوكيل','الموظف','اسم الموظف'],
    score: ['score','score %','attribute score','qa score','total score','overall score','total compliance','الدرجة','النسبة'],
    section: ['section','section name','category','attribute category','الفئة','القسم'],
    attribute: ['attribute name','attribute','البند','المعيار'],
    severity: ['severity','الخطورة','نوع الخطأ'],
    reason: ['error reason','reason','error reason name','سبب الخطأ','السبب'],
    comment: ['error reason comment','comment','reason comment','التعليق','الملاحظات'],
    monitoringId: ['monitoring id','evaluation id','interaction id','call id','id','رقم المكالمة','المكالمة'],
    transactionType: ['transaction type','type','direction','call type','نوع المعاملة','الاتجاه']
};

const normalise = v => String(v ?? '').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
const cleanText = (v, fallback = 'Not specified') => String(v ?? '').trim() || fallback;

function findColumn(row, key) {
    return Object.keys(row || {}).find(header => {
        const normHeader = normalise(header);
        return COLUMN_ALIASES[key].some(alias => normHeader.includes(alias) || alias.includes(normHeader));
    });
}
function value(row, key) {
    const column = findColumn(row, key);
    return column ? row[column] : '';
}
function parseScore(v) {
    const n = parseFloat(String(v).replace('%',''));
    return Number.isFinite(n) ? (n <= 1 ? n * 100 : n) : null;
}
function fmtScore(n) {
    return n === null || Number.isNaN(n) ? '--' : `${n.toFixed(2)}%`;
}
function html(v) {
    return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function category(row) {
    const text = `${value(row,'section')} ${value(row,'severity')}`.toLowerCase();
    if (text.includes('business') || text.includes('بيزنس')) return 'Business Critical';
    if (text.includes('end user') || text.includes('end-user') || text.includes('عميل')) return 'End User Critical';
    if (text.includes('soft') || text.includes('سوفت')) return 'Soft Skills';
    if (text.includes('compliance') || text.includes('امتثال')) return 'Compliance';
    return 'Other';
}

async function readFile(file) {
    if (!file) return [];
    try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    } catch (e) {
        console.error("Error reading file:", e);
        return [];
    }
}

function getUniqueErrors(rows) {
    const seen = new Set();
    return rows.filter(row => {
        const key = `${normalise(value(row, 'reason'))}::${normalise(value(row, 'comment'))}`;
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
    return errorCount > 4 ? Math.max(0, 100 - (errorCount * 4.16)) : 100;
}

function analyseCalls(failedRows, allSummaryRows = []) {
    const map = new Map(), summaryTypeMap = new Map();
    
    allSummaryRows.forEach(row => {
        const id = cleanText(value(row, 'monitoringId')), tType = cleanText(value(row, 'transactionType'));
        if (id && tType) summaryTypeMap.set(normalise(id), tType);
    });
    
    const callsGrouped = new Map();
    failedRows.forEach(row => {
        const key = `${cleanText(value(row, 'agent'), 'Unknown agent')}::${cleanText(value(row, 'monitoringId'), 'Unknown ID')}`;
        if (!callsGrouped.has(key)) callsGrouped.set(key, []);
        callsGrouped.get(key).push(row);
    });

    callsGrouped.forEach((rows, key) => {
        const [agent, id] = key.split('::'), tType = summaryTypeMap.get(normalise(id)) || 'Inbound', uniqueRows = getUniqueErrors(rows);
        let soft = 0, business = 0, endUser = 0, compliance = 0;
        
        uniqueRows.forEach(row => {
            const type = category(row);
            if (type === 'Soft Skills') soft++;
            if (type === 'Business Critical') business++;
            if (type === 'End User Critical') endUser++;
            if (type === 'Compliance') compliance++;
        });

        const scores = { compliance: compliance > 0 ? 0 : 100, endUser: endUser > 0 ? 0 : 100, business: business > 0 ? 0 : 100, soft: calculateSoftSkillsScore(soft) };
        const isFailed = scores.compliance < 99 || scores.soft < 90 || scores.business < 90 || scores.endUser < 90;
        map.set(key, { id, agent, type: tType, failed: isFailed, categoryScores: scores });
    });

    allSummaryRows.forEach(row => {
        const agent = cleanText(value(row, 'agent'), 'Unknown agent'), id = cleanText(value(row, 'monitoringId'), ''), tType = cleanText(value(row, 'transactionType'), 'Inbound');
        if (id && !map.has(`${agent}::${id}`)) {
            map.set(`${agent}::${id}`, { id, agent, type: tType, failed: false, categoryScores: { compliance: 100, endUser: 100, business: 100, soft: 100 } });
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
        const score = parseScore(value(row, 'score'));
        if (score !== null) add(cleanText(value(row, 'agent'), 'Unknown agent')).scores.push(score);
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
        const calcAvg = arr => arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : 100;
        const avgComp = calcAvg(a.compScores), avgSoft = calcAvg(a.softScores), avgBiz = calcAvg(a.bizScores), avgEU = calcAvg(a.euScores);
        const finalAvg = a.scores.length ? a.scores.reduce((x,y)=>x+y,0)/a.scores.length : (avgSoft + avgBiz + avgEU + avgComp) / 4;
        return { ...a, avgCompliance: avgComp, avgSoft: avgSoft, avgBusiness: avgBiz, avgEndUser: avgEU, average: finalAvg };
    }).sort((a, b) => b.failedCalls - a.failedCalls || a.average - b.average);
}

function renderTransactionPivotTables(calls) {
    const pivot = {}, typesSeen = new Set();
    calls.forEach(c => {
        let type = c.type || 'Inbound';
        if (type.toLowerCase().includes('inbound')) type = 'Inbound';
        if (type.toLowerCase().includes('outbound')) type = 'Outbound';
        typesSeen.add(type);
        if (!pivot[type]) pivot[type] = {};
        if (!pivot[type][c.agent]) pivot[type][c.agent] = { compliance: [], endUser: [], business: [], soft: [] };
        
        const d = pivot[type][c.agent];
        d.compliance.push(c.categoryScores.compliance);
        d.endUser.push(c.categoryScores.endUser);
        d.business.push(c.categoryScores.business);
        d.soft.push(c.categoryScores.soft);
    });

    let htmlOutput = `<h3 style="margin-top:35px; color:#fff; border-bottom:2px solid #3b82f6; padding-bottom:8px;">Score Per Agent (By Transaction Type)</h3>`;
    [...typesSeen].sort().forEach(tType => {
        const agentsData = pivot[tType] || {}, agentNames = Object.keys(agentsData).sort();
        htmlOutput += `
        <div style="margin-bottom:25px; background:#1e293b; padding:15px; border-radius:8px;">
            <h4 style="color:#60a5fa; margin-bottom:10px; text-transform:uppercase; font-weight:bold;">Direction: ${html(tType)}</h4>
            <table style="width:100%; border-collapse:collapse; text-align:left; color:#f8fafc;">
                <thead>
                    <tr style="background:#334155; color:#94a3b8; font-size:13px;">
                        <th style="padding:10px; border:1px solid #475569;">Agent Name</th>
                        <th style="padding:10px; border:1px solid #475569;">Average of %Compliance</th>
                        <th style="padding:10px; border:1px solid #475569;">Average of %End User Critical</th>
                        <th style="padding:10px; border:1px solid #475569;">Average of %Business Critical</th>
                        <th style="padding:10px; border:1px solid #475569;">Average of %Softskills</th>
                    </tr>
                </thead><tbody>`;
        let tComp = 0, tEU = 0, tBiz = 0, tSoft = 0, tCount = 0;
        agentNames.forEach(aName => {
            const d = agentsData[aName], avg = arr => arr.length ? (arr.reduce((a,b)=>a+b,0) / arr.length) : 100;
            const ac = avg(d.compliance), aeu = avg(d.endUser), ab = avg(d.business), as = avg(d.soft);
            tComp += ac; tEU += aeu; tBiz += ab; tSoft += as; tCount++;
            htmlOutput += `
            <tr style="border-bottom:1px solid #334155;">
                <td style="padding:10px; border:1px solid #475569; font-weight:500;">${html(aName)}</td>
                <td style="padding:10px; border:1px solid #475569; color:${ac<99?'#f87171':'#34d399'}">${ac.toFixed(2)}%</td>
                <td style="padding:10px; border:1px solid #475569; color:${aeu<90?'#f87171':'#34d399'}">${aeu.toFixed(2)}%</td>
                <td style="padding:10px; border:1px solid #475569; color:${ab<90?'#f87171':'#34d399'}">${ab.toFixed(2)}%</td>
                <td style="padding:10px; border:1px solid #475569; color:${as<90?'#f87171':'#34d399'}">${as.toFixed(2)}%</td>
            </tr>`;
        });
        if (tCount > 0) {
            htmlOutput += `
            <tr style="background:#1e293b; font-weight:bold; border-top:2px solid #475569;">
                <td style="padding:10px; border:1px solid #475569; color:#f59e0b;">Grand Total</td>
                <td style="padding:10px; border:1px solid #475569; color:#f59e0b;">${(tComp/tCount).toFixed(2)}%</td>
                <td style="padding:10px; border:1px solid #475569; color:#f59e0b;">${(tEU/tCount).toFixed(2)}%</td>
                <td style="padding:10px; border:1px solid #475569; color:#f59e0b;">${(tBiz/tCount).toFixed(2)}%</td>
                <td style="padding:10px; border:1px solid #475569; color:#f59e0b;">${(tSoft/tCount).toFixed(2)}%</td>
            </tr>`;
        }
        htmlOutput += `</tbody></table></div>`;
    });
    let container = window.$('transaction-pivot-container') || document.createElement('div');
    container.id = 'transaction-pivot-container'; container.innerHTML = htmlOutput;
    const target = window.$('failed-calls-table') || document.body;
    if (!document.getElementById('transaction-pivot-container')) target.parentNode.insertBefore(container, target);
}

function render({ summary, detailed }) {
    const calls = analyseCalls(detailed, summary), agents = agentStats(summary, detailed, calls);
    const scores = agents.flatMap(a => a.scores);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : (agents.reduce((acc, a) => acc + a.average, 0) / (agents.length || 1));
    
    if (window.$('avg-score')) window.$('avg-score').textContent = fmtScore(avg);
    if (window.$('evaluations')) window.$('evaluations').textContent = summary.length || calls.length || '--';
    if (window.$('agents')) window.$('agents').textContent = agents.length || '--';
    if (window.$('critical-errors')) window.$('critical-errors').textContent = calls.filter(c => c.failed).length;
    
    const rEl = window.$('ranking-list');
    if (rEl) {
        rEl.innerHTML = agents.map((a, i) => `
            <div style="padding:12px; border-bottom:1px solid #334155; display:flex; justify-content:between; align-items:center;">
                <span style="color:#94a3b8; font-weight:bold; width:24px;">${i+1}</span>
                <div style="flex-grow:1; margin-left:10px;">
                    <div style="font-weight:bold; color:#f8fafc;">${a.name}</div>
                    <div style="font-size:12px; color:#94a3b8; margin-top:4px;">
                        Soft: <span style="color:${a.avgSoft<90?'#f87171':'#34d399'}">${a.avgSoft.toFixed(2)}%</span> | 
                        Biz: <span style="color:${a.avgBusiness<90?'#f87171':'#34d399'}">${a.avgBusiness.toFixed(2)}%</span> | 
                        EU: <span style="color:${a.avgEndUser<90?'#f87171':'#34d399'}">${a.avgEndUser.toFixed(2)}%</span> | 
                        Comp: <span style="color:${a.avgCompliance<99?'#f87171':'#34d399'}">${a.avgCompliance.toFixed(2)}%</span>
                    </div>
                </div>
                <span style="font-weight:bold; color:#60a5fa;">${fmtScore(a.average)}</span>
            </div>`).join('');
    }
    renderTransactionPivotTables(calls);
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = window.$('analyze-btn') || document.querySelector('button') || document.querySelector('.bg-blue-600');
    const inputSum = window.$('summary-report') || document.querySelectorAll('input[type="file"]')[0];
    const inputDet = window.$('detailed-report') || document.querySelectorAll('input[type="file"]')[1];

    if (btn) {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!inputDet?.files[0]) { alert('Please upload the Detailed report first.'); return; }
            const sData = inputSum?.files[0] ? await readFile(inputSum.files[0]) : [];
            const dData = await readFile(inputDet.files[0]);
            render({ summary: sData, detailed: dData });
        });
    }
});
