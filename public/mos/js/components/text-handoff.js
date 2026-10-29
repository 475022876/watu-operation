import { api, withBrand } from '../api.js';
import { esc, openModal, toast } from '../ui.js';
export async function saveTextToTask(ctx, text, onSaved, alive = () => true) {
  let rows;
  try { rows=(await api.get(withBrand('/api/mos/tasks',ctx.brand,{pageSize:200}))).items || []; }
  catch(err){toast('任务加载失败，文字仍保留：'+err.message,'err');return;}
  if(ctx.params.task && !rows.some(t=>t.id===ctx.params.task)){try{rows.push((await api.get('/api/mos/tasks/'+encodeURIComponent(ctx.params.task))).task);}catch(err){toast('当前任务不可访问，文字仍保留：'+err.message,'err');return;}}
  if(!alive())return;
  const available=rows.filter(t=>!['IN_REVIEW','READY','COMPLETED','CANCELLED'].includes(t.status)&&t.can.edit);
  let createdTaskId=null, saving=false;
  return openModal({title:'将选定文字保存到任务',okText:'保存作品并打开任务',
    body:'<p>只保存下面确认的文字，不保存整段聊天记录。保存后在任务内查看要求、修改并提交审核。</p>'
      +'<label class="field"><span>保存位置</span><select id="handoffTask"><option value="">新建任务</option>'+available.map(t=>'<option value="'+esc(t.id)+'"'+(t.id===ctx.params.task?' selected':'')+'>'+esc(t.title)+'</option>').join('')+'</select></label>'
      +'<label class="field"><span>作品标题</span><input type="text" id="handoffTitle" maxlength="200" value="'+esc(text.split('\n').find(l=>l.trim())?.slice(0,80)||'文字作品')+'"></label>'
      +'<label class="field"><span>确认要交付的内容</span><textarea id="handoffBody" rows="12">'+esc(text)+'</textarea></label>'
      +'<p class="muted">新任务默认由你负责，品牌规则自动沿用；可在任务中补充要求和时间。</p><div id="handoffError" role="status"></div>',
    onOk:async b=>{
      if(saving||!alive())return false;
      const title=b.querySelector('#handoffTitle').value.trim(),body=b.querySelector('#handoffBody').value;
      if(!title||!body.trim()){b.querySelector('#handoffError').textContent='标题和正文不能为空。';return false;}
      saving=true;
      try{
        let id=createdTaskId||b.querySelector('#handoffTask').value;
        if(!id){
          const result=await api.post(withBrand('/api/mos/tasks',ctx.brand),{title,requirements:'从文字制作区选定作品后创建。'});
          id=createdTaskId=result.task.id;
          b.querySelector('#handoffTask').disabled=true;
        }
        const result=await api.post(withBrand('/api/mos/content-versions',ctx.brand),{taskId:id,title,body});
        if(!alive())return true;
        toast('作品已保存，尚未送审','ok');
        if(onSaved)onSaved(result.version);
        ctx.navigate('task-detail',{task:id});return true;
      }catch(err){if(alive())b.querySelector('#handoffError').textContent='保存未完成，文字已保留。'+(createdTaskId?'任务已创建，可保留本窗口重试保存作品。':'如网络中断，请先核对任务列表，避免重复新建。')+err.message;return false;}
      finally{saving=false;}
    }
  });
}
