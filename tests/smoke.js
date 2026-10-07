// Прогон всех страниц пула в jsdom: ошибки скриптов, ключевые узлы, сценарии модели.
const {JSDOM} = require('jsdom');
const fs = require('fs');
const path = require('path');
const {indexedDB, IDBKeyRange} = require('fake-indexeddb');

const SITE = path.join(__dirname, '..', 'site');
let failed = 0;
const ok  = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); failed++; };

function fakeCtx(){
  return new Proxy({canvas:{width:900,height:600}, measureText:()=>({width:10}),
    createRadialGradient:()=>({addColorStop(){}}), createLinearGradient:()=>({addColorStop(){}}),
    getImageData:()=>({data:[]})}, {get:(t,k)=> k in t ? t[k] : ()=>{}, set:()=>true});
}

function load(file){
  const errs = [];
  const dom = new JSDOM(fs.readFileSync(path.join(SITE, file), 'utf8'), {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://local/',
    beforeParse(w){
      w.print = () => {};
      w.scrollTo = () => {};
      w.onerror = (m) => errs.push(String(m));
      w.indexedDB = indexedDB; w.IDBKeyRange = IDBKeyRange;
      w.HTMLCanvasElement.prototype.getContext = () => fakeCtx();
      w.Element.prototype.scrollIntoView = function(){};
      if (w.HTMLMediaElement) {
        w.HTMLMediaElement.prototype.load = function(){};
        w.HTMLMediaElement.prototype.play = () => Promise.resolve();
        w.HTMLMediaElement.prototype.pause = function(){};
      }
      w.AudioContext = function(){
        this.state='running'; this.currentTime=0; this.destination={};
        this.createOscillator=()=>({connect(){},start(){},stop(){},frequency:{value:0,setValueAtTime(){}},type:''});
        this.createGain=()=>({connect(){},gain:{value:0,setValueAtTime(){},exponentialRampToValueAtTime(){},linearRampToValueAtTime(){}}});
        this.createBiquadFilter=()=>({connect(){},frequency:{value:0,setValueAtTime(){}},Q:{value:1},type:''});
        this.resume=()=>{}; this.suspend=()=>{}; this.close=()=>{};
      };
      w.webkitAudioContext = w.AudioContext;
    }
  });
  return {dom, d: dom.window.document, W: dom.window, errs};
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const click = (W, el) => el && el.dispatchEvent(new W.MouseEvent('click', {bubbles:true}));

(async () => {
  // 1. Синтаксис скриптов во всех файлах
  console.log('\nСинтаксис скриптов');
  for (const f of fs.readdirSync(SITE).filter(x => x.endsWith('.html'))) {
    const src = fs.readFileSync(path.join(SITE, f), 'utf8');
    const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
    let m, badScript = false;
    while ((m = re.exec(src))) { try { new Function(m[1]); } catch(e){ badScript = e.message; } }
    badScript ? bad(f + ' — ' + badScript) : ok(f);
  }

  // 2. Страницы базы знаний открываются без ошибок
  console.log('\nСтраницы базы знаний');
  for (const f of ['index.html','00-ukazatel-bz-ii-medicina.html','01-zarubezhnyy-segment.html',
                   '02-paralleli-i-modeli.html','03-koncentraciya-i-ii-medicina.html',
                   '04-processnaya-model.html','05-trek-osvoeniya.html','06-uroven-uchastiya.html']) {
    const {d, errs} = load(f);
    await wait(500);
    errs.length ? bad(f + ' — ошибки: ' + errs.slice(0,2).join('; ')) : ok(f + ' — без ошибок');
    if (f !== 'index.html') {
      const panes = d.querySelectorAll('section.pane').length;
      panes > 0 ? ok(`  разделов: ${panes}`) : bad('  разделы не найдены');
    }
  }

  // 3. Битые внутренние ссылки
  console.log('\nВнутренние ссылки');
  const files = new Set(fs.readdirSync(SITE));
  let broken = 0;
  for (const f of fs.readdirSync(SITE).filter(x => x.endsWith('.html'))) {
    const src = fs.readFileSync(path.join(SITE, f), 'utf8');
    for (const href of new Set([...src.matchAll(/href="([^"#:${]+\.html)(?:#[^"]*)?"/g)].map(m => m[1]))) {
      if (!files.has(href) && !href.startsWith('../')) { bad(`${f} → ${href}`); broken++; }
    }
  }
  if (!broken) ok('битых ссылок нет');

  // 4. Модель: меню, настройки, сценарий сессии, запись
  console.log('\nМодель «Концентрация и дыхание»');
  const {d, W, errs} = load('concentration-breathing-model.html');
  await wait(700);
  errs.length ? bad('ошибки скриптов: ' + errs.slice(0,2).join('; ')) : ok('загрузка без ошибок');

  const menu = [...d.querySelectorAll('#topbar button')].length;
  menu >= 7 ? ok(`верхнее меню: ${menu} кнопок`) : bad('верхнее меню неполное');
  d.querySelector('#adv-body .cols') ? ok('ползунки в расширенных настройках') : bad('ползунки не перенесены');
  d.querySelectorAll('.hint-mark').length >= 10 ? ok('маркеры подсказок на месте') : bad('маркеров подсказок мало');

  click(W, d.getElementById('tb-quick'));
  const reasons = d.querySelectorAll('#rs-reasons .rs-reason').length;
  reasons === 12 ? ok('экран причин: 12 причин') : bad(`причин ${reasons}, ожидалось 12`);

  click(W, d.querySelector('[data-reason="Боль"]'));
  const pars = [...d.querySelectorAll('#rs-card [data-par]')].length;
  pars >= 8 ? ok(`карточка параметров: ${pars} полей`) : bad('карточка параметров неполная');
  d.querySelector('[data-q="pre:quality"]') ? ok('вопрос о характере боли') : bad('нет вопроса о характере боли');

  const h2 = d.querySelector('#rs-card [data-par="t-h2"]');
  h2.value = '20'; h2.dispatchEvent(new W.Event('input', {bubbles:true}));
  d.getElementById('t-h2').value === '20' ? ok('правка в карточке уходит в ползунок') : bad('правка не доходит до ползунка');

  click(W, d.querySelector('[data-q="pre:area"][data-v="heart"]'));
  click(W, d.querySelector('[data-q="pre:level"][data-v="7"]'));
  click(W, d.getElementById('rs-go'));
  await wait(250);
  d.getElementById('session-live').classList.contains('on') ? ok('сессия запускается') : bad('сессия не запустилась');

  // Процесс шёл параллельно: точка до сессии отбрасывается, внутри секунды остаётся последняя
  const fbOrig = W.__cbFbTrack, fbStart = W.performance.now() - 2000;
  // сессия идёт уже ~250 мс: точки 1.9 и 1.95 внутри её первой секунды, 1.0 — до старта
  W.__cbFbTrack = () => ({start: fbStart, track: [{t:1.0, v:99}, {t:1.9, v:10}, {t:1.95, v:20}]});
  W.__cbSessEvent('hold'); W.__cbSessEvent('contact'); W.__cbSessEvent('release');
  click(W, d.getElementById('sess-exit'));
  await wait(250);
  d.getElementById('post-screen').classList.contains('on') ? ok('экран вопросов после сессии') : bad('нет экрана после сессии');
  click(W, d.querySelector('[data-q="post:level"][data-v="3"]'));
  click(W, d.getElementById('ps-save'));
  await wait(350);
  const idx = await W.CB_DB.all('index');
  const ses = await W.CB_DB.all('sessions');
  idx.length && ses.length ? ok('запись сохранена в указатель и сессии') : bad('запись не сохранилась');
  if (ses.length) {
    const r = ses[ses.length-1];
    r.fmt === 'cb-record-2' ? ok('формат записи cb-record-2') : bad('неверная версия формата');
    r.reason === 'Боль' && r.reasonCode === 'R02' && r.reasonGroup === 'pain'
      ? ok('в записи причина, код и группа') : bad('в записи нет кода или группы причины');
    idx[idx.length-1].reasonCode === 'R02' ? ok('код причины в указателе') : bad('в указателе нет кода причины');
    r.stated.pre.level === 7 && r.stated.post.level === 3 ? ok('ответы до и после записаны') : bad('ответы записаны неверно');
    r.stated.pre.area === 'heart' && r.stated.pre.ctx === '__skipped' && r.stated.pre.quality === '__skipped'
      ? ok('показанный вопрос без ответа — __skipped') : bad('неотвеченный вопрос до сессии не помечен пропуском');
    r.set.params && r.set.params['t-h2'] === 20 ? ok('фактические параметры записаны') : bad('параметры сессии не записаны');

    // З-2: сырьё в series, тот же id, одной транзакцией с sessions и index
    const sr = (await W.CB_DB.all('series')).find(x => x.id === r.id);
    sr && idx.some(x => x.id === r.id) ? ok('series: запись с тем же id, что в sessions и index') : bad('в series нет записи сессии');
    if (sr) {
      const ev = sr.events.map(x => x.e).join(',');
      ev === 'start,hold,contact,release,end' ? ok('series.events: start, hold, contact, release, end') : bad('series.events: ' + ev);
      sr.events.every((x, i, a) => typeof x.t === 'number' && (!i || x.t >= a[i-1].t))
        ? ok('время событий растёт от старта') : bad('время событий неверно');
      JSON.stringify(sr.react) === '[20]' ? ok('react: окно сессии, одно значение в секунду') : bad('react: ' + JSON.stringify(sr.react));
      !('rr' in sr) && !('spo2' in sr) ? ok('без датчика rr и spo2 не пишутся') : bad('rr/spo2 записаны без датчика');
    }
  }
  W.__cbFbTrack = fbOrig;

  // Коды причин неизменяемы (Р-8): соответствие коду и строке
  const CODES = {'Дискомфорт':'R01','Боль':'R02','Острая боль':'R03','Хроническая боль':'R04','Воспаление':'R05',
    'Расслабление':'R06','Восстановление':'R07','Усталость':'R08','Концентрация':'R09','Тревога':'R10',
    'Интуиция':'R11','Профилактика':'R12'};
  JSON.stringify(W.CB_REASON_CODES) === JSON.stringify(CODES)
    ? ok('коды причин R01–R12 соответствуют строкам') : bad('коды причин не совпадают с таблицей');

  // Старые записи cb-record-1: код подставляется при чтении, исходник не меняется
  await W.CB_DB.put('sessions', {id:'OLD1', fmt:'cb-record-1', reason:'Тревога'});
  await W.CB_DB.put('sessions', {id:'OLD2', fmt:'cb-record-1', reason:'Бессонница'});
  const old = Object.fromEntries((await W.CB_DB.all('sessions')).map(x => [x.id, x]));
  old.OLD1.reasonCode === 'R10' && old.OLD1.reasonGroup === 'calm' && !old.OLD1.reasonUnknown
    ? ok('старая запись получает код по строке') : bad('старая запись не получила код');
  old.OLD2.reasonCode === 'R00' && old.OLD2.reasonUnknown === true && old.OLD2.reason === 'Бессонница'
    ? ok('неизвестная причина — R00 с пометкой') : bad('неизвестная причина обработана неверно');
  old.OLD1.fmt === 'cb-record-1' ? ok('версия старой записи не переписывается') : bad('версия старой записи изменена');

  // Escape: в сессии — на экран после, на экране после — как «Пропустить»
  const esc = () => d.dispatchEvent(new W.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  click(W, d.getElementById('tb-quick'));
  click(W, d.querySelector('[data-reason="Тревога"]'));
  click(W, d.getElementById('rs-go'));
  await wait(250);
  d.getElementById('session-live').classList.contains('on') ? ok('вторая сессия запускается') : bad('вторая сессия не запустилась');
  esc(); await wait(250);
  d.getElementById('post-screen').classList.contains('on') ? ok('Escape в сессии открывает экран после') : bad('Escape не открыл экран после');
  esc(); await wait(350);
  const esr = (await W.CB_DB.all('sessions')).find(x => x.reason === 'Тревога' && x.fmt === 'cb-record-2');
  const esi = (await W.CB_DB.all('index')).find(x => esr && x.id === esr.id);
  esr && esr.stated.postSkipped === true ? ok('Escape на экране после записывает сессию как пропуск') : bad('сессия после Escape не записана');
  esr && esr.stated.pre.ctx === '__skipped' && esr.stated.pre.level === '__skipped' && esi && esi.pre === null
    ? ok('пропуски до сессии: в записи __skipped, в указателе null') : bad('пропуски до сессии записаны неверно');
  esr && esr.stated.post.level === '__skipped' && esi && esi.post === null
    ? ok('пропуски после сессии: в записи __skipped, в указателе null') : bad('пропуск после сессии в указателе: ' + JSON.stringify(esi && esi.post));
  !d.getElementById('post-screen').classList.contains('on') ? ok('экран после закрыт') : bad('экран после не закрылся');
  const ess = esr && (await W.CB_DB.all('series')).find(x => x.id === esr.id);
  ess && Array.isArray(ess.react) && ess.react.length === 0 && ess.events.map(x => x.e).join(',') === 'start,end'
    ? ok('series после Escape: пустой react, события start и end') : bad('series после Escape записан неверно');

  // З-11: производные от событий в derived
  const D = W.CB_DERIVE, eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const d1 = D([{t:0,e:'start'},{t:5,e:'hold'},{t:8.2,e:'contact'},{t:12,e:'b2'},{t:20,e:'release'},
    {t:30,e:'hold'},{t:41.5,e:'release'},{t:45,e:'response',v:1},{t:50,e:'end'}]);
  d1.holds === 2 && eq(d1.holdSec, [15, 11.5]) && eq(d1.holdOpen, [false, false]) && d1.lastHoldOpen === false
    ? ok('derived: две задержки, длительности') : bad('derived: ' + JSON.stringify(d1));
  eq(d1.contactSec, [3.2, null]) ? ok('derived: время до контакта, без контакта — null') : bad('contactSec: ' + JSON.stringify(d1.contactSec));
  d1.boundaryReached === true && d1.response === 1 ? ok('derived: граница сред и отклик +1') : bad('derived: b2 или отклик неверны');
  const d2 = D([{t:0,e:'start'},{t:4,e:'hold'},{t:9,e:'release'},{t:15,e:'end'}]);
  d2.response === null && d2.boundaryReached === false ? ok('derived: сессия без отклика — null') : bad('derived без отклика: ' + JSON.stringify(d2));
  const d3 = D([{t:0,e:'start'},{t:5,e:'hold'},{t:6,e:'contact'},{t:17.3,e:'end'}]);
  eq(d3.holdSec, [12.3]) && eq(d3.holdOpen, [true]) && d3.lastHoldOpen === true
    ? ok('derived: прервана в задержке — holdSec до end, lastHoldOpen') : bad('derived прерванной: ' + JSON.stringify(d3));
  const d4 = D([{t:0,e:'start'},{t:5,e:'hold'},{t:9,e:'hold'},{t:16,e:'release'},{t:20,e:'end'}]);
  d4.holds === 2 && eq(d4.holdSec, [4, 7]) && eq(d4.holdOpen, [true, false]) && d4.lastHoldOpen === false
    ? ok('derived: задержка, оборванная следующим hold, помечена') : bad('derived оборванной: ' + JSON.stringify(d4));

  // в сохранённой записи: одна задержка с контактом
  const s1 = ses[ses.length-1];
  s1.derived.holds === 1 && eq(s1.derived.holdOpen, [false]) && typeof s1.derived.contactSec[0] === 'number'
    ? ok('derived записан при сохранении') : bad('derived в записи: ' + JSON.stringify(s1.derived));

  // запись без derived (З-2): считается при чтении из series, исходник не переписывается
  await W.CB_DB.put('sessions', {id:'S2OLD', fmt:'cb-record-2', reason:'Боль', reasonCode:'R02', derived:{}});
  await W.CB_DB.put('series', {id:'S2OLD', fmt:'cb-record-2', react:[],
    events:[{t:0,e:'start'},{t:3,e:'hold'},{t:10,e:'release'},{t:12,e:'end'}]});
  const s2 = (await W.CB_DB.all('sessions')).find(x => x.id === 'S2OLD');
  const raw2 = (await W.CB_DB.getMany('sessions', ['S2OLD'])).S2OLD;
  s2.derived.holds === 1 && eq(s2.derived.holdSec, [7]) && eq(raw2.derived, {})
    ? ok('без derived — считается при чтении, исходник не меняется') : bad('derived при чтении: ' + JSON.stringify(s2.derived));

  // сырьё удалено — derived в записи остаётся; запись series восстанавливается для проверок ниже
  const sr1 = (await W.CB_DB.getMany('series', [s1.id]))[s1.id];
  await W.CB_DB.del('series', s1.id);
  const kept = (await W.CB_DB.all('sessions')).find(x => x.id === s1.id);
  !(await W.CB_DB.all('series')).some(x => x.id === s1.id) && kept.derived.holds === 1
    ? ok('после удаления series derived остаётся') : bad('derived пропал вместе с series');
  sr1 && await W.CB_DB.put('series', sr1);

  // З-4 · Р-14: производные в указателе
  const i1 = (await W.CB_DB.getMany('index', [s1.id]))[s1.id];
  const i1ok = i1 && i1.holdN === 1 && i1.holdOpenN === 0 && i1.contact === true
    && i1.change === null && i1.holdSum === s1.derived.holdSec[0];
  i1ok ? ok('index: holdN, holdSum, holdOpenN, contact, change')
       : bad('index без производных: ' + JSON.stringify(i1));

  await W.CB_DB.put('sessions', {id:'IDXOLD', fmt:'cb-record-2', reason:'Боль', reasonCode:'R02',
    stated:{post:{change:'усилилась'}},
    derived:{holds:2, holdSec:[10,5], holdOpen:[false,true], contactSec:[null,2]}});
  await W.CB_DB.put('index', {id:'IDXOLD', at:'2026-09-01T10:00:00Z',
    reason:'Боль', reasonCode:'R02', pre:5, post:3});
  const fi = (await W.CB_DB.fillIndex([{id:'IDXOLD', pre:5}]))[0];
  const rawIdx = (await W.CB_DB.getMany('index', ['IDXOLD'])).IDXOLD;
  const fiOk = fi.holdN === 1 && fi.holdSum === 10 && fi.holdOpenN === 1
    && fi.contact === true && fi.change === 'усилилась' && !('holdN' in rawIdx);
  fiOk ? ok('старая строка index дочитывается из sessions, не переписывается')
       : bad('fillIndex: ' + JSON.stringify(fi));
  await W.CB_DB.del('index', 'IDXOLD');
  await W.CB_DB.del('sessions', 'IDXOLD');

  // З-4: сводка за период
  const SUM = W.CB_SUMMARY, NOW = Date.UTC(2026, 9, 1, 12), DAY = 864e5;
  let seq = 0;
  const mk = (d, code, reason, area, pre, post, x) => Object.assign({
    id: 'T' + (seq++), at: new Date(NOW - d*DAY).toISOString(),
    reason, reasonCode: code, area, pre, post}, x);

  // порог 5 сессий
  const few = SUM([40,30,20,10].map(d => mk(d,'R10','Тревога',null,5,3)), NOW, 90).lines[0];
  const five = SUM([50,40,30,20,10].map(d => mk(d,'R10','Тревога',null,5,3)), NOW, 90);
  const l5 = five.lines[0];
  few.few === true && few.preAvg === undefined && l5.few === false && l5.preAvg === 5 && l5.diff === -2
    ? ok('сводка: меньше 5 сессий — без средних, с 5 — средние')
    : bad('порог 5: ' + JSON.stringify([few, l5]));
  !five.signals.length
    ? ok('сводка: ровный фон — сигналов нет')
    : bad('лишний сигнал: ' + JSON.stringify(five.signals));

  // рост значения до
  const up = SUM([40,30,20,10,1].map((d,i) => mk(d,'R02','Боль','heart',3+i,2)), NOW, 90);
  up.signals.some(s => s.type === 'pre' && s.reason === 'Боль' && s.trend >= 1) && up.lines[0].worse
    ? ok('сводка: рост значения до — сигнал')
    : bad('нет сигнала роста: ' + JSON.stringify(up.signals));

  // направление шкалы у well
  const wellDown = SUM([40,30,20,10,1].map((d,i) => mk(d,'R12','Профилактика',null,8-i,8)), NOW, 90);
  const wellUp = SUM([40,30,20,10,1].map((d,i) => mk(d,'R12','Профилактика',null,4+i,8)), NOW, 90);
  wellDown.signals.some(s => s.type === 'pre') && !wellUp.signals.length
    ? ok('сводка: у well сигнал при снижении, рост — не сигнал')
    : bad('направление шкалы well: ' + JSON.stringify([wellDown.signals, wellUp.signals]));

  // «усилилась» и границы периода
  const ch = SUM([mk(5,'R02','Боль','heart',5,6,{change:'усилилась'}),
                  mk(100,'R02','Боль','heart',5,6,{change:'усилилась'})], NOW, 90);
  ch.n === 1 && ch.signals.some(s => s.type === 'worse' && s.n === 1)
    ? ok('сводка: отметка «усилилась» — сигнал, период 90 дней')
    : bad('сигнал «усилилась»: ' + JSON.stringify(ch.signals));

  // обрыв практики
  const days10 = [48,45,42,39,36,33,30,27,24,21];
  const brk = SUM(days10.map(d => mk(d,'R06','Расслабление',null,4,2)), NOW, 'all');
  const noBrk = SUM(days10.map(d => mk(d-18,'R06','Расслабление',null,4,2)), NOW, 'all');
  brk.signals.some(s => s.type === 'break' && s.days === 21)
    && !noBrk.signals.some(s => s.type === 'break')
    ? ok('сводка: обрыв практики после регулярности')
    : bad('обрыв: ' + JSON.stringify([brk.signals, noBrk.signals]));

  // строка задержек по периоду
  const hs = SUM([
    mk(3,'R02','Боль','heart',5,3,{holdN:2, holdSum:40, holdOpenN:0, contact:true}),
    mk(2,'R02','Боль','heart',5,3,{holdN:1, holdSum:20, holdOpenN:1, contact:false}),
    mk(1,'R02','Боль','heart',5,3)], NOW, 90).holds;
  const hsOk = hs.holdAvg === 20 && hs.holdN === 3 && hs.holdOpenN === 1
    && hs.contactShare === 0.5 && hs.noData === 1;
  hsOk ? ok('сводка: средняя задержка без оборванных, доля контакта')
       : bad('строка задержек: ' + JSON.stringify(hs));

  // демонстрационные данные
  const dm = SUM(W.CB_SUMMARY_DEMO(NOW), NOW, 90);
  dm.lines.length >= 3 && dm.lines.some(l => l.few)
    && dm.signals.some(s => s.type === 'pre' && s.reason === 'Боль')
    && dm.signals.some(s => s.type === 'worse')
    ? ok('сводка на демонстрационных данных: строки и сигналы')
    : bad('демо: ' + JSON.stringify(dm.signals));

  // З-5: выгрузка
  const X = W.CB_EXPORT;
  const exRows = [mk(200,'R10','Тревога',null,6,4), mk(150,'R10','Тревога',null,6,4),
    ...[40,30,20,10,5].map(d => mk(d,'R02','Боль','heart',6,3)), mk(3,'R10','Тревога',null,7,4,{change:'усилилась'}), mk(2,'R10','Тревога',null,5,4)];
  const S30 = SUM(exRows, NOW, 30), S90 = SUM(exRows, NOW, 90), Sall = SUM(exRows, NOW, 'all');
  S30.since === Sall.since && S30.total === 9 && S90.total === 9 && S30.n !== Sall.n
    ? ok('выгрузка: «практика с» и «всего» не зависят от периода')
    : bad('since/total: ' + JSON.stringify([S30.since, Sall.since, S30.total]));
  const dr = X.doctorBody(S30, [{at: new Date(NOW).toISOString(), note: 'тянуло <слева>'}], NOW);
  dr.includes('Практика с') && dr.includes('всего сессий: 9') && dr.includes('30 дней')
    && dr.includes(X.notice) && dr.includes(X.format) && dr.includes('&lt;слева&gt;')
    && (X.draft ? dr.includes('Черновик') : !dr.includes('Черновик'))
    ? ok('врачу: шапка, период, обязательная строка, черновик, заметка дословно')
    : bad('страница врачу: ' + dr.slice(0, 300));
  // каждое поле данных — в словаре с меткой происхождения
  const leaves = (o, p, out) => {
    if (Array.isArray(o)) o.forEach(x => leaves(x, p + '[].', out));
    else if (o && typeof o === 'object') Object.entries(o).forEach(([k, x]) => {
      out.add(p + k); if (x && typeof x === 'object') leaves(x, p + k + (Array.isArray(x) ? '' : '.'), out); });
    return out; };
  for (const kind of ['ai-doc', 'ai-pat']) {
    const J = X.buildJSON(kind, Sall, [{at: '2026-09-30T10:00:00Z', note: 'заметка'}], NOW);
    const {dictionary, ...data} = J;
    const paths = [...leaves(data, '', new Set())];
    const miss = paths.filter(p => !dictionary[p] || !dictionary[p].origin);
    const extra = Object.keys(dictionary).filter(p => !paths.includes(p));
    !miss.length && !extra.length && paths.length > 20
      ? ok(`${kind}: у всех ${paths.length} полей метка происхождения, словарь без лишних полей`)
      : bad(`${kind}: без словаря ${miss.join(',')}; лишние ${extra.join(',')}`);
    J.format === X.format && J.notice === X.notice && J.period.code === 'all' && J.practice.total === 9
      ? ok(`${kind}: версия формата, обязательная строка, период`)
      : bad(`${kind}: шапка ` + JSON.stringify([J.format, J.period, J.practice]));
  }
  const JP = X.buildJSON('ai-pat', Sall, [], NOW), anx = JP.pairs.find(p => p.reasonCode === 'R10');
  const JD = X.buildJSON('ai-doc', Sall, [], NOW);
  anx && anx.n === 4 && anx.nBoth === 4 && anx.diff === -2 && anx.few === true
    && !('pairs' in JD) && JD.lines.find(l => l.reasonCode === 'R10').diff === null
    ? ok('ИИ пациента: средняя разница по каждой паре, и при малом числе сессий')
    : bad('пары: ' + JSON.stringify(JP.pairs));
  X.journalSize([{dur: 900}], true) > X.journalSize([{dur: 900}], false) + 9000
    ? ok('журнал: сырьё увеличивает примерный размер') : bad('размер журнала не учитывает сырьё');

  // вкладки аналитики: открывается «Сводка», нынешняя аналитика — «Подробно»
  click(W, d.getElementById('tb-ana'));
  await wait(300);
  const sumBox = d.getElementById('ana-summary');
  const det = d.getElementById('analytics-content');
  sumBox.style.display !== 'none' && det.style.display === 'none'
    && d.querySelector('#ana-tabs .on').dataset.tab === 'sum'
    ? ok('аналитика открывается на вкладке «Сводка»')
    : bad('вкладка «Сводка» не первая');
  sumBox.querySelector('.sum-tbl') && sumBox.textContent.includes('Боль')
    ? ok('сводка построена по сохранённым сессиям')
    : bad('сводка пуста: ' + sumBox.textContent.slice(0, 120));
  click(W, d.querySelector('#ana-tabs [data-tab="det"]'));
  det.style.display !== 'none' && sumBox.style.display === 'none'
    ? ok('вкладка «Подробно» — нынешняя аналитика')
    : bad('вкладка «Подробно» не открылась');

  // З-5: согласие и выгрузка из интерфейса
  click(W, d.querySelector('#ana-tabs [data-tab="sum"]'));
  await wait(300);
  const cons = () => d.getElementById('exp-consent');
  d.getElementById('exp-bar') ? ok('панель выгрузки под сводкой') : bad('панели выгрузки нет');
  click(W, d.getElementById('exp-ai-doc'));
  await wait(50);
  const det5 = d.getElementById('exp-details');
  cons().style.display !== 'none' && det5 && !det5.open && /Период: 90 дней.*Получатель: ИИ-ассистент врача/.test(det5.querySelector('summary').textContent)
    && det5.querySelectorAll('li').length >= 6 && W.CB_EXPORT.last === null
    ? ok('согласие: свёрнутый список — период, состав, получатель; до подтверждения файла нет')
    : bad('согласие: ' + (det5 && det5.textContent.slice(0, 160)));
  click(W, d.getElementById('exp-cancel'));
  await wait(50);
  cons().style.display === 'none' && W.CB_EXPORT.last === null ? ok('«Отмена» — ничего не выгружено') : bad('выгрузка после отмены');
  click(W, d.getElementById('exp-ai-doc')); await wait(50);
  click(W, d.getElementById('exp-ok')); await wait(100);
  const L1 = W.CB_EXPORT.last;
  L1 && /^svodka-vrach-ii-90d-\d{4}-\d\d-\d\d\.json$/.test(L1.name) && JSON.parse(L1.text).lines.some(l => l.reason === 'Боль')
    ? ok('ИИ-ассистенту врача: файл с периодом в имени, данные сводки') : bad('JSON врачу-ИИ: ' + (L1 && L1.name));
  click(W, d.querySelector('#ana-summary [data-per="30"]')); await wait(300);
  click(W, d.getElementById('exp-ai-pat')); await wait(50);
  click(W, d.getElementById('exp-ok')); await wait(100);
  const L2 = W.CB_EXPORT.last;
  L2 && /^svodka-pacient-ii-30d-/.test(L2.name) && JSON.parse(L2.text).period.code === '30' && Array.isArray(JSON.parse(L2.text).pairs)
    ? ok('ИИ пациента: текущий период в файле и в имени') : bad('JSON ИИ пациента: ' + (L2 && L2.name));
  click(W, d.getElementById('exp-html')); await wait(50);
  click(W, d.getElementById('exp-ok')); await wait(100);
  const L3 = W.CB_EXPORT.last;
  L3 && /^svodka-30d-.*\.html$/.test(L3.name) && L3.text.startsWith('<!doctype html>') && L3.text.includes(W.CB_EXPORT.notice)
    ? ok('врачу файлом: отдельная страница с обязательной строкой') : bad('HTML врачу: ' + (L3 && L3.name));
  let printed = 0; W.print = () => { printed++; };
  click(W, d.getElementById('exp-print')); await wait(50);
  click(W, d.getElementById('exp-ok')); await wait(100);
  const pr = d.getElementById('cb-print');
  printed === 1 && pr && pr.parentNode === d.body && pr.textContent.includes('Практика с')
    ? ok('врачу на печать: окно печати, страница для врача') : bad('печать: ' + printed);
  click(W, d.getElementById('exp-journal')); await wait(200);
  const jl = () => d.getElementById('exp-line').textContent;
  const noRaw = jl();
  const rawBox = d.getElementById('exp-raw');
  rawBox && !rawBox.checked && /без сырья.*примерно \d+ КБ/.test(noRaw) ? ok('журнал: сырьё по умолчанию выключено, размер в согласии') : bad('журнал: ' + noRaw);
  rawBox.checked = true; rawBox.dispatchEvent(new W.Event('change', {bubbles: true}));
  /журнал и сырьё.*примерно/.test(jl()) && jl() !== noRaw ? ok('журнал: со сырьём — состав и размер меняются') : bad('журнал со сырьём: ' + jl());
  click(W, d.getElementById('exp-ok')); await wait(300);
  const L4 = W.CB_EXPORT.last, J4 = L4 && JSON.parse(L4.text);
  L4 && /^zhurnal-\d{4}-\d\d-\d\d\.json$/.test(L4.name) && J4.includesRaw && J4.series.length && J4.sessions.length && J4.notice === W.CB_EXPORT.notice
    ? ok('журнал: файл с сессиями и сырьём, обязательная строка') : bad('журнал: ' + (L4 && L4.name));
  d.getElementById('m-analytics').classList.remove('open');

  // Возврат из настроек
  click(W, d.getElementById('tb-set'));
  click(W, d.querySelector('#tb-drop [data-set="adv"]'));
  d.getElementById('adv-settings').classList.contains('on') ? ok('расширенные настройки открываются') : bad('расширенные не открылись');
  click(W, d.getElementById('adv-save'));
  !d.getElementById('adv-settings').classList.contains('on') ? ok('«Сохранить и выйти» закрывает экран') : bad('экран не закрылся');
  W.localStorage.getItem('cb_settings_v1') ? ok('настройки сохраняются') : bad('настройки не сохранились');

  console.log(failed ? `\nПРОВАЛЕНО проверок: ${failed}\n` : '\nВсе проверки пройдены\n');
  process.exit(failed ? 1 : 0);
})();
