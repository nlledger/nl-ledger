import fs from 'node:fs';
import { parse } from 'parse5';
import assert from 'node:assert/strict';
const [before, after, beforeDist, afterDist] = process.argv.slice(2);
if (!afterDist) throw Error('Usage: node scripts/compare/requests.mjs BEFORE_URL AFTER_URL BEFORE_DIST AFTER_DIST');
const routes = JSON.parse(fs.readFileSync(new URL('./routes.json', import.meta.url)));
const oldCards=JSON.parse(fs.readFileSync(beforeDist+'/data/share-cards.json'));
const newCards=JSON.parse(fs.readFileSync(afterDist+'/data/share-cards.json'));
const imageNames=new Map(newCards.map(c=>[c.image,oldCards.find(b=>b.path===c.path)?.image]));
const value=text=>text.replace(/\/share\/static\/[a-f0-9]+\.png/g,x=>imageNames.get(x)||x).replace(/\/share\/dynamic\/[a-f0-9]+\//g,'/share/dynamic/BUILD/');
function canonical(node){return {tag:node.tagName||node.nodeName,attrs:node.attrs?.map(a=>[a.name,value(a.value)]).sort(([a],[b])=>a.localeCompare(b)),text:node.nodeName==='#text'?node.value.replace(/\s+/g,' ').trim():undefined,children:node.childNodes?.map(canonical).filter(n=>n.tag!=='#text'||n.text)}}
const differences=[];
for(const route of routes){const [a,b]=await Promise.all([fetch(before+route),fetch(after+route)]);assert.deepEqual([...a.headers].filter(([k])=>k!=='date'), [...b.headers].filter(([k])=>k!=='date'), route+' headers');if(a.status!==b.status)differences.push({route,status:[a.status,b.status]});const texts=await Promise.all([a.text(),b.text()]);const [x,y]=texts.map(s=>JSON.stringify(canonical(parse(s))));if(x!==y){let i=0;while(x[i]===y[i])i++;differences.push({route,before:x.slice(i-100,i+200),after:y.slice(i-100,i+200)})}}
console.log(routes.length,'request/page-type cases;',differences.length,'differences');console.log(differences.slice(0,3));if(differences.length)process.exitCode=1;
