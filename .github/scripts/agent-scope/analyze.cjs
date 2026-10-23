const fs = require('fs');
const path = require('path');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const root = path.resolve(process.argv[2] || 'export');
const files = new Map();
function walk(dir) { for (const e of fs.readdirSync(dir, {withFileTypes:true})) { const p=path.join(dir,e.name); if(e.isDirectory()) walk(p); else if (/\.[cm]?[jt]sx?$/.test(p) && !p.endsWith('.d.ts')) { const rel=path.relative(root,p); const text=fs.readFileSync(p,'utf8'); files.set(rel, {text, ast:ts.createSourceFile(rel,text,ts.ScriptTarget.Latest,true), imports:{}, exports:{}, nodes:{}}); } } }
walk(path.join(root,'src'));
function resolve(from, spec) { if(!spec.startsWith('@/') && !spec.startsWith('.')) return null; const base=spec.startsWith('@/')?'src/'+spec.slice(2):path.normalize(path.join(path.dirname(from),spec)); return [base,base+'.ts',base+'.tsx',base+'.js',base+'/index.ts',base+'/index.tsx'].find(p=>files.has(p)); }
function modifiers(n,k) {return n.modifiers?.some(m=>m.kind===k);}
for(const [f,m] of files) {
  function add(name,node){m.nodes[name]={node, edges:[], calls:[], text:node.getText(m.ast), line:m.ast.getLineAndCharacterOfPosition(node.getStart()).line+1};}
  for(const s of m.ast.statements) {
    if(ts.isImportDeclaration(s) && s.importClause && !s.importClause.isTypeOnly) {
      const target=resolve(f,s.moduleSpecifier.text); const c=s.importClause;
      if(c.name)m.imports[c.name.text]=[target,'default'];
      if(c.namedBindings && ts.isNamedImports(c.namedBindings)) for(const e of c.namedBindings.elements)if(!e.isTypeOnly)m.imports[e.name.text]=[target,(e.propertyName||e.name).text];
      if(c.namedBindings && ts.isNamespaceImport(c.namedBindings))m.imports[c.namedBindings.name.text]=[target,'*'];
    } else if(ts.isExportDeclaration(s) && !s.isTypeOnly) {
      const target=s.moduleSpecifier?resolve(f,s.moduleSpecifier.text):f;
      if(s.exportClause && ts.isNamedExports(s.exportClause)){for(const e of s.exportClause.elements)if(!e.isTypeOnly)m.exports[e.name.text]=[target,(e.propertyName||e.name).text];}
      else if(target)m.exports['*']=[target,'*'];
    } else if(ts.isVariableStatement(s)) {
      for(const d of s.declarationList.declarations)if(d.initializer){if(ts.isIdentifier(d.name)){add(d.name.text,d.initializer);if(modifiers(s,ts.SyntaxKind.ExportKeyword))m.exports[d.name.text]=[f,d.name.text];}else if(ts.isObjectBindingPattern(d.name)){for(const e of d.name.elements)if(ts.isIdentifier(e.name)){add(e.name.text,d.initializer);if(modifiers(s,ts.SyntaxKind.ExportKeyword))m.exports[e.name.text]=[f,e.name.text];}}}
    } else if(ts.isFunctionDeclaration(s)||ts.isClassDeclaration(s)) {
      const name=s.name?.text||'default';add(name,s);if(modifiers(s,ts.SyntaxKind.ExportKeyword))m.exports[modifiers(s,ts.SyntaxKind.DefaultKeyword)?'default':name]=[f,name];
    } else if(ts.isExportAssignment(s)){add('$default',s.expression);m.exports.default=[f,'$default'];}
  }
}
function target(f,n,seen=new Set()) {
  if(!f || !files.has(f))return null; const key=f+'#'+n;if(seen.has(key))return null;seen.add(key);const m=files.get(f);
  if(m.nodes[n])return key;
  if(m.imports[n])return target(...m.imports[n],seen);
  if(m.exports[n]){const [p,k]=m.exports[n];if(p!==f||k!==n)return target(p,k,seen);}
  if(m.exports['*'])return target(m.exports['*'][0],n,seen);
  return null;
}
const nodes={};
const read=/^(findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|count|aggregate|groupBy)$/;
const write=/^(create|createMany|update|updateMany|upsert|delete|deleteMany)$/;
for(const [f,m] of files)for(const [name,node]of Object.entries(m.nodes)) {
  const key=f+'#'+name;nodes[key]={file:f,name,line:node.line,edges:[],calls:[], auth:[], helper:false};const out=nodes[key];
  // Auth implementations are terminals. Following their housekeeping produces unrelated board reachability.
  const authSymbol=/^(getSessionUser|verifySession|verifyEdgeSession|validateMcpAuth|validateMcpRouteAuth|requireMcpAuth|requireSession|requireUser|requireAuth|getAuthContext|getApiAuthContext|verifyMcpToken)$/;
  if(authSymbol.test(name)&&/\/(auth|mcp)\//.test(f)) {
    out.auth.push(/Mcp|mcp/.test(name)?'bearer;agent':'session;agent');continue;
  }
  if(f==='src/utils/controllers/projects/getAllIncludes.ts' && /^(getProjectWhere|getProjectListingWhere|projectContentAccessWhere|taskWriteAccessWhere|savedViewBoardAccessWhere)$/.test(name)){out.helper=true;continue;}
  if(/^(isValidUser|getCurrentUserFromCookies)$/.test(name)){out.auth.push('session;agent');continue;}
  if(f==='src/lib/prisma.ts' || /\/(operationCrashReport|automatic|dbTiming|instrumentation)\./.test(f))continue;
  if(/CRON_SECRET|CRON_AUTH|verifyCron|authorizeCron/.test(node.text))out.auth.push('cron');
  if(/ADMIN_USER_RESET_PW|x-admin-password|ANNOUNCEMENTS_SECRET_KEY|verifyIdToken|verifyIdTokenFromRequest/.test(node.text))out.auth.push('bearer');
  if(/verifySignature|verifyQStash|constructEvent|verifyWebhook|svix-id|resend-signature/.test(node.text))out.auth.push('webhook');
  function visit(n){
    if(ts.isTypeNode(n)||ts.isImportDeclaration(n))return;
    if(ts.isIdentifier(n)) {
      const p=n.parent;
      const skip=(ts.isPropertyAccessExpression(p)&&p.name===n)||(ts.isPropertyAssignment(p)&&p.name===n)||(ts.isVariableDeclaration(p)&&p.name===n)||(ts.isParameter(p)&&p.name===n)||((ts.isFunctionDeclaration(p)||ts.isClassDeclaration(p))&&p.name===n);
      if(!skip){const t=target(f,n.text);if(t&&t!==key)out.edges.push(t);}
    }
    if(ts.isTaggedTemplateExpression(n)&&/(?:prisma|tx|db)\.\$queryRaw/.test(n.tag.getText(m.ast))){const text=n.getText(m.ast);for(const model of ['project','task','comment','page'])if(new RegExp('(?:FROM|JOIN|UPDATE|INTO)\\s+"?'+model+'"?(?:\\s|$)','i').test(text))out.calls.push({model,method:'$queryRaw',mode:/\\b(?:UPDATE|INSERT|DELETE)\\b/i.test(text)?'write':'read',line:m.ast.getLineAndCharacterOfPosition(n.getStart()).line+1,text,via:'raw-sql'});}
    if(ts.isCallExpression(n)){
      const expr=n.expression.getText(m.ast);const match=expr.match(/^(?:prisma|tx|db|transaction)\.(\w+)\.(\w+)$/);
      if(match && (read.test(match[2])||write.test(match[2]))){const text=n.getText(m.ast);const models=new Set([match[1]]);for(const b of ['project','task','comment','page'])if(new RegExp('\\b'+b+'(?:s|Id)?\\s*:','i').test(text))models.add(b);for(const model of models)out.calls.push({model,method:match[2],mode:read.test(match[2])?'read':'write',line:m.ast.getLineAndCharacterOfPosition(n.getStart()).line+1,text,via:model===match[1]?'direct':'relation-key'});}
      if(/(?:prisma|tx|db)\.\$queryRaw/.test(expr)&&n.arguments.length){const text=n.getText(m.ast);for(const model of ['project','task','comment','page'])if(new RegExp('(?:FROM|JOIN|UPDATE|INTO)\\s+"?'+model+'"?\\b','i').test(text))out.calls.push({model,method:'$queryRaw',mode:/\\b(?:UPDATE|INSERT|DELETE)\\b/i.test(text)?'write':'read',line:m.ast.getLineAndCharacterOfPosition(n.getStart()).line+1,text,via:'raw-sql'});}
      if(n.expression.kind===ts.SyntaxKind.ImportKeyword && n.arguments[0]&&ts.isStringLiteral(n.arguments[0])){
        const p=resolve(f,n.arguments[0].text);if(p){let parent=n;while(parent.parent&&(ts.isAwaitExpression(parent.parent)||ts.isParenthesizedExpression(parent.parent)))parent=parent.parent;const upper=parent.parent;let names=null;if(upper&&ts.isPropertyAccessExpression(upper))names=[upper.name.text];else if(upper&&ts.isVariableDeclaration(upper)&&ts.isObjectBindingPattern(upper.name))names=upper.name.elements.map(e=>(e.propertyName||e.name).getText(m.ast));for(const k of names||Object.keys(files.get(p).exports)){const t=target(p,k);if(t)out.edges.push(t);}}
      }
      if(ts.isPropertyAccessExpression(n.expression)&&ts.isIdentifier(n.expression.expression)){
        const imp=m.imports[n.expression.expression.text];if(imp&&imp[1]==='*'){const t=target(imp[0],n.expression.name.text);if(t)out.edges.push(t);}
      }
    }
    ts.forEachChild(n,visit);
  }
  visit(node.node);out.edges=[...new Set(out.edges)];
}
const routes=[];
for(const [f,m]of files){
  const pages=f.startsWith('src/pages/api/');const app=f.startsWith('src/app/api/')&&/\/route\.[jt]sx?$/.test(f);const op=f.startsWith('src/lib/mcp/operations/')&&f.endsWith('/operation.ts');if(!pages&&!app&&!op)continue;
  let starts=[];let methods=Object.keys(m.exports).filter(k=>/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(k));
  if(pages){starts=[target(f,'default')].filter(Boolean);const text=m.text;methods=[...new Set([...text.matchAll(/(?:method\s*(?:===|!==|==|!=)\s*['"]|case\s*['"])(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)['"]|\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*:/g)].map(x=>x[1]||x[2]))];if(!methods.length)methods=['ANY'];}
  else starts=methods.map(k=>target(f,k)).filter(Boolean);
  const reached=new Map();const queue=starts.map(k=>[k,[k]]);while(queue.length){const [k,chain]=queue.shift();if(reached.has(k)||!nodes[k])continue;reached.set(k,chain);for(const e of nodes[k].edges)queue.push([e,[...chain,e]]);}
  const helpers=[...reached.keys()].filter(k=>nodes[k].helper);const calls=[...reached.keys()].flatMap(k=>nodes[k].calls.filter(c=>/^(project|task|comment|page)$/.test(c.model)).map(c=>({...c,node:k,chain:reached.get(k)})));
  const auth=[...new Set([...reached.keys()].flatMap(k=>nodes[k].auth.flatMap(x=>x.split(';'))))];
  routes.push({path:f,kind:pages?'pages':app?'app':'mcp',methods:methods.sort(),parseErrors:m.ast.parseDiagnostics.length,auth,starts,helpers:helpers.map(k=>({node:k,chain:reached.get(k)})),calls,reached:[...reached.keys()],text:m.text});
}
fs.writeFileSync(process.argv[3]||'analysis.json',JSON.stringify({root,nodes,routes},null,2));
console.log(`${routes.length} route/operation files, ${Object.keys(nodes).length} symbols`);
