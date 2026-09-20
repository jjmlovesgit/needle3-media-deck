import {normalizeMediaText as normalize} from './metadata.js';
const enums={
 control_playback:{action:['play','pause','stop','previous','next']},
 set_panel:{section:['voice','sidebar'],action:['open','close','show','hide','toggle']},
 play_media:{media_type:['any','mp3','mp4']}
};
const keys={play_media:['title','artist','album','media_type'],control_playback:['action'],rewind_10_seconds:[],skip_forward_10_seconds:[],show_mp3_files:[],show_original_videos:[],show_karaoke_files_or_videos:[],show_all_media_files:[],show_graphic_equalizer_panel:[],close_graphic_equalizer_panel:[],show_library_panel:[],hide_media_library_panel:[],close_performance_monitor_panel:[],search_library:['query'],refresh_library:[],set_volume:['volume'],load_eq_preset:['preset'],set_panel:['section','action']};
const required={play_media:['title','media_type'],control_playback:['action'],rewind_10_seconds:[],skip_forward_10_seconds:[],show_mp3_files:[],show_original_videos:[],show_karaoke_files_or_videos:[],show_all_media_files:[],show_graphic_equalizer_panel:[],close_graphic_equalizer_panel:[],show_library_panel:[],hide_media_library_panel:[],close_performance_monitor_panel:[],search_library:['query'],refresh_library:[],set_volume:['volume'],load_eq_preset:['preset'],set_panel:['section','action']};
const presets=['Flat','Rock','Pop','Jazz','Classical','Vocal','Bass Boost','Dance','Acoustic'];
const phrases={
 play:['play','resume','continue'],pause:['pause'],stop:['stop'],previous:['previous','back track'],next:['next'],
 performance_monitor:['performance monitor','monitor'],equalizer:['equalizer','eq'],library:['library'],voice:['voice','command'],sidebar:['sidebar','side panel'],
 all:['all'],albums:['album','albums'],mp3:['mp3','audio'],original_mp4:['original','mp4','video','videos'],karaoke_mp4:['karaoke']
};
const panelActionPhrases={open:['open','show','display','expand'],show:['show','display','open'],close:['close','hide','collapse'],hide:['hide','close'],toggle:['toggle']};
const mentions=(text,values)=>values.some(value=>(' '+text+' ').includes(' '+value+' '));
/** Validate every call and its grounding before any call is executed.
 * @param {unknown} calls @param {string} transcript
 */
export function validateCalls(calls,transcript){
 if(!Array.isArray(calls)||calls.length>8)throw new Error('Invalid tool-call list.');
 const namedPlayback=new Set(['play_media']);
 if(calls.some(call=>namedPlayback.has(call?.name))&&calls.some(call=>call?.name==='control_playback'&&call.arguments?.action==='play'))throw new Error('Conflicting named and current-track playback requests. Please name only the desired track.');
 const text=normalize(transcript);
 return calls.map(call=>{
  if(!call||typeof call!=='object'||Object.keys(call).some(key=>!['name','arguments'].includes(key))||!Object.hasOwn(keys,call.name))throw new Error('Unsupported tool call.');
  const args={...call.arguments};
  if(!call.arguments||typeof call.arguments!=='object'||Array.isArray(call.arguments)||Object.keys(args).some(key=>!keys[call.name].includes(key))||required[call.name].some(key=>!Object.hasOwn(args,key)))throw new Error('Invalid arguments for '+call.name+'.');
  for(const [key,value] of Object.entries(args)){
   if(key==='volume'){
    if(!Number.isInteger(value)||value<0||value>100)throw new Error('Volume must be an integer from 0 to 100.');
    if(!mentions(text,['volume','percent','louder','quieter'])||!new RegExp('(^|[^0-9])'+value+'([^0-9]|$)').test(transcript))throw new Error('Volume is not grounded in the typed command; use digits.');
   }else{
    if(typeof value!=='string'||value.length>160||(!value.trim()&&key!=='query'))throw new Error('Invalid '+key+'.');
    if(enums[call.name]?.[key]&&!enums[call.name][key].includes(value))throw new Error('Unsupported '+key+'.');
    if(['title','artist','album','query','preset'].includes(key)&&value){
     const normalizedValue=normalize(value),grounded=(' '+text+' ').includes(' '+normalizedValue+' ')||(key==='artist'&&(' '+text+' ').includes(' '+normalizedValue+'s '));
     if(!grounded)throw new Error(key+' was not present in the typed command.');
    }
    if(key==='preset'&&!presets.includes(value))throw new Error('Unknown EQ preset.');
   }
  }
  if(namedPlayback.has(call.name)&&!mentions(text,phrases.play)&&normalize(args.title)!==text)throw new Error('Playback was not requested.');
  if(namedPlayback.has(call.name)){
   const requestedFormat=mentions(text,['mp3','audio'])?'mp3':mentions(text,['mp4','video','videos','original video','original videos','karaoke'])?'mp4':null;
   const toolFormat=args.media_type;
   if(requestedFormat&&toolFormat!==requestedFormat)throw new Error('Needle omitted or changed the explicitly requested media format. Nothing was played.');
   if(!requestedFormat&&toolFormat!=='any')throw new Error('Needle added a media format that was not requested. Nothing was played.');
   const explicit=/^(?:please\s+)?(?:play|resume|continue)\s+(.+)$/i.exec(transcript.trim());
   if(explicit&&normalize(explicit[1]).split(' ')[0]!==normalize(args.title).split(' ')[0])throw new Error('Needle omitted the beginning of the requested title. Nothing was played.');
  }
  if(call.name==='control_playback'&&!mentions(text,phrases[args.action]||[]))throw new Error('Playback action was not grounded in the typed command.');
  if(call.name==='rewind_10_seconds'&&(!mentions(text,['rewind','backward','back'])||!/(^|[^0-9])10([^0-9]|$)/.test(transcript)))throw new Error('Rewind was not grounded in the typed command.');
  if(call.name==='skip_forward_10_seconds'&&(!mentions(text,['forward','skip','ahead'])||!/(^|[^0-9])10([^0-9]|$)/.test(transcript)))throw new Error('Forward seek was not grounded in the typed command.');
  const filterGrounding={show_mp3_files:'mp3',show_original_videos:'original_mp4',show_karaoke_files_or_videos:'karaoke_mp4',show_all_media_files:'all'};
  if(filterGrounding[call.name]&&(!mentions(text,['show','filter','list'])||!mentions(text,phrases[filterGrounding[call.name]])))throw new Error('Media filter was not grounded in the typed command.');
  if(call.name==='show_library_panel'&&(!mentions(text,['show','open','display'])||!mentions(text,['library'])))throw new Error('Showing the library was not grounded in the typed command.');
  if(call.name==='hide_media_library_panel'&&(!mentions(text,['hide','close'])||!mentions(text,['library'])))throw new Error('Hiding the library was not grounded in the typed command.');
  if(call.name==='show_graphic_equalizer_panel'&&(!mentions(text,['show','open','display'])||!mentions(text,['graphic equalizer','equalizer','eq'])))throw new Error('Showing the equalizer was not grounded in the typed command.');
  if(call.name==='close_graphic_equalizer_panel'&&(!mentions(text,['hide','close'])||!mentions(text,['graphic equalizer','equalizer','eq'])))throw new Error('Closing the equalizer was not grounded in the typed command.');
  if(call.name==='close_performance_monitor_panel'&&(!mentions(text,['hide','close'])||!mentions(text,['performance monitor','monitor'])))throw new Error('Closing the performance monitor was not grounded in the typed command.');
  if(call.name==='search_library'&&!mentions(text,['search','find','look for']))throw new Error('Library search was not grounded in the typed command.');
  if(call.name==='refresh_library'&&!mentions(text,['refresh','rescan','reload']))throw new Error('Library refresh was not grounded in the typed command.');
  if(call.name==='set_panel'&&(!mentions(text,phrases[args.section]||[])||!mentions(text,panelActionPhrases[args.action]||[])))throw new Error('Panel change was not grounded in the typed command.');
  return {name:call.name,arguments:{...args}};
 });
}
/** Execution depends only on application APIs, never model-authored code or DOM selectors.
 * @param {Array<{name:string,arguments:Record<string,unknown>}>} calls
 * @param {object} api
 * @param {{allowAmbiguousMedia?:boolean}} options
 */
export async function executeCalls(calls,api,{allowAmbiguousMedia=false}={}){
 const results=[];
 try { for(const {name,arguments:args} of calls){
  if(name==='play_media'){
   const {media_type,...mediaRequest}=args,format=media_type==='any'?null:media_type;
   const suffix={mp3:/\s+(?:mp3|audio)\s*$/i,mp4:/\s+(?:mp4|original\s+videos?|karaoke(?:\s+videos?)?|videos?)\s*$/i}[media_type];
   if(suffix)for(const key of ['title','artist','album'])if(mediaRequest[key]){
    const value=mediaRequest[key].replace(suffix,'').trim();if(value)mediaRequest[key]=value;
   }
   for(const key of ['artist','album'])if(normalize(mediaRequest[key]||'')===normalize(mediaRequest.title))delete mediaRequest[key];
   const match=api.matchMedia(format?{...mediaRequest,format}:mediaRequest);
   if(match.status==='ambiguous'&&allowAmbiguousMedia&&match.candidates.length){
    await api.playMedia(match.candidates[0].id);results.push('Playback requested: '+match.candidates[0].title);continue;
   }
   if(match.status!=='match'){api.showCandidates(match.candidates);results.push(match.message);break;}
   await api.playMedia(match.candidates[0].id);results.push('Playback requested: '+match.candidates[0].title);
  }else if(name==='control_playback'){await api.control(args.action);results.push(args.action.replaceAll('_',' '));}
  else if(name==='rewind_10_seconds'){await api.control('rewind_10');results.push('Rewind 10 seconds');}
  else if(name==='skip_forward_10_seconds'){await api.control('skip_10');results.push('Forward 10 seconds');}
  else if(name==='set_volume'){api.setVolume(args.volume/100);results.push('Volume '+args.volume+'%');}
  else if(name==='load_eq_preset'){api.setPreset(args.preset);results.push(args.preset+' EQ');}
  else if(['show_mp3_files','show_original_videos','show_karaoke_files_or_videos','show_all_media_files'].includes(name)){
   const media_type={show_mp3_files:'mp3',show_original_videos:'original_mp4',show_karaoke_files_or_videos:'karaoke_mp4',show_all_media_files:'all'}[name];
   await api.manageLibrary({action:'filter',media_type});results.push('Library filter: '+media_type);
  }
  else if(name==='show_library_panel'){api.manageInterface({section:'library',action:'show'});results.push('library show');}
  else if(name==='hide_media_library_panel'){api.manageInterface({section:'library',action:'hide'});results.push('library hide');}
  else if(name==='show_graphic_equalizer_panel'){api.manageInterface({section:'equalizer',action:'show'});results.push('equalizer show');}
  else if(name==='close_graphic_equalizer_panel'){api.manageInterface({section:'equalizer',action:'close'});results.push('equalizer close');}
  else if(name==='close_performance_monitor_panel'){api.manageInterface({section:'performance_monitor',action:'close'});results.push('performance monitor close');}
  else if(name==='search_library'){await api.manageLibrary({action:'search',query:args.query});results.push('Library search: '+args.query);}
  else if(name==='refresh_library'){await api.manageLibrary({action:'refresh'});results.push('Library refreshed');}
  else if(name==='set_panel'){api.manageInterface(args);results.push(args.section.replaceAll('_',' ')+' '+args.action);}
 }
 } catch(error){throw new Error((results.length?'Already applied: '+results.join(' · ')+'. Remaining action failed: ':'')+error.message);}
 return results;
}
