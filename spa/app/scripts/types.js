/**
 * @typedef {'mp3'|'original_mp4'|'karaoke_mp4'} MediaKind
 * @typedef {{id:string, title:string, kind:MediaKind, reason:string, file:File|string, source?:'shared', relativePath?:string, artist?:string, album?:string, albumKey?:string, track?:number|null, metadataSource?:string, modified?:number}} MediaItem
 * @typedef {'empty'|'loading'|'ready'|'playing'|'paused'|'stopped'|'ended'|'error'} PlaybackStatus
 * @typedef {{mediaId:string|null, status:PlaybackStatus, position:number, duration:number, volume:number, error:string|null}} PlaybackState
 * @typedef {{load:(file:File|string)=>void, play:()=>Promise<void>, pause:()=>void, seek:(seconds:number)=>void, setVolume:(volume:number)=>void, dispose:()=>void, on:(listener:(event:string)=>void)=>()=>void, read:()=>{position:number,duration:number,paused:boolean,ended:boolean,error:boolean}}} MediaPort
 * @typedef {'all'|'albums'|MediaKind} LibraryFilter
 */
export {};
