"""Build the public Media Deck extension without the private Suno module."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "extension"
DEFAULT_OUTPUT = ROOT / "dist" / "extension-store"

STORE_UI_IDS = [
    "youtubeSourcePanel", "youtubeUrl", "useYoutubeTab", "localMediaPanel",
    "mediaFolder", "browseMediaFolder", "browseMediaFile", "mediaSelect",
    "playSelectedMedia", "albumSplitter", "albumSourceStatus", "albumTracklist",
    "previewAlbum", "splitAlbum", "albumPreview", "saveFolderPanel", "fetch",
    "downloadMp4", "downloadMp3", "setupHelp", "status", "karaokePanel",
    "karaokeSummary", "editorCard", "title", "lyricsDetails", "lyricsSummary",
    "captionInfo", "cues", "renderCard", "layout", "folder", "browse", "render",
    "buildProgress", "progressMessage", "progressPercent", "progressBar",
    "resultCard", "output", "play", "log", "clearLog",
]

SUNO_ONLY_PREFIXES = (
    "let mediaRecorder=", "function elapsedLabel(", "function updateCaptureClock(",
    "function chooseTabAudio(", "function stopCaptureMedia(", "function bytesToBase64(",
    "async function sendCapturedAudio(", "async function finishTabRecording(",
    "async function startTabRecording(", "function stopTabRecording(",
    "ui.useSunoTab.onclick=", "ui.downloadSunoMp3.onclick=", "ui.recordStart.onclick=",
    "ui.recordStop.onclick=", "ui.recordRights.onchange=", "ui.sunoUrl.addEventListener(",
)

STORE_CONNECT = '''function connect(){
 if(port)return port;
 try{port=chrome.runtime.connectNative(HOST)}catch(error){status("Native host is not installed. Run setup, then reload this extension.");ui.setupHelp.classList.remove("hidden");appendLog(error.message);return null}
 port.onMessage.addListener(async message=>{
  clearTimeout(watchdog);
  if(message.type==="log"){ui.setupHelp.classList.add("hidden");appendLog(message.message);armWatchdog();return}
  if(message.type==="progress"){updateProgress(message.percent,message.message);armWatchdog();return}
  if(message.type==="browse_result"){outputDir=message.outputDir||"";ui.folder.textContent=outputDir||"Project output folder";busy(false);return}
  if(message.type==="media_library"){await chrome.storage.local.set({[MEDIA_FOLDER_KEY]:message.folder});renderMediaLibrary(message.folder,message.files||[]);status(`Loaded ${message.files?.length||0} local MP3 / MP4 files.`);return}
  if(message.type==="media_file"){renderMediaLibrary("",[message.file],message.file.path);status(`Selected local file: ${message.file.name}`);return}
  if(message.type==="media_library_cancelled"||message.type==="media_file_cancelled"){busy(false);status("Local media selection cancelled.");return}
  if(message.type==="album_tracks"){renderAlbumTracks(message.tracks||[]);busy(false);return}
  if(message.type==="album_split_complete"){ui.output.textContent=message.outputDir;ui.resultCard.classList.remove("hidden");ui.play.classList.add("hidden");updateProgress(100,`Album split complete: ${message.trackCount} tracks`);busy(false);status(`Album split complete. ${message.trackCount} MP3 tracks saved beside the source album.`);appendLog(`[complete] ${message.trackCount} tracks saved to ${message.outputDir}`);if(mediaFolderPath)send({action:"scan_media_folder",folder:mediaFolderPath});return}
  if(message.type==="transcript"){script=message.script;renderEditor();busy(false);status(`Loaded ${script.cues.length} ${script.caption_kind} caption cues. Review before rendering.`);return}
  if(message.type==="render_complete"){playbackUrl=message.playbackUrl;ui.play.classList.remove("hidden");ui.output.textContent=message.output;ui.resultCard.classList.remove("hidden");updateProgress(100,"Karaoke MP4 complete");busy(false);status("Karaoke MP4 complete. Press Play in New Tab when ready.");appendLog(`[complete] ${message.output}`);return}
  if(message.type==="download_complete"){await rememberDownload(message.format,message.output,"youtube");pendingOperationSource=null;ui.play.classList.add("hidden");ui.output.textContent=message.output;ui.resultCard.classList.remove("hidden");updateProgress(100,`${message.format.toUpperCase()} download complete`);busy(false);status(`${message.format.toUpperCase()} saved. Its green button now plays the local file.`);appendLog(`[complete] ${message.output}`);return}
  if(message.type==="playback_ready"){const label=pendingDownloadPlay?.toUpperCase()||"media";pendingDownloadPlay=null;busy(false);status(`Playing saved ${label} in a new tab.`);chrome.tabs.create({url:message.playbackUrl});return}
  if(message.type==="error"){pendingDownloadPlay=null;pendingOperationSource=null;busy(false);ui.progressMessage.textContent="Operation failed";status(`Error: ${message.message}`);appendLog(`[error] ${message.message}`)}
 });
 port.onDisconnect.addListener(()=>{const reason=chrome.runtime.lastError?.message||"Native host disconnected";appendLog(reason);port=null;pendingOperationSource=null;busy(false);if(reason.includes("not found")){ui.setupHelp.classList.remove("hidden");status("Native host is not installed. Run setup, then reload this extension.")}});
 return port
}'''


def rewrite_html(text: str) -> str:
    lines = [line for line in text.splitlines() if 'id="sunoSourcePanel"' not in line]
    lines = [line for line in lines if not line.lstrip().startswith("<style>.record-stop")]
    result = "\n".join(lines) + "\n"
    return result.replace(",.record-actions", "").replace(".record-actions,", "")


def rewrite_javascript(text: str) -> str:
    output: list[str] = []
    for line in text.splitlines():
        if line.startswith(SUNO_ONLY_PREFIXES):
            continue
        if line.startswith("const ui="):
            ids = json.dumps(STORE_UI_IDS, separators=(",", ":"))
            output.append(f"const ui=Object.fromEntries({ids}.map(id=>[id,document.getElementById(id)]));")
        elif line.startswith("let sourceDownloads="):
            output.append("let sourceDownloads={youtube:{mp4:null,mp3:null}};")
        elif line.startswith("function sessionSnapshot("):
            output.append('function sessionSnapshot(){if(script)script.title=ui.title.value.trim()||script.title;return{youtubeUrl:ui.youtubeUrl.value,outputDir,mediaFolderPath,playbackUrl,sourceDownloads,script,title:ui.title.value,layout:ui.layout.value,albumTracklist:ui.albumTracklist.value,folderLabel:ui.folder.textContent,mediaFolderLabel:ui.mediaFolder.textContent,mediaOptions:[...ui.mediaSelect.options].map(option=>({value:option.value,text:option.textContent,title:option.title})),selectedMedia:ui.mediaSelect.value,status:ui.status.textContent,log:ui.log.textContent,output:ui.output.textContent,progressHidden:ui.buildProgress.classList.contains("hidden"),progressValue:ui.progressBar.value,progressMessage:ui.progressMessage.textContent,resultHidden:ui.resultCard.classList.contains("hidden"),playHidden:ui.play.classList.contains("hidden"),karaokeHidden:ui.karaokePanel.classList.contains("hidden"),openPanels:Object.fromEntries(["youtubeSourcePanel","localMediaPanel","saveFolderPanel","karaokePanel","lyricsDetails","albumSplitter"].map(id=>[id,ui[id].open])),scrollY:window.scrollY,savedAt:Date.now()}}')
        elif line.startswith("async function restoreSession("):
            output.append('async function restoreSession(){const stored=await chrome.storage.local.get(SESSION_KEY),state=stored[SESSION_KEY];if(!state)return false;restoringSession=true;try{ui.youtubeUrl.value=state.youtubeUrl||"";outputDir=state.outputDir||"";mediaFolderPath=state.mediaFolderPath||"";playbackUrl=state.playbackUrl||"";if(state.sourceDownloads)sourceDownloads={youtube:{mp4:null,mp3:null,...(state.sourceDownloads.youtube||{})}};ui.layout.value=state.layout||ui.layout.value;ui.albumTracklist.value=state.albumTracklist||"";ui.folder.textContent=state.folderLabel||outputDir||"Project output folder";ui.mediaFolder.textContent=state.mediaFolderLabel||mediaFolderPath||"No folder selected";if(Array.isArray(state.mediaOptions)&&state.mediaOptions.length){ui.mediaSelect.innerHTML="";state.mediaOptions.forEach(saved=>{const option=document.createElement("option");option.value=saved.value||"";option.textContent=saved.text||saved.value||"Choose a directory or file…";option.title=saved.title||saved.value||"";ui.mediaSelect.appendChild(option)});ui.mediaSelect.value=state.selectedMedia||""}script=state.script||null;if(script){renderEditor();ui.title.value=state.title||script.title||""}ui.status.textContent=state.status||"Ready.";ui.log.textContent=state.log||"[ready] Side panel loaded.";ui.output.textContent=state.output||"";ui.progressBar.value=Number(state.progressValue)||0;ui.progressPercent.textContent=`${Math.round(Number(state.progressValue)||0)}%`;ui.progressMessage.textContent=state.progressMessage||"Waiting to start";ui.buildProgress.classList.toggle("hidden",state.progressHidden!==false);ui.resultCard.classList.toggle("hidden",state.resultHidden!==false);ui.play.classList.toggle("hidden",state.playHidden!==false);ui.karaokePanel.classList.toggle("hidden",state.karaokeHidden!==false);for(const [id,open] of Object.entries(state.openPanels||{}))if(ui[id])ui[id].open=Boolean(open);updateDownloadButtons("youtube");requestAnimationFrame(()=>window.scrollTo(0,Number(state.scrollY)||0));return true}finally{restoringSession=false}}')
        elif line.startswith("function sourceUrl("):
            output.append("function sourceUrl(){return ui.youtubeUrl.value.trim()}")
        elif line.startswith("function downloadStorageKey("):
            output.append('function downloadStorageKey(source,url){try{const parsed=new URL(url),id=parsed.hostname==="youtu.be"?parsed.pathname.split("/").filter(Boolean)[0]:parsed.searchParams.get("v");return id?`youtube:${id}`:`${source}:${parsed.origin}${parsed.pathname.replace(/\\/$/,"")}`}catch(_error){return `${source}:${url}`}}')
        elif line.startswith("function albumSourcePath("):
            output.append('function albumSourcePath(){const selected=ui.mediaSelect.value;if(selected.toLowerCase().endsWith(".mp3"))return selected;return sourceDownloads.youtube.mp3?.path||""}')
        elif line.startswith("function status(text)"):
            output.append('function status(text){ui.status.textContent=text;scheduleSessionSave()}function busy(value){ui.youtubeUrl.disabled=value;ui.useYoutubeTab.disabled=value;ui.fetch.disabled=value;ui.downloadMp4.disabled=value;ui.downloadMp3.disabled=value;ui.render.disabled=value;ui.browse.disabled=value;ui.browseMediaFolder.disabled=value;ui.browseMediaFile.disabled=value;ui.mediaSelect.disabled=value;ui.playSelectedMedia.disabled=value||!ui.mediaSelect.value;ui.previewAlbum.disabled=value;ui.splitAlbum.disabled=value||!albumSourcePath();if(!value)syncAlbumSource()}function updateProgress(percent,message){const value=Math.max(0,Math.min(100,Number(percent)||0));ui.saveFolderPanel.open=true;ui.buildProgress.classList.remove("hidden");ui.progressBar.value=value;ui.progressPercent.textContent=`${Math.round(value)}%`;ui.progressMessage.textContent=message||"Processing media";scheduleSessionSave()}')
        elif line.startswith("const sourceButtons="):
            output.append("const sourceButtons={youtube:{mp4:ui.downloadMp4,mp3:ui.downloadMp3}};")
        elif line.startswith("function updateDownloadButtons("):
            output.append('function updateDownloadButtons(source){for(const [kind,button] of Object.entries(sourceButtons[source])){const saved=sourceDownloads[source][kind];button.classList.toggle("downloaded",Boolean(saved));button.textContent=saved?`▶ Play ${kind.toUpperCase()}`:`Download ${kind.toUpperCase()}`;button.title=saved?.path||""}}')
        elif line.startswith("function resetDownloaded("):
            output.append('function resetDownloaded(source){sourceDownloads[source]={mp4:null,mp3:null};updateDownloadButtons(source)}')
        elif line.startswith("async function restoreDownloads("):
            output.append('async function restoreDownloads(source){const url=sourceUrl();if(!url){resetDownloaded(source);return}const stored=await chrome.storage.local.get(DOWNLOADS_KEY),all=stored[DOWNLOADS_KEY]||{},key=downloadStorageKey(source,url);sourceDownloads[source]={mp4:null,mp3:null,...(all[url]||{}),...(all[key]||{})};updateDownloadButtons(source)}')
        elif line.startswith("function connect("):
            output.extend(STORE_CONNECT.splitlines())
        elif line.startswith("async function activeSupportedUrl("):
            output.append('async function activeSupportedUrl(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const parsed=new URL(tab?.url||"");return /(^|\\.)youtube\\.com$/i.test(parsed.hostname)||parsed.hostname==="youtu.be"?tab.url:""}')
        elif line.startswith("async function useCurrentTab("):
            output.append('async function useCurrentTab(){try{const url=await activeSupportedUrl();if(!url)throw new Error("The active tab is not a supported media page.");const changed=ui.youtubeUrl.value.trim()!==url;ui.youtubeUrl.value=url;ui.youtubeSourcePanel.open=true;if(changed)resetDownloaded("youtube");await restoreDownloads("youtube");busy(false);ui.youtubeUrl.focus({preventScroll:true});await persistSession();status("Current media tab loaded.")}catch(error){busy(false);status(error.message)}}')
        elif line.startswith("ui.useYoutubeTab.onclick="):
            output.append('ui.useYoutubeTab.onclick=useCurrentTab;')
        elif line.startswith("ui.fetch.onclick="):
            output.append('ui.fetch.onclick=()=>{const url=sourceUrl();if(!url)return status("Enter a supported media URL first.");busy(true);status("Fetching timed captions without downloading the video…");appendLog(`[info] Fetching captions for ${url}`);send({action:"fetch_transcript",url})};')
        elif line.startswith("function directDownload("):
            output.append('function directDownload(action,label,source){const url=sourceUrl();if(!url)return status("Enter a supported media URL first.");pendingOperationSource=source;playbackUrl="";busy(true);updateProgress(0,`Starting ${label} download`);ui.resultCard.classList.add("hidden");status(`Downloading ${label}…`);appendLog(`[info] Downloading ${label} from ${url}`);send({action,url,outputDir})}')
        elif line.startswith("function downloadOrPlay("):
            output.append('function downloadOrPlay(source,kind){const saved=sourceDownloads[source][kind];if(saved?.path){pendingDownloadPlay=`${source} ${kind}`;busy(true);status(`Opening saved ${kind.toUpperCase()}…`);send({action:"play_file",path:saved.path});return}directDownload(`download_${kind}`,kind.toUpperCase(),source)}')
        elif line.startswith('document.addEventListener("input",scheduleSessionSave)'):
            output.append('document.addEventListener("input",scheduleSessionSave);document.addEventListener("change",scheduleSessionSave);for(const id of ["youtubeSourcePanel","localMediaPanel","saveFolderPanel","karaokePanel","lyricsDetails","albumSplitter"])ui[id].addEventListener("toggle",scheduleSessionSave);new MutationObserver(scheduleSessionSave).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["class","open"]});document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")persistSession().catch(()=>{})});window.addEventListener("pagehide",()=>persistSession().catch(()=>{}));')
        elif line.startswith("async function initializeSidePanel("):
            output.append('async function initializeSidePanel(){const restored=await restoreSession();const nativeConnection=connect();if(nativeConnection)nativeConnection.onMessage.addListener(message=>{if(message.type==="download_complete"&&message.format==="mp3"){selectAlbumSourceFile(message.output);setTimeout(()=>status("MP3 saved and selected in Album Splitter. Paste the track list and press Split Album MP3."),50)}});const stored=await chrome.storage.local.get(MEDIA_FOLDER_KEY),folder=mediaFolderPath||(!restored?stored[MEDIA_FOLDER_KEY]:"");if(folder)send({action:"scan_media_folder",folder});try{const mediaUrl=await activeSupportedUrl();if(mediaUrl&&(!restored||!ui.youtubeUrl.value)){ui.youtubeUrl.value=mediaUrl;resetDownloaded("youtube")}}catch(_error){}await restoreDownloads("youtube");busy(false);scheduleSessionSave()}')
        else:
            output.append(line)
    return "\n".join(output) + "\n"


def build(output: Path) -> None:
    if output.exists():
        shutil.rmtree(output)
    shutil.copytree(SOURCE, output)
    manifest_path = output / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["name"] = "Media Deck"
    manifest["description"] = "Create karaoke from timed captions, organize local media, and control private playback from Media Deck."
    manifest["permissions"] = ["storage", "nativeMessaging", "sidePanel"]
    manifest["host_permissions"] = ["https://www.youtube.com/*", "https://youtu.be/*", "http://127.0.0.1:8765/*"]
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    html_path = output / "sidepanel.html"
    html_path.write_text(rewrite_html(html_path.read_text(encoding="utf-8")), encoding="utf-8")
    js_path = output / "sidepanel.js"
    js_path.write_text(rewrite_javascript(js_path.read_text(encoding="utf-8")), encoding="utf-8")
    combined = html_path.read_text(encoding="utf-8") + js_path.read_text(encoding="utf-8") + manifest_path.read_text(encoding="utf-8")
    forbidden = ["suno", "getdisplaymedia", "mediarecorder", "capture_begin", "capture_chunk", "capture_end", "recordrights", "recordstart"]
    found = [token for token in forbidden if token in combined.lower()]
    if found:
        raise RuntimeError(f"Store build still contains excluded feature tokens: {', '.join(found)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    build(args.output.resolve())
    print(args.output.resolve())


if __name__ == "__main__":
    main()
