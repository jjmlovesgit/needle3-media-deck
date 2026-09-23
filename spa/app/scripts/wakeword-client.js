export class WakewordClient {
  #onState; #timer=0; #sequence=0;
  constructor({onState}) { this.#onState=onState; }
  async #request(action, body) {
    const response=await fetch('/api/wakeword/'+action,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
    const state=await response.json();
    if(!response.ok)throw new Error(state.error||'Wake-word service request failed.');
    this.#onState?.(state,{detected:Number(state.sequence||0)>this.#sequence});
    this.#sequence=Math.max(this.#sequence,Number(state.sequence||0));
    return state;
  }
  status(){ return this.#request('status'); }
  configure(enabled){ return this.#request('config',{enabled}); }
  pause(){ return this.#request('pause',{}); }
  resume(){ return this.#request('resume',{}); }
  startPolling(){ this.stopPolling(); this.#timer=setInterval(()=>{void this.status().catch(()=>{});},500); return this.status(); }
  stopPolling(){ clearInterval(this.#timer); this.#timer=0; }
}
