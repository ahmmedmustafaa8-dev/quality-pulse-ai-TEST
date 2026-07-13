// تعريف الأداة في أول السطر لضمان عدم حدوث خطأ في الملفات الأخرى
window.$ = function(id) { return document.getElementById(id); };

// رسالة تأكيد فورية للتأكد من تخطي الكاش بنجاح
alert("🚀 تم تشغيل النسخة المحصنة بنسبة 100% بنجاح! اضغط OK.");

var ALIASES = {
    agent: ['agent','name','user','الوكيل','الموظف','اسم'],
    score: ['score','compliance','الدرجة','النسبة','المعدل'],
    section: ['section','category','الفئة','القسم','نوع المعيار'],
    attribute: ['attribute','البند','المعيار','السلوك'],
    severity: ['severity','خطورة','الخطورة'],
    reason: ['reason','سبب','السبب'],
    comment: ['comment','ملاحظات','التعليق'],
    monitoringId: ['monitoring','evaluation','call','id','رقم','المكالمة'],
    transactionType: ['transaction','type','direction','اتجاه','نوع']
};

function norm(v) {
    return String(v || '').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
}

function txt(v, fb) {
    var fallback = fb || 'Not specified';
    return String(v || '').trim() || fallback;
}

function getCol(row, key, fbIdx) {
    if (!row) return null;
    var keys = Object.keys(row);
    var found = keys.find(function(h) {
        return ALIASES[key].some(function(a) {
            return norm(h).includes(a) || a.includes(norm(h));
        });
    });
    return found || keys[fbIdx] || null;
}

function val(row, key, fbIdx) {
    var defaultIdx = fbIdx || 0;
    var c = getCol(row, key, defaultIdx);
    return c ? row[c] : '';
}

function parseNum(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = parseFloat(String(v).replace('%',''));
    return Number.isFinite(n) ? (n <= 1 ? n * 100 : n) : null;
}

function getCat(row) {
    var t = (val(row,'section',2) + " " + val(row,'severity',4) + " " + val(row,'attribute',3)).toLowerCase();
    if (t.includes('business') || t.includes('بيزنس') || t.includes('عمليات')) return 'Business Critical';
    if (t.includes('end user') || t.includes('عميل') || t.includes('نهائي')) return 'End User Critical';
    if (t.includes('compliance') || t.includes('امتثال') || t.includes('نظامي')) return 'Compliance';
    return 'Soft Skills';
}

function processData(failedRows, summaryRows) {
    var rowsSummary = summaryRows || [];
    var calls = new Map(), sumTypes = new Map();
    
    rowsSummary.forEach(function(r) {
        var id = txt(val(r,'monitoringId',7)), t = txt(val(r,'transactionType',8));
        if (id && t) sumTypes.set(norm(id), t);
    });

    failedRows.forEach(function(r) {
        var ag = txt(val(r,'agent',0),'Unknown agent');
        var id = txt(val(r,'monitoringId',7),'Unknown ID');
        var k = ag + "::" + id;
        if (!calls.has(k)) {
            calls.set(k, { id: id, agent: ag, type: sumTypes.get(norm(id)) || 'Inbound', soft: 0, biz: 0, eu: 0, comp: 0 });
        }
        var c = calls.get(k), type = getCat(r);
        if (type === 'Soft Skills') c.soft++;
        if (type === 'Business Critical') c.biz++;
        if (type === 'End User Critical') c.eu++;
        if (type === 'Compliance') c.comp++;
    });

    rowsSummary.forEach(function(r) {
        var ag = txt(val(r,'agent',0),'Unknown agent');
        var id = txt(val(r,'monitoringId',7),'');
        if (id && !calls.has(ag + "::" + id)) {
            calls.set(ag + "::" + id, { id: id, agent: ag, type: txt(val(r,'transactionType',8),'Inbound'), soft:0, biz:0, eu:0, comp:0 });
        }
    });

    return Array.from(calls.values()).map(function(c) {
        var calcSoft = function(s) {
            if (s === 1) return 97.22;
            if (s === 2) return 94.44;
            if (s === 3) return 88.80;
            if (s === 4) return 83.33;
            if (s > 4) return Math.max(0, 100 - (s * 4.16));
            return 100;
        };
        c.scores = { compliance: c.comp > 0 ? 0 : 100, endUser: c.eu > 0 ? 0 : 100, business: c.biz > 0 ? 0 : 100, soft: calcSoft(c.soft) };
        c.failed = c.scores.compliance < 99 || c.scores.soft < 90 || c.scores.business < 90 || c.scores.endUser < 90;
        return c;
    });
}

function render(calls, summaryRows) {
    var agMap = new Map();
    summaryRows.forEach(function(r) {
        var ag = txt(val(r,'agent',0),'Unknown agent'), s = parseNum(val(r,'score',1));
        if (!agMap.has(ag)) agMap.set(ag, { name: ag, scores: [], fCalls: 0, comp:[], soft:[], biz:[], eu:[] });
        if (s !== null) agMap.get(ag).scores.push(s);
    });

    calls.forEach(function(c) {
        if (!agMap.has(c.agent)) agMap.set(c.agent, { name: c.agent, scores: [], fCalls: 0, comp:[], soft:[], biz:[], eu:[] });
        var a = agMap.get(c.agent);
        if (c.failed) a.fCalls++;
        a.comp.push(c.scores.compliance); a.soft.push(c.scores.soft); a.biz.push(c.scores.business); a.eu.push(c.scores.endUser);
    });

    var agents = Array.from(agMap.values()).map(function(a) {
        var avg = function(arr) { return arr.length ? arr.reduce(function(x,y){return x+y;},0)/arr.length : 100; };
        a.avgSoft = avg(a.soft); a.avgBiz = avg(a.biz); a.avgEU = avg(a.eu); a.avgComp = avg(a.comp);
        a.finalAvg = a.scores.length ? avg(a.scores) : (a.avgSoft + a.avgBiz + a.avgEU + a.avgComp)/4;
        return a;
    }).sort(function(a,b) { return b.fCalls - a.fCalls || a.finalAvg - b.finalAvg; });

    var allScores = agents.flatMap(function(a) { return a.scores; });
    var totAvg = allScores.length ? allScores.reduce(function(x,y){return x+y;},0)/allScores.length : (agents.reduce(function(x,y){return x+y.finalAvg;},0)/(agents.length||1));

    var setT = function(id, v) { if(window.$(id)) window.$(id).textContent = v; };
    setT('avg-score', totAvg.toFixed(2) + "%");
    setT('evaluations', summaryRows.length || calls.length || '0');
    setT('agents', agents.length || '0');
    setT('critical-errors', calls.filter(function(c){ return c.failed; }).length);

    var list = window.$('ranking-list') || document.querySelector('.space-y-4');
    if (list) {
        var htmlList = "";
        agents.forEach(function(a, i) {
            htmlList += "<div style='padding:12px; border-bottom:1px solid #334155; display:flex; justify-content:space-between; align-items:center; background:#1e293b; margin-bottom:8px; border-radius:6px;'>" +
                "<span style='color:#94a3b8; font-weight:bold; width:24px;'>" + (i+1) + "</span>" +
                "<div style='flex-grow:1; margin-left:10px;'>" +
                    "<div style='font-weight:bold; color:#f8fafc;'>" + a.name + "</div>" +
                    "<div style='font-size:12px; color:#94a3b8; margin-top:4px;'>" +
                        "Soft: <span style='color:" + (a.avgSoft<90?'#f87171':'#34d399') + "'>" + a.avgSoft.toFixed(2) + "%</span> | " +
                        "Biz: <span style='color:" + (a.avgBiz<90?'#f87171':'#34d399') + "'>" + a.avgBiz.toFixed(2) + "%</span> | " +
                        "EU: <span style='color:" + (a.avgEU<90?'#f87171':'#34d399') + "'>" + a.avgEU.toFixed(2) + "%</span> | " +
                        "Comp: <span style='color:" + (a.avgComp<99?'#f87171':'#34d399') + "'>" + a.avgComp.toFixed(2) + "%</span>" +
                    "</div>" +
                "</div>" +
                "<span style='font-weight:bold; color:#60a5fa;'>" + a.finalAvg.toFixed(2) + "%</span>" +
            "</div>";
        });
        list.innerHTML = htmlList;
    }
    renderPivot(calls);
}

function renderPivot(calls) {
    var pivot = {}, types = new Set();
    calls.forEach(function(c) {
        var t = c.type.toLowerCase().includes('outbound') ? 'Outbound' : 'Inbound';
        types.add(t);
        if (!pivot[t]) pivot[t] = {};
        if (!pivot[t][c.agent]) pivot[t][c.agent] = { comp: [], eu: [], biz: [], soft: [] };
        pivot[t][c.agent].comp.push(c.scores.compliance);
        pivot[t][c.agent].eu.push(c.scores.endUser);
        pivot[t][c.agent].biz.push(c.scores.business);
        pivot[t][c.agent].soft.push(c.scores.soft);
    });

    var html = "<h3 style='margin-top:35px; color:#fff; border-bottom:2px solid #3b82f6; padding-bottom:8px;'>Score Per Agent (By Transaction Type)</h3>";
    Array.from(types).forEach(function(t) {
        html += "<div style='margin-bottom:25px; background:#1e293b; padding:15px; border-radius:8px;'>" +
            "<h4 style='color:#60a5fa; margin-bottom:10px; font-weight:bold;'>Direction: " + t + "</h4>" +
            "<table style='width:100%; border-collapse:collapse; text-align:left; color:#f8fafc;'>" +
                "<thead>" +
                    "<tr style='background:#334155; color:#94a3b8; font-size:13px;'>" +
                        "<th style='padding:10px; border:1px solid #475569;'>Agent Name</th>" +
                        "<th style='padding:10px; border:1px solid #475569;'>Average of %Compliance</th>" +
                        "<th style='padding:10px; border:1px solid #475569;'>Average of %End User Critical</th>" +
                        "<th style='padding:10px; border:1px solid #475569;'>Average of %Business Critical</th>" +
                        "<th style='padding:10px; border:1px solid #475569;'>Average of %Softskills</th>" +
                    "</tr>" +
                "</thead><tbody>";
        Object.keys(pivot[t]).sort().forEach(function
