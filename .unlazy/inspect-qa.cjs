const { request } = require('@playwright/test');
const fs = require('node:fs');
(async () => {
  const ctx = await request.newContext({ baseURL: 'https://app.hypertask.ai', storageState: '/home/valentin/.config/hypertask-videos/storageState-qa.json' });
  try {
    const user = await (await ctx.get('/api/users/getById')).json();
    if (user.id !== 985) throw Error('Not QA 985');
    console.log('QA identity:', user.id);
    await ctx.storageState({path: '/home/valentin/.local/state/vcc-evidence/YPER4-227/smoke-fixture/qa-state.json'});
    fs.chmodSync('/home/valentin/.local/state/vcc-evidence/YPER4-227/smoke-fixture/qa-state.json',0o600);
    const boot = await (await ctx.post('/api/app-shell/bootstrap')).json();
    const teams = boot.slices.teams;
    console.log('QA teams:', JSON.stringify(teams));
    const ids = [6859, ...(teams?.ok ? teams.data.flatMap(t=>t.projects.map(p=>p.id)) : [])];
    for (const projectId of [...new Set(ids)]) {
      const members = await ctx.get(`/api/members/getAllForAssignees?projectId=${projectId}`);
      const membersBody = members.ok() ? await members.json() : {};
      const board = await ctx.post('/api/projects/boardTasks', {data:{projectId}});
      const b = board.ok() ? await board.json() : {};
      console.log(JSON.stringify({projectId,membersStatus:members.status(),owner:membersBody.owner?.id,members:membersBody.members?.map(m=>({role:m.role,userId:m.user.id})),boardStatus:board.status(),title:b.project?.title,sections:b.project?.section?.map(s=>({id:s.id,title:s.section_title,visibility:s.visibility})),tasks:b.tasks?.map(t=>({id:t.id,uniqueIndex:t.uniqueIndex,title:t.title,status:t.status,userId:t.userId,sectionId:t.sectionId})).slice(0,20)}));
    }
  } finally { await ctx.dispose(); }
})().catch(e=>{ console.error(e.message);process.exitCode=1; });
