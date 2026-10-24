const { chromium, expect, request } = require('@playwright/test');
const fs = require('node:fs');
const dir = '/home/valentin/.local/state/vcc-evidence/YPER4-227/smoke-fixture';
(async()=>{
 const browser = await chromium.launch({headless:true});
 try {
  const api = await request.newContext({baseURL:'https://app.hypertask.ai',storageState:'/home/valentin/.config/hypertask-videos/storageState-qa-normal.json'});
  try {
   const user=await(await api.get('/api/users/getById')).json();
   expect(user.id).toBe(2343);
   const board=await(await api.get('/api/members/getAllForAssignees?projectId=6859')).json();
   expect(board.owner.id).toBe(2343); expect(board.members).toHaveLength(0);
   fs.writeFileSync(`${dir}/old-fixture-owner.json`,JSON.stringify({projectId:6859,title:board.title,ownerId:board.owner.id,members:[]}));
  } finally {await api.dispose();}
  for(const mobile of [false,true]) {
   const ctx=await browser.newContext({baseURL:'https://app.hypertask.ai',storageState:`${dir}/qa-state.json`,viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
   try {
    const user=await(await ctx.request.get('/api/users/getById')).json();expect(user.id).toBe(985);
    const page=await ctx.newPage();
    await page.goto('/project?id=6121&surface=board&realtime=on',{waitUntil:'load'});
    await expect(page.locator('.kanban-column-title').first()).toBeVisible({timeout:20000});
    const card=page.locator('[id^="task-"] a[href="/detail/project-6121/1"]').first();
    await expect(card).toBeVisible({timeout:20000});
    await page.screenshot({path:`${dir}/${mobile?'Mobile':'Desktop'}-board.png`});
    await card.click();
    await expect(page.locator('#title-input')).toHaveValue('Midscene persistent browser target',{timeout:20000});
    await expect(page.locator('#description-input')).toBeAttached({timeout:20000});
    await expect(page).toHaveURL(/\/detail\/project-6121\/1/);
    await page.screenshot({path:`${dir}/${mobile?'Mobile':'Desktop'}-ticket.png`});
    console.log(`${mobile?'Mobile':'Desktop'}: QA 985 opened existing private fixture /detail/project-6121/1`);
   }finally{await ctx.close();}
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
