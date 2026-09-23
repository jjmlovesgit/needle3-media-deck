import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

const unavailable = message => ({available:false,enabled:false,paused:false,state:'unavailable',error:message,local:true});

export class WakewordBridge {
  #pythonPath; #servicePath; #modelPath; #token = randomBytes(24).toString('hex'); #process = null; #url = ''; #starting = null; #state = unavailable('Wake-word service is starting.');
  constructor({pythonPath,servicePath,modelPath}) { this.#pythonPath=pythonPath; this.#servicePath=servicePath; this.#modelPath=modelPath; }
  async start() {
    if (this.#url) return;
    if (this.#starting) return this.#starting;
    this.#starting = new Promise(async (resolve, reject) => {
      try { await Promise.all([access(this.#pythonPath),access(this.#servicePath)]); }
      catch { const error=new Error('Wake-word runtime is unavailable. Run npm run setup:wakeword.'); this.#state=unavailable(error.message); reject(error); return; }
      const child=spawn(this.#pythonPath,[this.#servicePath,'--port','0','--model',this.#modelPath,'--token',this.#token],{stdio:['ignore','pipe','pipe'],windowsHide:true});
      this.#process=child;
      let output='';
      const timeout=setTimeout(()=>reject(new Error('Wake-word service did not start.')),8000);
      child.stdout.on('data',chunk=>{
        output+=chunk;
        const lineEnd=output.indexOf('\n');
        if(lineEnd<0)return;
        try { const ready=JSON.parse(output.slice(0,lineEnd)); if(ready.event!=='ready'||!Number.isInteger(ready.port))throw new Error(); this.#url='http://127.0.0.1:'+ready.port; clearTimeout(timeout); resolve(); }
        catch { clearTimeout(timeout); reject(new Error('Wake-word service returned an invalid startup response.')); }
      });
      child.once('error',error=>{clearTimeout(timeout);this.#state=unavailable(error.message);reject(error);});
      child.once('exit',code=>{this.#url='';this.#process=null;if(code!==0)this.#state=unavailable('Wake-word service stopped ('+code+').');});
    }).finally(()=>{this.#starting=null;});
    return this.#starting;
  }
  async #request(action,body) {
    try { await this.start(); const response=await fetch(this.#url+'/'+action,{method:body?'POST':'GET',headers:{'X-Media-Deck-Wakeword-Token':this.#token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}); const value=await response.json(); if(!response.ok)throw new Error(value.error||'Wake-word service request failed.'); this.#state=value; return value; }
    catch(error) { this.#state=unavailable(error.message); return this.#state; }
  }
  status(){ return this.#request('status'); }
  configure(enabled){ return this.#request('config',{enabled:Boolean(enabled)}); }
  pause(){ return this.#request('pause',{}); }
  resume(){ return this.#request('resume',{}); }
  stop(){ this.#process?.kill(); this.#process=null; this.#url=''; }
}
