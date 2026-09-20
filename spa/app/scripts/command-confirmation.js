export const DEFAULT_CONFIDENCE_THRESHOLD = 70;

/** @param {unknown} value */
export function clampConfidenceThreshold(value) {
 const number=Number(value);
 return Number.isFinite(number)?Math.max(0,Math.min(100,Math.round(number))):DEFAULT_CONFIDENCE_THRESHOLD;
}

/** @param {unknown} confidence @param {unknown} threshold */
export function shouldConfirmCommand(confidence,threshold) {
 return typeof confidence!=='number'||!Number.isFinite(confidence)||Math.round(confidence*100)<clampConfidenceThreshold(threshold);
}

export class CommandConfirmationPolicy {
 /** @param {{read:(key:string,fallback:string)=>string,save:(key:string,value:number)=>void}} storage */
 constructor(storage){
  this.storage=storage;
  this.threshold=clampConfidenceThreshold(storage.read('commandConfidenceThreshold',String(DEFAULT_CONFIDENCE_THRESHOLD)));
 }
 /** @param {unknown} value */
 setThreshold(value){this.threshold=clampConfidenceThreshold(value);this.storage.save('commandConfidenceThreshold',this.threshold);return this.threshold;}
 /** @param {unknown} confidence */
 requiresConfirmation(confidence){return shouldConfirmCommand(confidence,this.threshold);}
}
