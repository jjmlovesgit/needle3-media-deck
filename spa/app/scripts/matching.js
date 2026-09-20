import { normalizeMediaText as normalize } from './metadata.js';
/** @typedef {{title:string,artist?:string,album?:string,format?:'any'|import('./types.js').MediaKind}} MediaRequest */
/** Deterministic matching only. Never executes a partial or ambiguous result.
 * @param {import('./types.js').MediaItem[]} items @param {MediaRequest} request
 */
export function matchMedia(items, request) {
  if (!request || typeof request.title !== 'string' || !normalize(request.title) ||
      Object.keys(request).some(key => !['title','artist','album','format'].includes(key)) ||
      ['artist','album'].some(key => request[key] !== undefined && typeof request[key] !== 'string') ||
      !['any','mp3','original_mp4','karaoke_mp4'].includes(request.format || 'any')) {
    return { status: 'invalid', candidates: [], message: 'Enter a title and valid optional artist, album, and format.' };
  }
  const title = normalize(request.title);
  const candidates = items.filter(item => (!request.format || request.format === 'any' || item.kind === request.format)
    && (!request.artist || normalize(item.artist || '') === normalize(request.artist))
    && (!request.album || normalize(item.album || '') === normalize(request.album)));
  const exact = candidates.filter(item => normalize(item.title) === title);
  if (exact.length === 1) return { status: 'match', candidates: exact, message: 'One exact normalized match. Choose it to play.' };
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact, message: 'Several matching versions. Choose a file or specify artist, album, or format.' };
  const partial = candidates.filter(item => (' ' + normalize(item.title) + ' ').includes(' ' + title + ' '));
  if(partial.length)return { status: 'ambiguous', candidates: partial, message: 'Partial title matches; choose a candidate to confirm.' };
  const requestedTokens=new Set(title.split(' '));
  const metadataMatches=candidates.filter(item=>{
    const available=new Set(normalize([item.title,item.artist,item.album].filter(Boolean).join(' ')).split(' '));
    return [...requestedTokens].every(token=>available.has(token));
  });
  if(metadataMatches.length)return {status:'ambiguous',candidates:metadataMatches,message:'The requested words match local title and artist metadata; choose a candidate to confirm.'};
  const requested=[...requestedTokens];
  const coverage=value=>{
    const available=normalize(value).split(' ').filter(Boolean);
    return requested.filter(token=>available.some(word=>word===token||(token.length>=5&&word.length>=5&&Math.abs(word.length-token.length)<=1&&(word.startsWith(token.slice(0,-1))||token.startsWith(word.slice(0,-1)))))).length/requested.length;
  };
  const ranked=candidates.map((item,index)=>{
    const primaryText=[item.title,item.artist].filter(Boolean).join(' '),primaryTokens=new Set(normalize(primaryText).split(' '));
    return {item,index,lead:primaryTokens.has(requested[0])?1:0,primary:coverage(primaryText),all:coverage([item.title,item.artist,item.album].filter(Boolean).join(' '))};
  }).filter(entry=>entry.all>=.7).sort((a,b)=>b.lead-a.lead||b.primary-a.primary||b.all-a.all||a.index-b.index);
  return ranked.length?{status:'ambiguous',candidates:ranked.map(entry=>entry.item),message:'A close local metadata match was found; choose a candidate to confirm.'}
    :{status:'none',candidates:[],message:'No matching local media. Check the title or optional filters.'};
}
