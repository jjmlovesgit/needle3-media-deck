import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const revision='b274efcb211a9eef48c9a88da4b43bd569696a39';
const repository='Cactus-Compute/needle3';
const destination=new URL('../app/vendor/needle3/',import.meta.url);
await mkdir(destination,{recursive:true});
async function fetchOK(url){const r=await fetch(url);if(!r.ok)throw new Error('Download failed: '+r.status+' '+url);return r;}
const files=['wasm/needle.js','wasm/needle.wasm','needle3.cact','wasm/needle.h','LICENSE'];
const tree=(await (await fetchOK('https://huggingface.co/api/models/'+repository+'/tree/'+revision+'?recursive=true')).json());
const manifest={repository,revision,generation:3,depth:20,license:'Apache-2.0',files:[]};
for(const file of files){
 const entry=tree.find(x=>x.path===file);if(!entry)throw new Error('Missing published file '+file);
 const source='https://huggingface.co/'+repository+'/resolve/'+revision+'/'+file;
 const bytes=Buffer.from(await (await fetchOK(source)).arrayBuffer());
 const sha256=createHash('sha256').update(bytes).digest('hex');
 const blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
 if(bytes.length!==entry.size||(entry.lfs?sha256!==entry.lfs.oid:blob!==entry.oid))throw new Error('Published hash mismatch: '+file);
 const name=file.split('/').pop();
 await writeFile(new URL(name,destination),bytes);
 manifest.files.push({name,source,bytes:bytes.length,sha256,gitBlob:entry.oid});
 console.log('Verified '+name+' ('+bytes.length+' bytes)');
}
const original=await readFile(new URL('needle.js',destination),'utf8');
if(!original.includes('var ENV={};'))throw new Error('Upstream environment initialization changed');
const adapted='// Modified for Media Deck: disable telemetry and expose the official factory as an ES module. Apache-2.0.\n'+original.replace('var ENV={};','var ENV={NEEDLE_TELEMETRY:"0",DO_NOT_TRACK:"1"};')+'\nexport default createNeedle;\n';
await writeFile(new URL('needle-browser.mjs',destination),adapted);
manifest.files.push({name:'needle-browser.mjs',derivedFrom:'needle.js',bytes:Buffer.byteLength(adapted),sha256:createHash('sha256').update(adapted).digest('hex')});
await writeFile(new URL('manifest.json',destination),JSON.stringify(manifest,null,2)+'\n');
await writeFile(new URL('../needle-assets.lock.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
