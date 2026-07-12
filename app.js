// ==========================================
// QUALITY PULSE AI — INTEGRATED POLICY ENGINE
// ==========================================

const COLUMN_ALIASES = {
    agent: ['agent name', 'agent', 'full name', 'user name', 'agent name (full name)'],
    score: ['score', 'score %', 'attribute score', 'qa score', 'total score', 'overall score', 'total compliance'],
    section: ['section', 'section name', 'category', 'attribute category'],
    attribute: ['attribute name', 'attribute'],
    severity: ['severity'],
    reason: ['error reason', 'reason', 'error reason name'],
    comment: ['error reason comment', 'comment', 'reason comment'],
    monitoringId: ['monitoring id', 'evaluation id', 'interaction id', 'call id', 'id']
};

const $ = id => document.getElementById(id),
      normalise = v => String(v ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' '),
      cleanText = (v, fallback = 'Not specified') => String(v ?? '').trim() || fallback;

function findColumn(row, key) {
    return Object.keys(row || {}).find(header => COLUMN_ALIASES[key].includes(normalise(header)));
}

function value(row, key) {
    const column = findColumn(row, key);
    return column ? row[column] : '';
}

function parseScore(v) {
    const n = parseFloat(String(v).replace('%', ''));
    return Number.isFinite(n) ? (n <= 1 ? n * 100 : n) : null;
}

function isZeroScore(v) {
    const text = String(v ?? '').trim().replace('%', '');
    return text !== '' && Number.isFinite(Number(text)) && Number(text) === 0;
}

function group(rows, key) {
    return rows.reduce((m, row) => {
        const label = cleanText(key(row));
        m.set(label, (m.get(label) || 0) + 1);
        return m;
    }, new Map());
}

function category(row) {
    const text = normalise(value(row, 'section') || value(row, 'severity'));
    if (text.includes('business critical')) return 'Business Critical';
    if (text.includes('end user') || text.includes('customer critical')) return 'End User Critical';
    if (text.includes('compliance')) return 'Compliance';
    return 'Soft Skills';
}

function removeDuplicateComments(rows) {
    const seen = new Set();
    return rows.filter(row => {
        const key = `${normalise(value(row, 'monitoringId'))}-${normalise(value(row, 'agent'))}-${normalise(value(row, 'attribute'))}-${normalise(value(row, 'comment'))}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// دمج السياسة المحدثة: الكريتيكال يسقط فوراً + غلطة السوفت سكيلز الواحدة بتخصم وتنقص
function analyseCalls(failedRows) {
    const calls = new Map();
    failedRows.forEach(row => {
        const id = cleanText(value(row, 'monitoringId'), 'Unknown ID');
        if (!calls.has(id)) {
            calls.set(id, { id, agent: cleanText(value(row, 'agent'), 'Unknown agent'), softAttributes: new Set(), business: 0, endUser: 0, compliance: 0 });
        }
        const c = calls.get(id);
        const type = category(row);
        if (type === 'Soft Skills') c.softAttributes.add(cleanText(value(row, 'attribute')));
        else if (type === 'Business Critical') c.business++;
        else if (type === 'End User Critical') c.endUser++;
        else if (type === 'Compliance') c.compliance++;
    });

    return [...calls.values()].map(c => {
        let failed = false, reason = [];
        
        // السياسة القديمة المستمرة: أخطاء الكريتيكال تسبب سقوط فوري للمكالمة
        if (c.business > 0) { failed = true; reason.push('Business Critical'); }
        if (c.endUser > 0) { failed = true; reason.push('End User Critical'); }
        
        // الإضافة الجديدة: خطأ السوفت سكيلز يسجل ويؤثر فوراً بنقصان التقييم
        if (c.softAttributes.size > 0) { 
            failed = true; 
            reason.push(`Soft Skills Defect (- Deducted)`); 
        }
        if (c.compliance > 0) { reason.push('Compliance Issue'); }
        
        return {
            id: c.id,
            agent: c.agent,
            failed,
            failReason: failed ? reason.join(' + ') : 'PASSED',
            soft: c.softAttributes.size,
            business: c.business,
            endUser: c.endUser,
            compliance: c.compliance
        };
    });
}

function agentStats(summary, failed, calls, detailedRows) {
    const map = new Map();
    const add = name => {
        if (!map.has(name)) {
            map.set(name, {
                name, scores: [], mistakes: 0, failedCalls: 0,
                categories: {
                    'Soft Skills': { totalItems: 0, zeroItems: 0 },
                    'Compliance': { totalItems: 0, zeroItems: 0 },
                    'Business Critical': { totalItems: 0, zeroItems: 0 },
                    'End User Critical': { totalItems: 0, zeroItems: 0 }
                }
            });
        }
        return map.get(name);
    };

    summary.forEach(row => {
        const a = add(cleanText(value(row, 'agent'), 'Unknown agent'));
        const score = parseScore(value(row, 'score'));
        if (score !== null) a.scores.push(score);
    });

    detailedRows.forEach(row => {
        const agentName = cleanText(value(row, 'agent'), 'Unknown agent');
        const a = add(agentName);
        const type = category(row);
        if (a.categories[type]) {
            a.categories[type].totalItems++;
            if (isZeroScore(value(row, 'score'))) a.categories[type].zeroItems++;
        }
    });

    failed.forEach(row => add(cleanText(value(row, 'agent'), 'Unknown agent')).mistakes++);
    calls.filter(c => c.failed).forEach(c => add(c.agent).failedCalls++);

    return [...map.values()].map(a => {
        const catAverages = {};
        Object.keys(a.categories).forEach(cat => {
            const total = a.categories[cat].totalItems;
            const zeros = a.categories[cat].zeroItems;
            catAverages[cat] = total > 0 ? ((total - zeros) / total) * 100 : null;
        });

        return {
            ...a,
            average: a.scores.length ? a.scores.reduce((x, y) => x + y, 0) / a.scores.length : null,
            evaluations: a.scores.length,
            categoryAverages: catAverages
        };
    }).sort((a, b) => (a.average ?? -1) - (b.average ?? -1));
}

function fmtScore(v) {
    return v !== null && v !== undefined ? `${v.toFixed(1)}%` : '--';
}

function html(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderAgentProfile(name) {
    const profile = window.latestAgentProfiles?.get(name);
    if (!profile) {
        $('agent-profile-content').innerHTML = '<p class="empty">Select an agent to see the coaching profile.</p>';
        return;
    }

    const attribute = [...group(profile.errors, row => value(row, 'attribute')).entries()].sort((a, b) => b[1] - a[1])[0];
    const type = [...group(profile.errors, row => category(row)).entries()].sort((a, b) => b[1] - a[1])[0];
    const focus = type ?.[0] || 'No failed items';
    
    // التحديث هنا ليعكس الـ Target الجديد 98% في التوصيات
    const coaching = profile.agent.average < 98 
        ? `Performance is below the 98% target. Focus on top attribute: <b>${html(attribute?.[0] || 'None')}</b>.` 
        : 'Maintaining performance above the 98% target.';

    $('agent-profile-content').innerHTML = `
        <div class="agent-profile-grid">
            <div class="profile-summary">
                <h4>${html(profile.agent.name)}</h4>
                <p>${profile.agent.evaluations} evaluations · ${profile.agent.mistakes} failed items</p>
                <div class="profile-metrics">
                    <span><strong>${fmtScore(profile.agent.average)}</strong>Overall Score</span>
                    <span><strong>${profile.failedCalls.length}</strong>Failed Calls</span>
                </div>
                <div style="margin-top: 15px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size:11px;">
                    <div style="padding:5px; background:rgba(255,255,255,0.03); border-radius:4px;">Soft Skills: <b>${fmtScore(profile.agent.categoryAverages['Soft Skills'])}</b></div>
                    <div style="padding:5px; background:rgba(255,255,255,0.03); border-radius:4px;">Compliance: <b>${fmtScore(profile.agent.categoryAverages['Compliance'])}</b></div>
                    <div style="padding:5px; background:rgba(255,255,255,0.03); border-radius:4px;">Business: <b>${fmtScore(profile.agent.categoryAverages['Business Critical'])}</b></div>
                    <div style="padding:5px; background:rgba(255,255,255,0.03); border-radius:4px;">End User: <b>${fmtScore(profile.agent.categoryAverages['End User Critical'])}</b></div>
                </div>
            </div>
            <div class="profile-detail">
                <p class="profile-label">PRIMARY FOCUS</p>
                <strong>${html(focus)}</strong>
                <p>Target Goal: <b>98.0%</b></p>
            </div>
            <div class="profile-detail coaching">
                <p class="profile-label">TARGET COACHING ACTION</p>
                <p>${coaching}</p>
            </div>
        </div>
    `;
}

function render({ summary, detailed }) {
    const hasScore = findColumn(detailed[0], 'score');
    const rawFailed = hasScore ? detailed.filter(r => isZeroScore(value(r, 'score'))) : [];
    const failed = removeDuplicateComments(rawFailed);
    const duplicatesRemoved = rawFailed.length - failed.length;
    const calls = analyseCalls(failed);
    
    const agents = agentStats(summary, failed, calls, detailed); 
    const scores = agents.flatMap(a => a.scores);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null; 
    const failedCalls = calls.filter(c => c.failed);

    if($('avg-score')) $('avg-score').textContent = fmtScore(avg);
    if($('evaluations')) $('evaluations').textContent = summary.length - 1 || '--';
    if($('agents')) $('agents').textContent = agents.length || '--';
    if($('critical-errors')) $('critical-errors').textContent = failedCalls.length;
    if($('period-label')) $('period-label').textContent = `${failed.length} failed items; ${failedCalls.length} failed calls affected; Target: 98%.`;

    const previousSelection = $('agent-select')?.value;
    window.latestAgentProfiles = new Map(agents.map(agent => [agent.name, { agent, errors: failed.filter(row => cleanText(value(row, 'agent'), 'Unknown agent') === agent.name), failedCalls: failedCalls.filter(call => call.agent === agent.name) }]));
    
    if($('agent-select')) {
        $('agent-select').innerHTML = `<option value="">Select an agent</option>${agents.map(agent => `<option value="${html(agent.name)}">${html(agent.name)}</option>`).join('')}`;
        const selected = window.latestAgentProfiles.has(previousSelection) ? previousSelection : agents[0]?.name || '';
        $('agent-select').value = selected;
        renderAgentProfile(selected);
    }
}

async function parseExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const workbook = XLSX.read(e.target.result, { type: 'binary' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                resolve(XLSX.utils.sheet_to_json(sheet));
            } catch (err) { reject(err); }
        };
        reader.readAsBinaryString(file);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    let summaryData = [], detailedData = [];
    
    const sFile = $('summary-file'), dFile = $('detailed-file'), btn = $('analyze-btn');
    
    if(sFile) sFile.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (file) summaryData = await parseExcelFile(file);
    });

    if(dFile) dFile.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (file) detailedData = await parseExcelFile(file);
    });

    if(btn) btn.addEventListener('click', () => {
        if (detailedData.length > 0) {
            render({ summary: summaryData, detailed: detailedData });
        }
    });
});
