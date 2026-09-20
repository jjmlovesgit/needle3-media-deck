/** Persistent worker owner, independent of microphone capture and application execution. */
export class NeedleClient {
  #worker;
  #id = 0;
  #pending = new Map();
  constructor() {
    this.#worker = new Worker(new URL('./needle-worker.js', import.meta.url), {type:'module'});
    this.#worker.onmessage = ({data}) => {
      const pending = this.#pending.get(data.id); if (!pending) return;
      this.#pending.delete(data.id); clearTimeout(pending.timer);
      data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.result);
    };
    this.#worker.onerror = () => this.#rejectAll('Needle worker could not start.');
  }
  #rejectAll(message) { for(const pending of this.#pending.values()){clearTimeout(pending.timer);pending.reject(new Error(message));}this.#pending.clear(); }
  /** @param {'status'|'route'} type @param {unknown} [payload] */
  request(type,payload) {
    const id=++this.#id;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.#pending.delete(id);reject(new Error('Needle worker timed out.'));},120000);
      this.#pending.set(id,{resolve,reject,timer});this.#worker.postMessage({id,type,payload});
    });
  }
  dispose(){this.#rejectAll('Needle worker closed.');this.#worker.terminate();}
}
