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
        if (c.business > 0) { failed = true; reason.push('Business Critical'); }
        if (c.endUser > 0) { failed = true; reason.push('End User Critical'); }
        if (c.softAttributes.size >= 3) { failed = true; reason.push('Soft Skills (>=3 attributes)'); }
        
        return {
            id: c.id,
            agent: c.agent,
            failed,
            failReason: failed ? reason.join(' + ') : 'PASSED (Compliance issues only or <3 soft attributes)',
            soft: c.softAttributes.size,
            business: c.business,
            endUser: c.endUser,
            compliance: c.compliance
        };
    });
}

// حساب الـ Averages لكل فئة لكل إيجنت لوحده بدقة
function agentStats(summary, failed, calls, detailedRows) {
    const map = new Map();
    
    const add = name => {
        if (!map.has(name)) {
            map.set(name, {
                name,
                scores: [],
                mistakes: 0,
                failedCalls: 0,
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

    // 1. سحب الـ Scores العامة من شيت الـ Summary
    summary.forEach(row => {
        const a = add(cleanText(value(row, 'agent'), 'Unknown agent'));
        const score = parseScore(value(row, 'score'));
        if (score !== null) a.scores.push(score);
    });

    // 2. تحليل تفاصيل الفئات من شيت الـ Detailed كاملاً لفرز الـ Items المتاحة والـ Zeroes
    detailedRows.forEach(row => {
        const agentName = cleanText(value(row, 'agent'), 'Unknown agent');
        const a = add(agentName);
        const type = category(row);
        
        if (a.categories[type]) {
            a.categories[type].totalItems++;
            if (isZeroScore(value(row, 'score'))) {
                a.categories[type].zeroItems++;
            }
        }
    });

    // 3. ربط عدد الأخطاء ومكالمات الـ Fail
    failed.forEach(row => add(cleanText(value(row, 'agent'), 'Unknown agent')).mistakes++);
    calls.filter(c => c.failed).forEach(c => add(c.agent).failedCalls++);

    // 4. احتساب النسب المئوية النهائية للـ Averages لكل فئة
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
    }).sort((a, b) => {
        const aHasFailed = a.failedCalls > 0, bHasFailed = b.failedCalls > 0;
        if (aHasFailed !== bHasFailed) return aHasFailed ? 1 : -1;
        if (a.mistakes !== b.mistakes) return a.mistakes - b.mistakes;
        if (a.failedCalls !== b.failedCalls) return a.failedCalls - b.failedCalls;
        return (b.average ?? -1) - (a.average ?? -1);
    });
}

function fmtScore(v) {
    return v !== null && v !== undefined ? `${v.toFixed(1)}%` : '--';
}

function html(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function csv(text) {
    return String(text ?? '');
}

function showStatus(text, isError = false) {
    const status = $('status-message');
    status.textContent = text;
    status.className = `status-message ${isError ? 'error' : 'success'}`;
    status.style.display = 'block';
    setTimeout(() => { status.style.display = 'none'; }, 4500);
}

// عرض الملف التعريفي للإيجنت وتضمين كروت الـ Averages المنفصلة
function renderAgentProfile(name) {
    const profile = window.latestAgentProfiles?.get(name);
    if (!profile) {
        $('agent-profile-content').innerHTML = '<p class="empty">Select an agent to see the coaching profile.</p>';
        return;
    }

    const attribute = [...group(profile.errors, row => value(row, 'attribute')).entries()].sort((a, b) => b[1] - a[1])[0];
    const reason = [...group(profile.errors, row => value(row, 'reason')).entries()].sort((a, b) => b[1] - a[1])[0];
    const type = [...group(profile.errors, row => category(row)).entries()].sort((a, b) => b[1] - a[1])[0];
    
    const focus = type ?.[0] || 'No failed items';
    const coaching = focus === 'Business Critical' ? 'Run an immediate one-to-one policy/process coaching, then monitor the next 5 evaluations.' : focus === 'End User Critical' ? 'Run an immediate one-to-one coaching focused on customer impact, then monitor the next 5 evaluations.' : focus === 'Soft Skills' ? 'Use call examples for a targeted soft-skills coaching. Track distinct attributes, not duplicate comments.' : focus === 'Compliance' ? 'Run a compliance refresher and validate the next 5 evaluations.' : 'Maintain the current performance and continue normal monitoring.';

    const softAvg = fmtScore(profile.agent.categoryAverages['Soft Skills']);
    const compAvg = fmtScore(profile.agent.categoryAverages['Compliance']);
    const busAvg = fmtScore(profile.agent.categoryAverages['Business Critical']);
    const endAvg = fmtScore(profile.agent.categoryAverages['End User Critical']);

    $('agent-profile-content').innerHTML = `
        <div class="agent-profile-grid">
            <div class="profile-summary">
                <h4>${html(profile.agent.name)}</h4>
                <p>${profile.agent.evaluations} evaluations · ${profile.agent.mistakes} failed items</p>
                <div class="profile-metrics">
                    <span><strong>${fmtScore(profile.agent.average)}</strong>Overall Score</span>
                    <span><strong>${profile.failedCalls.length}</strong>Failed Calls</span>
                    <span><strong>${profile.errors.length}</strong>Zero-score items</span>
                </div>
                
                <div class="profile-category-scores" style="margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--line); display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div style="display: grid; gap: 2px; background: rgba(91, 123, 188, 0.05); padding: 6px 10px; border-radius: 6px; border: 1px solid var(--line);"><span style="font-size: 10px; color: var(--muted);">Soft Skills Avg</span><strong style="font-size: 14px; color: #719af8;">${softAvg}</strong></div>
                    <div style="display: grid; gap: 2px; background: rgba(91, 123, 188, 0.05); padding: 6px 10px; border-radius: 6px; border: 1px solid var(--line);"><span style="font-size: 10px; color: var(--muted);">Compliance Avg</span><strong style="font-size: 14px; color: #48d6a3;">${compAvg}</strong></div>
                    <div style="display: grid; gap: 2px; background: rgba(91, 123, 188, 0.05); padding: 6px 10px; border-radius: 6px; border: 1px solid var(--line);"><span style="font-size: 10px; color: var(--muted);">Business Crit. Avg</span><strong style="font-size: 14px; color: #ff687b;">${busAvg}</strong></div>
                    <div style="display: grid; gap: 2px; background: rgba(91, 123, 188, 0.05); padding: 6px 10px; border-radius: 6px; border: 1px solid var(--line);"><span style="font-size: 10px; color: var(--muted);">End User Crit. Avg</span><strong style="font-size: 14px; color: #f6b54d;">${endAvg}</strong></div>
                </div>
            </div>
            
            <div class="profile-detail">
                <p class="profile-label">PRIMARY FOCUS</p>
                <strong>${html(focus)}</strong>
                <p>Most repeated attribute: <b>${html(attribute?.[0] || 'None')}</b>${attribute ? ` (${attribute[1]})` : ''}</p>
                <p>Top error reason: <b>${html(reason?.[0] || 'None')}</b>${reason ? ` (${reason[1]})` : ''}</p>
            </div>
            
            <div class="profile-detail coaching">
                <p class="profile-label">RECOMMENDED COACHING</p>
                <p>${html(coaching)}</p>
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
    const avg = scores.length ? scores.reduce((a, b) => x + b, 0) / scores.length : null; // تعديل بسيط لضمان الجمع الصحيح
    const failedCalls = calls.filter(c => c.failed);
    const types = ['Soft Skills', 'Compliance', 'Business Critical', 'End User Critical'];
    const counts = Object.fromEntries(types.map(t => [t, failed.filter(r => category(r) === t).length]));
    const attributes = [...group(failed, r => value(r, 'attribute')).entries()].sort((a, b) => b[1] - a[1]);
    const errors = [...group(failed, r => value(r, 'reason')).entries()].sort((a, b) => b[1] - a[1]);

    $('avg-score').textContent = fmtScore(avg);
    $('evaluations').textContent = summary.length || '--';
    $('agents').textContent = agents.length || '--';
    $('critical-errors').textContent = failedCalls.length;
    $('avg-note').textContent = scores.length ? 'Across scored evaluations' : 'No score column found';
    $('period-label').textContent = `${failed.length} failed items (Score = 0); ${failedCalls.length} failed calls; ${duplicatesRemoved} duplicate comments removed.`;

    $('category-breakdown').innerHTML = types.map(t => `<div class="category-card"><strong>${t}</strong><span>${counts[t]} failed items</span>${t === 'Soft Skills' ? `<small>${calls.filter(c => c.soft >= 3).length} calls reached 3 different soft-skill attributes</small>` : ''}</div>`).join('');

    $('ranking-list').innerHTML = agents.slice(0, 8).map((a, i) => `<div class="ranking-row"><span class="rank">${i + 1}</span><div><div class="agent-name">${a.name}</div><div class="agent-meta">${a.evaluations} evaluations · ${a.mistakes} failed items · ${a.failedCalls} failed calls</div></div><span class="score">${fmtScore(a.average)}</span></div>`).join('') || '<p class="empty">No agents found.</p>';
    
    const max = attributes[0]?.[1] || 1;
    $('pareto-list').innerHTML = attributes.slice(0, 6).map(([n, c]) => `<div class="bar-row"><div><div class="bar-label">${n}</div><div class="bar"><span style="width:${c / max * 100}%"></span></div></div><div class="bar-value">${c}</div></div>`).join('') || '<p class="empty">No failed items found.</p>';
    
    const outliers = [...agents].sort((a, b) => b.failedCalls - a.failedCalls || (a.average ?? 101) - (b.average ?? 101) || b.mistakes - a.mistakes).slice(0, 5);
    $('outlier-list').innerHTML = outliers.map(a => `<div class="outlier"><div class="outlier-top"><span>${a.name}</span><span class="priority">${a.failedCalls ? 'High' : 'Review'}</span></div><p>${fmtScore(a.average)} · ${a.failedCalls} failed calls · ${a.mistakes} failed items</p></div>`).join('') || '<p class="empty">No outliers calculated yet.</p>';
    
    const actions = types.filter(t => counts[t]).sort((a, b) => counts[b] - counts[a]).slice(0, 3).map(t => `<div class="action-item"><strong>${t} — ${counts[t]} failed items</strong><p>${t === 'Soft Skills' ? 'A call fails only after 3 different soft-skill attributes. Repeated comments for the same attribute do not add to the fail count.' : t === 'Compliance' ? 'Use a compliance refresher and monitor the next evaluations.' : 'Review immediately: this category fails the call.'}</p></div>`);
    $('action-plan').innerHTML = actions.join('') || '<p class="empty">No recommendations available.</p>';
    
    $('reason-table').innerHTML = errors.length ? `<table><thead><tr><th>Error reason</th><th>Occurrences</th><th>Share</th></tr></thead><tbody>${errors.slice(0, 12).map(([n, c]) => `<tr><td>${n}</td><td>${c}</td><td>${(c / (failed.length || 1) * 100).toFixed(1)}%</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No zero-score errors found.</p>';
    
    $('failed-calls-table').innerHTML = failed.length ? `<table><thead><tr><th>Call ID</th><th>Agent</th><th>Type</th><th>Attribute</th><th>Error reason</th><th>Comment</th><th>Severity</th></tr></thead><tbody>${failed.slice(0, 75).map((r, i) => `<tr><td>${cleanText(value(r, 'monitoringId'), `Row ${i + 1}`)}</td><td>${cleanText(value(r, 'agent'), 'Unknown agent')}</td><td>${category(r)}</td><td>${cleanText(value(r, 'attribute'))}</td><td>${cleanText(value(r, 'reason'))}</td><td>${cleanText(value(r, 'comment'), '-')}</td><td>${cleanText(value(r, 'severity'), '-')}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No zero-score items available.</p>';
    
    window.latestCallResults = calls;
    $('call-results-table').innerHTML = calls.length ? `<table><thead><tr><th>Call ID</th><th>Agent</th><th>Result</th><th>Fail reason</th><th>Unique Soft Skills</th><th>Business Critical</th><th>End User Critical</th><th>Compliance</th></tr></thead><tbody>${calls.map(call => `<tr><td>${html(call.id)}</td><td>${html(call.agent)}</td><td><span class="result ${call.failed ? 'failed' : 'passed'}">${call.failed ? 'FAILED' : 'PASSED'}</span></td><td>${html(call.failReason)}</td><td>${call.soft}</td><td>${call.business}</td><td>${call.endUser}</td><td>${call.compliance}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No zero-score items available.</p>';
    
    const previousSelection = $('agent-select').value;
    window.latestAgentProfiles = new Map(agents.map(agent => [agent.name, { agent, errors: failed.filter(row => cleanText(value(row, 'agent'), 'Unknown agent') === agent.name), failedCalls: failedCalls.filter(call => call.agent === agent.name) }]));
    window.latestReportData = { average: avg, evaluations: summary.length, agents, failed, failedCalls, counts, attributes, reasons: errors };
    
    $('agent-select').innerHTML = `<option value="">Select an agent</option>${agents.map(agent => `<option value="${html(agent.name)}">${html(agent.name)}</option>`).join('')}`;
    const selected = window.latestAgentProfiles.has(previousSelection) ? previousSelection : agents[0]?.name || '';
    $('agent-select').value = selected;
    renderAgentProfile(selected);
}

function buildCoachingDraft() {
    const data = window.latestReportData, name = $('agent-select').value, profile = window.latestAgentProfiles?.get(name);
    if (!data || !name || !profile) return '';
    const atts = [...group(profile.errors, r => value(r, 'attribute')).entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => `• ${n} (${c} occurrences)`).join('\n');
    
    const softAvg = fmtScore(profile.agent.categoryAverages['Soft Skills']);
    const compAvg = fmtScore(profile.agent.categoryAverages['Compliance']);
    const busAvg = fmtScore(profile.agent.categoryAverages['Business Critical']);
    const endAvg = fmtScore(profile.agent.categoryAverages['End User Critical']);

    return `COACHING RECAP & ACTION PLAN\n\nAgent: ${profile.agent.name}\nOverall QA Score: ${fmtScore(profile.agent.average)}\nEvaluations Checked: ${profile.agent.evaluations}\nCritical Failed Calls: ${profile.failedCalls.length}\n\nCATEGORY PERFORMANCE BREAKDOWN:\n• Soft Skills Average: ${softAvg}\n• Compliance Average: ${compAvg}\n• Business Critical Average: ${busAvg}\n• End User Critical Average: ${endAvg}\n\nTOP ERROR ATTRIBUTES:\n${atts || '• No specific failed attributes.'}\n\nCOACHING OBJECTIVE & COMMITMENT:\nDiscussed the main breakdown attributes. Agent acknowledges the gaps and commits to addressing them in the upcoming interactions. Next 5 evaluations will closely monitor these specific points.`;
}

function buildManagementBrief() {
    const data = window.latestReportData;
    if (!data) return '';
    const topAgents = [...data.agents].sort((a, b) => (b.average ?? -1) - (a.average ?? -1)).slice(0, 3).map(a => `• ${a.name} (${fmtScore(a.average)})`).join('\n');
    const bottomAgents = [...data.agents].sort((a, b) => b.failedCalls - a.failedCalls || b.mistakes - a.mistakes).slice(0, 3).map(a => `• ${a.name} (${a.failedCalls} failed calls, ${a.mistakes} failed items)`).join('\n');
    const topErrors = data.reasons.slice(0, 3).map(([n, c]) => `• ${n} (${c} occurrences)`).join('\n');
    return `EXECUTIVE QUALITY SUMMARY\n\nOverall Campaign Average: ${fmtScore(data.average)}\nTotal Evaluations analyzed: ${data.evaluations}\nTotal Unique Agents: ${data.agents.length}\nCritical Failed Calls Count: ${data.failedCalls.length}\n\nTOP PERFORMING AGENTS:\n${topAgents}\n\nPRIORITY AGENTS FOR COACHING (Outliers):\n${bottomAgents}\n\nTOP ROOT CAUSES (Error reasons):\n${topErrors}\n\nRECOMMENDED ACTIONS:\nDeploy refreshers for the top error reasons. Prioritize one-to-one coaching sessions with the listed outlier agents.`;
}

function buildDMAICPlan() {
    const data = window.latestReportData;
    if (!data) return '';
    const topError = data.reasons[0]?.[0] || 'Process Compliance';
    return `DMAIC CONTINUOUS IMPROVEMENT PLAN\n\n1. DEFINE:\nObjective: Reduce critical failures and optimize performance across the campaign.\nTarget Metric: Increase overall score average from ${fmtScore(data.average)} and target zero critical failed calls.\n\n2. MEASURE:\nBaseline: ${data.evaluations} evaluations reviewed, resulting in ${data.failedCalls.length} critical call drops.\nPrimary Area of Concern: "${topError}" represents a significant share of errors.\n\n3. ANALYZE:\nRoot cause analysis points to repetitive errors in "${topError}". Evaluation trends suggest specific knowledge gaps or behavioral misalignment among outlier profiles.\n\n4. IMPROVE:\nAction 1: Immediate huddle / refresher training focusing on the main failure reasons.\nAction 2: Structured one-to-one coaching for priority agents using call recordings.\n\n5. CONTROL:\nValidation: QA will perform 5 targeted calibrations for coached agents over the next cycles. Track attribute performance in subsequent detailed reports to confirm closure of gaps.`;
}

async function handleFile(file, isSummary) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const workbook = XLSX.read(e.target.result, { type: 'binary' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                resolve(XLSX.utils.sheet_to_json(sheet));
            } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error('File reading failed.'));
        reader.readAsBinaryString(file);
    });
}

function loadDemo() {
    const summary = [
        { 'Agent Name': 'Ahmed M.Q.', 'Score %': '92%' },
        { 'Agent Name': 'John Doe', 'Score %': '45%' },
        { 'Agent Name': 'Sarah Connor', 'Score %': '88%' }
    ];
    const detailed = [
        { 'Agent Name': 'Ahmed M.Q.', 'Score': '100%', 'Section': 'Soft Skills', 'Attribute Name': 'Active Listening', 'Error Reason': 'None', 'Error Reason Comment': 'Excellent service', 'Monitoring ID': 'C01' },
        { 'Agent Name': 'Ahmed M.Q.', 'Score': '0%', 'Section': 'Soft Skills', 'Attribute Name': 'Interruption', 'Error Reason': 'Interrupted customer', 'Error Reason Comment': 'Spoke over customer at 01:23', 'Monitoring ID': 'C01' },
        { 'Agent Name': 'John Doe', 'Score': '0%', 'Section': 'Business Critical', 'Attribute Name': 'Authentication', 'Error Reason': 'Failed Verification', 'Error Reason Comment': 'Did not ask for email address', 'Monitoring ID': 'C02' },
        { 'Agent Name': 'John Doe', 'Score': '0%', 'Section': 'Soft Skills', 'Attribute Name': 'Tone', 'Error Reason': 'Monotone', 'Error Reason Comment': 'Sounded bored', 'Monitoring ID': 'C02' },
        { 'Agent Name': 'John Doe', 'Score': '0%', 'Section': 'Soft Skills', 'Attribute Name': 'Empathy', 'Error Reason': 'No Empathy', 'Error Reason Comment': 'Did not acknowledge complaint', 'Monitoring ID': 'C02' },
        { 'Agent Name': 'John Doe', 'Score': '0%', 'Section': 'Soft Skills', 'Attribute Name': 'Greeting', 'Error Reason': 'Missed Greeting', 'Error Reason Comment': 'Did not state company name', 'Monitoring ID': 'C02' },
        { 'Agent Name': 'Sarah Connor', 'Score': '100%', 'Section': 'Compliance', 'Attribute Name': 'Hold Process', 'Error Reason': 'None', 'Error Reason Comment': 'Correct hold', 'Monitoring ID': 'C03' }
    ];
    render({ summary, detailed });
    showStatus('Demo data loaded. Check the dashboard counters and individual profile!');
}

document.addEventListener('DOMContentLoaded', () => {
    let summaryData = [], detailedData = [];
    
    $('summary-file').addEventListener('change', async e => {
        const file = e.target.files[0];
        if (file) {
            try { summaryData = await handleFile(file, true); showStatus(`Summary loaded: ${summaryData.length} records.`); }
            catch (err) { showStatus('Error parsing Summary file.', true); }
        }
    });

    $('detailed-file').addEventListener('change', async e => {
        const file = e.target.files[0];
        if (file) {
            try { detailedData = await handleFile(file, false); showStatus(`Detailed report loaded: ${detailedData.length} rows.`); }
            catch (err) { showStatus('Error parsing Detailed file.', true); }
        }
    });

    $('analyze-button').addEventListener('click', () => {
        if (!detailedData.length) { showStatus('Please upload at least a Detailed report file.', true); return; }
        render({ summary: summaryData, detailed: detailedData });
        showStatus('Reports analyzed successfully.');
    });

    $('demo-button').addEventListener('click', loadDemo);
    $('agent-select').addEventListener('change', e => renderAgentProfile(e.target.value));

    $('generate-coaching-button').addEventListener('click', () => {
        const draft = buildCoachingDraft();
        if (!draft) { showStatus('Analyze data and select an agent first.', true); return; }
        $('coaching-draft').value = draft;
        showStatus('Coaching recap draft generated.');
    });

    $('copy-coaching-button').addEventListener('click', async () => {
        const draft = $('coaching-draft').value;
        if (!draft) { showStatus('Generate a draft first.', true); return; }
        try { await navigator.clipboard.writeText(draft); showStatus('Coaching recap copied.'); }
        catch (e) { $('coaching-draft').focus(); $('coaching-draft').select(); showStatus('Select and copy manually.'); }
    });

    $('generate-brief-button').addEventListener('click', () => {
        const brief = buildManagementBrief();
        if (!brief) { showStatus('Analyze a report first.', true); return; }
        $('management-brief-draft').value = brief;
        showStatus('Management brief generated.');
    });

    $('copy-brief-button').addEventListener('click', async () => {
        const brief = $('management-brief-draft').value;
        if (!brief) { showStatus('Generate a brief first.', true); return; }
        try { await navigator.clipboard.writeText(brief); showStatus('Brief copied.'); }
        catch (e) { $('management-brief-draft').focus(); $('management-brief-draft').select(); showStatus('Select and copy manually.'); }
    });

    $('generate-dmaic-button').addEventListener('click', () => {
        const plan = buildDMAICPlan();
        if (!plan) { showStatus('Analyze a report first.', true); return; }
        $('dmaic-draft').value = plan;
        showStatus('DMAIC improvement plan generated.');
    });

    $('copy-dmaic-button').addEventListener('click', async () => {
        const plan = $('dmaic-draft').value;
        if (!plan) { showStatus('Generate a DMAIC plan first.', true); return; }
        try { await navigator.clipboard.writeText(plan); showStatus('DMAIC plan copied.'); }
        catch (e) { $('dmaic-draft').focus(); $('dmaic-draft').select(); showStatus('Select and copy manually.'); }
    });

    $('export-calls-button').addEventListener('click', () => {
        const calls = window.latestCallResults || [];
        if (!calls.length) { showStatus('Analyze a Detailed report before exporting.', true); return; }
        const rows = [
            ['Call ID', 'Agent', 'Result', 'Fail reason', 'Unique Soft Skills', 'Business Critical', 'End User Critical', 'Compliance'],
            ...calls.map(c => [c.id, c.agent, c.failed ? 'FAILED' : 'PASSED', c.failReason, c.soft, c.business, c.endUser, c.compliance])
        ];
        const text = rows.map(row => row.map(v => `"${csv(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
        link.setAttribute('download', 'call_results_register.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
});
