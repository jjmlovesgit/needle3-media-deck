import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function verifyNeedleAssets(){
 const lock=JSON.parse(await readFile(new URL('../needle-assets.lock.json',import.meta.url),'utf8'));
 for(const file of lock.files){
  const bytes=await readFile(new URL('../app/vendor/needle3/'+file.name,import.meta.url));
  if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('Needle asset mismatch: '+file.name+'. Run the pinned acquisition script.');
 }
 return lock;
}
