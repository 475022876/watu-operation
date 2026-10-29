import { api, withBrand } from '../api.js';
import { esc, toast, loadingHtml, stateBlock, statusBadge, fmtDate, fmtDateTime, openModal } from '../ui.js';
import { caseTypeLabel, decisionButtons, decideReviewCase, openReviewCase } from '../components/reviewkit.js';
let epoch = 0, dirty = false, busy = false;
const drafts = new Map();
export default {
  async mount(host, ctx) {
    const token = ++epoch, taskId = ctx.params.task;
    dirty = false; busy = false;
    if (!taskId) { host.innerHTML = '<p>请先选择要处理的任务。</p><button class="btn" id="chooseTask">查看全部任务</button>'; host.querySelector('#chooseTask').onclick = () => ctx.navigate('tasks'); return; }
    const key = ctx.me.id + ':' + ctx.brand + ':' + taskId;
    let task, workspace, current, cases = [], edit = 0, selected = new Set();
    let title = '', body = '';
    const alive = () => token === epoch;
    function remember() { drafts.set(key, { title, body, refs: [...selected], versionId: current?.id || null }); }
    function error(message) { if (alive()) { const el = host.querySelector('#deliveryError'); if (el) { el.textContent = message; el.className = 'delivery-error'; } } }
    function syncButtons() {
      host.querySelectorAll('[data-write]').forEach(b => { b.disabled = busy; });
      host.querySelectorAll('#deliveryTitle,#deliveryBody,[data-file-ref]').forEach(b => { b.disabled = busy && b.dataset.freeze === '1'; });
    }
    async function save() {
      if (!alive() || busy) return false;
      if (!title.trim() || !body.trim()) { error('请填写作品标题和正文，输入会保留。'); return false; }
      const revision = edit, snapshot = {title, body, refAssetIds:[...selected]}; busy = true; syncButtons();
      try {
        const result = current
          ? await api.put('/api/mos/content-versions/' + current.id, {...snapshot, rowVersion:current.rowVersion})
          : await api.post(withBrand('/api/mos/content-versions', ctx.brand), {...snapshot, taskId});
        if (!alive()) return false;
        current = result.version;
        if (revision !== edit) { dirty = true; remember(); error('保存期间内容发生变化，请再次保存；尚未提交审核。'); return false; }
        dirty = false; drafts.delete(key); host.querySelector('#deliveryError').className = ''; host.querySelector('#deliveryError').textContent = '已保存当前作品';
        return true;
      } catch (err) { if (alive()) { dirty = true; remember(); error('保存失败，当前内容已保留，未提交审核：' + err.message); } return false; }
      finally { if (alive()) { busy = false; syncButtons(); } }
    }
    async function submit() {
      if (busy) return;
      if (!await save() || !alive() || dirty) return;
      const revision = edit; busy = true; syncButtons();
      host.querySelectorAll('#deliveryTitle,#deliveryBody,[data-file-ref]').forEach(b => { b.disabled = true; });
      try {
        if (revision !== edit) { error('内容已变化，请重新保存。'); return; }
        await api.post('/api/mos/content-versions/' + current.id + '/lock', { rowVersion:current.rowVersion });
        if (!alive()) return;
        drafts.delete(key); dirty = false; busy = false; toast('已提交审核，审核反馈将出现在本任务中', 'ok'); await load();
      } catch (err) { if (alive()) { remember(); error('送审未确认，作品已保留。请刷新核对状态后重试：' + err.message); } }
      finally { if (alive()) { busy = false; host.querySelectorAll('#deliveryTitle,#deliveryBody,[data-file-ref]').forEach(b => { b.disabled = false; }); syncButtons(); } }
    }
    async function load() {
      host.innerHTML = loadingHtml();
      try {
        const [detail, files, versions] = await Promise.all([
          api.get('/api/mos/tasks/' + taskId), api.get('/api/mos/tasks/' + taskId + '/workspace'),
          api.get(withBrand('/api/mos/content-versions', ctx.brand, {taskId, pageSize:200}))
        ]);
        if (!alive()) return;
        task = detail.task; workspace = files;
        if (task.brandCode !== ctx.brand) throw new Error('请切换到该任务所属品牌后打开。');
        const latest = (versions.items || []).sort((a,b) => b.number-a.number)[0];
        current = latest ? (await api.get('/api/mos/content-versions/' + latest.id)).version : null;
        cases = current ? (await api.get(withBrand('/api/mos/review-cases', ctx.brand, {subjectId:current.id, pageSize:200}))).items || [] : [];
        if (!alive()) return;
        const cached = drafts.get(key);
        const restore = cached && cached.versionId === (current?.id || null) && (!current || current.editable);
        title = restore ? cached.title : current?.title || task.title;
        body = restore ? cached.body : current?.body || '';
        selected = new Set(restore ? cached.refs : current?.refAssetIds || []);
        dirty = !!restore; paint();
        if (cached && !restore) error('有未保存的旧稿；任务状态已变化，未自动覆盖当前作品。请在下方恢复文本中核对。');
      } catch (err) { if (!alive()) return; const s=stateBlock('error',{title:'任务加载失败',desc:err.message,actions:[{label:'重试',onClick:load}]});host.innerHTML=s.html;s.bind(host); }
    }
    function paint() {
      const editable = current ? current.can.edit : task.can.edit && !['IN_REVIEW','READY','COMPLETED','CANCELLED'].includes(task.status);
      const stage = !current ? '开始制作' : current.state === 'DRAFT' ? '制作中' : current.state === 'REVISION_REQUIRED' ? '待修改' : current.state === 'APPROVED' ? '已批准' : '审核中';
      const feedback = workspace.feedback || [];
      host.innerHTML = '<div class="page-head"><div class="crumb">工作台 / 全部任务 / 任务详情</div><div class="ph-row"><h1 data-notranslate>' + esc(task.title) + '</h1><button class="btn" id="deliveryBack">返回任务列表</button></div><p>' + esc(task.ownerName) + ' 负责 · 截止 ' + esc(fmtDate(task.productionDue)) + ' · ' + stage + '</p></div>'
        + '<div class="delivery-steps" aria-label="工作进度"><span>1 明确要求</span><span class="' + (editable?'current':'') + '">2 制作作品</span><span class="' + (stage==='审核中'?'current':'') + '">3 审核与修改</span><span class="' + (stage==='已批准'?'current':'') + '">4 批准交付</span></div>'
        + '<div class="delivery-layout"><main class="card delivery-main"><div class="card-head"><h2>当前作品</h2><span>' + stage + '</span></div><div class="card-body">'
        + (editable ? '<div class="delivery-actions"><button class="btn" id="deliverySave" data-write>保存作品</button><button class="btn btn-primary" id="deliverySubmit" data-write>保存并提交审核</button><button class="btn" id="deliveryWrite" data-write>用 AI 继续创作</button><button class="btn" id="deliveryUpload" data-write>添加任务文件</button><input type="file" id="deliveryFile" hidden></div>' : '')
        + (current?.can.revise ? '<button class="btn btn-primary" id="deliveryRevise" data-write>' + (current.state==='REVISION_REQUIRED'?'根据反馈继续修改':'修改作品并重新审核') + '</button>' : '')
        + '<label class="field"><span>作品标题</span><input type="text" id="deliveryTitle" maxlength="200" value="' + esc(title) + '"' + (editable?'':' readonly') + '></label>'
        + '<label class="field"><span>作品正文</span><textarea id="deliveryBody" rows="18"' + (editable?'':' readonly') + ' placeholder="在这里完成要交付的正文，也可以从文字制作区选择结果保存到本任务。">' + esc(body) + '</textarea></label>'
        + (current?.state==='APPROVED'?'<div class="callout info">作品已批准，可交给发布负责人安排；这不表示已经对外发布。<button class="btn btn-sm" id="deliveryPublishing">查看发布安排</button></div>':'')
        + '<div id="deliveryError" role="status" aria-live="polite">' + (dirty?'已恢复未保存内容，请先保存。':'') + '</div>'
        + '<h3>作品附件</h3>' + ((workspace.files || []).map(a => '<label class="delivery-file">' + (editable?'<input type="checkbox" data-file-ref="'+esc(a.id)+'"'+(selected.has(a.id)?' checked':'')+'>':'') + '<a target="_blank" rel="noopener" href="' + esc(a.contentUrl) + '" data-notranslate>' + esc(a.fileName) + '</a></label>').join('') || '<p class="muted">暂无附件；添加后勾选随本次作品送审的文件。</p>')
        + '<details class="delivery-details"><summary>历史与详细信息</summary><p>任务编号 ' + esc(task.code) + '；当前版本 ' + esc(current?.code || '尚未保存') + '</p><p>系统按风险及品牌权限匹配审核角色，作者不能审核自己的作品。</p><button class="btn btn-sm" id="deliveryAdvanced">打开完整制作工具</button></details>'
        + (drafts.has(key) && !editable ? '<details><summary>恢复未保存的文本</summary><pre data-notranslate>' + esc(drafts.get(key).body) + '</pre></details>':'')
        + '</div></main><aside class="delivery-aside"><section class="card"><div class="card-head"><h2>任务要求</h2></div><div class="card-body"><p data-notranslate style="white-space:pre-wrap">' + esc(task.requirements || '尚未填写要求，请与发起人确认交付内容。') + '</p><p>发起人：' + esc(task.createdByName || '—') + '</p><p>负责人：' + esc(task.ownerName) + '</p><p>开始：' + esc(fmtDate(task.startAt)) + '</p><p>截止：' + esc(fmtDate(task.productionDue)) + '</p>' + (task.can.edit?'<button class="btn btn-sm" id="deliveryEditTask">调整要求与负责人</button>':'') + '</div></section>'
        + '<section class="card"><div class="card-head"><h2>审核与反馈</h2></div><div class="card-body">'
        + (cases.map(c => '<div class="delivery-review"><b>' + esc(caseTypeLabel(c.type)) + '</b> ' + statusBadge(c.state) + '<p>' + (c.canDecide?'等待你处理':esc(['APPROVED','REJECTED','CANCELLED','REVISION_REQUESTED'].includes(c.state) ? '已处理，结果见下方反馈' : '由具有该品牌权限的独立审核人处理')) + '</p><button class="btn btn-sm" data-review-view="'+esc(c.id)+'">查看审核作品</button>' + (c.canDecide?decisionButtons(c):'') + '</div>').join('') || '<p class="muted">保存并提交后，审核进度和反馈会显示在这里。</p>')
        + feedback.map(f => '<div class="delivery-feedback"><b>' + esc(f.actorName || '审核人') + '</b><p data-notranslate>' + esc(f.comment || f.action) + '</p><time>' + esc(fmtDateTime(f.createdAt)) + '</time></div>').join('')
        + '<button class="btn btn-sm" id="deliveryRefresh">刷新反馈</button></div></section></aside></div>';
      host.querySelector('#deliveryBack').onclick=()=>ctx.navigate('tasks');
      const publishing=host.querySelector('#deliveryPublishing');if(publishing)publishing.onclick=()=>ctx.navigate('publishing');
      host.querySelector('#deliveryAdvanced').onclick=()=>ctx.navigate('content-editor',{task:taskId});
      host.querySelector('#deliveryRefresh').onclick=()=>{ if(dirty) { error('请先保存当前作品，再刷新反馈。'); return; } load(); };
      const editTask = host.querySelector('#deliveryEditTask');
      if(editTask)editTask.onclick=async()=>{
        if(dirty||busy){error('请先保存当前作品，再调整任务要求。');return;}
        try{
          const people=(await api.get(withBrand('/api/mos/task-workspace/people',ctx.brand))).items || [];
          if(!alive())return;
          openModal({title:'调整任务安排',okText:'保存安排',body:'<label class="field"><span>工作要求</span><textarea id="arrangeBrief" maxlength="12000">'+esc(task.requirements || '')+'</textarea></label><label class="field"><span>负责人</span><select id="arrangeOwner">'+people.map(u=>'<option value="'+esc(u.id)+'"'+(u.id===task.ownerId?' selected':'')+'>'+esc(u.displayName)+'</option>').join('')+'</select></label><label class="field"><span>开始日期</span><input type="date" id="arrangeStart" value="'+esc(task.startAt || '')+'"></label><label class="field"><span>截止日期</span><input type="date" id="arrangeDue" value="'+esc(task.productionDue || '')+'"></label>',onOk:async b=>{
            try{await api.put('/api/mos/tasks/'+taskId,{rowVersion:task.rowVersion,requirements:b.querySelector('#arrangeBrief').value,ownerId:b.querySelector('#arrangeOwner').value,startAt:b.querySelector('#arrangeStart').value||null,productionDue:b.querySelector('#arrangeDue').value||null});if(alive())await load();}
            catch(err){toast('保存失败，安排尚未更新：'+err.message,'err');return false;}
          }});
        }catch(err){error(err.message);}
      };
      const input=host.querySelector('#deliveryBody'), titleInput=host.querySelector('#deliveryTitle');
      function changed(){ title=titleInput.value;body=input.value;edit++;dirty=true;remember(); }
      input.oninput=titleInput.oninput=changed;
      host.querySelectorAll('[data-file-ref]').forEach(b=>b.onchange=()=>{b.checked?selected.add(b.dataset.fileRef):selected.delete(b.dataset.fileRef);edit++;dirty=true;remember();});
      if(editable){
        host.querySelector('#deliverySave').onclick=save;
        host.querySelector('#deliverySubmit').onclick=()=>openModal({title:'提交当前作品审核',okText:'确认提交',body:'<p>将先保存当前正文与勾选附件，再冻结送审。聊天记录不会送审；提交后修改需要重新形成待审作品。</p>',onOk:async()=>{await submit();return !host.querySelector('#deliveryError')?.classList.contains('delivery-error');}});
        host.querySelector('#deliveryWrite').onclick=()=>ctx.navigate('text-studio',{task:taskId});
        const file=host.querySelector('#deliveryFile');host.querySelector('#deliveryUpload').onclick=()=>file.click();
        file.onchange=async()=>{
          const f=file.files[0];if(!f||busy)return;if(f.size>20*1024*1024){error('文件超过20MB，请压缩后再上传。');return;}
          busy=true;syncButtons();
          try { const url=withBrand('/api/mos/assets/upload',ctx.brand,{taskId,name:f.name});const result=await api.upload(url,f);if(!alive())return;const asset=result.asset;if(!asset)throw Error('上传结果未确认');workspace.files.push({id:asset.id,fileName:asset.fileName,contentUrl:asset.contentUrl});selected.add(asset.id);edit++;dirty=true;remember();paint(); }
          catch(err){error('上传失败：'+err.message);}finally{if(alive()){busy=false;syncButtons();}}
        };
      }
      const revise=host.querySelector('#deliveryRevise');if(revise)revise.onclick=async()=>{if(busy)return;busy=true;syncButtons();try{await api.post('/api/mos/content-versions/'+current.id+'/revise',{reason:'根据任务审核反馈修改'});if(alive()){busy=false;await load();}}catch(err){error(err.message);}finally{if(alive()){busy=false;syncButtons();}}};
      host.querySelectorAll('[data-review-view]').forEach(b=>b.onclick=()=>openReviewCase(b.dataset.reviewView,ctx.brand));
      host.querySelectorAll('[data-dec]').forEach(b=>b.onclick=()=>decideReviewCase({caseId:b.dataset.case,brand:ctx.brand,action:b.dataset.dec,onDone:load}));
    }
    await load();
  },
  unmount(){epoch++;dirty=false;busy=false;},
  hasUnsaved(){return dirty||busy;}
};
