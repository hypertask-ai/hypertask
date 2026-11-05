import { createRequire } from 'node:module';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isPurple, radiusVerdict } from './design-lib.mjs';
const repoPackage = fileURLToPath(new URL('../../../../package.json', import.meta.url));
const repoModules = fileURLToPath(new URL('../../../../node_modules', import.meta.url));
const require = createRequire(existsSync(repoModules) ? repoPackage : '/home/valentin/projects/hypertask/package.json');
const [url, out, state, themes, viewport, allow, doctor, press = ''] = process.argv.slice(2);
const [width,height] = viewport.split('x').map(Number);
try {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    mkdirSync(out, {recursive:true});
    for (const theme of themes.split(',')) {
      const context = await browser.newContext({storageState:state, viewport:{width,height}});
      try {
        await context.addCookies([{name:'theme',value:theme,url:new URL(url).origin,secure:url.startsWith('https:'),sameSite:'Strict'}]);
        const page = await context.newPage();
        await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
        await page.waitForLoadState('networkidle',{timeout:30000}).catch(()=>{});
        await page.waitForTimeout(3000);
        const landed = page.url();
        if (/login|signin|sign-in/i.test(new URL(landed).pathname)) throw new Error(`login page ${landed}; refresh QA state`);
        if (new URL(landed).href !== new URL(url).href && allow !== 'yes') throw new Error(`requested ${url}, landed ${landed}; check access or use --allow-redirect`);
        if (doctor === 'yes') console.log(`url ok: ${landed}`);
        const resolved = await page.locator('html').getAttribute('data-theme');
        if (resolved !== theme) throw new Error(`theme ${theme} resolved as ${resolved}; check theme cookie`);
        if (doctor === 'yes') { console.log(`theme ok: ${resolved}`); continue; }
        for (const keys of press.split(' ').filter(Boolean)) { await page.keyboard.press(keys); await page.waitForTimeout(1500); }
        const audit = await page.evaluate(({purpleFn,radiusFn}) => {
          const isPurple = eval(`(${purpleFn})`), radiusVerdict = eval(`(${radiusFn})`);
          const result = {landedUrl:location.href, corners:{count:0,findings:[]}, round:{count:0,findings:[]}, purple:{count:0,findings:[]}, sparkle:{count:0,findings:[]}};
          const add = (kind,el,value,rect) => {
            const path=[]; for(let e=el;e && path.length<3;e=e.parentElement) path.unshift(e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(typeof e.className==='string' && e.className.trim()?'.'+e.className.trim().split(/\s+/).join('.'):''));
            const group=result[kind]; group.count++; if(group.findings.length<50) group.findings.push({selector:path.join(' > '),value,box:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}});
          };
          for(const el of document.querySelectorAll('*')) {
            const rect=el.getBoundingClientRect(), css=getComputedStyle(el);
            if(!rect.width || !rect.height || css.display==='none' || css.visibility!=='visible' || Number(css.opacity)===0 || rect.bottom<=0 || rect.right<=0 || rect.top>=innerHeight || rect.left>=innerWidth) continue;
            for(const prop of ['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius']) {
              const raw=css[prop], parts=raw.split(/\s+/), px=parts[0].endsWith('%')?parseFloat(parts[0])*rect.width/100:parseFloat(parts[0]);
              const py=(parts[1]||parts[0]).endsWith('%')?parseFloat(parts[1]||parts[0])*rect.height/100:parseFloat(parts[1]||parts[0]);
              const verdict=radiusVerdict(Math.min(px,py),rect.width,rect.height);
              if(verdict!=='ok') add(verdict==='round'?'round':'corners',el,`${prop}: ${raw}`,rect);
            }
            for(const prop of ['color','backgroundColor','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor']) if(isPurple(css[prop])) add('purple',el,`${prop}: ${css[prop]}`,rect);
            const match=['class','aria-label','data-icon','title'].map(k=>el.getAttribute(k)||'').find(v=>/sparkl/i.test(v));
            if(match) add('sparkle',el,match,rect);
          }
          return result;
        },{purpleFn:isPurple.toString(),radiusFn:radiusVerdict.toString()});
        await page.screenshot({path:`${out}/live-${theme}.png`});
        writeFileSync(`${out}/audit-${theme}.json`,JSON.stringify(audit,null,2)+'\n');
        console.log(`${theme}: ${landed}`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
} catch(error) { console.error(`ERROR: ${error.message}`); process.exitCode=1; }
